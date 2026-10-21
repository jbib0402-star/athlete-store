import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canEnterStore, OPERATOR_ONLY_MESSAGE } from "@/lib/store-access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("서버 연결 정보가 설정되지 않았습니다.");
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: setting, error } = await admin.from("app_settings").select("value").eq("key", "operator_only_access").maybeSingle();
    if (error) throw new Error("접속 설정을 확인하지 못했습니다.");
    const restricted = setting?.value === true;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ restricted, allowed: false }, { headers });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "다시 로그인해주세요." }, { status: 401, headers });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError) throw new Error("접속 권한을 확인하지 못했습니다.");
    const allowed = Boolean(profile) && canEnterStore(restricted, profile?.role ?? null);
    return NextResponse.json({ restricted, allowed, message: allowed ? null : OPERATOR_ONLY_MESSAGE }, { headers });
  } catch {
    return NextResponse.json({ allowed: false, error: "접속 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 503, headers });
  }
}
