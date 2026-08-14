import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const pusher = require("../../../../lib/pusher");
const { verifyToken } = require("../../../../lib/auth");
const { getRoomByCode } = require("../../../../lib/db");

export async function POST(req) {
  const formData = await req.formData();
  const socketId = formData.get("socket_id");
  const channelName = formData.get("channel_name");

  if (!socketId || !channelName) {
    return NextResponse.json({ error: "Missing socket_id or channel_name" }, { status: 400 });
  }

  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);

  // Joining a room requires an account — no anonymous guests. This is
  // enforced here (not just in the UI) so a bookmarked/shared room link
  // can't be used to skip sign-in.
  if (!payload) {
    return NextResponse.json({ error: "Sign in required to join this room" }, { status: 403 });
  }

  const code = channelName.replace(/^presence-room-/, "").toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const isHost = payload.userId === room.host_id;

  if (room.max_participants && !isHost) {
    try {
      const usersRes = await pusher.get({ path: `/channels/${channelName}/users` });
      const usersData = await usersRes.json();
      const currentUsers = usersData.users || [];
      const alreadyIn = currentUsers.some((u) => u.id === payload.userId);
      if (!alreadyIn && currentUsers.length >= room.max_participants) {
        return NextResponse.json({ error: "This room is full" }, { status: 403 });
      }
    } catch {
      // If the Pusher lookup itself fails, fail open rather than blocking
      // everyone from joining because of a transient API error.
    }
  }

  const authResponse = pusher.authorizeChannel(socketId, channelName, {
    user_id: payload.userId,
    user_info: { username: payload.username, isHost },
  });

  return NextResponse.json(authResponse);
}

