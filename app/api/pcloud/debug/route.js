import { NextResponse } from "next/server";

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
    return NextResponse.json({
      ...info,
      pcloud_raw_response: data,
    });
  } catch (err) {
    return NextResponse.json({
      ...info,
      pcloud_live_check_error: err.cause?.message || err.cause?.code || err.message,
    });
  }
}
