"use client";
import { useEffect, useRef, useState } from "react";

// Public STUN only — no TURN server. This works for most typical home/
// mobile networks, but some restrictive corporate or symmetric-NAT
// networks may fail to establish a direct connection without a TURN
// relay, which isn't included here (that generally needs a paid/hosted
// TURN service — e.g. Twilio, Xirsys, metered.ca — and API credentials
// this app doesn't have). If voice doesn't connect for someone, this is
// the most likely reason.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// Mesh topology: every participant connects directly to every other
// participant. Simple and needs no media server, but bandwidth/CPU cost
// grows with the square of the participant count — fine for a handful of
// people in a watch party, not meant for dozens of simultaneous speakers.

export default function VoiceChat({ channel, broadcast, userId, username, participants, canModerate }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState(new Set());
  const [remoteMuted, setRemoteMuted] = useState(new Set()); // peer userIds currently muted
  const [unmuteRequested, setUnmuteRequested] = useState(false);
  const [error, setError] = useState("");

  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map()); // userId -> RTCPeerConnection
  const audioElsRef = useRef(new Map()); // userId -> <audio> element
  const pendingCandidatesRef = useRef(new Map()); // userId -> candidates queued before remote description is set
  const joinedRef = useRef(false);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current);
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        broadcast("voice:ice-candidate", {
          targetUserId: peerId,
          fromUserId: userId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      let audioEl = audioElsRef.current.get(peerId);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        audioElsRef.current.set(peerId, audioEl);
      }
      audioEl.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setConnectedPeers((prev) => new Set(prev).add(peerId));
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        setConnectedPeers((prev) => {
          const next = new Set(prev);
          next.delete(peerId);
          return next;
        });
      }
    };

    peersRef.current.set(peerId, pc);
    return pc;
  }

  function closePeer(peerId) {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    const audioEl = audioElsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioElsRef.current.delete(peerId);
    }
    setConnectedPeers((prev) => {
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }

  async function joinVoice() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setJoined(true);
      broadcast("voice:join", { fromUserId: userId, username });
    } catch (err) {
      console.error("Mic access failed:", err);
      setError("Couldn't access your microphone — check your browser's permission for this site.");
    }
  }

  function leaveVoice() {
    broadcast("voice:leave", { fromUserId: userId });
    peersRef.current.forEach((_, peerId) => closePeer(peerId));
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setJoined(false);
    setMuted(false);
    setConnectedPeers(new Set());
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = muted; // currently muted -> unmuting -> enable
    setMuted(!muted);
    setUnmuteRequested(false);
    broadcast("voice:mute-state", { fromUserId: userId, muted: !muted });
  }

  function forceMute(targetUserId) {
    broadcast("voice:force-mute", { targetUserId });
  }

  function requestUnmute(targetUserId) {
    broadcast("voice:request-unmute", { targetUserId });
  }

  // Signaling: all handled through the room's existing Pusher channel.
  useEffect(() => {
    if (!channel) return;

    async function onVoiceJoin({ fromUserId }) {
      if (fromUserId === userId || !joinedRef.current) return;
      // Whoever's already in the call initiates the offer to a newcomer —
      // avoids both sides racing to create simultaneous offers.
      const pc = createPeerConnection(fromUserId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      broadcast("voice:offer", { targetUserId: fromUserId, fromUserId: userId, sdp: offer });
    }

    function onVoiceLeave({ fromUserId }) {
      closePeer(fromUserId);
    }

    async function onOffer({ targetUserId, fromUserId, sdp }) {
      if (targetUserId !== userId || !joinedRef.current) return;
      const pc = createPeerConnection(fromUserId);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const queued = pendingCandidatesRef.current.get(fromUserId) || [];
      for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c));
      pendingCandidatesRef.current.delete(fromUserId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast("voice:answer", { targetUserId: fromUserId, fromUserId: userId, sdp: answer });
    }

    async function onAnswer({ targetUserId, fromUserId, sdp }) {
      if (targetUserId !== userId) return;
      const pc = peersRef.current.get(fromUserId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const queued = pendingCandidatesRef.current.get(fromUserId) || [];
      for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c));
      pendingCandidatesRef.current.delete(fromUserId);
    }

    async function onIceCandidate({ targetUserId, fromUserId, candidate }) {
      if (targetUserId !== userId) return;
      const pc = peersRef.current.get(fromUserId);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        const queue = pendingCandidatesRef.current.get(fromUserId) || [];
        queue.push(candidate);
        pendingCandidatesRef.current.set(fromUserId, queue);
      }
    }

    function onMuteState({ fromUserId, muted: isMuted }) {
      setRemoteMuted((prev) => {
        const next = new Set(prev);
        if (isMuted) next.add(fromUserId);
        else next.delete(fromUserId);
        return next;
      });
    }

    // A host/co-host force-muted me — mute locally immediately. Nobody can
    // remotely turn a mic ON, only off, for privacy: see onRequestUnmute.
    function onForceMute({ targetUserId }) {
      if (targetUserId !== userId || !joinedRef.current) return;
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = false;
      setMuted(true);
      broadcast("voice:mute-state", { fromUserId: userId, muted: true });
    }

    function onRequestUnmute({ targetUserId }) {
      if (targetUserId !== userId) return;
      setUnmuteRequested(true);
    }

    channel.bind("voice:join", onVoiceJoin);
    channel.bind("voice:leave", onVoiceLeave);
    channel.bind("voice:offer", onOffer);
    channel.bind("voice:answer", onAnswer);
    channel.bind("voice:ice-candidate", onIceCandidate);
    channel.bind("voice:mute-state", onMuteState);
    channel.bind("voice:force-mute", onForceMute);
    channel.bind("voice:request-unmute", onRequestUnmute);

    return () => {
      channel.unbind("voice:join", onVoiceJoin);
      channel.unbind("voice:leave", onVoiceLeave);
      channel.unbind("voice:offer", onOffer);
      channel.unbind("voice:answer", onAnswer);
      channel.unbind("voice:ice-candidate", onIceCandidate);
      channel.unbind("voice:mute-state", onMuteState);
      channel.unbind("voice:force-mute", onForceMute);
      channel.unbind("voice:request-unmute", onRequestUnmute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, broadcast, userId]);

  // If someone leaves the room entirely while in the voice call, clean up
  // their connection too (not just on an explicit voice:leave).
  useEffect(() => {
    const currentIds = new Set(participants.map((p) => p.id));
    peersRef.current.forEach((_, peerId) => {
      if (!currentIds.has(peerId)) closePeer(peerId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  // Clean up on unmount (navigating away/closing the tab).
  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((pc) => pc.close());
      audioElsRef.current.forEach((el) => el.remove());
    };
  }, []);

  const voiceParticipants = participants.filter(
    (p) => p.id === userId ? joined : connectedPeers.has(p.id)
  );

  return (
    <div className="border-t border-neutral-800 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-neutral-400">
          🎙️ Voice chat {voiceParticipants.length > 0 && `(${voiceParticipants.length})`}
        </p>
        {joined ? (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className={`text-xs px-3 py-1.5 rounded-lg ${
                muted ? "bg-red-950 text-red-300" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
            >
              {muted ? "🔇 Unmute" : "🎤 Mute"}
            </button>
            <button
              onClick={leaveVoice}
              className="text-xs px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
            >
              Leave
            </button>
          </div>
        ) : (
          <button
            onClick={joinVoice}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent hover:opacity-90"
          >
            🎙️ Join voice
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {unmuteRequested && muted && (
        <div className="text-xs bg-neutral-800 rounded-lg px-3 py-2 flex items-center justify-between">
          <span>The host asked you to unmute.</span>
          <button onClick={toggleMute} className="text-accent hover:underline">
            Unmute
          </button>
        </div>
      )}

      {joined && (
        <div className="space-y-1">
          {participants
            .filter((p) => p.id === userId || connectedPeers.has(p.id))
            .map((p) => {
              const isMe = p.id === userId;
              const isMuted = isMe ? muted : remoteMuted.has(p.id);
              return (
                <div key={p.id} className="flex items-center justify-between text-xs text-neutral-400">
                  <span>
                    {isMuted ? "🔇" : "🎤"} {p.username}
                    {isMe && " (you)"}
                  </span>
                  {canModerate && !isMe && (
                    <span className="flex gap-2">
                      {isMuted ? (
                        <button onClick={() => requestUnmute(p.id)} className="hover:text-accent">
                          Ask to unmute
                        </button>
                      ) : (
                        <button onClick={() => forceMute(p.id)} className="hover:text-accent">
                          Mute
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
