import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const service = process.env.SUPABASE_SERVICE_ROLE_KEY; const bootstrap = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!url || !service || !bootstrap) return NextResponse.json({ error: "초기 설정이 준비되지 않았습니다." }, { status: 503 });
  const body = await request.json();
  if (body.secret !== bootstrap) return NextResponse.json({ error: "설정 코드가 일치하지 않습니다." }, { status: 403 });
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (count) return NextResponse.json({ error: "운영진 계정이 이미 존재합니다." }, { status: 409 });
  const username = String(body.username || "").trim().toLowerCase(); const password = String(body.password || ""); const characterName = String(body.character_name || "운영진").trim();
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8) return NextResponse.json({ error: "아이디는 영문·숫자 3자 이상, 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  const domain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN || "athlete-store.local";
  const { data, error } = await admin.auth.admin.createUser({ email: `${username}@${domain}`, password, email_confirm: true });
  if (error || !data.user) return NextResponse.json({ error: error?.message || "계정을 만들지 못했습니다." }, { status: 400 });
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, username, character_name: characterName, role: "admin", points: 0 });
  if (profileError) { await admin.auth.admin.deleteUser(data.user.id); return NextResponse.json({ error: profileError.message }, { status: 400 }); }
  return NextResponse.json({ message: "첫 운영진 계정을 만들었습니다." });
}
