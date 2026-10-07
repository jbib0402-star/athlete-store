"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

type LotteryPrize = { label: string; points: number; chance: number };
const DEFAULT_PRIZES: LotteryPrize[] = [
  { label: "꽝", points: 0, chance: 50 },
  { label: "100P 당첨", points: 100, chance: 30 },
  { label: "300P 당첨", points: 300, chance: 15 },
  { label: "500P 당첨", points: 500, chance: 4 },
  { label: "1000P 당첨", points: 1000, chance: 1 }
];

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
  special_type: string | null;
  lottery_prizes: LotteryPrize[] | null;
  created_at: string;
};

type AdminMember = {
  id: string;
  username: string;
  character_name: string;
  role: "member" | "staff" | "admin";
};

type MemberInventoryItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  product_image_url: string | null;
  purchased_at: string;
  gift_from_name: string | null;
};

type EditForm = {
  item_type: "standard" | "timed" | "lottery";
  lottery_prizes: { label: string; points: string; chance: string }[];
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

function formatInventoryDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

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
  const [inventoryMember, setInventoryMember] = useState<AdminMember | null>(null);
  const [memberInventory, setMemberInventory] = useState<MemberInventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [deletingInventoryId, setDeletingInventoryId] = useState<string | null>(null);
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
    if (me?.role !== "admin" && me?.role !== "staff") {
      setIsAdmin(false);
      return;
    }
    setIsAdmin(true);

    const [productsRes, membersRes, categoriesRes] = await Promise.all([
      supabase.from("products").select("id,name,description,price,image_url,category,stock,purchase_limit,is_active,is_consumable,effect_text,effect_duration_hours,special_type,lottery_prizes,created_at").order("created_at", { ascending: false }),
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
      item_type: product.special_type === "lottery" ? "lottery" : product.effect_duration_hours ? "timed" : "standard",
      lottery_prizes: (product.lottery_prizes?.length ? product.lottery_prizes : DEFAULT_PRIZES).map(prize => ({ label: prize.label, points: String(prize.points), chance: String(prize.chance) })),
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
        const inventoryButton = row.querySelector<HTMLButtonElement>(".admin-member-inventory-trigger");
        const deleteButton = row.querySelector<HTMLButtonElement>(".admin-member-delete-trigger");

        if (!member) {
          inventoryButton?.remove();
          deleteButton?.remove();
          return;
        }

        let itemButton = inventoryButton;
        if (!itemButton) {
          itemButton = document.createElement("button");
          itemButton.type = "button";
          itemButton.className = "button outline small admin-member-inventory-trigger";
          itemButton.textContent = "아이템";
          row.appendChild(itemButton);
        }
        itemButton.onclick = () => { void openMemberInventory(member); };

        if (member.role !== "member" || member.id === currentUserId) {
          deleteButton?.remove();
          return;
        }
        let button = deleteButton;
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

  async function openMemberInventory(member: AdminMember) {
    setInventoryMember(member);
    setMemberInventory([]);
    setInventoryLoading(true);
    try {
      const data = await adminRequest("list_member_inventory", { user_id: member.id });
      setMemberInventory((data.items || []) as MemberInventoryItem[]);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "보관함을 불러오지 못했습니다.", true);
      setInventoryMember(null);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function deleteInventoryItem(item: MemberInventoryItem) {
    if (!inventoryMember) return;
    if (!window.confirm(`${inventoryMember.character_name}의 '${item.product_name}' 아이템을 삭제할까요?\n포인트는 환불되지 않으며 이 작업은 되돌릴 수 없습니다.`)) return;
    setDeletingInventoryId(item.id);
    try {
      const data = await adminRequest("delete_inventory_item", { inventory_id: item.id });
      showNotice(data.message || "아이템을 삭제했습니다.");
      setMemberInventory(current => current.filter(row => row.id !== item.id));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "아이템을 삭제하지 못했습니다.", true);
    } finally {
      setDeletingInventoryId(null);
    }
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !editing || !editForm) return;
    const prizes = editForm.lottery_prizes.map(prize => ({ label: prize.label.trim(), points: Number(prize.points), chance: Number(prize.chance) }));
    if (editForm.item_type === "lottery") {
      if (editForm.lottery_prizes.some(prize => !prize.label.trim() || prize.points.trim() === "" || prize.chance.trim() === "") ||
          prizes.some(prize => !Number.isInteger(prize.points) || prize.points < 0 || prize.points > 1000000 || !Number.isFinite(prize.chance) || prize.chance < 0 || prize.chance > 100)) {
        showNotice("결과 문구, 0 이상의 정수 포인트, 0~100% 확률을 입력해주세요.", true);
        return;
      }
      const total = prizes.reduce((sum, prize) => sum + prize.chance, 0);
      if (Math.abs(total - 100) > 0.001) {
        showNotice(`당첨 확률의 합계는 100%여야 합니다. 현재 ${Number(total.toFixed(3))}%입니다.`, true);
        return;
      }
    }
    if (editForm.item_type === "timed" && editForm.effect_duration_hours && !editForm.effect_text.trim()) {
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
        special_type: editForm.item_type === "lottery" ? "lottery" : "standard",
        lottery_prizes: editForm.item_type === "lottery" ? prizes : null,
        lottery_daily_limit: 3,
        effect_duration_hours: editForm.item_type !== "timed" || editForm.effect_duration_hours === "" ? null : Number(editForm.effect_duration_hours),
        effect_text: editForm.item_type === "timed" ? editForm.effect_text : ""
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
          <div className="lottery-admin-fields lottery-edit-fields" data-react-managed="true">
            <label>아이템 유형<select className="lottery-item-type" value={editForm.item_type} onChange={event => setEditForm(value => value ? { ...value, item_type: event.target.value as EditForm["item_type"] } : value)}>
              <option value="standard">일반 아이템</option>
              <option value="timed">시간 효과 아이템</option>
              <option value="lottery">일일복권 · 하루 3회</option>
            </select></label>
            {editForm.item_type === "lottery" && <div className="lottery-config-box">
              <div className="lottery-config-title"><strong>복권 당첨 설정</strong><span role="status">확률 합계 {Number(editForm.lottery_prizes.reduce((sum, prize) => sum + (Number(prize.chance) || 0), 0).toFixed(3))}% / 100%</span></div>
              <div className="lottery-prize-head"><span>#</span><span>결과 문구</span><span>포인트</span><span>확률</span></div>
              <div className="lottery-prize-rows">{editForm.lottery_prizes.map((prize, index) => <div className="lottery-prize-row" key={index}>
                <span>{index + 1}</span>
                <input aria-label={`결과 ${index + 1} 문구`} className="lottery-prize-label" value={prize.label} maxLength={40} required onChange={event => setEditForm(value => value ? { ...value, lottery_prizes: value.lottery_prizes.map((row, i) => i === index ? { ...row, label: event.target.value } : row) } : value)} />
                <input aria-label={`결과 ${index + 1} 포인트`} className="lottery-prize-points" type="number" min="0" max="1000000" step="1" value={prize.points} required onChange={event => setEditForm(value => value ? { ...value, lottery_prizes: value.lottery_prizes.map((row, i) => i === index ? { ...row, points: event.target.value } : row) } : value)} />
                <input aria-label={`결과 ${index + 1} 확률 (%)`} className="lottery-prize-chance" type="number" min="0" max="100" step="any" value={prize.chance} required onChange={event => setEditForm(value => value ? { ...value, lottery_prizes: value.lottery_prizes.map((row, i) => i === index ? { ...row, chance: event.target.value } : row) } : value)} />
              </div>)}</div>
              <p>확률 합계를 100%로 맞춘 뒤 수정 저장을 눌러주세요. 하루 최대 3회 사용할 수 있습니다.</p>
            </div>}
          </div>
          <div className="admin-maintenance-effect-box" hidden={editForm.item_type !== "timed"}>
            <strong>시간제 아이템 효과</strong>
            <div className="admin-maintenance-form-row">
              <label>효과 지속시간<select value={editForm.effect_duration_hours} onChange={event => setEditForm(value => value ? { ...value, effect_duration_hours: event.target.value } : value)}>
                <option value="">없음 · 일반 아이템</option>
                <option value="6">6시간</option>
                <option value="8">8시간</option>
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

    {inventoryMember && <div className="admin-maintenance-backdrop" onMouseDown={() => !deletingInventoryId && setInventoryMember(null)}>
      <section className="admin-maintenance-modal member-inventory-modal" role="dialog" aria-modal="true" aria-labelledby="member-inventory-title" onMouseDown={event => event.stopPropagation()}>
        <div className="admin-maintenance-kicker">LOCKER MANAGEMENT</div>
        <h2 id="member-inventory-title">{inventoryMember.character_name} 보관함</h2>
        <p className="member-inventory-subtitle">@{inventoryMember.username} · 현재 보관 중인 미사용 아이템만 표시됩니다.</p>
        {inventoryLoading ? <div className="member-inventory-empty">보관함을 불러오는 중입니다.</div> : memberInventory.length ? <div className="member-inventory-list">
          {memberInventory.map(item => <article className="member-inventory-row" key={item.id}>
            <div className="member-inventory-thumb">{item.product_image_url ? <img src={item.product_image_url} alt="" /> : <span>ITEM</span>}</div>
            <div className="member-inventory-info"><strong>{item.product_name}</strong><span>{formatInventoryDate(item.purchased_at)} 보관{item.gift_from_name ? ` · ${item.gift_from_name}에게 선물 받음` : ""}</span></div>
            <button type="button" className="button danger small" disabled={deletingInventoryId === item.id} onClick={() => deleteInventoryItem(item)}>{deletingInventoryId === item.id ? "삭제 중…" : "삭제"}</button>
          </article>)}
        </div> : <div className="member-inventory-empty">현재 보관 중인 아이템이 없습니다.</div>}
        <div className="admin-maintenance-warning member-inventory-warning">아이템을 삭제해도 구매·포인트·사용 기록은 수정되지 않으며 포인트는 환불되지 않습니다.</div>
        <div className="admin-maintenance-actions"><button type="button" className="button ghost" disabled={Boolean(deletingInventoryId)} onClick={() => setInventoryMember(null)}>닫기</button></div>
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
