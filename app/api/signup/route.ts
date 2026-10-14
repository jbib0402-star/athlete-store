import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { SIGNUP_CLOSED_MESSAGE } from "@/lib/signup";

export const dynamic = "force-dynamic";
const STARTING_POINTS = 500;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error("서버 연결 정보가 설정되지 않았습니다.");
  return createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function signupEnabled(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", "signup_enabled").maybeSingle();
  if (error) throw new Error("회원가입 설정을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
  return data?.value === true;
}

export async function GET() {
  try { return NextResponse.json({ enabled: await signupEnabled(adminClient()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ enabled: false, error: "회원가입 상태를 확인하지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

export async function POST(request: Request) {
  try {
    const admin = adminClient();
    if (!await signupEnabled(admin)) return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
    const body = await request.json();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const characterName = String(body.character_name || "").trim();

    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return NextResponse.json({ error: "아이디는 영문 소문자, 숫자, 점(.), 밑줄(_), 하이픈(-)만 사용해 3~30자로 입력해주세요." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "비밀번호는 8자 이상으로 입력해주세요." }, { status: 400 });
    }
    if (!characterName || characterName.length > 40) {
      return NextResponse.json({ error: "밴드에서 사용하는 닉네임을 40자 이내로 정확히 입력해주세요." }, { status: 400 });
    }

    const { data: existing, error: lookupError } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (lookupError) throw new Error("가입 정보를 확인하지 못했습니다.");
    if (existing) return NextResponse.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });

    const domain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN || "athlete-store.local";
    const { data, error } = await admin.auth.admin.createUser({
      email: `${username}@${domain}`,
      password,
      email_confirm: true
    });

    if (error || !data.user) {
      const message = error?.message?.toLowerCase().includes("already") ? "이미 사용 중인 아이디입니다." : (error?.message || "계정을 만들지 못했습니다.");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { error: profileError } = await admin.rpc("register_self_signup", {
      new_user_id: data.user.id, new_username: username, new_character_name: characterName
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return NextResponse.json({ error: profileError.message }, { status: profileError.message === SIGNUP_CLOSED_MESSAGE ? 403 : 400 });
    }

    return NextResponse.json({ message: "가입이 완료되었습니다.", points: STARTING_POINTS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
