"use client";
import { useEffect, useRef, useState } from "react";

// Drift tolerance: if the player is more than this many seconds away from
// the group's playback position, snap to it instead of just letting it play on.
const DRIFT_TOLERANCE = 1.2;

export default function VideoPlayer({ videoUrl, channel, broadcast, canControl }) {
  const videoRef = useRef(null);
  const applyingRemote = useRef(false);
  const canControlRef = useRef(canControl);
  const requestedInitialSync = useRef(false);
  const [reactions, setReactions] = useState([]);

  useEffect(() => {
    canControlRef.current = canControl;
  }, [canControl]);

  // If the room's active video changes (host switches to a new one from
  // chat), reload the element with the new source.
  useEffect(() => {
    videoRef.current?.load?.();
    requestedInitialSync.current = false;
  }, [videoUrl]);

  useEffect(() => {
    if (!channel) return;
    const video = videoRef.current;

    function applySync({ time, playing }) {
      if (!video) return;
      // Don't stack a new seek on top of one that's still resolving (the
      // browser is still buffering to the last target) — that pile-up is
      // what causes visible play/pause thrashing right after someone joins.
      // Just skip this correction; the next heartbeat will catch up.
      if (video.seeking) return;
      applyingRemote.current = true;
      if (Math.abs(video.currentTime - time) > DRIFT_TOLERANCE) {
        video.currentTime = time;
      }
      if (playing && video.paused) video.play().catch(() => {});
      if (!playing && !video.paused) video.pause();
      setTimeout(() => (applyingRemote.current = false), 800);
    }

    function onAction({ action, time }) {
      applyingRemote.current = true;
      if (video) video.currentTime = time;
      if (action === "play") video?.play().catch(() => {});
      if (action === "pause") video?.pause();
      setTimeout(() => (applyingRemote.current = false), 800);
    }

    function onHeartbeat({ time, playing }) {
      applySync({ time, playing });
    }

    // A newly-joined viewer asked for the current state right away, instead
    // of waiting up to 4s for the next scheduled heartbeat — only whoever's
    // actually in control responds.
    function onSyncRequest() {
      if (!canControlRef.current || !video) return;
      broadcast?.("player:heartbeat", { time: video.currentTime, playing: !video.paused });
    }

    function onReaction({ emoji }) {
      const id = Math.random().toString(36).slice(2);
      setReactions((r) => [...r, { id, emoji, left: 10 + Math.random() * 80 }]);
      setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2000);
    }

    channel.bind("player:action", onAction);
    channel.bind("player:heartbeat", onHeartbeat);
    channel.bind("player:request-sync", onSyncRequest);
    channel.bind("reaction:show", onReaction);

    return () => {
      channel.unbind("player:action", onAction);
      channel.unbind("player:heartbeat", onHeartbeat);
      channel.unbind("player:request-sync", onSyncRequest);
      channel.unbind("reaction:show", onReaction);
    };
  }, [channel, broadcast]);

  // On joining (or when a non-controller's channel becomes ready), ask
  // whoever's in control for an immediate snapshot rather than sitting at
  // 0:00/stale-time for up to 4 seconds.
  useEffect(() => {
    if (!channel || !broadcast || canControl || requestedInitialSync.current) return;
    requestedInitialSync.current = true;
    broadcast("player:request-sync", {});
  }, [channel, broadcast, canControl]);

  // Only the host (or someone granted control) broadcasts a periodic
  // heartbeat — this doubles as the correction signal that pulls a
  // non-controller's local view back in sync if they paused/scrubbed it
  // themselves (see the `controls` note below).
  useEffect(() => {
    if (!broadcast || !canControl) return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || applyingRemote.current || video.seeking) return;
      broadcast("player:heartbeat", { time: video.currentTime, playing: !video.paused });
    }, 4000);
    return () => clearInterval(interval);
  }, [broadcast, canControl]);

  function emit(action) {
    if (!canControl || applyingRemote.current) return;
    const video = videoRef.current;
    if (!video || !broadcast) return;
    broadcast("player:action", { action, time: video.currentTime });
  }

  return (
    <div className="relative rounded-xl overflow-hidden bg-black shadow-2xl shadow-black/50">
      {/* Native controls (including fullscreen) stay available to everyone —
          there's no browser-native way to show only the fullscreen button.
          Non-controllers' play/pause/seek just isn't broadcast (see emit()
          above), so it only affects their own view, and the host's next
          heartbeat pulls them back in sync within a few seconds. */}
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="w-full aspect-video"
        onPlay={() => emit("play")}
        onPause={() => emit("pause")}
        onSeeked={() => emit("seek")}
      />
      {!canControl && (
        <div className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur text-xs text-neutral-300 flex items-center gap-1.5 pointer-events-none">
          🔒 Host controls playback
        </div>
      )}
      {reactions.map((r) => (
        <span
          key={r.id}
          className="absolute bottom-10 text-3xl animate-bounce pointer-events-none"
          style={{ left: `${r.left}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
