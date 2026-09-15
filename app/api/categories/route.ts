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

function cleanName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validName(name: string) {
  return name.length >= 1 && name.length <= 30 && name !== "전체";
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

    const body = await request.json();
    const action = String(body?.action || "");

    if (action === "add") {
      const name = cleanName(body.name);
      if (!validName(name)) return NextResponse.json({ error: "카테고리 이름을 1~30자로 입력해주세요. '전체'는 사용할 수 없습니다." }, { status: 400 });

      const { data: existing } = await admin.from("store_categories").select("id").eq("name", name).maybeSingle();
      if (existing) return NextResponse.json({ error: "이미 있는 카테고리입니다." }, { status: 409 });

      const { data: last } = await admin.from("store_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
      const { error } = await admin.from("store_categories").insert({ name, sort_order: Number(last?.sort_order || 0) + 10 });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: `${name} 카테고리를 추가했습니다.` });
    }

    if (action === "rename") {
      const id = String(body.id || "");
      const name = cleanName(body.name);
      if (!id || !validName(name)) return NextResponse.json({ error: "카테고리 이름을 확인해주세요." }, { status: 400 });

      const { data: category } = await admin.from("store_categories").select("id,name").eq("id", id).single();
      if (!category) return NextResponse.json({ error: "카테고리를 찾을 수 없습니다." }, { status: 404 });
      if (category.name === name) return NextResponse.json({ message: "변경 사항이 없습니다." });

      const { data: duplicate } = await admin.from("store_categories").select("id").eq("name", name).neq("id", id).maybeSingle();
      if (duplicate) return NextResponse.json({ error: "이미 같은 이름의 카테고리가 있습니다." }, { status: 409 });

      const oldName = category.name;
      const { error: categoryError } = await admin.from("store_categories").update({ name }).eq("id", id);
      if (categoryError) return NextResponse.json({ error: categoryError.message }, { status: 400 });

      const { error: productsError } = await admin.from("products").update({ category: name }).eq("category", oldName);
      if (productsError) {
        await admin.from("store_categories").update({ name: oldName }).eq("id", id);
        return NextResponse.json({ error: productsError.message }, { status: 400 });
      }
      return NextResponse.json({ message: `${oldName} → ${name}으로 변경했습니다.` });
    }

    if (action === "delete") {
      const id = String(body.id || "");
      const { data: category } = await admin.from("store_categories").select("id,name").eq("id", id).single();
      if (!category) return NextResponse.json({ error: "카테고리를 찾을 수 없습니다." }, { status: 404 });

      const { count: categoryCount } = await admin.from("store_categories").select("id", { count: "exact", head: true });
      if ((categoryCount || 0) <= 1) return NextResponse.json({ error: "카테고리는 최소 1개 이상 남겨야 합니다." }, { status: 400 });

      const { count: productCount } = await admin.from("products").select("id", { count: "exact", head: true }).eq("category", category.name);
      if ((productCount || 0) > 0) return NextResponse.json({ error: `이 카테고리를 사용하는 상품이 ${productCount}개 있습니다. 상품 카테고리를 먼저 변경해주세요.` }, { status: 400 });

      const { error } = await admin.from("store_categories").delete().eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ message: `${category.name} 카테고리를 삭제했습니다.` });
    }

    if (action === "move") {
      const id = String(body.id || "");
      const direction = body.direction === "up" ? "up" : body.direction === "down" ? "down" : "";
      if (!id || !direction) return NextResponse.json({ error: "이동 요청을 확인해주세요." }, { status: 400 });

      const { data: categories, error: listError } = await admin.from("store_categories").select("id,name,sort_order").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      if (listError) return NextResponse.json({ error: listError.message }, { status: 400 });
      const index = (categories || []).findIndex(item => item.id === id);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= (categories || []).length) return NextResponse.json({ message: "이미 끝 순서입니다." });

      const current = categories![index];
      const target = categories![targetIndex];
      const currentOrder = current.sort_order;
      const targetOrder = target.sort_order;

      const { error: firstError } = await admin.from("store_categories").update({ sort_order: targetOrder }).eq("id", current.id);
      if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });
      const { error: secondError } = await admin.from("store_categories").update({ sort_order: currentOrder }).eq("id", target.id);
      if (secondError) {
        await admin.from("store_categories").update({ sort_order: currentOrder }).eq("id", current.id);
        return NextResponse.json({ error: secondError.message }, { status: 400 });
      }
      return NextResponse.json({ message: "카테고리 순서를 변경했습니다." });
    }

    return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
