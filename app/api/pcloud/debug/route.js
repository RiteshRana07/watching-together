import { NextResponse } from "next/server";

// TEMPORARY diagnostic route — not linked from anywhere in the app.
// Visit it directly in your browser: /api/pcloud/debug
//
// This exists purely to stop guessing. It shows exactly what the live,
// currently-deployed server sees for your pCloud env vars (masked, safe to
// screenshot), and makes a real call to pCloud's userinfo endpoint so you
// see pCloud's own raw response — no wrapping, no interpretation.
//
// Delete this file once the upload is working — it's not something that
// should stay in a production app long-term, even though it doesn't leak
// the full token.
export async function GET() {
  const rawHost = process.env.PCLOUD_API_HOST;
  const token = process.env.PCLOUD_ACCESS_TOKEN;

  const info = {
    PCLOUD_API_HOST_raw_value: rawHost || "(not set — falls back to api.pcloud.com)",
    PCLOUD_ACCESS_TOKEN_is_set: !!token,
    PCLOUD_ACCESS_TOKEN_length: token ? token.length : 0,
    PCLOUD_ACCESS_TOKEN_preview: token ? `${token.slice(0, 6)}...${token.slice(-4)}` : null,
    PCLOUD_ACCESS_TOKEN_has_surrounding_whitespace: token ? token !== token.trim() : null,
  };

  if (!token) {
    return NextResponse.json({ ...info, pcloud_live_check: "skipped — no token set" });
  }

  // Actually call pCloud right now, live, using exactly what this route
  // computes as the host (same logic as lib/pcloud.js's apiHost()).
  const cleanHost = (rawHost || "api.pcloud.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");

  try {
    const res = await fetch(`https://${cleanHost}/userinfo?access_token=${token}`);
    const data = await res.json();
    return NextResponse.json({
      ...info,
      host_actually_used: cleanHost,
      pcloud_raw_response: data,
    });
  } catch (err) {
    return NextResponse.json({
      ...info,
      host_actually_used: cleanHost,
      pcloud_live_check_error: err.cause?.message || err.cause?.code || err.message,
    });
  }
}
