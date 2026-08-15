import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { verifyToken } = require("../../../../lib/auth");
const { deleteMovie } = require("../../../../lib/db");

export async function DELETE(req, { params }) {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await deleteMovie(params.id, payload.userId);
  return NextResponse.json({ ok: true });
}
