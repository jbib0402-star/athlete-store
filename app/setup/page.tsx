"use client";

import { useState } from "react";
import { Dumbbell, ShieldCheck } from "lucide-react";

export default function SetupPage() {
  const [form, setForm] = useState({ secret: "", username: "", password: "", character_name: "운영진" });
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(""); setMessage("");
    const response = await fetch("/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json();
    if (!response.ok) setError(data.error || "설정하지 못했습니다."); else setMessage(data.message);
    setLoading(false);
  }
  return <main className="setup-page"><section className="setup-card"><div className="brand-mark"><Dumbbell/></div><div className="eyebrow">FIRST ADMIN</div><h1>첫 운영진 계정 만들기</h1><p className="muted">배포 환경에 등록한 설정 코드로 최초 한 번만 사용할 수 있습니다.</p><form onSubmit={submit}><label>설정 코드<input type="password" value={form.secret} onChange={e => setForm(v => ({ ...v, secret: e.target.value }))} required/></label><label>운영진 아이디<input value={form.username} onChange={e => setForm(v => ({ ...v, username: e.target.value }))} pattern="[A-Za-z0-9._-]+" required/></label><label>운영진 비밀번호<input type="password" minLength={8} value={form.password} onChange={e => setForm(v => ({ ...v, password: e.target.value }))} required/></label><label>표시 이름<input value={form.character_name} onChange={e => setForm(v => ({ ...v, character_name: e.target.value }))} required/></label>{error && <p className="form-error">{error}</p>}{message && <p className="form-success"><ShieldCheck/> {message} 이제 메인 화면에서 로그인할 수 있습니다.</p>}<button className="button primary wide" disabled={loading}>{loading ? "설정 중…" : "운영진 계정 만들기"}</button></form></section></main>;
}
