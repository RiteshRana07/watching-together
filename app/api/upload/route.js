import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { verifyToken } = require("../../../lib/auth");
const { createUploadLink, uploadFileProxy } = require("../../../lib/pcloud");

export const runtime = "nodejs";

function requireUser() {
  const token = cookies().get("wt_session")?.value;
  return token && verifyToken(token);
}

// GET: issues a short-lived pCloud upload link for the browser to POST the
// file to directly — bypassing our server (and its request-size limit)
// entirely, the same reason Vercel Blob's client tokens were used before.
export async function GET() {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const { uploadUrl, code } = await createUploadLink({ comment: `by ${payload.username}` });
    return NextResponse.json({ uploadUrl, code });
  } catch (error) {
    console.error("pCloud createUploadLink failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: fallback proxy path, used automatically by the library page only
// if the direct browser upload above fails (e.g. pCloud blocks the
// cross-origin request). Routes the file through this serverless function,
// so it's subject to Vercel's ~4.5MB request body limit — same constraint
// that existed before Vercel Blob's client-upload flow was added.
const MAX_PROXY_BYTES = 4 * 1024 * 1024; // stay safely under Vercel's cap

export async function POST(request) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_PROXY_BYTES) {
    return NextResponse.json(
      {
        error:
          "This file is too large for the fallback upload path (direct-to-pCloud upload failed, likely a CORS restriction on pCloud's side). Files over ~4MB need the direct path working — see the README's pCloud section.",
      },
      { status: 413 }
    );
  }

  try {
    const fileid = await uploadFileProxy(file, file.name);
    return NextResponse.json({ fileid });
  } catch (error) {
    console.error("pCloud proxy upload failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
