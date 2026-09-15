"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type RawActiveEffect = {
  id: string;
  product_id: string | null;
  product_name: string;
  effect_text: string | null;
  effect_duration_hours: number | null;
  effect_expires_at: string | null;
};

type ActiveEffect = {
  id: string;
  key: string;
  product_name: string;
  effect_text: string | null;
  effect_expires_at: string;
  stack_count: number;
};

type ActivationNotice = {
  product_name: string;
  effect_text: string | null;
  effect_duration_hours: number;
};

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TimedItemEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [effects, setEffects] = useState<ActiveEffect[]>([]);
  const [activationNotice, setActivationNotice] = useState<ActivationNotice | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [balancePanel, setBalancePanel] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  const loadEffects = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) { setEffects([]); return; }

    const { data } = await supabase
      .from("inventory")
      .select("id,product_id,product_name,effect_text,effect_duration_hours,effect_expires_at")
      .eq("user_id", userId)
      .not("effect_expires_at", "is", null)
      .gt("effect_expires_at", new Date().toISOString())
      .order("effect_expires_at", { ascending: true });

    const grouped = new Map<string, ActiveEffect>();
    for (const row of (data || []) as RawActiveEffect[]) {
      if (!row.effect_expires_at) continue;
      const key = row.product_id || `${row.product_name}::${row.effect_text || ""}::${row.effect_duration_hours || 0}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          id: row.id,
          key,
          product_name: row.product_name,
          effect_text: row.effect_text,
          effect_expires_at: row.effect_expires_at,
          stack_count: 1
        });
        continue;
      }

      const currentExpires = new Date(current.effect_expires_at).getTime();
      const rowExpires = new Date(row.effect_expires_at).getTime();
      grouped.set(key, {
        ...current,
        effect_expires_at: rowExpires > currentExpires ? row.effect_expires_at : current.effect_expires_at,
        stack_count: current.stack_count + 1
      });
    }

    setEffects(Array.from(grouped.values()).sort((a, b) =>
      new Date(a.effect_expires_at).getTime() - new Date(b.effect_expires_at).getTime()
    ));
  }, [supabase]);

  useEffect(() => {
    setMounted(true);
    loadEffects();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => loadEffects());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadEffects]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const scan = () => {
      const panel = document.querySelector<HTMLElement>(".balance-panel");
      setBalancePanel(previous => previous === panel ? previous : panel);

      if (panel) {
        const profileLine = panel.querySelector<HTMLElement>("small");
        const current = profileLine?.textContent?.trim() || "";
        if (profileLine && current.includes("·")) {
          const nickname = current.split("·")[0].trim();
          if (nickname && profileLine.textContent !== nickname) profileLine.textContent = nickname;
        }
      }

      document.querySelectorAll<HTMLElement>(".admin-form").forEach(section => {
        if (section.querySelector("h2")?.textContent?.trim() !== "상품 등록") return;
        const form = section.querySelector<HTMLFormElement>("form");
        if (!form || form.dataset.timedEffectEnhanced === "true") return;
        form.dataset.timedEffectEnhanced = "true";

        const wrapper = document.createElement("div");
        wrapper.className = "timed-effect-admin-fields";
        wrapper.innerHTML = `
          <div class="timed-effect-admin-title">시간제 아이템 효과 <span>선택사항</span></div>
          <label>효과 지속시간
            <select id="timed-effect-duration">
              <option value="">없음 · 일반 아이템</option>
              <option value="6">6시간</option>
              <option value="12">12시간</option>
              <option value="24">24시간</option>
            </select>
          </label>
          <label>효과 문구
            <input id="timed-effect-text" type="text" maxlength="120" placeholder="예: 야간 외출 허용 / 훈련 보너스 적용" />
          </label>
          <p>시간제 아이템은 사용한 순간부터 자동으로 시간이 계산됩니다. 동일 아이템은 시간이 이어서 중첩되며, 활성 시간제 아이템은 최대 3개까지 사용할 수 있습니다.</p>
        `;

        const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit'], button.button.primary.wide");
        if (submitButton) form.insertBefore(wrapper, submitButton);
        else form.appendChild(wrapper);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let nextInit = init;
      let creatingTimedProduct = false;
      let usedInventoryId: string | null = null;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/admin") && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body?.action === "create_product" && body?.payload) {
            creatingTimedProduct = true;
            const duration = (document.getElementById("timed-effect-duration") as HTMLSelectElement | null)?.value || "";
            const effectText = (document.getElementById("timed-effect-text") as HTMLInputElement | null)?.value?.trim() || "";
            body.payload.effect_duration_hours = duration ? Number(duration) : null;
            body.payload.effect_text = effectText;
            nextInit = { ...init, body: JSON.stringify(body) };
          }
        } catch {
          // 기존 요청을 그대로 보냅니다.
        }
      }

      if (url.includes("/rest/v1/rpc/use_inventory_item") && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body);
          usedInventoryId = typeof body?.inventory_item_id === "string" ? body.inventory_item_id : null;
        } catch {
          usedInventoryId = null;
        }
      }

      const response = await originalFetch(input, nextInit);

      if (creatingTimedProduct && response.ok) {
        const durationSelect = document.getElementById("timed-effect-duration") as HTMLSelectElement | null;
        const effectInput = document.getElementById("timed-effect-text") as HTMLInputElement | null;
        if (durationSelect) durationSelect.value = "";
        if (effectInput) effectInput.value = "";
      }

      if (url.includes("/rest/v1/rpc/use_inventory_item") && !response.ok) {
        const cloned = response.clone();
        window.setTimeout(async () => {
          try {
            const payload = await cloned.json();
            const message = String(payload?.message || "");
            if (message.includes("건강을 위해 더 이상 시간제 아이템")) setLimitNotice(message);
          } catch {
            // 기존 오류 처리는 본 화면의 토스트가 담당합니다.
          }
        }, 0);
      }

      if (url.includes("/rest/v1/rpc/use_inventory_item") && response.ok) {
        if (usedInventoryId) {
          window.setTimeout(async () => {
            const { data } = await supabase
              .from("inventory")
              .select("product_name,effect_text,effect_duration_hours,effect_expires_at")
              .eq("id", usedInventoryId)
              .maybeSingle();

            const duration = Number(data?.effect_duration_hours || 0);
            if (data?.effect_expires_at && duration > 0) {
              setActivationNotice({
                product_name: data.product_name,
                effect_text: data.effect_text,
                effect_duration_hours: duration
              });
            }
            loadEffects();
          }, 180);
        } else {
          window.setTimeout(loadEffects, 250);
        }
      }
      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, [supabase, loadEffects]);

  const visibleEffects = effects.filter(effect => new Date(effect.effect_expires_at).getTime() > now);

  if (!mounted) return null;

  return <>
    {balancePanel && visibleEffects.length > 0 && createPortal(
      <div className="timed-effects-list" aria-live="polite">
        {visibleEffects.map(effect => {
          const expires = new Date(effect.effect_expires_at).getTime();
          return <div className="timed-effect-row" key={effect.key}>
            <div>
              <strong>{effect.product_name}{effect.stack_count > 1 && <em className="timed-effect-stack"> ×{effect.stack_count} 중첩</em>}</strong>
              <span>{effect.effect_text || "아이템 효과 적용 중"}</span>
            </div>
            <b>{formatRemaining(expires - now)}</b>
          </div>;
        })}
      </div>,
      balancePanel
    )}

    {activationNotice && createPortal(
      <div className="status-activation-backdrop" onMouseDown={() => setActivationNotice(null)}>
        <section className="status-activation-modal" role="alertdialog" aria-modal="true" aria-labelledby="status-activation-title" onMouseDown={event => event.stopPropagation()}>
          <div className="status-activation-symbol">!</div>
          <div className="status-activation-kicker">ITEM EFFECT</div>
          <h2 id="status-activation-title">상태 이상 발동!!</h2>
          <strong className="status-activation-item">{activationNotice.product_name}</strong>
          <p className="status-activation-effect">{activationNotice.effect_text || "아이템 효과가 적용되었습니다."}</p>
          <p className="status-activation-duration"><b>{activationNotice.effect_duration_hours}시간</b>의 효과가 기존 효과와 이어서 적용됩니다!!</p>
          <button type="button" className="button primary wide" onClick={() => setActivationNotice(null)}>확인</button>
        </section>
      </div>,
      document.body
    )}

    {limitNotice && createPortal(
      <div className="status-activation-backdrop" onMouseDown={() => setLimitNotice(null)}>
        <section className="status-activation-modal status-limit-modal" role="alertdialog" aria-modal="true" aria-labelledby="status-limit-title" onMouseDown={event => event.stopPropagation()}>
          <div className="status-activation-symbol">!</div>
          <div className="status-activation-kicker">HEALTH WARNING</div>
          <h2 id="status-limit-title">사용 제한!</h2>
          <p className="status-limit-message">건강을 위해 더 이상 시간제 아이템을 사용할 수 없습니다!</p>
          <p className="status-activation-duration">시간제 아이템은 <b>최대 3개</b>까지 동시에 사용할 수 있습니다.<br/>현재 효과가 일부 종료된 뒤 다시 사용해주세요.</p>
          <button type="button" className="button danger wide" onClick={() => setLimitNotice(null)}>확인</button>
        </section>
      </div>,
      document.body
    )}
  </>;
}
