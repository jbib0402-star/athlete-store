"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";
import { OPERATOR_ONLY_MESSAGE } from "@/lib/store-access";

export default function StoreAccessGate({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [status, setStatus] = useState<"checking" | "allowed" | "blocked" | "error">("checking");
  const [restricted, setRestricted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [reload, setReload] = useState(0);
  const userId = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) { setStatus("allowed"); return; }
    let alive = true;
    let sequence = 0;
    const controller = new AbortController();
    async function refresh() {
      const current = ++sequence;
      try {
        const { data, error } = await supabase!.auth.getSession();
        if (error) throw error;
        const session = data.session;
        const response = await fetch("/api/access", {
          cache: "no-store", signal: controller.signal,
          headers: session ? { Authorization: `Bearer ${session.access_token}` } : {}
        });
        const access = await response.json();
        if (!response.ok) throw new Error("Access check failed");
        if (!alive || current !== sequence) return;
        userId.current = session?.user.id ?? null;
        setAuthenticated(Boolean(session));
        setRestricted(access.restricted === true);
        setStatus(!session || access.allowed === true ? "allowed" : "blocked");
      } catch {
        if (alive && current === sequence) setStatus("error");
      }
    }
    void refresh();
    let authTimer: number | undefined;
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (userId.current !== (session?.user.id ?? null)) setStatus("checking");
      window.clearTimeout(authTimer);
      authTimer = window.setTimeout(() => void refresh(), 0);
    });
    const interval = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false; controller.abort(); auth.subscription.unsubscribe();
      window.clearInterval(interval); window.clearTimeout(authTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supabase, reload]);

  if (status === "allowed") return <>{restricted && !authenticated && <div className="operator-access-banner" role="status">운영진 전용 접속 중 · 관리자와 스태프 계정으로 로그인해주세요.</div>}{children}</>;
  return <main className="operator-access-screen"><section className="operator-access-card">
    <ShieldCheck size={38}/>
    <h1>{status === "checking" ? "접속 상태 확인 중" : status === "blocked" ? "운영진 전용 접속 중" : "접속 상태를 확인하지 못했어요"}</h1>
    <p role="status">{status === "checking" ? "잠시만 기다려주세요." : status === "blocked" ? OPERATOR_ONLY_MESSAGE : "잠시 후 다시 시도하거나 다시 로그인해주세요."}</p>
    {status !== "checking" && <div className="operator-access-actions"><button type="button" className="button outline" onClick={() => { setStatus("checking"); setReload(value => value + 1); }}>다시 확인</button><button type="button" className="button primary" onClick={() => void supabase?.auth.signOut({ scope: "local" })}>로그아웃 · 다른 계정</button></div>}
  </section></main>;
}
