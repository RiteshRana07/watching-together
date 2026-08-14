import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, removeFromQueue, listQueue } = require("../../../../../../lib/db");
const { verifyToken } = require("../../../../../../lib/auth");
const pusher = require("../../../../../../lib/pusher");

export async function DELETE(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_id !== payload.userId) {
    return NextResponse.json({ error: "Only the host can remove queue items" }, { status: 403 });
  }

  await removeFromQueue(params.itemId, room.id);
  const queue = await listQueue(room.id);

  await pusher.trigger(`presence-room-${code}`, "room:queue-changed", { queue });

  return NextResponse.json({ queue });
}
