import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const crypto = require("crypto");

const { verifyToken } = require("../../../../lib/auth");

const {
  getOrCreateUserFolder,
  createUploadLink,
} = require("../../../../lib/pcloud");

const { createStorageUpload } = require("../../../../lib/db");

export const runtime = "nodejs";

function getCurrentUser() {
  try {
    const token = cookies().get("wt_session")?.value;
    if (!token) return null;
    const payload = verifyToken(token);
    if (!payload?.userId) return null;
    return payload;
  } catch (error) {
    console.error("[storage upload-link] auth error:", error);
    return null;
  }
}

/*
 * GET /api/storage/upload-link
 *
 * Returns a short-lived pCloud upload link scoped to the signed-in user's
 * own folder. The browser then POSTs the file straight to pCloud using
 * this link — bypassing this Next.js server (and Vercel's serverless
 * request body size limit) for the actual video bytes. Falls back to the
 * existing /api/storage/upload proxy route only if this direct path fails
 * client-side (e.g. a network/CORS issue) — see app/library/page.js.
 */
export async function GET() {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const userFolder = await getOrCreateUserFolder(
      user.userId,
      user.username
    );

    const { code, uploadLinkId, uploadUrl } = await createUploadLink({
      folderId: userFolder.folderId,
      comment: `${user.username || user.userId} upload`,
    });

    // Tracked in storage_uploads (a table that already existed in the
    // schema for exactly this purpose, just never wired up until now).
    // Not load-bearing for playback — purely for visibility/cleanup.
    const uploadId = crypto.randomUUID();
    try {
      await createStorageUpload({
        id: uploadId,
        ownerId: user.userId,
        folderId: userFolder.folderId,
        uploadLinkId,
        code,
        objectName: null,
        size: null,
        progressHash: null,
      });
    } catch (err) {
      // Non-fatal — the upload link itself still works even if this
      // bookkeeping insert fails for some reason.
      console.error("[storage upload-link] tracking insert failed:", err);
    }

    return NextResponse.json({
      ok: true,
      uploadUrl,
      code,
      folderId: userFolder.folderId,
      folderName: userFolder.folderName,
    });
  } catch (error) {
    console.error("[storage upload-link] ERROR:", error);
    // error.status here is often pCloud's own HTTP transport status (which
    // is frequently 200 even for an API-level failure like "Log in
    // required" — pCloud encodes the real error in the JSON `result`
    // field, not the HTTP status). Blindly reusing that as OUR status
    // meant this route could return HTTP 200 with an error body, which
    // fetch()'s `.ok` check reads as success — silently hiding the
    // failure from the client entirely. Only reuse it if it's already a
    // genuine HTTP error code; otherwise this is a real server error.
    const upstreamStatus = Number(error?.status);
    const status =
      upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 500;
    return NextResponse.json(
      { error: error?.message || "Couldn't create an upload link." },
      { status }
    );
  }
}
