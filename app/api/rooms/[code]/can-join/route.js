import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { verifyToken } = require("../../../../../lib/auth");
const { getRoomByCode } = require("../../../../../lib/db");
const pusher = require("../../../../../lib/pusher");

// This is the same capacity check the Pusher presence-channel auth route
// runs — but that route only gates the live chat/sync connection. Without
// this separate check, a room "at capacity" would still load fine (the
// video plays, since fetching room info doesn't check capacity) with only
// chat/sync silently failing — which looked like the cap wasn't enforced
// at all. The room page calls this before rendering anything.
export async function GET(req, { params }) {
  const code = params.code.toUpperCase();
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) {
    return NextResponse.json({ allowed: false, reason: "signin" }, { status: 401 });
  }

  const room = await getRoomByCode(code);
  if (!room) {
    return NextResponse.json({ allowed: false, reason: "notfound" }, { status: 404 });
  }

  const isHost = payload.userId === room.host_id;
  if (isHost || !room.max_participants) {
    return NextResponse.json({ allowed: true });
  }

  try {
    const usersRes = await pusher.get({ path: `/channels/presence-room-${code}/users` });
    const usersData = await usersRes.json();
    const currentUsers = usersData.users || [];
    const alreadyIn = currentUsers.some((u) => u.id === payload.userId);
    if (alreadyIn || currentUsers.length < room.max_participants) {
      return NextResponse.json({ allowed: true });
    }
    return NextResponse.json({ allowed: false, reason: "full" });
  } catch {
    // Fail open on a transient Pusher API error rather than locking
    // everyone out of a room because of an unrelated outage.
    return NextResponse.json({ allowed: true });
  }
}
