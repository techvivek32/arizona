import { audit } from "@/lib/audit";
import { getCurrentAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";
import { readConversation } from "@/lib/chat-repo";
import { chatRoute, notFound, staffCaller } from "@/lib/chat-routes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET `?after=` — the chat and its messages (only what changed since `after`). */
export async function GET(request: Request, ctx: Ctx) {
  return chatRoute(request, async () => {
    const caller = await staffCaller();
    const after = new URL(request.url).searchParams.get("after");
    const id = (await ctx.params).id;
    const result = await readConversation(id, caller, after);
    // Opening the chat is logged; the polls that follow (with ?after=) aren't.
    if (result && !after) await audit(await getCurrentAdmin(), "chat.open", { type: "chat", id });
    return result ? NextResponse.json(result) : notFound();
  });
}
