import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const pusher = require("../../../../../lib/pusher");
const { verifyToken } = require("../../../../../lib/auth");
const {
  getRoomByCode,
  saveMessage,
  addCoHost,
  removeCoHost,
  isHostOrCoHost,
} = require("../../../../../lib/db");

const ALLOWED_EVENTS = [
  "player:action",
  "player:heartbeat",
  "player:request-sync",
  "chat:message",
  "reaction:show",
  "room:grant-control",
  // Voice chat signaling (WebRTC offer/answer/ICE relay) + mute controls.
  // Offer/answer/ice-candidate payloads include a targetUserId; each
  // client ignores anything not addressed to it (Pusher has no built-in
  // per-client targeting on a shared presence channel).
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
// doesn't need to receive an echo of their own action.
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

// Events that need the room's host_id (for authorization) and/or a
// database write as a side effect of broadcasting them.
const NEEDS_ROOM_LOOKUP = new Set([
  "room:grant-control",
  "chat:message",
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

  if (event === "room:grant-control") {
    // Only the room's host may grant or revoke someone's co-host status —
    // a co-host can't grant control to a third person.
    const token = cookies().get("wt_session")?.value;
    const authPayload = token && verifyToken(token);
    if (!authPayload || !room || authPayload.userId !== room.host_id) {
      return NextResponse.json({ error: "Only the host can do that" }, { status: 403 });
    }
    // Persisted (not just broadcast) so co-host status survives a refresh
    // and so the server can authorize co-host actions like playing a
    // queued video — see /api/rooms/[code]/queue/[itemId]/play.
    try {
      if (data.grant) await addCoHost(room.id, data.userId);
      else await removeCoHost(room.id, data.userId);
    } catch (err) {
      console.error("Failed to persist co-host change:", err);
    }
  }

  if (event === "voice:force-mute" || event === "voice:request-unmute") {
    // Only the host or a co-host may mute someone else or ask them to
    // unmute. Nobody can remotely turn someone else's mic ON without that
    // person acting themselves — see components/VoiceChat.js.
    const token = cookies().get("wt_session")?.value;
    const authPayload = token && verifyToken(token);
    if (!authPayload || !room || !(await isHostOrCoHost(room, authPayload.userId))) {
      return NextResponse.json({ error: "Only the host or a co-host can do that" }, { status: 403 });
    }
  }

  const eventPayload =
    event === "chat:message"
      ? { ...data, message: String(data.message || "").slice(0, 500) }
      : data;

  // Persist chat messages so the host can see everything that was said
  // even while they were away — see /api/rooms/[code]/messages. Guests
  // don't get this history back (they only see what's sent live during
  // their own visit), but the message is still saved either way since the
  // host needs to see messages guests sent while the host was offline.
  // Awaited (not fire-and-forget) because a serverless function can be
  // frozen the instant it returns a response, which would silently drop
  // an un-awaited write.
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
