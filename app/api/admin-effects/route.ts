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

type EffectRow = {
  id: string;
  user_id: string;
  product_id: string | null;
  product_name: string;
  effect_text: string | null;
  effect_duration_hours: number | null;
  effect_expires_at: string | null;
  used_at: string | null;
};

export async function POST(request: Request) {
  try {
    const { userClient, admin } = clients();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: "로그인이 만료되었습니다." }, { status: 401 });

    const { data: requester } = await admin
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (requester?.role !== "admin") {
      return NextResponse.json({ error: "운영진 권한이 필요합니다." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    if (action === "list_active_effects") {
      const now = new Date().toISOString();
      const { data, error } = await admin
        .from("inventory")
        .select("id,user_id,product_id,product_name,effect_text,effect_duration_hours,effect_expires_at,used_at")
        .not("effect_expires_at", "is", null)
        .gt("effect_expires_at", now)
        .order("effect_expires_at", { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      const rows = (data || []) as EffectRow[];
      const userIds = Array.from(new Set(rows.map(row => row.user_id)));
      const profilesById = new Map<string, { username: string; character_name: string }>();

      if (userIds.length) {
        const { data: profiles, error: profileError } = await admin
          .from("profiles")
          .select("id,username,character_name")
          .in("id", userIds);
        if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });
        for (const profile of profiles || []) {
          profilesById.set(String(profile.id), {
            username: String(profile.username),
            character_name: String(profile.character_name)
          });
        }
      }

      const grouped = new Map<string, {
        representative_id: string;
        user_id: string;
        username: string;
        character_name: string;
        product_name: string;
        effect_text: string | null;
        effect_duration_hours: number | null;
        effect_expires_at: string;
        stack_count: number;
      }>();

      for (const row of rows) {
        if (!row.effect_expires_at) continue;
        const profile = profilesById.get(row.user_id);
        const effectKey = row.product_id || `${row.product_name}::${row.effect_text || ""}::${row.effect_duration_hours || 0}`;
        const key = `${row.user_id}::${effectKey}`;
        const current = grouped.get(key);

        if (!current) {
          grouped.set(key, {
            representative_id: row.id,
            user_id: row.user_id,
            username: profile?.username || "unknown",
            character_name: profile?.character_name || "탈퇴한 회원",
            product_name: row.product_name,
            effect_text: row.effect_text,
            effect_duration_hours: row.effect_duration_hours,
            effect_expires_at: row.effect_expires_at,
            stack_count: 1
          });
          continue;
        }

        current.stack_count += 1;
        if (new Date(row.effect_expires_at).getTime() > new Date(current.effect_expires_at).getTime()) {
          current.effect_expires_at = row.effect_expires_at;
          current.representative_id = row.id;
        }
      }

      return NextResponse.json({
        effects: Array.from(grouped.values()).sort((a, b) =>
          new Date(a.effect_expires_at).getTime() - new Date(b.effect_expires_at).getTime()
        )
      });
    }

    if (action === "clear_active_effect") {
      const inventoryId = String((payload as Record<string, unknown>).inventory_id || "");
      if (!inventoryId) return NextResponse.json({ error: "삭제할 상태이상을 확인해주세요." }, { status: 400 });

      const { data: target, error: targetError } = await admin
        .from("inventory")
        .select("id,user_id,product_id,product_name,effect_text,effect_duration_hours,effect_expires_at")
        .eq("id", inventoryId)
        .maybeSingle();

      if (targetError) return NextResponse.json({ error: targetError.message }, { status: 400 });
      if (!target?.effect_expires_at || new Date(target.effect_expires_at).getTime() <= Date.now()) {
        return NextResponse.json({ error: "이미 종료된 상태이상입니다." }, { status: 400 });
      }

      let updateQuery = admin
        .from("inventory")
        .update({ effect_expires_at: null, effect_cancelled_at: new Date().toISOString() })
        .eq("user_id", target.user_id)
        .not("effect_expires_at", "is", null)
        .gt("effect_expires_at", new Date().toISOString());

      if (target.product_id) {
        updateQuery = updateQuery.eq("product_id", target.product_id);
      } else {
        updateQuery = updateQuery
          .is("product_id", null)
          .eq("product_name", target.product_name)
          .eq("effect_duration_hours", target.effect_duration_hours);
        updateQuery = target.effect_text == null
          ? updateQuery.is("effect_text", null)
          : updateQuery.eq("effect_text", target.effect_text);
      }

      const { error: clearError } = await updateQuery;
      if (clearError) return NextResponse.json({ error: clearError.message }, { status: 400 });

      return NextResponse.json({ message: `${target.product_name} 상태이상을 종료했습니다.` });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
