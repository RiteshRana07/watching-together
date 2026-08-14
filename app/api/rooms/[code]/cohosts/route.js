import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, listCoHosts } = require("../../../../../lib/db");
const { verifyToken } = require("../../../../../lib/auth");

// Lets a co-host's permission survive a page refresh — the room page loads
// this once and seeds it into local "controllers" state, instead of only
// ever learning about co-host status from a live room:grant-control event.
export async function GET(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const room = await getRoomByCode(params.code.toUpperCase());
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const coHostIds = await listCoHosts(room.id);
  return NextResponse.json({ coHostIds });
}
