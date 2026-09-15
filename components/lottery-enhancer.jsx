"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

const DEFAULT_PRIZES = [
  { label: "꽝", points: 0, chance: 50 },
  { label: "100P 당첨!", points: 100, chance: 30 },
  { label: "300P 당첨!", points: 300, chance: 15 },
  { label: "500P 당첨!", points: 500, chance: 4 },
  { label: "1000P 당첨!", points: 1000, chance: 1 }
];

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char] || char));
}

function prizeRowsHtml(prizes) {
  const rows = Array.isArray(prizes) && prizes.length ? prizes : DEFAULT_PRIZES;
  return rows.map((prize, index) => `
    <div class="lottery-prize-row">
      <span>${index + 1}</span>
      <input class="lottery-prize-label" maxlength="40" value="${escapeHtml(prize.label)}" aria-label="결과 문구 ${index + 1}" />
      <input class="lottery-prize-points" type="number" min="0" max="1000000" value="${Math.max(0, Number(prize.points) || 0)}" aria-label="당첨 포인트 ${index + 1}" />
      <div class="lottery-chance-input"><input class="lottery-prize-chance" type="number" min="0" max="100" step="0.1" value="${Math.max(0, Number(prize.chance) || 0)}" aria-label="확률 ${index + 1}" /><b>%</b></div>
    </div>`).join("");
}

function readPrizes(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(".lottery-prize-row")).map(row => ({
    label: row.querySelector(".lottery-prize-label")?.value.trim() || "",
    points: Math.max(0, Math.floor(Number(row.querySelector(".lottery-prize-points")?.value || 0))),
    chance: Math.max(0, Number(row.querySelector(".lottery-prize-chance")?.value || 0))
  }));
}

function validatePrizes(prizes) {
  if (!prizes.length) return "복권 당첨 항목을 입력해주세요.";
  if (prizes.some(prize => !prize.label)) return "모든 복권 결과에 문구를 입력해주세요.";
  const total = prizes.reduce((sum, prize) => sum + prize.chance, 0);
  if (Math.abs(total - 100) > 0.001) return `당첨 확률의 합계는 100%여야 합니다. 현재 ${total}%입니다.`;
  return null;
}

function ScratchTicket({ result, onClose }) {
  const canvasRef = useRef(null);
  const scratchingRef = useRef(false);
  const cellsRef = useRef(new Set());
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = 620;
    canvas.height = 230;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#b8bdc3";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = 10;
    for (let x = -220; x < 820; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 220, 230);
      ctx.stroke();
    }
    ctx.fillStyle = "#5e6670";
    ctx.font = "800 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("긁어서 행운을 확인하세요!", 310, 115);
  }, []);

  const scratch = event => {
    if (!scratchingRef.current || revealed) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
    const cellX = Math.max(0, Math.min(11, Math.floor(x / (canvas.width / 12))));
    const cellY = Math.max(0, Math.min(4, Math.floor(y / (canvas.height / 5))));
    cellsRef.current.add(`${cellX}:${cellY}`);
    if (cellsRef.current.size >= 22) setRevealed(true);
  };

  return createPortal(
    <div className="lottery-backdrop">
      <section className="lottery-modal" role="dialog" aria-modal="true" aria-labelledby="lottery-title">
        <div className="lottery-ticket-top">
          <div><span>DAILY SCRATCH</span><h2 id="lottery-title">{result.product_name}</h2></div>
          <b>오늘 {result.attempt_no} / {result.daily_limit}회</b>
        </div>
        <p className="lottery-guide">은색 부분을 마우스나 손가락으로 긁어 결과를 확인해주세요!</p>
        <div className={`scratch-card ${revealed ? "revealed" : ""}`}>
          <div className="scratch-result">
            <span>{result.reward_points > 0 ? "🎉 WINNER" : "TRY AGAIN"}</span>
            <strong>{result.result_label}</strong>
            <p>{result.reward_points > 0 ? `+${Number(result.reward_points).toLocaleString("ko-KR")} P가 자동 지급되었습니다!` : "아쉽지만 다음 복권의 행운을 노려보세요!"}</p>
          </div>
          <canvas ref={canvasRef}
            onPointerDown={event => { scratchingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); scratch(event); }}
            onPointerMove={scratch}
            onPointerUp={() => { scratchingRef.current = false; }}
            onPointerCancel={() => { scratchingRef.current = false; }} />
        </div>
        {!revealed ? <p className="lottery-progress-hint">조금 더 긁으면 결과가 완전히 공개됩니다.</p> : <button type="button" className="button primary wide lottery-close" onClick={onClose}>결과 확인</button>}
      </section>
    </div>, document.body
  );
}

