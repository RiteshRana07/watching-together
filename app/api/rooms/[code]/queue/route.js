import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, addToQueue, listQueue } = require("../../../../../lib/db");
const { verifyToken } = require("../../../../../lib/auth");
const { resolveVideoInfo } = require("../../../../../lib/youtube");
const pusher = require("../../../../../lib/pusher");

function requireUser() {
  const token = cookies().get("wt_session")?.value;
  return token && verifyToken(token);
}

export async function GET(req, { params }) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const room = await getRoomByCode(params.code.toUpperCase());
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const queue = await listQueue(room.id);
  return NextResponse.json({ queue });
}

// Anyone in the room can add a video to the queue — like a jukebox.
// Only the host can actually play it (see queue/[itemId]/play).
export async function POST(req, { params }) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const { videoUrl } = await req.json();
  if (!videoUrl) return NextResponse.json({ error: "Missing video URL" }, { status: 400 });

  const info = await resolveVideoInfo(videoUrl);
  const queue = await addToQueue({
    roomId: room.id,
    ...info,
    addedBy: payload.username,
  });

  await pusher.trigger(`presence-room-${code}`, "room:queue-changed", { queue });

  return NextResponse.json({ queue });
}
