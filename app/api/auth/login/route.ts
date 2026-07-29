import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "ozon_auth";

export async function POST(request: NextRequest) {
  const { password } = (await request.json()) as { password?: string };
  const expected = process.env.SITE_ACCESS_PASSWORD;

  if (!expected || password !== expected) {
    return NextResponse.json({ error: "Şifre yanlış" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
