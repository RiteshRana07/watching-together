import { NextResponse } from "next/server";
import { cookies } from "next/headers";
const { verifyToken } = require("../../../../lib/auth");
const { getUserById } = require("../../../../lib/db");
const { isSuperHostEmail } = require("../../../../lib/superhost");

export async function GET() {
  const token = cookies().get("wt_session")?.value;
  const payload = token && verifyToken(token);
  if (!payload) return NextResponse.json({ user: null });

  const user = await getUserById(payload.userId);
  if (!user) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: { ...user, isSuperHost: isSuperHostEmail(user.email) },
  });
}
