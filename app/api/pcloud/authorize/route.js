import { NextResponse } from "next/server";

// One-time setup: visit /api/pcloud/authorize while signed into your pCloud
// account in the browser. It sends you to pCloud to approve access, then
// pCloud redirects back to /api/pcloud/callback with a code we exchange
// for a permanent access token.
export async function GET(req) {
  const clientId = process.env.PCLOUD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Set PCLOUD_CLIENT_ID (and PCLOUD_CLIENT_SECRET) first." },
      { status: 500 }
    );
  }

  const redirectUri =
    process.env.PCLOUD_REDIRECT_URI || `${new URL(req.url).origin}/api/pcloud/callback`;

  const authorizeUrl = new URL("https://my.pcloud.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(authorizeUrl.toString());
}
