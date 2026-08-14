import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { getRoomByCode, deleteRoom, updateRoomCapacity } = require("../../../../lib/db");
const { verifyToken } = require("../../../../lib/auth");
const pusher = require("../../../../lib/pusher");

function requireUser() {
  const token = cookies().get("wt_session")?.value;
  return token && verifyToken(token);
}

export async function GET(req, { params }) {
  const room = await getRoomByCode(params.code.toUpperCase());
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json({ room });
}

export async function DELETE(req, { params }) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const room = await getRoomByCode(code);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.host_id !== payload.userId) {
    return NextResponse.json({ error: "Only the host can delete this room" }, { status: 403 });
  }

  await deleteRoom(code, payload.userId);
  return NextResponse.json({ ok: true });
}

// Change the room's participant cap after creation. Host-only.
export async function PATCH(req, { params }) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const code = params.code.toUpperCase();
  const { maxParticipants } = await req.json();

  let cap = null;
  if (maxParticipants !== null && maxParticipants !== undefined && maxParticipants !== "unlimited") {
    const n = parseInt(maxParticipants, 10);
    if (!Number.isNaN(n) && n > 0 && n <= 500) cap = n;
  }

  const room = await updateRoomCapacity(code, payload.userId, cap);
  if (!room) {
    return NextResponse.json({ error: "Room not found, or you're not the host" }, { status: 403 });
  }

  // Let everyone currently in the room see the new cap live.
  await pusher.trigger(`presence-room-${code}`, "room:capacity-changed", {
    maxParticipants: room.max_participants,
  });

  return NextResponse.json({ room });
}
