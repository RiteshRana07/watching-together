import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { verifyToken } = require("../../../lib/auth");
const { createRoom, listRoomsForUser, getMovieById } = require("../../../lib/db");
const { resolveVideoInfo } = require("../../../lib/youtube");

function requireUser() {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  return payload;
}

export async function GET() {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rooms = await listRoomsForUser(payload.userId);
  return NextResponse.json({ rooms });
}

export async function POST(req) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { name, source, movieId, videoUrl, maxParticipants } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "Room name is required" }, { status: 400 });
  }

  const cap = parseInt(maxParticipants, 10);
  if (Number.isNaN(cap) || cap < 1 || cap > 500) {
    return NextResponse.json({ error: "Enter a valid room size (1-500)" }, { status: 400 });
  }

  let room;

  if (source === "library") {
    if (!movieId) {
      return NextResponse.json({ error: "Pick a movie from your library" }, { status: 400 });
    }
    // Look the movie up server-side (and confirm this user owns it) rather
    // than trusting a client-supplied URL for a "from library" room.
    const movie = await getMovieById(movieId, payload.userId);
    if (!movie) {
      return NextResponse.json({ error: "Movie not found in your library" }, { status: 404 });
    }
    room = await createRoom({
      name,
      videoUrl: movie.video_url,
      videoTitle: movie.title,
      videoSource: "library",
      movieId: movie.id,
      maxParticipants: cap,
      hostId: payload.userId,
    });
  } else {
    if (!videoUrl) {
      return NextResponse.json({ error: "Paste a video URL" }, { status: 400 });
    }
    const info = await resolveVideoInfo(videoUrl);
    room = await createRoom({
      name,
      ...info,
      maxParticipants: cap,
      hostId: payload.userId,
    });
  }

  return NextResponse.json({ room });
}

