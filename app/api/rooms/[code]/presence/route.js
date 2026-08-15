import { NextResponse } from "next/server";
const pusher = require("../../../../../lib/pusher");

export async function GET(req, { params }) {
  const code = params.code.toUpperCase();
  try {
    const result = await pusher.get({
      path: `/channels/presence-room-${code}`,
      params: { info: "user_count" },
    });
    const data = await result.json();
    return NextResponse.json({ count: data.user_count || 0 });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
