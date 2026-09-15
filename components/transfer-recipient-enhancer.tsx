"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseBrowser } from "@/lib/supabase";

type Member = {
  id: string;
  username: string;
  character_name: string;
};

export default function TransferRecipientEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const loadMembers = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id || null;
    setCurrentUserId(userId);
    if (!userId) {
      setMembers([]);
      return;
    }
    const { data } = await supabase.from("profiles").select("id,username,character_name").order("character_name");
    if (data) setMembers(data as Member[]);
  }, [supabase]);

  useEffect(() => {
    loadMembers();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => loadMembers());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadMembers]);

  const availableMembers = useMemo(() => members.filter(member => member.id !== currentUserId), [members, currentUserId]);

  const suggestions = useMemo(() => {
    const raw = query.trim().toLowerCase();
    if (!raw) return [];
    const usernameQuery = raw.replace(/^@/, "");
    return availableMembers
      .filter(member => member.character_name.toLowerCase().includes(raw) || member.username.toLowerCase().includes(usernameQuery))
      .slice(0, 8);
  }, [query, availableMembers]);

  const setUnderlyingRecipient = useCallback((id: string) => {
    const select = document.querySelector<HTMLSelectElement>(".transfer-card select.transfer-original-select");
    if (!select) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, []);

  const choose = useCallback((member: Member) => {
    setSelectedId(member.id);
    setQuery(member.character_name);
    setUnderlyingRecipient(member.id);
  }, [setUnderlyingRecipient]);

  useEffect(() => {
    const raw = query.trim();
    if (!raw) {
      if (selectedId) {
        setSelectedId("");
        setUnderlyingRecipient("");
      }
      return;
    }
    if (selectedId) return;

    const rawLower = raw.toLowerCase();
    const usernameQuery = rawLower.replace(/^@/, "");
    const exact = availableMembers.filter(member =>
      member.character_name.trim().toLowerCase() === rawLower || member.username.toLowerCase() === usernameQuery
    );
    if (exact.length === 1) {
      setSelectedId(exact[0].id);
      setUnderlyingRecipient(exact[0].id);
    } else {
      setUnderlyingRecipient("");
    }
  }, [query, selectedId, availableMembers, setUnderlyingRecipient]);

  useEffect(() => {
    const scan = () => {
      const card = document.querySelector<HTMLElement>(".transfer-card");
      if (!card) {
        setMount(null);
        setQuery("");
        setSelectedId("");
        return;
      }

      const labels = Array.from(card.querySelectorAll<HTMLLabelElement>("label"));
      const recipientLabel = labels.find(label => label.textContent?.includes("받을 캐릭터"));
      const select = recipientLabel?.querySelector<HTMLSelectElement>("select");
      if (!recipientLabel || !select) return;

      select.classList.add("transfer-original-select");
      select.style.display = "none";
      let nextMount = recipientLabel.querySelector<HTMLElement>(".transfer-search-mount");
      if (!nextMount) {
        nextMount = document.createElement("div");
        nextMount.className = "transfer-search-mount";
        recipientLabel.appendChild(nextMount);
      }
      setMount(previous => previous === nextMount ? previous : nextMount);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!mount) return null;

  const selectedMember = availableMembers.find(member => member.id === selectedId);

  return createPortal(
    <div className="gift-recipient-search transfer-recipient-search">
      <input
        value={query}
        onChange={event => { setQuery(event.target.value); setSelectedId(""); }}
        placeholder="닉네임 또는 @아이디 입력"
        autoComplete="off"
      />
      {query.trim() && !selectedId && <div className="gift-suggestions">
        {suggestions.length ? suggestions.map(member => <button type="button" key={member.id} onClick={() => choose(member)}>
          <strong>{member.character_name}</strong>
          <span>@{member.username}</span>
        </button>) : <div className="gift-no-result">일치하는 캐릭터가 없습니다.</div>}
      </div>}
      {selectedMember && <div className="gift-selected">받는 사람: <strong>{selectedMember.character_name}</strong> <span>@{selectedMember.username}</span></div>}
    </div>,
    mount
  );
}
