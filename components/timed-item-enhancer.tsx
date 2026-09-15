"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type ActiveEffect = {
  id: string;
  product_name: string;
  effect_text: string | null;
  effect_expires_at: string | null;
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
  const [now, setNow] = useState(() => Date.now());
  const [balancePanel, setBalancePanel] = useState<HTMLElement | null>(null);

  const loadEffects = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) { setEffects([]); return; }

    const { data } = await supabase
      .from("inventory")
      .select("id,product_name,effect_text,effect_expires_at")
      .eq("user_id", userId)
      .not("effect_expires_at", "is", null)
      .gt("effect_expires_at", new Date().toISOString())
      .order("effect_expires_at", { ascending: true });

    setEffects((data || []) as ActiveEffect[]);
  }, [supabase]);

  useEffect(() => {
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
          <p>시간제 아이템은 사용한 순간부터 자동으로 시간이 계산되며, 남은 시간이 메인 잔액 카드에 표시됩니다.</p>
        `;

        const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit'], button.button.primary.wide");
        if (submitButton) form.insertBefore(wrapper, submitButton);
        else form.appendChild(wrapper);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let nextInit = init;
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/admin") && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body?.action === "create_product" && body?.payload) {
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

      const response = await originalFetch(input, nextInit);
      if (url.includes("/rest/v1/rpc/use_inventory_item") && response.ok) {
        window.setTimeout(loadEffects, 250);
      }
      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, [loadEffects]);

  const visibleEffects = effects.filter(effect => effect.effect_expires_at && new Date(effect.effect_expires_at).getTime() > now);

  if (!balancePanel || !visibleEffects.length) return null;

  return createPortal(
    <div className="timed-effects-list" aria-live="polite">
      {visibleEffects.map(effect => {
        const expires = new Date(effect.effect_expires_at as string).getTime();
        return <div className="timed-effect-row" key={effect.id}>
          <div>
            <strong>{effect.product_name}</strong>
            <span>{effect.effect_text || "아이템 효과 적용 중"}</span>
          </div>
          <b>{formatRemaining(expires - now)}</b>
        </div>;
      })}
    </div>,
    balancePanel
  );
}
