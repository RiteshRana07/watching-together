import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const { verifyToken } = require("../../../../lib/auth");
const {
  getUploadLinkCode,
  getUploadLinkUrl,
  validateVideo,
  MAX_VIDEO_BYTES,
} = require("../../../../lib/pcloud");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCurrentUser() {
  try {
    const token = cookies().get("wt_session")?.value;
    const payload = token ? verifyToken(token) : null;
    return payload?.userId ? payload : null;
  } catch {
    return null;
  }
}

function jsonError(error, status = 400) {
  console.error("[storage upload]", error);
  return NextResponse.json(
    { error: error?.message || "Storage operation failed." },
    { status }
  );
}

/*
 * IMPORTANT:
 * The video bytes are NOT accepted by this Next.js route.
 *
 * The route only prepares a direct pCloud Upload Link request.
 * This avoids sending multi-GB videos through Railway/Next.js.
 */
export async function POST(request) {
  const user = getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    const title = String(body?.title || "").trim();
    const filename = String(body?.filename || "video.mp4").trim();
    const contentType = String(body?.contentType || "").trim();
    const size = Number(body?.size);

    if (!title) {
      return NextResponse.json(
        { error: "Movie title is required." },
        { status: 400 }
      );
    }

    validateVideo({ filename, contentType, size });

    if (size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: "Video is too large. Maximum size is 3 GB." },
        { status: 400 }
      );
    }

    const code = getUploadLinkCode();

    /*
     * Unique name lets the server identify this upload after
     * pCloud's public Upload Link has received it.
     */
    const crypto = require("crypto");
    const base = filename
      .normalize("NFKC")
      .replace(/[\\/\0]+/g, "-")
      .replace(/[^a-zA-Z0-9._ -]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/-+/g, "-")
      .trim()
      .replace(/^[. -]+|[. -]+$/g, "")
      .slice(0, 150) || "video.mp4";

    const objectName = `${String(user.userId).slice(0, 40)}-${Date.now()}-${crypto.randomUUID()}-${base}`;

    return NextResponse.json({
      ok: true,
      uploadUrl: getUploadLinkUrl(user.username || `user-${user.userId}`),
      uploadLinkCode: code,
      objectName,
      filename: objectName,
      size,
      contentType,
    });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function GET() {
  const user = getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Storage upload API is working.",
    mode: "direct-pcloud-upload-link",
    userId: user.userId,
    username: user.username || null,
  });
}
