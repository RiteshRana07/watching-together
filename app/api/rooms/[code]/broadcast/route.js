import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const pusher = require("../../../../../lib/pusher");
const { verifyToken } = require("../../../../../lib/auth");
const {
  getRoomByCode,
  getUserById,
  saveMessage,
  addCoHost,
  removeCoHost,
  canManageRoom,
} = require("../../../../../lib/db");

const ALLOWED_EVENTS = [
  "player:action",
  "player:heartbeat",
  "player:request-sync",
  "chat:message",
  "reaction:show",
  "room:grant-control",
  // Voice chat signaling (WebRTC offer/answer/ICE relay) + mute controls.
  // Offer/answer/ice-candidate payloads carry a targetUserId; each client
  // ignores anything not addressed to it — Pusher has no built-in
  // per-client targeting on a shared presence channel.
  "voice:join",
  "voice:leave",
  "voice:offer",
  "voice:answer",
  "voice:ice-candidate",
  "voice:mute-state",
  "voice:force-mute",
  "voice:request-unmute",
];

// Events where the sender already applied their own change locally and
// doesn't need an echo of their own action.
const EXCLUDE_SENDER_EVENTS = [
  "player:action",
  "player:heartbeat",
  "player:request-sync",
  "room:grant-control",
  "voice:join",
  "voice:leave",
  "voice:offer",
  "voice:answer",
  "voice:ice-candidate",
  "voice:mute-state",
  "voice:force-mute",
  "voice:request-unmute",
];

const NEEDS_ROOM_LOOKUP = new Set([
  "room:grant-control",
  "chat:message",
  "voice:force-mute",
  "voice:request-unmute",
]);

const NEEDS_MANAGE_CHECK = new Set([
  "room:grant-control",
  "voice:force-mute",
  "voice:request-unmute",
]);

export async function POST(req, { params }) {
  const code = params.code.toUpperCase();
  const { event, data, socketId } = await req.json();

  if (!ALLOWED_EVENTS.includes(event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const room = NEEDS_ROOM_LOOKUP.has(event) ? await getRoomByCode(code) : null;

  if (NEEDS_MANAGE_CHECK.has(event)) {
    // Host, co-host, or the site-wide super-host may grant/revoke co-host
    // status and moderate voice chat. A plain co-host can also mute
    // others / request unmutes — only granting co-host itself stays
    // stricter (see below), matching "co-host can do playback + voice
    // moderation, only the real host/super-host manages who's co-host."
    const token = cookies().get("wt_session")?.value;
    const authPayload = token && verifyToken(token);
    if (!authPayload || !room) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const authUser = await getUserById(authPayload.userId);
    const allowed = await canManageRoom(room, authPayload.userId, authUser?.email);
    if (!allowed) {
      return NextResponse.json({ error: "Only the host or a co-host can do that" }, { status: 403 });
    }

    if (event === "room:grant-control") {
      try {
        if (data.grant) await addCoHost(room.id, data.userId);
        else await removeCoHost(room.id, data.userId);
      } catch (err) {
        console.error("Failed to persist co-host change:", err);
      }
    }
  }

  const eventPayload =
    event === "chat:message"
      ? { ...data, message: String(data.message || "").slice(0, 500) }
      : data;

  // Persist chat so the host (and super-host) can see everything said
  // even while away — see /api/rooms/[code]/messages. Guests don't get
  // this history back (only what's sent live during their own visit),
  // but the message is saved regardless since the host needs to see
  // messages sent while they were offline. Awaited, not fire-and-forget —
  // a serverless function can be frozen the instant it responds, which
  // would silently drop an un-awaited write.
  if (event === "chat:message" && room) {
    try {
      await saveMessage({
        roomId: room.id,
        username: eventPayload.username || "Guest",
        message: eventPayload.message,
      });
    } catch (err) {
      console.error("Failed to save chat message:", err);
    }
  }

  const options =
    EXCLUDE_SENDER_EVENTS.includes(event) && socketId ? { socket_id: socketId } : undefined;

  await pusher.trigger(`presence-room-${code}`, event, eventPayload, options);

  return NextResponse.json({ ok: true });
}
