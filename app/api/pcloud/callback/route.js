import { NextResponse } from "next/server";

// pCloud sends the user back here with ?code=... after they approve access.
// We exchange that code for a permanent access token server-side (using
// the client secret, which never touches the browser) and show it back to
// the person doing setup, once, so they can copy it into
// PCLOUD_ACCESS_TOKEN (and PCLOUD_API_HOST) in their environment variables
// and redeploy. There's nowhere safer to persist it automatically without
// adding a secrets-management system, so this is a manual last step.
export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const clientId = process.env.PCLOUD_CLIENT_ID;
  const clientSecret = process.env.PCLOUD_CLIENT_SECRET;

  if (!code) {
    return new Response("Missing ?code from pCloud — start over at /api/pcloud/authorize", {
      status: 400,
    });
  }
  if (!clientId || !clientSecret) {
    return new Response("PCLOUD_CLIENT_ID / PCLOUD_CLIENT_SECRET aren't set.", { status: 500 });
  }

  // pCloud accounts live on one of two regional API hosts; the token
  // exchange response tells us which one this account uses.
  const tokenRes = await fetch(
    `https://api.pcloud.com/oauth2_token?client_id=${clientId}&client_secret=${clientSecret}&code=${code}`
  );
  const tokenData = await tokenRes.json();

  if (tokenData.result !== 0 || !tokenData.access_token) {
    return new Response(
      `pCloud token exchange failed: ${tokenData.error || JSON.stringify(tokenData)}`,
      { status: 400 }
    );
  }

  const apiHost = tokenData.hostname || "api.pcloud.com";

  return new Response(
    `<!DOCTYPE html>
<html><body style="font-family: monospace; background: #111; color: #eee; padding: 40px; line-height: 1.6;">
<h2>pCloud connected ✅</h2>
<p>Copy these into your Vercel project's Environment Variables, then redeploy:</p>
<pre style="background:#000; padding:16px; border-radius:8px; white-space:pre-wrap;">PCLOUD_ACCESS_TOKEN=${tokenData.access_token}
PCLOUD_API_HOST=${apiHost}</pre>
<p style="color:#f88;">This token grants full access to this pCloud account — treat it like a password. Don't share this page or commit the token to source control.</p>
</body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
