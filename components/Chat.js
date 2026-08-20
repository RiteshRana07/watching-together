"use client";
import { useEffect, useRef, useState } from "react";
import VoiceChat from "./VoiceChat";
const { extractYouTubeId } = require("../lib/youtube");

const EMOJIS = ["❤️", "😂", "😮", "👏", "🔥"];
const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat({
  channel,
  broadcast,
  username,
  userId,
  participants,
  isHost,
  isSuperHost,
  controllers,
  onGrantControl,
  onAddToQueue,
  initialMessages,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const endRef = useRef(null);
  const seededHistory = useRef(false);
  const closeTimer = useRef(null);

  // Host (or the super-host) gets their persisted chat history seeded in
  // once it arrives. Deduped against messages already on screen (matched
  // by username+text) so a message you just sent yourself doesn't show
  // twice if the history fetch resolves right after you send it.
  useEffect(() => {
    if (!initialMessages || initialMessages.length === 0 || seededHistory.current) return;
    seededHistory.current = true;
    setMessages((prev) => {
      const alreadyShown = new Set(
        prev.filter((m) => m.type === "message").map((m) => `${m.username}\u0000${m.message}`)
      );
      const toPrepend = initialMessages
        .filter((m) => !alreadyShown.has(`${m.username}\u0000${m.message}`))
        .map((m) => ({ type: "message", ...m }));
      return [...toPrepend, ...prev];
    });
  }, [initialMessages]);

  useEffect(() => {
    if (!channel) return;

    function onMessage(m) {
      setMessages((prev) => {
        if (m.clientId && prev.some((x) => x.clientId === m.clientId)) return prev;
        return [...prev, { type: "message", ...m }];
      });
    }
    function onMemberAdded(member) {
      setMessages((prev) => [
        ...prev,
        { type: "system", text: `${member.info.username} joined the room · ${timeNow()}`, at: Date.now() },
      ]);
    }
    function onMemberRemoved(member) {
      setMessages((prev) => [
        ...prev,
        { type: "system", text: `${member.info.username} left the room · ${timeNow()}`, at: Date.now() },
      ]);
    }

    channel.bind("chat:message", onMessage);
    channel.bind("pusher:member_added", onMemberAdded);
    channel.bind("pusher:member_removed", onMemberRemoved);

    return () => {
      channel.unbind("chat:message", onMessage);
      channel.unbind("pusher:member_added", onMemberAdded);
      channel.unbind("pusher:member_removed", onMemberRemoved);
    };
  }, [channel]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function sendMessage(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !broadcast) return;

    const clientId = Math.random().toString(36).slice(2);
    const payload = { message: text, username, clientId };

    setMessages((prev) => [...prev, { type: "message", ...payload }]);
    broadcast("chat:message", payload);
    setInput("");
  }

  // Small hover delay so moving the mouse from the trigger into the panel
  // doesn't immediately close it.
  function openPanel() {
    clearTimeout(closeTimer.current);
    setPanelOpen(true);
  }
  function scheduleClose() {
    closeTimer.current = setTimeout(() => setPanelOpen(false), 200);
  }

  const canModerate = !!(isHost || isSuperHost);

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Hover to reveal participants + host/co-host management + voice
          chat, instead of them permanently taking up vertical space. */}
      <div
        className="relative border-b border-neutral-800"
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        <div className="px-4 py-3 text-sm text-neutral-400 cursor-default">
          {participants.length} watching
          <span className="text-neutral-600"> · hover for details</span>
        </div>

        {panelOpen && (
          <div className="absolute right-0 top-full z-20 w-80 bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl shadow-black/60 max-h-[70vh] overflow-y-auto">
            <div className="px-4 py-2 space-y-1.5 border-b border-neutral-800">
              <p className="text-xs font-medium text-neutral-500 mb-1">Participants</p>
              {participants.map((p) => {
                const isCoHost = p.isHost || p.isSuperHost || controllers?.has(p.id);
                return (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      {p.username}
                      {p.isHost && (
                        <span className="text-[9px] uppercase bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
                          Host
                        </span>
                      )}
                      {p.isSuperHost && !p.isHost && (
                        <span className="text-[9px] uppercase bg-fuchsia-500/20 text-fuchsia-300 px-1.5 py-0.5 rounded-full">
                          Admin
                        </span>
                      )}
                      {!p.isHost && !p.isSuperHost && isCoHost && (
                        <span className="text-[9px] uppercase bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-full">
                          Co-host
                        </span>
                      )}
                    </span>
                    {canModerate && !p.isHost && !p.isSuperHost && p.id !== userId && (
                      <button
                        onClick={() => onGrantControl?.(p.id, !isCoHost)}
                        className="text-accent hover:underline"
                      >
                        {isCoHost ? "Remove co-host" : "Make co-host"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <VoiceChat
              channel={channel}
              broadcast={broadcast}
              userId={userId}
              username={username}
              participants={participants}
              canModerate={canModerate}
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 text-sm">
        {messages.map((m, i) => {
          if (m.type === "system") {
            return (
              <p key={i} className="text-xs text-neutral-500 italic">
                {m.text}
              </p>
            );
          }

          const urlMatch = m.message.match(URL_PATTERN);
          const youtubeId = urlMatch ? extractYouTubeId(urlMatch[1]) : null;

          return (
            <div key={i}>
              <p>
                <span className="text-accent font-medium">{m.username}: </span>
                <span className="text-neutral-200">{m.message}</span>
              </p>
              {youtubeId && (
                <button
                  onClick={() => onAddToQueue?.(urlMatch[1])}
                  className="mt-1 text-xs px-2.5 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  ➕ Add to queue
                </button>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="px-4 py-2 flex gap-2 border-t border-neutral-800">
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => broadcast?.("reaction:show", { emoji: e })}
            className="text-lg hover:scale-125 transition-transform"
          >
            {e}
          </button>
        ))}
      </div>

      <form onSubmit={sendMessage} className="p-3 border-t border-neutral-800 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Say something..."
          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm"
        />
        <button className="px-3 py-1.5 bg-accent rounded-lg text-sm">Send</button>
      </form>
    </div>
  );
}
