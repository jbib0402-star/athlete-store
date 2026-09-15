"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

type AdminProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  category: string;
  stock: number | null;
  purchase_limit: number | null;
  is_active: boolean;
  is_consumable: boolean;
  effect_text: string | null;
  effect_duration_hours: number | null;
  created_at: string;
};

type AdminMember = {
  id: string;
  username: string;
  character_name: string;
  role: "member" | "admin";
};

type EditForm = {
  name: string;
  description: string;
  price: string;
  category: string;
  stock: string;
  purchase_limit: string;
  image_url: string;
  is_consumable: boolean;
  effect_duration_hours: string;
  effect_text: string;
};

export default function AdminMaintenanceEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [deletingMember, setDeletingMember] = useState<AdminMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const showNotice = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadAdminData = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id || null;
    setCurrentUserId(userId);
    if (!userId) {
      setIsAdmin(false);
      return;
    }

    const { data: me } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") {
      setIsAdmin(false);
      return;
    }
    setIsAdmin(true);

    const [productsRes, membersRes, categoriesRes] = await Promise.all([
      supabase.from("products").select("id,name,description,price,image_url,category,stock,purchase_limit,is_active,is_consumable,effect_text,effect_duration_hours,created_at").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,username,character_name,role").order("character_name"),
      supabase.from("store_categories").select("name").order("sort_order", { ascending: true }).order("created_at", { ascending: true })
    ]);

    if (productsRes.data) setProducts(productsRes.data as AdminProduct[]);
    if (membersRes.data) setMembers(membersRes.data as AdminMember[]);
    if (categoriesRes.data) setCategories(categoriesRes.data.map(row => String(row.name)));
  }, [supabase]);

  useEffect(() => {
    loadAdminData();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => loadAdminData());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadAdminData]);

  const openProductEdit = useCallback((product: AdminProduct) => {
    setEditing(product);
    setEditFile(null);
    setEditForm({
      name: product.name,
      description: product.description,
      price: String(product.price),
      category: product.category,
      stock: product.stock == null ? "" : String(product.stock),
      purchase_limit: product.purchase_limit == null ? "" : String(product.purchase_limit),
      image_url: product.image_url || "",
      is_consumable: product.is_consumable,
      effect_duration_hours: product.effect_duration_hours == null ? "" : String(product.effect_duration_hours),
      effect_text: product.effect_text || ""
    });
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const scan = () => {
      const productRows = Array.from(document.querySelectorAll<HTMLElement>(".product-admin-row"));
      productRows.forEach((row, index) => {
        const product = products[index];
        if (!product) return;
        row.dataset.productAdminId = product.id;
        let button = row.querySelector<HTMLButtonElement>(".admin-product-edit-trigger");
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "button outline small admin-product-edit-trigger";
          button.textContent = "수정";
          const statusButton = row.querySelector(".status-toggle");
          if (statusButton) row.insertBefore(button, statusButton);
          else row.appendChild(button);
        }
        button.onclick = () => openProductEdit(product);
      });

      document.querySelectorAll<HTMLElement>(".member-row").forEach(row => {
        const text = row.textContent || "";
        const username = text.match(/@([a-z0-9._-]{3,30})/i)?.[1]?.toLowerCase();
        const member = members.find(item => item.username.toLowerCase() === username);
        const existing = row.querySelector<HTMLButtonElement>(".admin-member-delete-trigger");
        if (!member || member.role !== "member" || member.id === currentUserId) {
          existing?.remove();
          return;
        }
        let button = existing;
        if (!button) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "button danger small admin-member-delete-trigger";
          button.textContent = "탈퇴";
          row.appendChild(button);
        }
        button.onclick = () => setDeletingMember(member);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isAdmin, products, members, currentUserId, openProductEdit]);

  async function adminRequest(action: string, payload: Record<string, unknown>) {
    if (!supabase) throw new Error("서버 연결 정보를 확인해주세요.");
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session?.access_token || ""}`
      },
      body: JSON.stringify({ action, payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
    return data;
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !editing || !editForm) return;
    if (editForm.effect_duration_hours && !editForm.effect_text.trim()) {
      showNotice("시간제 아이템은 효과 문구를 입력해주세요.", true);
      return;
    }

    setBusy(true);
    try {
      let imageUrl = editForm.image_url.trim() || null;
      if (editFile) {
        const path = `${Date.now()}-${editFile.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const upload = await supabase.storage.from("product-images").upload(path, editFile);
        if (upload.error) throw new Error(upload.error.message);
        imageUrl = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
      }

      const data = await adminRequest("update_product", {
        id: editing.id,
        name: editForm.name,
        description: editForm.description,
        price: Number(editForm.price) || 0,
        category: editForm.category,
        stock: editForm.stock === "" ? null : Number(editForm.stock),
        purchase_limit: editForm.purchase_limit === "" ? null : Number(editForm.purchase_limit),
        image_url: imageUrl,
        is_consumable: editForm.is_consumable,
        effect_duration_hours: editForm.effect_duration_hours === "" ? null : Number(editForm.effect_duration_hours),
        effect_text: editForm.effect_text
      });
      showNotice(data.message || "상품 정보를 수정했습니다.");
      setEditing(null);
      setEditForm(null);
      setEditFile(null);
      await loadAdminData();
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "상품을 수정하지 못했습니다.", true);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember() {
    if (!deletingMember) return;
    setBusy(true);
    try {
      const data = await adminRequest("delete_member", { user_id: deletingMember.id });
      showNotice(data.message || "회원을 탈퇴 처리했습니다.");
      setDeletingMember(null);
      await loadAdminData();
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "회원 탈퇴 처리에 실패했습니다.", true);
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return null;

  return <>
    {notice && <div className={`admin-maintenance-notice ${notice.error ? "error" : ""}`}>{notice.text}</div>}

    {editing && editForm && <div className="admin-maintenance-backdrop" onMouseDown={() => !busy && setEditing(null)}>
      <section className="admin-maintenance-modal product-edit-modal" role="dialog" aria-modal="true" aria-labelledby="product-edit-title" onMouseDown={event => event.stopPropagation()}>
        <div className="admin-maintenance-kicker">EDIT PRODUCT</div>
        <h2 id="product-edit-title">등록 상품 수정</h2>
        <form onSubmit={saveProduct}>
          <label>상품명<input value={editForm.name} onChange={event => setEditForm(value => value ? { ...value, name: event.target.value } : value)} required /></label>
          <label>설명<textarea rows={3} value={editForm.description} onChange={event => setEditForm(value => value ? { ...value, description: event.target.value } : value)} required /></label>
          <div className="admin-maintenance-form-row">
            <label>가격<input type="number" min="0" value={editForm.price} onChange={event => setEditForm(value => value ? { ...value, price: event.target.value } : value)} required /></label>
            <label>카테고리<select value={editForm.category} onChange={event => setEditForm(value => value ? { ...value, category: event.target.value } : value)}>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
          <div className="admin-maintenance-form-row">
            <label>재고<input type="number" min="0" value={editForm.stock} onChange={event => setEditForm(value => value ? { ...value, stock: event.target.value } : value)} placeholder="비우면 무제한" /></label>
            <label>1인 구매 제한<input type="number" min="1" value={editForm.purchase_limit} onChange={event => setEditForm(value => value ? { ...value, purchase_limit: event.target.value } : value)} placeholder="비우면 제한 없음" /></label>
          </div>
          <label>이미지 URL<input value={editForm.image_url} onChange={event => setEditForm(value => value ? { ...value, image_url: event.target.value } : value)} placeholder="https://..." /></label>
          <label>새 이미지 파일 <small>선택하면 기존 이미지 대신 적용됩니다.</small><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setEditFile(event.target.files?.[0] || null)} /></label>
          <label className="admin-maintenance-check"><input type="checkbox" checked={editForm.is_consumable} onChange={event => setEditForm(value => value ? { ...value, is_consumable: event.target.checked } : value)} /> 사용 가능한 소비 아이템</label>
          <div className="admin-maintenance-effect-box">
            <strong>시간제 아이템 효과</strong>
            <div className="admin-maintenance-form-row">
              <label>효과 지속시간<select value={editForm.effect_duration_hours} onChange={event => setEditForm(value => value ? { ...value, effect_duration_hours: event.target.value } : value)}>
                <option value="">없음 · 일반 아이템</option>
                <option value="6">6시간</option>
                <option value="12">12시간</option>
                <option value="24">24시간</option>
              </select></label>
              <label>효과 문구<input maxLength={120} value={editForm.effect_text} onChange={event => setEditForm(value => value ? { ...value, effect_text: event.target.value } : value)} placeholder="예: 야간 외출 허용" /></label>
            </div>
          </div>
          <div className="admin-maintenance-actions">
            <button type="button" className="button ghost" disabled={busy} onClick={() => setEditing(null)}>취소</button>
            <button className="button primary" disabled={busy}>{busy ? "저장 중…" : "수정 저장"}</button>
          </div>
        </form>
      </section>
    </div>}

    {deletingMember && <div className="admin-maintenance-backdrop" onMouseDown={() => !busy && setDeletingMember(null)}>
      <section className="admin-maintenance-modal member-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="member-delete-title" onMouseDown={event => event.stopPropagation()}>
        <div className="admin-maintenance-kicker danger">REMOVE MEMBER</div>
        <h2 id="member-delete-title">회원 탈퇴 처리</h2>
        <p><strong>{deletingMember.character_name}</strong> <span>@{deletingMember.username}</span> 계정을 삭제할까요?</p>
        <div className="admin-maintenance-warning">계정과 함께 보유 포인트, 장바구니, 보관함, 출석·훈련 기록 등이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</div>
        <div className="admin-maintenance-actions">
          <button type="button" className="button ghost" disabled={busy} onClick={() => setDeletingMember(null)}>취소</button>
          <button type="button" className="button danger" disabled={busy} onClick={removeMember}>{busy ? "처리 중…" : "탈퇴시키기"}</button>
        </div>
      </section>
    </div>}
  </>;
}
