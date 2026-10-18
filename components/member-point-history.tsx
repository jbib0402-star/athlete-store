"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";
import type { PointLog, Profile } from "@/lib/types";

type Filter = "all" | "spent" | "earned";
type Result = { member: Pick<Profile, "id" | "username" | "character_name" | "points">; logs: PointLog[]; hasMore: boolean };
const labels: Record<string, string> = {
  purchase: "상품 구매", gift: "선물", transfer_out: "양도 보냄", transfer_in: "양도 받음",
  attendance: "출석", training: "훈련", welcome: "가입 축하", admin: "운영진 조정",
  gacha: "잡동사니 뽑기", lottery: "일일복권"
};
const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const numberFormat = new Intl.NumberFormat("ko-KR");

export default function MemberPointHistory({ member, currency, onClose }: { member: Profile; currency: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(""); setResult(null);
    async function load() {
      try {
        const supabase = getSupabaseBrowser();
        const session = supabase ? (await supabase.auth.getSession()).data.session : null;
        if (!session) throw new Error("로그인이 필요합니다. 다시 로그인해주세요.");
        const response = await fetch("/api/admin", {
          method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "list_member_point_logs", payload: { user_id: member.id, page, filter } })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "포인트 내역을 불러오지 못했습니다.");
        if (active) setResult(data);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "포인트 내역을 불러오지 못했습니다.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [member.id, page, filter, reload]);

  return <dialog ref={dialog} className="member-point-dialog" aria-labelledby="member-point-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="member-point-heading">
      <div><div className="eyebrow">POINT HISTORY</div><h2 id="member-point-title">{member.character_name} 포인트 내역</h2><p>@{member.username} · 한국 시간 기준</p></div>
      <button type="button" className="icon-button" aria-label="포인트 내역 닫기" onClick={onClose}><X size={20}/></button>
    </div>
    <div className="member-point-balance"><span>현재 보유 포인트</span><strong>{numberFormat.format(result?.member.points ?? member.points)} {currency}</strong></div>
    <div className="member-point-controls">
      <label>내역 구분<select value={filter} onChange={event => { setFilter(event.target.value as Filter); setPage(1); }}><option value="all">전체 내역</option><option value="spent">사용·차감 내역</option><option value="earned">적립·지급 내역</option></select></label>
      <button type="button" className="button outline small" disabled={loading} onClick={() => { setPage(1); setReload(value => value + 1); }}>새로고침</button>
    </div>
    <div className="member-point-content" aria-busy={loading}>
      {loading ? <p role="status">포인트 내역을 불러오는 중…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="button outline small" onClick={() => setReload(value => value + 1)}>다시 시도</button></div> : result?.logs.length ? <ul className="member-point-logs">{result.logs.map(log => <li key={log.id}>
        <div><span className="member-point-kind">{labels[log.type] || (log.amount < 0 ? "사용·차감" : "적립·지급")}</span><p>{log.description || "포인트 변동"}</p><time dateTime={log.created_at}>{dateFormat.format(new Date(log.created_at))}</time></div>
        <strong className={log.amount < 0 ? "spent" : "earned"}>{log.amount > 0 ? "+" : ""}{numberFormat.format(log.amount)} {currency}</strong>
      </li>)}</ul> : <p role="status">{page > 1 ? "이 페이지에 기록이 없습니다. 이전 페이지를 확인해주세요." : "해당하는 포인트 내역이 없습니다."}</p>}
    </div>
    <nav className="member-point-pagination" aria-label="포인트 내역 페이지">
      <button type="button" className="button outline small" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>이전</button>
      <span>{page}페이지 · 20개씩</span>
      <button type="button" className="button outline small" disabled={loading || !!error || !result?.hasMore} onClick={() => setPage(value => value + 1)}>다음</button>
    </nav>
  </dialog>;
}
