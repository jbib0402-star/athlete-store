"use client";

import { useEffect } from "react";

const RESTORE_KEY = "athlete-store:restore-admin-members-after-delete";

function findButton(selector: string, text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .find(button => button.textContent?.includes(text));
}

export default function AdminMemberPageRestore() {
  useEffect(() => {
    const rememberMemberPage = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(".member-delete-modal button.button.danger");
      if (!button || !button.textContent?.includes("탈퇴시키기")) return;

      sessionStorage.setItem(RESTORE_KEY, "1");

      window.setTimeout(() => {
        if (document.querySelector(".member-delete-modal")) {
          sessionStorage.removeItem(RESTORE_KEY);
        }
      }, 5000);
    };

    document.addEventListener("click", rememberMemberPage, true);
    return () => document.removeEventListener("click", rememberMemberPage, true);
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_KEY) !== "1") return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;

      if (!document.querySelector(".admin-page")) {
        const adminButton = findButton(".sidebar nav button", "운영 관리");
        adminButton?.click();
        if (attempts < 80) return;
      }

      const membersButton = findButton(".admin-tabs button", "회원");
      if (membersButton) {
        membersButton.click();
        sessionStorage.removeItem(RESTORE_KEY);
        window.clearInterval(timer);
        return;
      }

      if (attempts >= 100) {
        sessionStorage.removeItem(RESTORE_KEY);
        window.clearInterval(timer);
      }
    }, 75);

    return () => window.clearInterval(timer);
  }, []);

  return null;
}
