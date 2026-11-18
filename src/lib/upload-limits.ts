/**
 * Uploads must fit in one request Vercel accepts (4.5 MB, a platform limit
 * the app can't raise). Each picture is kept at or under 4 MB, and a form
 * that sends several (check-in) is checked as a whole before it is sent.
 * Shared by the browser (to say so clearly) and the server (to refuse).
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_BYTES = Math.floor(4.4 * 1024 * 1024);

/**
 * In the browser: a picture over `maxBytes` (or wider than `maxSide`) is
 * redrawn as a JPEG at most `maxSide` pixels across; smaller ones go as they
 * are. Returns the original if the browser can't read it (e.g. HEIC outside
 * Safari) — the size check after this then decides.
 */
export async function shrinkImage(file: File, maxSide = 1600, maxBytes = 1.5 * 1024 * 1024, quality = 0.85): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= maxBytes && file.type !== "image/heic" && file.type !== "image/heif") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
