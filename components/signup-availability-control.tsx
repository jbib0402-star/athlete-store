"use client";
import { useRef, useState } from "react";

export default function SignupAvailabilityControl({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function toggle() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await onChange(!enabled); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "회원가입 설정을 변경하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="signup-availability">
    <div><h3>회원가입 허용</h3><p>{enabled ? "ON · 누구나 새 계정을 만들 수 있습니다." : "OFF · 신규 회원가입이 차단되어 있습니다."}</p><small>기존 회원 로그인과 운영자의 직접 회원 추가는 계속 이용할 수 있습니다.</small></div>
    <button type="button" role="switch" aria-label="회원가입 허용" aria-checked={enabled} disabled={busy} className={`status-toggle ${enabled ? "on" : ""}`} onClick={() => void toggle()}>{busy ? "변경 중…" : enabled ? "ON" : "OFF"}</button>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
