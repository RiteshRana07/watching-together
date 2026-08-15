"use client";

export default function Queue({
  queue,
  isHost,
  canControl,
  originalTitle,
  isOnOriginal,
  onPlayOriginal,
  onPlayItem,
  onRemove,
}) {
  return (
    <div className="rounded-xl bg-neutral-900 border border-neutral-800 p-4 space-y-3">
      {/* The room's original video is always available to jump back to —
          it's never removed, just temporarily replaced by whatever's
          playing from the queue. */}
      <div className="flex items-center justify-between text-xs bg-neutral-950 rounded-lg px-3 py-2">
        <span className="truncate">
          🎬 <span className="font-medium">{originalTitle || "Main video"}</span>
          {isOnOriginal && (
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
              Now playing
            </span>
          )}
        </span>
        {canControl && !isOnOriginal && (
          <button
            onClick={onPlayOriginal}
            className="text-accent hover:underline ml-2 shrink-0"
          >
            ▶️ Play main video
          </button>
        )}
      </div>

      {queue && queue.length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-400 mb-2">
            Up next <span className="text-neutral-600">({queue.length})</span>
          </p>
          <div className="space-y-1.5">
            {queue.map((item) => {
              const playing = !isOnOriginal && item.currentlyPlaying;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-xs bg-neutral-950 rounded-lg px-3 py-2"
                >
                  <span className="truncate">
                    {item.video_title || item.video_url}
                    {item.added_by && (
                      <span className="text-neutral-600"> · added by {item.added_by}</span>
                    )}
                    {playing && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">
                        Now playing
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 ml-2 shrink-0">
                    {/* Playback (play a queued video) is a host-or-co-host
                        action. Removing from the queue stays host-only —
                        it's a bit more "administrative" than playback. */}
                    {canControl && !playing && (
                      <button
                        onClick={() => onPlayItem(item.id)}
                        className="text-accent hover:underline"
                      >
                        ▶️ Play
                      </button>
                    )}
                    {isHost && (
                      <button
                        onClick={() => onRemove(item.id)}
                        className="text-neutral-600 hover:text-red-400"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
