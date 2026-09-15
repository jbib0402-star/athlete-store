"use client";

import { useEffect } from "react";

type Prize = { label: string; points: number; chance: number };

function readPrizes(root: ParentNode | null): Prize[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(".lottery-prize-row")).map(row => ({
    label: row.querySelector<HTMLInputElement>(".lottery-prize-label")?.value.trim() || "",
    points: Math.max(0, Math.floor(Number(row.querySelector<HTMLInputElement>(".lottery-prize-points")?.value || 0))),
    chance: Math.max(0, Number(row.querySelector<HTMLInputElement>(".lottery-prize-chance")?.value || 0))
  }));
}

function validatePrizes(prizes: Prize[]) {
  if (!prizes.length) return "복권 당첨 항목을 입력해주세요.";
  if (prizes.some(prize => !prize.label)) return "모든 복권 결과에 문구를 입력해주세요.";
  const total = prizes.reduce((sum, prize) => sum + prize.chance, 0);
  if (Math.abs(total - 100) > 0.001) return `당첨 확률의 합계는 100%여야 합니다. 현재 ${total}%입니다.`;
  return null;
}

export default function LotteryConfigBridge() {
  useEffect(() => {
    const previousFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isAdminProductRequest = /\/api\/admin\/?(?:\?.*)?$/.test(url) && typeof init?.body === "string";

      if (!isAdminProductRequest) return previousFetch(input, init);

      try {
        const body = JSON.parse(init!.body as string);
        if (body?.action !== "create_product" && body?.action !== "update_product") {
          return previousFetch(input, init);
        }

        const isCreate = body.action === "create_product";
        const root = document.querySelector<HTMLElement>(isCreate ? ".lottery-create-fields" : ".lottery-edit-fields");
        const type = root?.querySelector<HTMLSelectElement>(".lottery-item-type")?.value || "standard";
        const prizes = readPrizes(root);

        body.payload = body.payload || {};
        body.payload.special_type = type === "lottery" ? "lottery" : "standard";
        body.payload.lottery_daily_limit = 3;

        if (type === "lottery") {
          const validation = validatePrizes(prizes);
          if (validation) {
            return new Response(JSON.stringify({ error: validation }), {
              status: 400,
              headers: { "Content-Type": "application/json" }
            });
          }
          body.payload.lottery_prizes = prizes;
          body.payload.effect_duration_hours = null;
          body.payload.effect_text = "";
        }

        const response = await previousFetch(input, { ...init, body: JSON.stringify(body) });
        if (response.ok) {
          window.dispatchEvent(new CustomEvent("lottery-config-changed"));
          window.setTimeout(() => window.location.reload(), 350);
        }
        return response;
      } catch {
        return previousFetch(input, init);
      }
    };

    return () => { window.fetch = previousFetch; };
  }, []);

  return null;
}
