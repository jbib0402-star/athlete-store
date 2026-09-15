"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type StoreCategory = {
  id: string;
  name: string;
  sort_order: number;
};

export default function CategoryEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [shopMount, setShopMount] = useState<HTMLElement | null>(null);
  const [adminMount, setAdminMount] = useState<HTMLElement | null>(null);
  const [productCategoryMount, setProductCategoryMount] = useState<HTMLElement | null>(null);
  const [productCategory, setProductCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const loadCategories = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      setCategories([]);
      return;
    }
    const { data, error } = await supabase
      .from("store_categories")
      .select("id,name,sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) {
      const next = data as StoreCategory[];
      setCategories(next);
      setDrafts(Object.fromEntries(next.map(category => [category.id, category.name])));
      setSelectedCategory(current => current === "전체" || next.some(category => category.name === current) ? current : "전체");
      setProductCategory(current => next.some(category => category.name === current) ? current : (next[0]?.name || ""));
    }
  }, [supabase]);

  useEffect(() => {
    loadCategories();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => loadCategories());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadCategories]);

  useEffect(() => {
    const scan = () => {
      const originalRow = document.querySelector<HTMLElement>(".content-section .category-row:not(.managed-category-row)");
      if (originalRow) {
        originalRow.style.display = "none";
        let mount = originalRow.parentElement?.querySelector<HTMLElement>(".managed-category-mount") || null;
        if (!mount && originalRow.parentElement) {
          mount = document.createElement("div");
          mount.className = "managed-category-mount";
          originalRow.insertAdjacentElement("afterend", mount);
        }
        setShopMount(previous => previous === mount ? previous : mount);
      } else {
        setShopMount(previous => previous && document.body.contains(previous) ? previous : null);
      }

      const activeAdminTab = document.querySelector<HTMLElement>(".admin-tabs button.active")?.textContent || "";
      const adminPage = document.querySelector<HTMLElement>(".admin-page");
      const showManager = Boolean(adminPage && activeAdminTab.includes("상품 관리"));
      let managerMount = document.querySelector<HTMLElement>(".category-manager-mount");

      if (showManager && adminPage) {
        if (!managerMount) {
          managerMount = document.createElement("div");
          managerMount.className = "category-manager-mount";
          adminPage.appendChild(managerMount);
        }
        setAdminMount(previous => previous === managerMount ? previous : managerMount);
      } else {
        if (managerMount) managerMount.remove();
        setAdminMount(null);
      }

      const forms = Array.from(document.querySelectorAll<HTMLFormElement>(".admin-form form"));
      const productForm = forms.find(item => item.closest(".admin-form")?.querySelector("h2")?.textContent?.trim() === "상품 등록");
      if (productForm) {
        const labels = Array.from(productForm.querySelectorAll<HTMLLabelElement>("label"));
        const categoryLabel = labels.find(label => label.textContent?.trim().startsWith("카테고리"));
        const originalSelect = categoryLabel?.querySelector<HTMLSelectElement>("select");
        if (categoryLabel && originalSelect) {
          originalSelect.style.display = "none";
          originalSelect.classList.add("managed-product-category-original");
          let categoryMount = categoryLabel.querySelector<HTMLElement>(".managed-product-category-mount");
          if (!categoryMount) {
            categoryMount = document.createElement("div");
            categoryMount.className = "managed-product-category-mount";
            categoryLabel.appendChild(categoryMount);
          }
          setProductCategoryMount(previous => previous === categoryMount ? previous : categoryMount);
        }
      } else {
        setProductCategoryMount(null);
      }
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const applyFilter = () => {
      document.querySelectorAll<HTMLElement>(".product-grid .product-card").forEach(card => {
        const category = card.querySelector<HTMLElement>(".category-chip")?.textContent?.trim() || "";
        card.style.display = selectedCategory === "전체" || category === selectedCategory ? "" : "none";
      });
    };

    applyFilter();
    const main = document.querySelector(".main-content") || document.body;
    const observer = new MutationObserver(applyFilter);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selectedCategory]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let nextInit = init;
      let creatingProduct = false;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/admin") && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body?.action === "create_product" && body?.payload && productCategory) {
            creatingProduct = true;
            body.payload.category = productCategory;
            nextInit = { ...init, body: JSON.stringify(body) };
          }
        } catch {
          // 기존 요청을 그대로 보냅니다.
        }
      }

      const response = await originalFetch(input, nextInit);
      if (creatingProduct && response.ok && categories[0]?.name) setProductCategory(categories[0].name);
      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, [productCategory, categories]);

  async function categoryAction(action: string, payload: Record<string, unknown>, busyKey: string) {
    if (!supabase) return false;
    setBusyId(busyKey);
    setMessage(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session?.access_token || ""}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json();
    setBusyId(null);
    if (!response.ok) {
      setMessage({ text: data.error || "요청을 처리하지 못했습니다.", error: true });
      return false;
    }
    setMessage({ text: data.message || "저장했습니다." });
    await loadCategories();
    return true;
  }

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const ok = await categoryAction("add", { name }, "add");
    if (ok) setNewName("");
  }

  async function renameCategory(category: StoreCategory) {
    const name = (drafts[category.id] || "").trim();
    if (!name || name === category.name) return;
    const ok = await categoryAction("rename", { id: category.id, name }, `rename-${category.id}`);
    if (ok) window.setTimeout(() => window.location.reload(), 350);
  }

  const shopUi = shopMount ? createPortal(
    <div className="category-row managed-category-row">
      <button className={selectedCategory === "전체" ? "active" : ""} onClick={() => setSelectedCategory("전체")}>전체</button>
      {categories.map(category => <button key={category.id} className={selectedCategory === category.name ? "active" : ""} onClick={() => setSelectedCategory(category.name)}>{category.name}</button>)}
    </div>,
    shopMount
  ) : null;

  const productCategoryUi = productCategoryMount ? createPortal(
    <select value={productCategory} onChange={event => setProductCategory(event.target.value)}>
      {categories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}
    </select>,
    productCategoryMount
  ) : null;

  const adminUi = adminMount ? createPortal(
    <section className="panel category-manager-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">STORE CATEGORIES</div><h2>매점 카테고리 관리</h2></div>
        <span className="count-pill">{categories.length}개</span>
      </div>
      <p className="category-manager-help">추가·이름 변경·삭제·순서 변경이 가능합니다. 사용 중인 카테고리는 상품 보호를 위해 바로 삭제되지 않습니다.</p>
      <form className="category-add-row" onSubmit={addCategory}>
        <input value={newName} onChange={event => setNewName(event.target.value)} maxLength={30} placeholder="새 카테고리 이름" />
        <button className="button primary" disabled={!newName.trim() || busyId === "add"}>{busyId === "add" ? "추가 중…" : "추가"}</button>
      </form>
      <div className="category-manage-list">
        {categories.map((category, index) => <div className="category-manage-row" key={category.id}>
          <div className="category-order-buttons">
            <button type="button" disabled={index === 0 || Boolean(busyId)} onClick={() => categoryAction("move", { id: category.id, direction: "up" }, `move-${category.id}`)} aria-label="위로 이동">↑</button>
            <button type="button" disabled={index === categories.length - 1 || Boolean(busyId)} onClick={() => categoryAction("move", { id: category.id, direction: "down" }, `move-${category.id}`)} aria-label="아래로 이동">↓</button>
          </div>
          <input value={drafts[category.id] ?? category.name} onChange={event => setDrafts(current => ({ ...current, [category.id]: event.target.value }))} maxLength={30} />
          <button type="button" className="button outline small" disabled={Boolean(busyId) || (drafts[category.id] ?? category.name).trim() === category.name} onClick={() => renameCategory(category)}>이름 저장</button>
          <button type="button" className="button danger small" disabled={Boolean(busyId)} onClick={() => categoryAction("delete", { id: category.id }, `delete-${category.id}`)}>삭제</button>
        </div>)}
      </div>
      {message && <p className={`category-manager-message ${message.error ? "error" : ""}`}>{message.text}</p>}
    </section>,
    adminMount
  ) : null;

  return <>{shopUi}{productCategoryUi}{adminUi}</>;
}
