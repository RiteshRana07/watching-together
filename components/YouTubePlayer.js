"use client";
import { useEffect, useRef, useState } from "react";

// YouTube's reported currentTime is less precise than a native <video>
// element's, so we allow a bit more drift before snapping.
const DRIFT_TOLERANCE = 1.5;

let apiLoadPromise;
function loadYouTubeAPI() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
  });
  return apiLoadPromise;
}

export default function YouTubePlayer({ videoId, channel, broadcast, canControl }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const applyingRemote = useRef(false);
  const ready = useRef(false);
  const [reactions, setReactions] = useState([]);

  // canControl can change (host grants/revokes control) without needing to
  // recreate the whole iframe player — onStateChange reads the latest value
  // from this ref instead of closing over a stale prop.
  const canControlRef = useRef(canControl);
  useEffect(() => {
    canControlRef.current = canControl;
  }, [canControl]);

  // Create the player once on mount (not once per video — see the
  // loadVideoById effect below for how video switches are handled without
  // tearing down and rebuilding the iframe). Controls always stay enabled
  // for everyone (including fullscreen — YouTube doesn't offer a way to
  // show only the fullscreen button and hide play/pause), and only the
  // ability to broadcast state changes is gated by canControl (see
  // onStateChange and the heartbeat effect below).
  const initialVideoId = useRef(videoId);
  useEffect(() => {
    let destroyed = false;

    loadYouTubeAPI().then(() => {
      if (destroyed || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: initialVideoId.current,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            ready.current = true;
          },
          onStateChange: (e) => {
            if (applyingRemote.current || !ready.current || !broadcast) return;
            if (!canControlRef.current) return;
            const time = playerRef.current.getCurrentTime();
            if (e.data === window.YT.PlayerState.PLAYING) {
              broadcast("player:action", { action: "play", time });
            } else if (e.data === window.YT.PlayerState.PAUSED) {
              broadcast("player:action", { action: "pause", time });
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      playerRef.current?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the room advances to a new video (queue), load it into the same
  // player instance instead of tearing the iframe down and rebuilding it.
  const lastLoadedId = useRef(videoId);
  useEffect(() => {
    const p = playerRef.current;
    if (lastLoadedId.current === videoId) return;
    lastLoadedId.current = videoId;
    if (p && ready.current && typeof p.loadVideoById === "function") {
      applyingRemote.current = true;
      p.loadVideoById(videoId);
      setTimeout(() => (applyingRemote.current = false), 800);
    }
  }, [videoId]);

  // Apply remote play/pause/seek/heartbeat events.
  useEffect(() => {
    if (!channel) return;

    function applySync({ time, playing }) {
      const p = playerRef.current;
      if (!p || !ready.current) return;
      // BUFFERING (3) means a previous seek is still resolving — piling a
      // new one on top is what causes visible stutter right after someone
      // joins. Skip this correction and let the next heartbeat catch up.
      if (p.getPlayerState() === window.YT.PlayerState.BUFFERING) return;
      applyingRemote.current = true;
      const current = p.getCurrentTime();
      if (Math.abs(current - time) > DRIFT_TOLERANCE) p.seekTo(time, true);
      if (playing) p.playVideo();
      else p.pauseVideo();
      setTimeout(() => (applyingRemote.current = false), 800);
    }

    function onAction({ action, time }) {
      const p = playerRef.current;
      if (!p || !ready.current) return;
      applyingRemote.current = true;
      p.seekTo(time, true);
      if (action === "play") p.playVideo();
      if (action === "pause") p.pauseVideo();
      setTimeout(() => (applyingRemote.current = false), 800);
    }

    function onHeartbeat(data) {
      applySync(data);
    }

    // A newly-joined viewer asked for the current state right away, instead
    // of waiting up to 4s for the next scheduled heartbeat.
    function onSyncRequest() {
      const p = playerRef.current;
      if (!canControlRef.current || !p || !ready.current) return;
      broadcast?.("player:heartbeat", {
        time: p.getCurrentTime(),
        playing: p.getPlayerState() === window.YT.PlayerState.PLAYING,
      });
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

  // On joining, ask whoever's in control for an immediate snapshot rather
  // than sitting at a stale time for up to 4 seconds.
  const requestedInitialSync = useRef(false);
  useEffect(() => {
    if (!channel || !broadcast || canControl || requestedInitialSync.current) return;
    requestedInitialSync.current = true;
    broadcast("player:request-sync", {});
  }, [channel, broadcast, canControl]);

  // Only the host (or someone granted control) sends a heartbeat — this
  // doubles as the correction signal that pulls a non-controller's local
  // view back in sync if they interacted with the (always-visible) controls.
  useEffect(() => {
    if (!broadcast || !canControl) return;
    const interval = setInterval(() => {
      const p = playerRef.current;
      if (!p || !ready.current || applyingRemote.current) return;
      if (typeof p.getCurrentTime !== "function") return;
      if (p.getPlayerState() === window.YT.PlayerState.BUFFERING) return;
      broadcast("player:heartbeat", {
        time: p.getCurrentTime(),
        playing: p.getPlayerState() === window.YT.PlayerState.PLAYING,
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [broadcast, canControl]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-black aspect-video shadow-2xl shadow-black/50">
      {/* Controls (including fullscreen) stay interactive for everyone —
          see the note above onStateChange for why we don't hide them. */}
      <div ref={containerRef} className="w-full h-full" />
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
