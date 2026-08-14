import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, updateRoomCurrentVideo, isHostOrCoHost } = require("../../../../../lib/db");
const { verifyToken } = require("../../../../../lib/auth");
const pusher = require("../../../../../lib/pusher");

// The room's original video (set at creation) is permanent — this route
// switches "now playing" back to it after the room has moved on to a
// queued/temporary video, without ever modifying the original itself.
export async function POST(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isHostOrCoHost(room, payload.userId))) {
    return NextResponse.json({ error: "Only the host or a co-host can do that" }, { status: 403 });
  }

  const updated = await updateRoomCurrentVideo(code, {
    videoUrl: room.video_url,
    videoTitle: room.video_title,
    videoSource: room.video_source,
  });

  await pusher.trigger(`presence-room-${code}`, "room:video-changed", {
    videoUrl: updated.current_video_url,
    videoTitle: updated.current_video_title,
    videoSource: updated.current_video_source,
  });

  return NextResponse.json({ room: updated });
}
