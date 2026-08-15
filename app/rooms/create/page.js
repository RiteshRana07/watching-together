"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Nav from "../../../components/Nav";
import { useCurrentUser } from "../../../lib/use-current-user";

export default function CreateRoomPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const [movies, setMovies] = useState(undefined);
  const [source, setSource] = useState("library"); // 'library' | 'url'
  const [movieId, setMovieId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [name, setName] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    fetch("/api/movies")
      .then((r) => r.json())
      .then((d) => setMovies(d.movies || []));
  }, [user]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Give your watch party a name");
    if (source === "library" && !movieId) return setError("Pick a movie from your library");
    if (source === "url" && !videoUrl.trim()) return setError("Paste a video URL");
    if (!maxParticipants) return setError("Enter a room size");

    setBusy(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          source === "library"
            ? { name, source: "library", movieId, maxParticipants }
            : { name, source: "url", videoUrl, maxParticipants }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/room/${data.room.code}`);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <main>
      <Nav username={user.username} />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <Link href="/rooms" className="text-sm text-neutral-500 hover:text-white">
          ← Back to rooms
        </Link>

        <p className="text-xs uppercase tracking-wide text-accent mt-6 mb-1">
          Private watch party
        </p>
        <h1 className="text-2xl font-bold mb-2">Create a watch room</h1>
        <p className="text-sm text-neutral-500 mb-8">
          Pick a movie from your library, paste a YouTube link, or paste a direct
          video link. Everyone watches together, perfectly in sync.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="text-sm font-medium block mb-3">What do you want to watch?</label>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSource("library")}
                className={`text-left p-4 rounded-xl border ${
                  source === "library"
                    ? "border-accent bg-accent/10"
                    : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <p className="font-medium mb-1">🎬 Movie from your library</p>
                <p className="text-xs text-neutral-500">
                  Pick a movie you've uploaded and watch it together in sync.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSource("url")}
                className={`text-left p-4 rounded-xl border ${
                  source === "url"
                    ? "border-accent bg-accent/10"
                    : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <p className="font-medium mb-1">▶️ YouTube or video link</p>
                <p className="text-xs text-neutral-500">
                  Paste a YouTube link, or a direct video file link (.mp4, .webm, .ogg).
                </p>
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Room name</label>
            <input
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2"
              placeholder="Friday movie night"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Room size</label>
            <p className="text-xs text-neutral-500 mb-3">
              How many people (including you) can be in the room at once.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {[1, 2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxParticipants(String(n))}
                  className={`px-3 py-1.5 rounded-lg border text-sm ${
                    maxParticipants === String(n)
                      ? "border-accent bg-accent/10 text-white"
                      : "border-neutral-800 bg-neutral-900 text-neutral-400"
                  }`}
                >
                  {n}
                </button>
              ))}
              <input
                type="number"
                min="1"
                max="500"
                placeholder="Other"
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value)}
                className="w-20 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          {source === "library" ? (
            movies && movies.length === 0 ? (
              <p className="text-sm text-neutral-500 p-4 rounded-lg bg-neutral-900 border border-neutral-800">
                No movies ready yet —{" "}
                <Link href="/library" className="text-accent">
                  upload one to your library
                </Link>{" "}
                first.
              </p>
            ) : (
              <div>
                <label className="text-sm font-medium block mb-2">Choose a movie</label>
                <select
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2"
                  value={movieId}
                  onChange={(e) => setMovieId(e.target.value)}
                >
                  <option value="">Select a movie...</option>
                  {(movies || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : (
            <div>
              <label className="text-sm font-medium block mb-2">Video link</label>
              <input
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2"
                placeholder="https://youtube.com/watch?v=... or https://example.com/movie.mp4"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            disabled={busy}
            className="bg-accent px-6 py-2.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating room..." : "Create room"}
          </button>
        </form>
      </div>
    </main>
  );
}
