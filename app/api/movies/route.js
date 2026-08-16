import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { verifyToken } = require("../../../lib/auth");
const { createMovie, listMoviesForUser } = require("../../../lib/db");

function requireUser() {
  const token = cookies().get("wt_session")?.value;
  return token && verifyToken(token);
}

export async function GET() {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const movies = await listMoviesForUser(payload.userId);
  return NextResponse.json({ movies });
}

export async function POST(req) {
  const payload = requireUser();
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { title, videoUrl } = await req.json();
  if (!title || !videoUrl) {
    return NextResponse.json({ error: "Title and video are required" }, { status: 400 });
  }

  const movie = await createMovie({ title, videoUrl, ownerId: payload.userId });
  return NextResponse.json({ movie });
}
