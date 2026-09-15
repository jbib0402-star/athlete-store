import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new Error("서버 연결 정보가 설정되지 않았습니다.");
  return {
    userClient: createClient(url, anon),
    admin: createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
  };
}

function kstDayBounds() {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const startMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 9 * 60 * 60 * 1000;
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 86400000).toISOString() };
}

async function requireAdmin(request) {
  const { userClient, admin } = clients();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return { error: NextResponse.json({ error: "로그인이 만료되었습니다." }, { status: 401 }) };
  const { data: requester } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (requester?.role !== "admin") return { error: NextResponse.json({ error: "운영진 권한이 필요합니다." }, { status: 403 }) };
  return { admin };
}

function normalizePrizes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return { error: "복권 당첨 항목은 1개 이상 10개 이하로 설정해주세요." };
  const prizes = [];
  for (const item of value) {
    const label = String(item?.label || "").trim().slice(0, 40);
    const points = Math.floor(Number(item?.points));
    const chance = Number(item?.chance);
    if (!label) return { error: "모든 당첨 항목에 결과 문구를 입력해주세요." };
    if (!Number.isFinite(points) || points < 0 || points > 1000000) return { error: "당첨 포인트를 확인해주세요." };
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) return { error: "당첨 확률을 0~100 사이로 입력해주세요." };
    prizes.push({ label, points, chance });
  }
  const total = prizes.reduce((sum, prize) => sum + prize.chance, 0);
  if (Math.abs(total - 100) > 0.001) return { error: `당첨 확률의 합계는 100%여야 합니다. 현재 ${total}%입니다.` };
  return { prizes };
}

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const { admin } = auth;
    const { start, end } = kstDayBounds();
    const { data: rows, error } = await admin.from("lottery_plays").select("id,user_id,product_id,result_label,reward_points,played_at").gte("played_at", start).lt("played_at", end).order("played_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const userIds = [...new Set((rows || []).map(row => String(row.user_id)))];
    const productIds = [...new Set((rows || []).map(row => String(row.product_id)))];
    const users = new Map();
    const products = new Map();

    if (userIds.length) {
      const { data, error: profileError } = await admin.from("profiles").select("id,character_name,username").in("id", userIds);
      if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });
      for (const row of data || []) users.set(String(row.id), { character_name: String(row.character_name), username: String(row.username) });
    }
    if (productIds.length) {
      const { data, error: productError } = await admin.from("products").select("id,name").in("id", productIds);
      if (productError) return NextResponse.json({ error: productError.message }, { status: 400 });
      for (const row of data || []) products.set(String(row.id), String(row.name));
    }

    return NextResponse.json({ plays: (rows || []).map(row => ({
      ...row,
      character_name: users.get(String(row.user_id))?.character_name || "알 수 없는 회원",
      username: users.get(String(row.user_id))?.username || "unknown",
      product_name: products.get(String(row.product_id)) || "삭제된 복권"
    })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const { admin } = auth;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    if (action === "set_config") {
      const productId = String(payload.product_id || "");
      const specialType = payload.special_type === "lottery" ? "lottery" : "standard";
      if (!productId) return NextResponse.json({ error: "상품을 확인해주세요." }, { status: 400 });
      if (specialType === "lottery") {
        const normalized = normalizePrizes(payload.prizes);
        if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
        const { error } = await admin.from("products").update({ special_type: "lottery", lottery_daily_limit: 3, lottery_prizes: normalized.prizes, effect_duration_hours: null, effect_text: "" }).eq("id", productId);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ message: "일일복권 설정을 저장했습니다." });
      }
      const { error } = await admin.from("products").update({ special_type: "standard" }).eq("id", productId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "아이템 유형을 저장했습니다." });
    }

    if (action === "reset_today") {
      const userId = String(payload.user_id || "");
      const productId = String(payload.product_id || "");
      if (!userId || !productId) return NextResponse.json({ error: "초기화할 회원과 복권을 확인해주세요." }, { status: 400 });
      const { start, end } = kstDayBounds();
      const { error } = await admin.from("lottery_plays").delete().eq("user_id", userId).eq("product_id", productId).gte("played_at", start).lt("played_at", end);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: "오늘 복권 이용 횟수를 초기화했습니다." });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
