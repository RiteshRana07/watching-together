import { NextResponse } from "next/server";
const { getFreshFileUrl } = require("../../../../lib/pcloud");

// pCloud's direct-download links expire after a few hours, so we never
// store one directly as a movie's video_url. Instead, video_url is
// "/api/stream/<fileid>" (a stable URL on our own domain) and this route
// resolves a brand-new pCloud link every time it's hit, then redirects.
// The browser's <video> element follows the redirect transparently, so
// playback works the same as a permanent URL would — it just re-resolves
// on each new request instead of ever going stale.
export async function GET(req, { params }) {
  try {
    const freshUrl = await getFreshFileUrl(params.fileid);
    return NextResponse.redirect(freshUrl, { status: 302 });
  } catch (error) {
    console.error("Failed to resolve pCloud stream link:", error);
    return NextResponse.json({ error: "Couldn't load this video from pCloud" }, { status: 502 });
  }
}
