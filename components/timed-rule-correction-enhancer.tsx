"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function TimedRuleCorrectionEnhancer() {
  const [healthNotice, setHealthNotice] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const patchDurationControls = () => {
      const createSelect = document.getElementById("timed-effect-duration") as HTMLSelectElement | null;
      if (createSelect) {
        const legacyOption = Array.from(createSelect.options).find(option => option.value === "12");
        if (legacyOption && legacyOption.textContent !== "8시간") legacyOption.textContent = "8시간";
      }

      const createHelp = document.querySelector<HTMLElement>(".timed-effect-admin-fields p");
      const helpText = "동일 아이템은 남은 시간에 이어서 중첩됩니다. 6시간 효과는 최대 3개, 8시간 효과는 최대 2개, 24시간 효과는 하루 1개까지 사용할 수 있습니다.";
      if (createHelp && createHelp.textContent !== helpText) createHelp.textContent = helpText;

      document.querySelectorAll<HTMLElement>(".product-edit-modal label").forEach(label => {
        if (!label.textContent?.trim().startsWith("효과 지속시간")) return;
        const select = label.querySelector<HTMLSelectElement>("select");
        if (!select) return;
        const legacyOption = Array.from(select.options).find(option => option.value === "12");
        if (legacyOption) {
          legacyOption.value = "8";
          legacyOption.textContent = "8시간";
        }
        if (Array.from(select.options).some(option => option.value === "8") && select.value === "") {
          const selectedValue = select.getAttribute("data-current-duration");
          if (selectedValue === "8") select.value = "8";
        }
      });
    };

    patchDurationControls();
    const observer = new MutationObserver(patchDurationControls);
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
          if (body?.action === "update_product" && body?.payload?.effect_duration_hours === 8) {
            body.payload.effect_duration_hours = 12;
            nextInit = { ...init, body: JSON.stringify(body) };
          }
        } catch {
          // 기존 요청을 그대로 보냅니다.
        }
      }

      const response = await originalFetch(input, nextInit);

      if (url.includes("/rest/v1/rpc/use_inventory_item") && !response.ok) {
        const cloned = response.clone();
        window.setTimeout(async () => {
          try {
            const payload = await cloned.json();
            const message = String(payload?.message || "");
            if (message.includes("선수의 컨디션과 건강 보호를 위해")) setHealthNotice(message);
          } catch {
            // 기본 오류 표시는 기존 화면에서 처리합니다.
          }
        }, 0);
      }

      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, []);

  if (!mounted || !healthNotice) return null;

  return createPortal(
    <div className="status-activation-backdrop" onMouseDown={() => setHealthNotice(null)}>
      <section className="status-activation-modal status-limit-modal" role="alertdialog" aria-modal="true" aria-labelledby="athlete-health-title" onMouseDown={event => event.stopPropagation()}>
        <div className="status-activation-symbol">!</div>
        <div className="status-activation-kicker">ATHLETE CARE</div>
        <h2 id="athlete-health-title">컨디션 보호 안내</h2>
        <p className="status-limit-message">{healthNotice}</p>
        <p className="status-activation-duration">선수의 안전한 회복과 컨디션 관리를 위한 사용 제한입니다.</p>
        <button type="button" className="button danger wide" onClick={() => setHealthNotice(null)}>확인</button>
      </section>
    </div>,
    document.body
  );
}
