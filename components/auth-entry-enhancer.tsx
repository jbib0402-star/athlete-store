"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser, usernameToEmail } from "@/lib/supabase";

export default function AuthEntryEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const scan = () => setVisible(Boolean(document.querySelector(".login-page")));
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError("");
    const cleanUsername = username.trim().toLowerCase();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(cleanUsername),
      password
    });
    if (authError) setError("아이디 또는 비밀번호를 확인해주세요.");
    setBusy(false);
  }

  async function signup(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError("");
    const cleanUsername = username.trim().toLowerCase();
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: cleanUsername, password, character_name: nickname })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "가입하지 못했습니다.");
      setBusy(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(cleanUsername),
      password
    });
    if (authError) {
      setError("가입은 완료됐지만 자동 로그인에 실패했습니다. 로그인 탭에서 다시 로그인해주세요.");
      setMode("login");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  if (!visible || !supabase) return null;

  return <div className="auth-entry-overlay">
    <main className="auth-entry-shell">
      <section className="auth-entry-brand">
        <div className="auth-entry-kicker">NATIONAL TRAINING CENTER</div>
        <h1>선수촌 매점</h1>
        <p>로그인하거나 새 계정을 만들어 바로 이용하세요.</p>
      </section>

      <section className="auth-entry-card">
        <div className="auth-entry-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>로그인</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>회원가입</button>
        </div>

        {mode === "login" ? <form onSubmit={login} className="auth-entry-form">
          <div>
            <h2>로그인</h2>
            <p>가입할 때 만든 아이디와 비밀번호를 입력해주세요.</p>
          </div>
          <label>아이디<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="아이디" required /></label>
          <label>비밀번호<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="8자 이상" required /></label>
          {error && <p className="auth-entry-error">{error}</p>}
          <button className="auth-entry-submit" disabled={busy}>{busy ? "로그인 중…" : "로그인"}</button>
        </form> : <form onSubmit={signup} className="auth-entry-form">
          <div>
            <h2>회원가입</h2>
            <p>직접 계정을 만들면 <strong>시작 포인트 500P</strong>가 자동 지급됩니다.</p>
          </div>
          <label>아이디<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="영문 소문자/숫자, 3~30자" required /></label>
          <label>비밀번호<input value={password} onChange={e => setPassword(e.target.value)} type="password" minLength={8} autoComplete="new-password" placeholder="8자 이상" required /></label>
          <label>닉네임<input value={nickname} onChange={e => setNickname(e.target.value)} maxLength={40} placeholder="밴드에서 사용 중인 닉네임" required /><small>오타 없이 밴드에서 사용 중인 닉네임으로 작성해주세요.</small></label>
          {error && <p className="auth-entry-error">{error}</p>}
          <button className="auth-entry-submit" disabled={busy}>{busy ? "가입 중…" : "계정 만들기"}</button>
        </form>}
      </section>
    </main>
  </div>;
}
