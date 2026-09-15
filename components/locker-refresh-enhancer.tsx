"use client";

import { useEffect } from "react";

const RESTORE_KEY = "athlete-store:restore-locker-after-refresh";

function findLockerNavButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find(button => button.textContent?.includes("장바구니") && button.textContent?.includes("보관함"));
}

function findLockerPanel() {
  return Array.from(document.querySelectorAll<HTMLElement>(".panel"))
    .find(panel => panel.querySelector("h2")?.textContent?.trim() === "내 보관함");
}

export default function LockerRefreshEnhancer() {
  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_KEY) !== "1") return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const lockerButton = findLockerNavButton();
      if (lockerButton) {
        lockerButton.click();
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

  useEffect(() => {
    const scan = () => {
      const panel = findLockerPanel();
      if (!panel) return;

      const heading = panel.querySelector<HTMLElement>(".panel-heading");
      if (!heading || heading.querySelector(".locker-refresh-trigger")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "button outline small locker-refresh-trigger";
      button.textContent = "새로고침";
      button.setAttribute("aria-label", "보관함 새로고침");
      button.onclick = () => {
        button.disabled = true;
        button.textContent = "새로고침 중…";
        sessionStorage.setItem(RESTORE_KEY, "1");
        window.location.reload();
      };

      const count = heading.querySelector(".count-pill");
      if (count) heading.insertBefore(button, count);
      else heading.appendChild(button);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
