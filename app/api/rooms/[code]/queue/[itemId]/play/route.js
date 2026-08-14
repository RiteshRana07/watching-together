import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const {
  getRoomByCode,
  getQueueItem,
  updateRoomCurrentVideo,
  isHostOrCoHost,
} = require("../../../../../../../lib/db");
const { verifyToken } = require("../../../../../../../lib/auth");
const pusher = require("../../../../../../../lib/pusher");

export async function POST(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isHostOrCoHost(room, payload.userId))) {
    return NextResponse.json(
      { error: "Only the host or a co-host can play something from the queue" },
      { status: 403 }
    );
  }

  const item = await getQueueItem(params.itemId, room.id);
  if (!item) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });

  // Playing an item does NOT remove it from the queue — it stays there so
  // it can be referenced or replayed later. Only the host's explicit
  // "remove" (✕) button deletes a queue entry.
  const updated = await updateRoomCurrentVideo(code, {
    videoUrl: item.video_url,
    videoTitle: item.video_title,
    videoSource: item.video_source,
  });

  await pusher.trigger(`presence-room-${code}`, "room:video-changed", {
    videoUrl: updated.current_video_url,
    videoTitle: updated.current_video_title,
    videoSource: updated.current_video_source,
  });

  return NextResponse.json({ room: updated });
}
