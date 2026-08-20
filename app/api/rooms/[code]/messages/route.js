import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, getUserById, getMessages } = require("../../../../../lib/db");
const { verifyToken } = require("../../../../../lib/auth");
const { isSuperHostEmail } = require("../../../../../lib/superhost");

// Only the room's host, or the site-wide super-host account, gets
// persisted chat history back. Everyone else only sees messages sent
// live during their own visit (see components/Chat.js) — this route
// intentionally isn't used for them. Messages are deleted along with the
// room (room_messages has ON DELETE CASCADE on room_id).
export async function GET(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const room = await getRoomByCode(params.code.toUpperCase());
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const user = await getUserById(payload.userId);
  const allowed = room.host_id === payload.userId || isSuperHostEmail(user?.email);
  if (!allowed) {
    return NextResponse.json({ error: "Only the host can view chat history" }, { status: 403 });
  }

  const messages = await getMessages(room.id);
  return NextResponse.json({ messages });
}
