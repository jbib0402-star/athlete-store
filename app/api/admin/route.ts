import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new Error("서버 연결 정보가 설정되지 않았습니다.");
  return { userClient: createClient(url, anon), admin: createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } }) };
}

export async function POST(request: Request) {
  try {
    const { userClient, admin } = clients();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: "로그인이 만료되었습니다." }, { status: 401 });
    const { data: requester } = await admin.from("profiles").select("role").eq("id", authData.user.id).single();
    if (requester?.role !== "admin") return NextResponse.json({ error: "운영진 권한이 필요합니다." }, { status: 403 });

    const { action, payload } = await request.json();
    if (!payload || typeof payload !== "object") return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

    if (action === "create_member") {
      const username = String(payload.username || "").trim().toLowerCase();
      const password = String(payload.password || "");
      const characterName = String(payload.character_name || "").trim();
      if (!/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8 || !characterName) return NextResponse.json({ error: "아이디, 비밀번호와 캐릭터명을 확인해주세요." }, { status: 400 });
      const domain = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN || "athlete-store.local";
      const { data, error } = await admin.auth.admin.createUser({ email: `${username}@${domain}`, password, email_confirm: true });
      if (error || !data.user) return NextResponse.json({ error: error?.message || "계정을 만들지 못했습니다." }, { status: 400 });
      const points = Math.max(0, Number(payload.points) || 0);
      const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, username, character_name: characterName, sport: String(payload.sport || "") || null, points, role: "member" });
      if (profileError) { await admin.auth.admin.deleteUser(data.user.id); return NextResponse.json({ error: profileError.message }, { status: 400 }); }
      if (points) await admin.from("point_logs").insert({ user_id: data.user.id, amount: points, type: "welcome", description: "가입 축하 포인트", actor_id: authData.user.id });
      return NextResponse.json({ message: `${characterName} 계정을 만들었습니다.` });
    }

    if (action === "adjust_points") {
      const userId = String(payload.user_id || ""); const amount = Number(payload.amount) || 0;
      if (!userId || !amount) return NextResponse.json({ error: "대상과 포인트를 확인해주세요." }, { status: 400 });
      const { error } = await admin.rpc("admin_adjust_points", { target_user_id: userId, point_delta: amount, log_description: String(payload.description || "운영진 조정"), admin_actor_id: authData.user.id });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "포인트를 조정했습니다." });
    }

    if (action === "create_product") {
      const record = { name: String(payload.name || "").trim(), description: String(payload.description || "").trim(), price: Math.max(0, Number(payload.price) || 0), image_url: payload.image_url ? String(payload.image_url) : null, category: String(payload.category || "기타"), stock: payload.stock == null ? null : Math.max(0, Number(payload.stock)), purchase_limit: payload.purchase_limit == null ? null : Math.max(1, Number(payload.purchase_limit)), is_consumable: payload.is_consumable !== false, is_active: true };
      if (!record.name || !record.description) return NextResponse.json({ error: "상품명과 설명을 입력해주세요." }, { status: 400 });
      const { error } = await admin.from("products").insert(record);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "상품을 등록했습니다." });
    }

    if (action === "toggle_product") {
      const { error } = await admin.from("products").update({ is_active: Boolean(payload.is_active) }).eq("id", String(payload.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "판매 상태를 변경했습니다." });
    }

    if (action === "delete_product") {
      const { error } = await admin.from("products").delete().eq("id", String(payload.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "상품을 삭제했습니다." });
    }

    if (action === "update_settings") {
      const allowed = ["site_name", "currency_name", "welcome_points", "attendance_reward", "training_reward", "daily_training_limit", "locker_limit"];
      const rows = allowed.filter(key => key in payload).map(key => ({ key, value: payload[key] }));
      const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "운영 설정을 저장했습니다." });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