export default function LotteryEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [scratchResult, setScratchResult] = useState(null);
  const [limitNotice, setLimitNotice] = useState(null);
  const [products, setProducts] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPage, setAdminPage] = useState(null);
  const [usage, setUsage] = useState([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [adminNotice, setAdminNotice] = useState(null);
  const editingProductIdRef = useRef(null);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("products").select("id,name,special_type,lottery_prizes,lottery_daily_limit,effect_duration_hours").order("created_at", { ascending: false });
    if (data) setProducts(data);
  }, [supabase]);

  const authHeaders = useCallback(async () => {
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token || ""}` };
  }, [supabase]);

  const loadUsage = useCallback(async () => {
    if (!isAdmin) return;
    setUsageLoading(true);
    try {
      const response = await fetch("/api/admin/lottery", { headers: await authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "복권 사용 기록을 불러오지 못했습니다.");
      const grouped = new Map();
      for (const row of data.plays || []) {
        const key = `${row.user_id}:${row.product_id}`;
        const current = grouped.get(key);
        if (current) { current.count += 1; current.results.push(row.result_label); }
        else grouped.set(key, { key, user_id: row.user_id, product_id: row.product_id, character_name: row.character_name, username: row.username, product_name: row.product_name, count: 1, results: [row.result_label] });
      }
      setUsage(Array.from(grouped.values()));
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "복권 기록을 불러오지 못했습니다.");
    } finally { setUsageLoading(false); }
  }, [isAdmin, authHeaders]);

  useEffect(() => {
    if (!supabase) return;
    const check = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) { setIsAdmin(false); return; }
      const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      setIsAdmin(data?.role === "admin");
      loadProducts();
    };
    check();
    const { data } = supabase.auth.onAuthStateChange(() => check());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadProducts]);

  useEffect(() => {
    const rememberEdit = event => {
      const button = event.target instanceof Element ? event.target.closest(".admin-product-edit-trigger") : null;
      if (!button) return;
      editingProductIdRef.current = button.closest(".product-admin-row")?.dataset.productAdminId || null;
    };
    document.addEventListener("click", rememberEdit, true);
    return () => document.removeEventListener("click", rememberEdit, true);
  }, []);

  useEffect(() => {
    const setTypeVisibility = (typeSelect, configBox, timedBox, clearTimed) => {
      const type = typeSelect.value;
      configBox.hidden = type !== "lottery";
      if (timedBox) timedBox.style.display = type === "timed" ? "grid" : "none";
      if (clearTimed && type !== "timed" && timedBox) {
        const duration = timedBox.querySelector("select");
        const text = timedBox.querySelector("input[type='text']");
        if (duration && duration.value) { duration.value = ""; duration.dispatchEvent(new Event("change", { bubbles: true })); }
        if (text && text.value) { text.value = ""; text.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    };

    const scan = () => {
      const page = document.querySelector(".admin-page");
      setAdminPage(previous => previous === page ? previous : page);

      document.querySelectorAll(".admin-form").forEach(section => {
        if (section.querySelector("h2")?.textContent?.trim() !== "상품 등록") return;
        const form = section.querySelector("form");
        if (!form) return;
        let wrapper = form.querySelector(".lottery-create-fields");
        if (!wrapper) {
          wrapper = document.createElement("div");
          wrapper.className = "lottery-admin-fields lottery-create-fields";
          wrapper.innerHTML = `<div class="lottery-admin-title">아이템 유형</div><label>유형 선택<select class="lottery-item-type"><option value="standard">일반 아이템</option><option value="timed">시간 효과 아이템</option><option value="lottery">일일복권 · 하루 3회</option></select></label><div class="lottery-config-box" hidden><div class="lottery-config-title"><strong>복권 당첨 설정</strong><span>확률 합계 100%</span></div><div class="lottery-prize-head"><span>#</span><span>결과 문구</span><span>포인트</span><span>확률</span></div><div class="lottery-prize-rows">${prizeRowsHtml(DEFAULT_PRIZES)}</div><p>복권 결과는 서버에서 무작위로 결정됩니다. 한 계정은 한국시간 기준 하루 최대 3회 사용할 수 있습니다.</p></div>`;
          const timedBox = form.querySelector(".timed-effect-admin-fields");
          if (timedBox) form.insertBefore(wrapper, timedBox); else form.prepend(wrapper);
          const typeSelect = wrapper.querySelector(".lottery-item-type");
          const configBox = wrapper.querySelector(".lottery-config-box");
          typeSelect.onchange = () => setTypeVisibility(typeSelect, configBox, form.querySelector(".timed-effect-admin-fields"), true);
        }
        setTypeVisibility(wrapper.querySelector(".lottery-item-type"), wrapper.querySelector(".lottery-config-box"), form.querySelector(".timed-effect-admin-fields"), false);
      });

      const modal = document.querySelector(".product-edit-modal");
      if (modal && !modal.querySelector(".lottery-edit-fields")) {
        const product = products.find(item => item.id === editingProductIdRef.current);
        if (product) {
          const type = product.special_type === "lottery" ? "lottery" : product.effect_duration_hours ? "timed" : "standard";
          const wrapper = document.createElement("div");
          wrapper.className = "lottery-admin-fields lottery-edit-fields";
          wrapper.innerHTML = `<div class="lottery-admin-title">아이템 유형</div><label>유형 선택<select class="lottery-item-type"><option value="standard" ${type === "standard" ? "selected" : ""}>일반 아이템</option><option value="timed" ${type === "timed" ? "selected" : ""}>시간 효과 아이템</option><option value="lottery" ${type === "lottery" ? "selected" : ""}>일일복권 · 하루 3회</option></select></label><div class="lottery-config-box" ${type === "lottery" ? "" : "hidden"}><div class="lottery-config-title"><strong>복권 당첨 설정</strong><span>확률 합계 100%</span></div><div class="lottery-prize-head"><span>#</span><span>결과 문구</span><span>포인트</span><span>확률</span></div><div class="lottery-prize-rows">${prizeRowsHtml(product.lottery_prizes || DEFAULT_PRIZES)}</div><p>확률과 당첨 포인트를 수정할 수 있습니다. 복권은 하루 최대 3회 사용됩니다.</p></div>`;
          const timedBox = modal.querySelector(".admin-maintenance-effect-box");
          const form = modal.querySelector("form");
          if (timedBox) form?.insertBefore(wrapper, timedBox); else form?.appendChild(wrapper);
          const select = wrapper.querySelector(".lottery-item-type");
          const configBox = wrapper.querySelector(".lottery-config-box");
          select.onchange = () => setTypeVisibility(select, configBox, modal.querySelector(".admin-maintenance-effect-box"), true);
          setTypeVisibility(select, configBox, timedBox, false);
        }
      }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [products]);

  useEffect(() => {
    if (!supabase) return;
    const previousFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/rest/v1/rpc/use_inventory_item") && typeof init?.body === "string") {
        try {
          const inventoryId = String(JSON.parse(init.body)?.inventory_item_id || "");
          if (inventoryId) {
            const { data: inventory } = await supabase.from("inventory").select("product_id").eq("id", inventoryId).maybeSingle();
            if (inventory?.product_id) {
              const { data: product } = await supabase.from("products").select("special_type").eq("id", inventory.product_id).maybeSingle();
              if (product?.special_type === "lottery") {
                const { data, error } = await supabase.rpc("play_lottery", { inventory_item_id: inventoryId });
                if (error) {
                  setLimitNotice(error.message);
                  return new Response(JSON.stringify({ code: "P0001", message: error.message, details: null, hint: null }), { status: 400, headers: { "Content-Type": "application/json" } });
                }
                setScratchResult(data);
                return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
              }
            }
          }
        } catch { /* 일반 아이템 사용 흐름 */ }
      }

      if (/\/api\/admin\/?(?:\?.*)?$/.test(url) && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body?.action === "create_product" || body?.action === "update_product") {
            const isCreate = body.action === "create_product";
            const root = document.querySelector(isCreate ? ".lottery-create-fields" : ".lottery-edit-fields");
            const type = root?.querySelector(".lottery-item-type")?.value || "standard";
            const prizes = readPrizes(root);
            if (type === "lottery") {
              const validation = validatePrizes(prizes);
              if (validation) return new Response(JSON.stringify({ error: validation }), { status: 400, headers: { "Content-Type": "application/json" } });
              body.payload.effect_duration_hours = null;
              body.payload.effect_text = "";
            }
            const response = await previousFetch(input, { ...init, body: JSON.stringify(body) });
            if (!response.ok) return response;
            let productId = isCreate ? "" : (editingProductIdRef.current || "");
            if (isCreate) {
              const name = String(body.payload?.name || "").trim();
              const { data } = await supabase.from("products").select("id").eq("name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
              productId = String(data?.id || "");
            }
            if (productId) {
              const { data: sessionData } = await supabase.auth.getSession();
              const configResponse = await previousFetch("/api/admin/lottery", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token || ""}` }, body: JSON.stringify({ action: "set_config", payload: { product_id: productId, special_type: type === "lottery" ? "lottery" : "standard", prizes } }) });
              if (!configResponse.ok) {
                const errorData = await configResponse.json().catch(() => ({}));
                setAdminNotice(errorData.error || "복권 설정 저장에 실패했습니다.");
              }
              loadProducts();
            }
            return response;
          }
        } catch { /* 기존 관리자 요청 */ }
      }
      return previousFetch(input, init);
    };
    return () => { window.fetch = previousFetch; };
  }, [supabase, loadProducts]);

  useEffect(() => { if (isAdmin && adminPage) loadUsage(); }, [isAdmin, adminPage, loadUsage]);

  async function resetUsage(group) {
    if (!window.confirm(`${group.character_name}의 '${group.product_name}' 오늘 복권 횟수(${group.count}회)를 초기화할까요?\n이미 지급된 당첨 포인트는 회수되지 않습니다.`)) return;
    try {
      const response = await fetch("/api/admin/lottery", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ action: "reset_today", payload: { user_id: group.user_id, product_id: group.product_id } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "초기화에 실패했습니다.");
      setAdminNotice(data.message || "오늘 복권 횟수를 초기화했습니다.");
      await loadUsage();
    } catch (error) { setAdminNotice(error instanceof Error ? error.message : "초기화에 실패했습니다."); }
  }

  return <>
    {scratchResult && <ScratchTicket result={scratchResult} onClose={() => setScratchResult(null)} />}
    {limitNotice && createPortal(<div className="lottery-backdrop" onMouseDown={() => setLimitNotice(null)}><section className="lottery-limit-modal" role="alertdialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}><div className="lottery-limit-icon">🎟️</div><span>DAILY LOTTERY</span><h2>오늘의 응모 완료!</h2><p>{limitNotice}</p><button type="button" className="button primary wide" onClick={() => setLimitNotice(null)}>확인</button></section></div>, document.body)}
    {isAdmin && adminPage && createPortal(<section className="panel lottery-admin-usage"><div className="panel-heading lottery-usage-heading"><div><div className="eyebrow">DAILY LOTTERY · ADMIN TEST</div><h2>오늘 복권 이용 현황</h2><p>테스트를 위해 회원별 오늘 이용 횟수만 초기화할 수 있습니다. 이미 받은 당첨 포인트는 유지됩니다.</p></div><button type="button" className="button outline small" disabled={usageLoading} onClick={loadUsage}>{usageLoading ? "불러오는 중…" : "새로고침"}</button></div>{adminNotice && <div className="lottery-admin-notice">{adminNotice}</div>}{usage.length ? <div className="lottery-usage-list">{usage.map(group => <article className="lottery-usage-row" key={group.key}><div><strong>{group.character_name}</strong><span>@{group.username}</span></div><div><strong>{group.product_name}</strong><span>{group.results.join(" · ")}</span></div><b>{group.count} / 3회</b><button type="button" className="button outline small" onClick={() => resetUsage(group)}>오늘 횟수 초기화</button></article>)}</div> : <div className="lottery-usage-empty">오늘 사용된 일일복권이 없습니다.</div>}</section>, adminPage)}
  </>;
}
