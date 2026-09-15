"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";

const RESTORE_KEY = "athlete-store:restore-profile-after-nickname-edit";
const NOTICE_KEY = "athlete-store:nickname-edit-success";

function findProfileNavButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find(button => button.textContent?.includes("내 정보"));
}

export default function ProfileNicknameEditor() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    const scan = () => {
      const h1 = document.querySelector<HTMLElement>(".profile-page .profile-hero h1");
      const nextTarget = h1?.parentElement || null;
      setMountTarget(current => current === nextTarget ? current : nextTarget);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_KEY) !== "1") return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const button = findProfileNavButton();
      if (button) {
        button.click();
        sessionStorage.removeItem(RESTORE_KEY);
        window.clearInterval(timer);

        if (sessionStorage.getItem(NOTICE_KEY) === "1") {
          sessionStorage.removeItem(NOTICE_KEY);
          setNotice(true);
          window.setTimeout(() => setNotice(false), 3200);
        }
      } else if (attempts >= 100) {
        sessionStorage.removeItem(RESTORE_KEY);
        sessionStorage.removeItem(NOTICE_KEY);
        window.clearInterval(timer);
      }
    }, 75);

    return () => window.clearInterval(timer);
  }, []);

  const openEditor = useCallback(async () => {
    if (!supabase) return;
    setErrorText("");

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      setErrorText("로그인이 필요합니다.");
      setOpen(true);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("username,character_name")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      setErrorText(error?.message || "프로필을 불러오지 못했습니다.");
      setOpen(true);
      return;
    }

    setValue(String(data.character_name || ""));
    setAccountId(String(data.username || ""));
    setOpen(true);
  }, [supabase]);

  const save = useCallback(async () => {
    if (!supabase || saving) return;
    const cleaned = value.trim().replace(/\s+/g, " ");

    if (!cleaned) {
      setErrorText("닉네임을 입력해주세요.");
      return;
    }
    if (cleaned.length > 30) {
      setErrorText("닉네임은 30자 이하로 입력해주세요.");
      return;
    }

    setSaving(true);
    setErrorText("");
    const { error } = await supabase.rpc("update_my_character_name", { new_character_name: cleaned });
    setSaving(false);

    if (error) {
      setErrorText(error.message || "닉네임을 수정하지 못했습니다.");
      return;
    }

    sessionStorage.setItem(RESTORE_KEY, "1");
    sessionStorage.setItem(NOTICE_KEY, "1");
    window.location.reload();
  }, [supabase, saving, value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setOpen(false);
      if (event.key === "Enter" && !event.isComposing && !saving) void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, save]);

  return <>
    {mountTarget && createPortal(
      <button type="button" className="button outline small profile-nickname-edit-button" onClick={() => void openEditor()}>
        <Pencil size={14} /> 닉네임 수정
      </button>,
      mountTarget
    )}

    {notice && <div className="profile-nickname-notice"><Check size={17} />닉네임을 수정했습니다.</div>}

    {open && <div className="profile-nickname-backdrop" onMouseDown={() => !saving && setOpen(false)}>
      <section className="profile-nickname-modal" role="dialog" aria-modal="true" aria-labelledby="nickname-edit-title" onMouseDown={event => event.stopPropagation()}>
        <button type="button" className="profile-nickname-close" aria-label="닫기" disabled={saving} onClick={() => setOpen(false)}><X size={18} /></button>
        <div className="eyebrow">PROFILE EDIT</div>
        <h2 id="nickname-edit-title">닉네임 수정</h2>
        <p>@{accountId || "account"} · 로그인 아이디는 변경되지 않습니다.</p>
        <label>
          새 닉네임
          <input autoFocus maxLength={30} value={value} onChange={event => { setValue(event.target.value); setErrorText(""); }} placeholder="닉네임을 입력해주세요" />
          <small>{value.trim().length} / 30</small>
        </label>
        {errorText && <div className="profile-nickname-error">{errorText}</div>}
        <div className="profile-nickname-actions">
          <button type="button" className="button ghost" disabled={saving} onClick={() => setOpen(false)}>취소</button>
          <button type="button" className="button primary" disabled={saving || !value.trim()} onClick={() => void save()}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </section>
    </div>}
  </>;
}
