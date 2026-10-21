"use client";

import { useRef, useState } from "react";

export default function OperatorAccessControl({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function toggle() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await onChange(!enabled); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "접속 설정을 변경하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="signup-availability">
    <div><h3>운영진 전용 접속</h3><p>{enabled ? "ON · 관리자와 스태프만 접속할 수 있습니다." : "OFF · 일반 회원도 접속할 수 있습니다."}</p><small>ON으로 설정하면 접속 중인 일반 회원도 이용이 제한되며, 신규 회원가입도 일시 중단됩니다.</small></div>
    <button type="button" role="switch" aria-label="운영진 전용 접속" aria-checked={enabled} disabled={busy} className={`status-toggle ${enabled ? "on" : ""}`} onClick={() => void toggle()}>{busy ? "변경 중…" : enabled ? "ON" : "OFF"}</button>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
