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

async function requireAdmin(request: Request) {
  const { userClient, admin } = clients();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) } as const;

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return { error: NextResponse.json({ error: "로그인이 만료되었습니다." }, { status: 401 }) } as const;

  const { data: requester } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (requester?.role !== "admin") return { error: NextResponse.json({ error: "운영진 권한이 필요합니다." }, { status: 403 }) } as const;

  return { admin } as const;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;
    const { admin } = auth;

    const { data: rows, error } = await admin
      .from("inventory")
      .select("id,user_id,product_id,product_name,product_image_url,purchased_at,gift_from_name")
      .is("used_at", null)
      .order("purchased_at", { ascending: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const userIds = Array.from(new Set((rows || []).map(row => String(row.user_id))));
    const users = new Map<string, { username: string; character_name: string }>();

    if (userIds.length) {
      const { data: profiles, error: profileError } = await admin
        .from("profiles")
        .select("id,username,character_name")
        .in("id", userIds);
      if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });
      for (const profile of profiles || []) {
        users.set(String(profile.id), {
          username: String(profile.username),
          character_name: String(profile.character_name)
        });
      }
    }

    return NextResponse.json({
      items: (rows || []).map(row => ({
        ...row,
        username: users.get(String(row.user_id))?.username || "unknown",
        character_name: users.get(String(row.user_id))?.character_name || "알 수 없는 회원"
      }))
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth) return auth.error;
    const { admin } = auth;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const payload = body?.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : {};

    if (action !== "delete_inventory_item") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }

    const inventoryId = String(payload.inventory_id || "");
    if (!inventoryId) return NextResponse.json({ error: "삭제할 아이템을 확인해주세요." }, { status: 400 });

    const { data: item, error: itemError } = await admin
      .from("inventory")
      .select("id,user_id,product_name,used_at")
      .eq("id", inventoryId)
      .maybeSingle();

    if (itemError) return NextResponse.json({ error: itemError.message }, { status: 400 });
    if (!item) return NextResponse.json({ error: "아이템을 찾을 수 없습니다." }, { status: 404 });
    if (item.used_at) return NextResponse.json({ error: "이미 사용한 아이템은 보관함에서 삭제할 수 없습니다." }, { status: 400 });

    const { data: owner } = await admin
      .from("profiles")
      .select("character_name")
      .eq("id", item.user_id)
      .maybeSingle();

    const { error: deleteError } = await admin.from("inventory").delete().eq("id", inventoryId).is("used_at", null);
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

    return NextResponse.json({ message: `${owner?.character_name || "회원"}의 '${item.product_name}' 아이템을 삭제했습니다.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
