import { safeError } from "./log";
import { NextResponse } from "next/server";
import { ForbiddenError, requireAdmin, requireStaff, requireTeam, UnauthorizedError } from "./auth";
import { crossSiteBlocked } from "./csrf";
import type { Admin } from "./models";

/** A bad request whose message is safe to show (e.g. unreadable JSON). */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function failure(error: unknown): NextResponse {
  if (error instanceof BadRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  // Details go to the server log, never to the browser.
  console.error("admin route failed", safeError(error));
  return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
}

/**
 * Wraps an admin route handler: only full admins get in (provider accounts
 * get a 403), and thrown errors become JSON responses so each route can stay
 * focused on its own work.
 */
export function adminRoute<T extends unknown[]>(
  handler: (request: Request, ...args: T) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    const csrf = crossSiteBlocked(request);
    if (csrf) return csrf;
    try {
      await requireAdmin();
      return await handler(request, ...args);
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * Like adminRoute, but open to front-desk staff accounts too — the website,
 * appointment slots, bookings and patient emails. Providers get a 403.
 */
export function teamRoute<T extends unknown[]>(
  handler: (request: Request, ...args: T) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    const csrf = crossSiteBlocked(request);
    if (csrf) return csrf;
    try {
      await requireTeam();
      return await handler(request, ...args);
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * Like adminRoute, but open to provider accounts too. The handler receives
 * the signed-in account and must limit a provider to their own records.
 */
export function staffRoute<T extends unknown[]>(
  handler: (request: Request, staff: Admin, ...args: T) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: T): Promise<NextResponse> => {
    const csrf = crossSiteBlocked(request);
    if (csrf) return csrf;
    try {
      const staff = await requireStaff();
      return await handler(request, staff, ...args);
    } catch (error) {
      return failure(error);
    }
  };
}

/** JSON bodies here are small forms; anything bigger is refused before it is read. */
const MAX_JSON_BYTES = 1024 * 1024;

export async function readJson<T>(request: Request): Promise<T> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) {
    throw new BadRequestError("That request is too large");
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}
