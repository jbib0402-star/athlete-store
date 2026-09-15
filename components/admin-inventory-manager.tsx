"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type InventoryRow = {
  id: string;
  user_id: string;
  product_id: string | null;
  product_name: string;
  product_image_url: string | null;
  purchased_at: string;
  gift_from_name: string | null;
  username: string;
  character_name: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function AdminInventoryManager() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPage, setAdminPage] = useState<HTMLElement | null>(null);
  const [isMembersTab, setIsMembersTab] = useState(false);
  const [items, setItems] = useState<InventoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const showNotice = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice(null), 3200);
  }, []);

  const authHeaders = useCallback(async () => {
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token || ""}` };
  }, [supabase]);

  const loadItems = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin-inventory", { headers: await authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "보관함 아이템을 불러오지 못했습니다.");
      setItems((data.items || []) as InventoryRow[]);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "보관함 아이템을 불러오지 못했습니다.", true);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, authHeaders, showNotice]);

  useEffect(() => {
    if (!supabase) return;
    const checkAdmin = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return setIsAdmin(false);
      const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      setIsAdmin(data?.role === "admin");
    };
    checkAdmin();
    const { data } = supabase.auth.onAuthStateChange(() => checkAdmin());
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const scan = () => {
      const page = document.querySelector<HTMLElement>(".admin-page");
      setAdminPage(previous => previous === page ? previous : page);
      const activeTab = page?.querySelector<HTMLButtonElement>(".admin-tabs button.active");
      setIsMembersTab(Boolean(activeTab?.textContent?.includes("회원")));
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isAdmin && adminPage && isMembersTab) loadItems();
  }, [isAdmin, adminPage, isMembersTab, loadItems]);

  const filtered = useMemo(() => {
    const raw = query.trim().toLowerCase().replace(/^@/, "");
    if (!raw) return items;
    return items.filter(item =>
      item.product_name.toLowerCase().includes(raw) ||
      item.character_name.toLowerCase().includes(raw) ||
      item.username.toLowerCase().includes(raw)
    );
  }, [items, query]);

  async function deleteItem(item: InventoryRow) {
    if (!window.confirm(`${item.character_name}의 '${item.product_name}' 아이템을 보관함에서 삭제할까요?\n포인트는 환불되지 않으며 이 작업은 되돌릴 수 없습니다.`)) return;
    setDeletingId(item.id);
    try {
      const response = await fetch("/api/admin-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ action: "delete_inventory_item", payload: { inventory_id: item.id } })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "아이템을 삭제하지 못했습니다.");
      showNotice(data.message || "아이템을 삭제했습니다.");
      setItems(current => current.filter(row => row.id !== item.id));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "아이템을 삭제하지 못했습니다.", true);
    } finally {
      setDeletingId(null);
    }
  }

  if (!isAdmin || !adminPage || !isMembersTab) return null;

  return createPortal(<>
    {notice && <div className={`admin-inventory-notice ${notice.error ? "error" : ""}`}>{notice.text}</div>}
    <section className="panel admin-inventory-manager">
      <div className="panel-heading admin-inventory-heading">
        <div>
          <div className="eyebrow">LOCKER · ADMIN</div>
          <h2>보관함 아이템 관리</h2>
          <p>회원이 현재 보관 중인 미사용 아이템만 삭제할 수 있습니다. 사용 내역과 포인트 기록은 유지됩니다.</p>
        </div>
        <button type="button" className="button outline small" onClick={loadItems} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</button>
      </div>

      <label className="admin-inventory-search">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="회원명, @아이디 또는 아이템명 검색" />
      </label>

      {filtered.length ? <div className="admin-inventory-list">
        {filtered.map(item => <article className="admin-inventory-row" key={item.id}>
          <div className="admin-inventory-thumb">
            {item.product_image_url ? <img src={item.product_image_url} alt="" /> : <span>ITEM</span>}
          </div>
          <div className="admin-inventory-owner">
            <strong>{item.character_name}</strong>
            <span>@{item.username}</span>
          </div>
          <div className="admin-inventory-item">
            <strong>{item.product_name}</strong>
            <span>{formatDate(item.purchased_at)} 보관{item.gift_from_name ? ` · ${item.gift_from_name}에게 선물 받음` : ""}</span>
          </div>
          <button type="button" className="button danger small" disabled={deletingId === item.id} onClick={() => deleteItem(item)}>{deletingId === item.id ? "삭제 중…" : "삭제"}</button>
        </article>)}
      </div> : <div className="admin-inventory-empty">{loading ? "보관함을 불러오는 중입니다." : query.trim() ? "검색 결과가 없습니다." : "현재 보관 중인 미사용 아이템이 없습니다."}</div>}
    </section>
  </>, adminPage);
}
