import { NextResponse } from "next/server";
const { getOrCreateUserFolder, createUploadLink } = require("../../../../lib/pcloud");

export const runtime = "nodejs";

// TEMPORARY diagnostic route — visit directly at /api/pcloud/debug
//
// Settles, with one screenshot, whether this LIVE Vercel deployment is
// actually running the pCloud credentials you think it is. It's easy for
// a local .env file and Vercel's dashboard values to quietly drift apart
// (or for an env var edit to be saved without triggering an actual
// redeploy, which means the old value is still what's running) — this
// shows the real, current, running values instead of guessing.
//
// Safe to leave temporarily (token is masked), but delete it once the
// upload issue is resolved.
export async function GET() {
  const rawHost = process.env.PCLOUD_API_HOST;
  const token = process.env.PCLOUD_ACCESS_TOKEN;

  const apiHost = (rawHost || "https://api.pcloud.com").replace(/\/$/, "");

  const info = {
    PCLOUD_API_HOST_raw_value: rawHost || "(not set — falling back to https://api.pcloud.com)",
    PCLOUD_API_HOST_actually_used: apiHost,
    PCLOUD_ACCESS_TOKEN_is_set: !!token,
    PCLOUD_ACCESS_TOKEN_length: token ? token.length : 0,
    PCLOUD_ACCESS_TOKEN_preview: token ? `${token.slice(0, 6)}...${token.slice(-4)}` : null,
    PCLOUD_FOLDER_raw_value: process.env.PCLOUD_FOLDER || "(not set — falling back to /WatchTogether)",
  };

  if (!token) {
    return NextResponse.json({ ...info, pcloud_live_check: "skipped — no token set" });
  }

  try {
    const res = await fetch(`${apiHost}/userinfo?access_token=${token}`);
    const data = await res.json();
    const results = { ...info, pcloud_raw_response: data };

    // Now test the EXACT path the real upload feature uses — userinfo
    // succeeding doesn't prove folder creation or upload-link creation
    // work too. pCloud OAuth apps can have different read vs. write
    // permission scopes, and this is the most likely explanation for
    // "userinfo works, but the real feature still says Log in required."
    try {
      const folder = await getOrCreateUserFolder("debug-test-user", "debug-test");
      results.folder_test = { ok: true, folder };

      try {
        const link = await createUploadLink({
          folderId: folder.folderId,
          comment: "debug test",
        });
        results.upload_link_test = { ok: true, link };
      } catch (linkErr) {
        results.upload_link_test = {
          ok: false,
          error: linkErr.message,
          status: linkErr.status,
          code: linkErr.code,
        };
      }
    } catch (folderErr) {
      results.folder_test = {
        ok: false,
        error: folderErr.message,
        status: folderErr.status,
        code: folderErr.code,
      };
    }

    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json({
      ...info,
      pcloud_live_check_error: err.cause?.message || err.cause?.code || err.message,
    });
  }
}
