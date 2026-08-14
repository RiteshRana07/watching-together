import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, getMessages } = require("../../../../../lib/db");
const { verifyToken } = require("../../../../../lib/auth");

// Only the host gets persisted chat history. Non-host participants only see
// messages sent live during their current visit (see components/Chat.js) —
// this route intentionally isn't used for them. Messages are deleted along
// with the room (room_messages has ON DELETE CASCADE on room_id).
export async function GET(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const room = await getRoomByCode(params.code.toUpperCase());
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_id !== payload.userId) {
    return NextResponse.json({ error: "Only the host can view chat history" }, { status: 403 });
  }

  const messages = await getMessages(room.id);
  return NextResponse.json({ messages });
}
