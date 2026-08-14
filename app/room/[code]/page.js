"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getPusherClient } from "../../../lib/pusher-client";
import Nav from "../../../components/Nav";
import VideoPlayer from "../../../components/VideoPlayer";
import YouTubePlayer from "../../../components/YouTubePlayer";
import Chat from "../../../components/Chat";
import Queue from "../../../components/Queue";

const CAPACITY_PRESETS = [1, 2, 3, 5, 10];

export default function RoomPage({ params }) {
  const code = params.code.toUpperCase();
  const router = useRouter();

  const [user, setUser] = useState(undefined);
  const [room, setRoom] = useState(undefined);
  const [canJoin, setCanJoin] = useState(undefined); // undefined = checking, true/false = result
  const [channel, setChannel] = useState(null);
  const [socketId, setSocketId] = useState(null);
  const [participants, setParticipants] = useState([]); // [{id, username, isHost}]
  const [controllers, setControllers] = useState(new Set()); // userIds allowed to control playback
  const [queue, setQueue] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [capacityInput, setCapacityInput] = useState("");

  // Auth gate: joining a room requires an account.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) {
          router.push(`/login?redirect=${encodeURIComponent(`/room/${code}`)}`);
          return;
        }
        setUser(d.user);
      });
  }, [router, code]);

  useEffect(() => {
    fetch(`/api/rooms/${code}`)
      .then((r) => r.json())
      .then((d) => setRoom(d.room || null));
  }, [code]);

  // Capacity pre-gate: check BEFORE rendering the player/chat at all, so a
  // full room can't be entered just because fetching room info (used for
  // the video) doesn't itself check capacity.
  useEffect(() => {
    if (!user || room === undefined || room === null) return;
    fetch(`/api/rooms/${code}/can-join`)
      .then((r) => r.json())
      .then((d) => setCanJoin(!!d.allowed))
      .catch(() => setCanJoin(true)); // fail open on a network hiccup
  }, [user, room, code]);

  useEffect(() => {
    if (!room) return;
    fetch(`/api/rooms/${code}/queue`)
      .then((r) => r.json())
      .then((d) => setQueue(d.queue || []));
  }, [room, code]);

  const isHost = !!(user && room && user.id === room.host_id);

  // Hosts get the full persisted chat history (see README: chat is only
  // retained for the host — guests only see what's sent live during their
  // own visit). Fetched once, when isHost first becomes known — NOT on
  // every `room` reference change (video/capacity changes), which used to
  // cause a refetch that could show a message twice: once from the local
  // optimistic add, once from the refetched history.
  useEffect(() => {
    if (!isHost) return;
    fetch(`/api/rooms/${code}/messages`)
      .then((r) => r.json())
      .then((d) => setChatHistory(d.messages || []));
  }, [isHost, code]);

  useEffect(() => {
    if (room?.max_participants) setCapacityInput(String(room.max_participants));
  }, [room?.max_participants]);

  // Host always has control; add them once known.
  useEffect(() => {
    if (isHost && user) {
      setControllers((prev) => new Set(prev).add(user.id));
    }
  }, [isHost, user]);

  // Seed co-host status from the database so it survives a page refresh —
  // previously this only ever came from a live room:grant-control event,
  // which meant a co-host lost their permission the moment they reloaded.
  // Fetched once (guarded), not on every `room` reference change.
  const coHostsSeeded = useRef(false);
  useEffect(() => {
    if (!room || coHostsSeeded.current) return;
    coHostsSeeded.current = true;
    fetch(`/api/rooms/${code}/cohosts`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.coHostIds?.length) return;
        setControllers((prev) => {
          const next = new Set(prev);
          d.coHostIds.forEach((id) => next.add(id));
          return next;
        });
      });
  }, [room, code]);

  useEffect(() => {
    // Deliberately NOT depending on `room` (only its value is read here,
    // once, when canJoin becomes true — by then room is guaranteed loaded).
    // `room` changes reference on every video/capacity change, and this
    // effect used to depend on it, which meant the Pusher presence channel
    // got fully unsubscribed and resubscribed on every single video change.
    // From every OTHER client's perspective, that looked exactly like a
    // leave-then-rejoin — which is what caused both the duplicated
    // "watching" list entries and the repeated "X joined the room" chat
    // spam every time the host played something from the queue.
    if (!user || !room || canJoin !== true) return;
    const pusher = getPusherClient();

    const onConnected = () => setSocketId(pusher.connection.socket_id);
    pusher.connection.bind("connected", onConnected);
    if (pusher.connection.state === "connected") onConnected();
    pusher.connection.bind("error", (err) => {
      console.error("Pusher connection error:", err);
    });

    const ch = pusher.subscribe(`presence-room-${code}`);

    ch.bind("pusher:subscription_succeeded", (members) => {
      const list = [];
      members.each((m) => list.push({ id: m.id, username: m.info.username, isHost: !!m.info.isHost }));
      setParticipants(list);
    });
    ch.bind("pusher:member_added", (member) => {
      setParticipants((p) => {
        // Defensive dedup: don't add a member id that's already present.
        if (p.some((x) => x.id === member.id)) return p;
        return [...p, { id: member.id, username: member.info.username, isHost: !!member.info.isHost }];
      });
    });
    ch.bind("pusher:member_removed", (member) => {
      setParticipants((p) => p.filter((x) => x.id !== member.id));
      setControllers((prev) => {
        const next = new Set(prev);
        next.delete(member.id);
        return next;
      });
    });
    ch.bind("pusher:subscription_error", (status) => {
      console.error("Pusher subscription error:", status);
      if (status?.status === 403 || status === 403) {
        setJoinError("This room is full, or you don't have access to join it.");
      } else {
        setJoinError("Couldn't connect to the room's live sync. Try refreshing.");
      }
    });

    // Host grants/revokes another participant's ability to control playback.
    ch.bind("room:grant-control", ({ userId, grant }) => {
      setControllers((prev) => {
        const next = new Set(prev);
        if (grant) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });

    // The room advanced to a different video (direct switch or queue).
    ch.bind("room:video-changed", ({ videoUrl, videoTitle, videoSource }) => {
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              current_video_url: videoUrl,
              current_video_title: videoTitle,
              current_video_source: videoSource,
            }
          : prev
      );
    });

    // The queue changed (something added, removed, or played).
    ch.bind("room:queue-changed", ({ queue: q }) => setQueue(q || []));

    // Host changed the room's participant cap.
    ch.bind("room:capacity-changed", ({ maxParticipants }) => {
      setRoom((prev) => (prev ? { ...prev, max_participants: maxParticipants } : prev));
    });

    setChannel(ch);

    return () => {
      pusher.unsubscribe(`presence-room-${code}`);
    };
  }, [user, code, canJoin]);

  const broadcast = useCallback(
    (event, data) => {
      fetch(`/api/rooms/${code}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, data, socketId }),
      }).catch(() => {});
    },
    [code, socketId]
  );

  function grantControl(userId, grant) {
    setControllers((prev) => {
      const next = new Set(prev);
      if (grant) next.add(userId);
      else next.delete(userId);
      return next;
    });
    broadcast("room:grant-control", { userId, grant });
  }

  async function updateCapacity(newValue) {
    const n = parseInt(newValue, 10);
    if (Number.isNaN(n) || n < 1) return;
    setCapacityInput(String(n));
    const res = await fetch(`/api/rooms/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxParticipants: n }),
    });
    const data = await res.json();
    if (res.ok) {
      setRoom((prev) => ({ ...prev, max_participants: data.room.max_participants }));
    }
  }

  async function addToQueue(videoUrl) {
    const res = await fetch(`/api/rooms/${code}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl }),
    });
    const data = await res.json();
    if (res.ok) {
      setQueue(data.queue || []);
    } else {
      alert(data.error || "Couldn't add that to the queue");
    }
  }

  async function playNextInQueue(itemId) {
    const res = await fetch(`/api/rooms/${code}/queue/${itemId}/play`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setRoom((prev) => ({ ...prev, ...data.room }));
    } else {
      alert(data.error || "Couldn't play that video");
    }
  }

  async function playOriginal() {
    const res = await fetch(`/api/rooms/${code}/play-original`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setRoom((prev) => ({ ...prev, ...data.room }));
    } else {
      alert(data.error || "Couldn't switch back to the main video");
    }
  }

  async function removeQueueItem(itemId) {
    const res = await fetch(`/api/rooms/${code}/queue/${itemId}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) setQueue(data.queue || []);
  }

  function copyInviteLink() {
    const url = `${window.location.origin}/invite/${code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (user === undefined || room === undefined || (room && canJoin === undefined)) return null;

  if (room === null) {
    return (
      <main>
        <Nav username={user?.username} />
        <div className="max-w-lg mx-auto px-6 py-24 text-center">
          <h1 className="text-xl font-semibold mb-2">Room not found</h1>
          <p className="text-neutral-500 text-sm mb-6">Double-check the room code and try again.</p>
          <Link href="/rooms" className="text-accent text-sm hover:underline">
            ← Back to rooms
          </Link>
        </div>
      </main>
    );
  }

  if (canJoin === false) {
    return (
      <main>
        <Nav username={user?.username} />
        <div className="max-w-lg mx-auto px-6 py-24 text-center">
          <h1 className="text-xl font-semibold mb-2">This room is full</h1>
          <p className="text-neutral-500 text-sm mb-6">
            "{room.name}" has reached its participant limit. Ask the host to raise it, or try
            again later.
          </p>
          <Link href="/rooms" className="text-accent text-sm hover:underline">
            ← Back to rooms
          </Link>
        </div>
      </main>
    );
  }

  const myCanControl = isHost || (user && controllers.has(user.id));
  const currentUrl = room.current_video_url || room.video_url;
  const currentTitle = room.current_video_title || room.video_title;
  const currentSource = room.current_video_source || room.video_source;

  return (
    <main>
      <Nav username={user?.username} />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/rooms" className="text-sm text-neutral-500 hover:text-white">
          ← Back to rooms
        </Link>

        <div className="flex items-center justify-between mb-6 mt-4 flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              {room.name}
              {isHost && (
                <span className="text-[10px] uppercase tracking-wide bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                  Host
                </span>
              )}
            </h1>
            <p className="text-xs text-neutral-500">
              {currentTitle ? `${currentTitle} · ` : ""}Room code: {room.code}
            </p>

            {isHost && (
              <div className="flex items-center gap-2 mt-3 text-xs">
                <span className="text-neutral-500">Room size:</span>
                <button
                  onClick={() => updateCapacity(Math.max(1, (room.max_participants || 2) - 1))}
                  className="w-6 h-6 flex items-center justify-center rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  −
                </button>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={capacityInput}
                  onChange={(e) => setCapacityInput(e.target.value)}
                  onBlur={(e) => updateCapacity(e.target.value)}
                  className="w-14 text-center bg-neutral-900 border border-neutral-800 rounded px-1 py-1"
                />
                <button
                  onClick={() => updateCapacity((room.max_participants || 1) + 1)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  +
                </button>
                <div className="flex gap-1 ml-1">
                  {CAPACITY_PRESETS.map((n) => (
                    <button
                      key={n}
                      onClick={() => updateCapacity(n)}
                      className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-400"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={copyInviteLink}
            className="text-sm px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700"
          >
            {copied ? "Link copied!" : "Copy invite link"}
          </button>
        </div>

        {joinError && (
          <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-sm text-red-300">
            {joinError}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            {currentSource === "youtube" ? (
              <YouTubePlayer
                videoId={currentUrl}
                channel={channel}
                broadcast={broadcast}
                canControl={myCanControl}
              />
            ) : (
              <VideoPlayer
                videoUrl={currentUrl}
                channel={channel}
                broadcast={broadcast}
                canControl={myCanControl}
              />
            )}
            <Queue
              queue={queue.map((item) => ({ ...item, currentlyPlaying: item.video_url === currentUrl }))}
              isHost={isHost}
              canControl={myCanControl}
              originalTitle={room.video_title}
              isOnOriginal={currentUrl === room.video_url}
              onPlayOriginal={playOriginal}
              onPlayItem={playNextInQueue}
              onRemove={removeQueueItem}
            />
          </div>
          <div className="h-[520px]">
            <Chat
              channel={channel}
              broadcast={broadcast}
              username={user?.username}
              userId={user?.id}
              participants={participants}
              isHost={isHost}
              controllers={controllers}
              onGrantControl={grantControl}
              onAddToQueue={addToQueue}
              initialMessages={chatHistory}
              queuedUrls={new Set(queue.map((q) => q.video_url))}
              canModerateVoice={myCanControl}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
