"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Trophy, X, Zap } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";

type Direction = "left" | "up" | "right" | "down";
type Answer = Direction | "miss";
type Phase = "closed" | "ready" | "countdown" | "playing" | "submitting" | "result";

type GameResult = {
  success: boolean;
  score: number;
  total: number;
  required_correct: number;
  reward: number;
  error?: string;
};

const RESTORE_ACTIVITY_KEY = "athlete-store:restore-activity-after-training";
const TOTAL_ROUNDS = 10;

const directionMeta: Record<Direction, { symbol: string; label: string; key: string }> = {
  left: { symbol: "←", label: "왼쪽", key: "←" },
  up: { symbol: "↑", label: "위", key: "↑" },
  right: { symbol: "→", label: "오른쪽", key: "→" },
  down: { symbol: "↓", label: "아래", key: "↓" }
};

function isDirection(value: unknown): value is Direction {
  return value === "left" || value === "up" || value === "right" || value === "down";
}

function findActivityButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find(button => button.textContent?.includes("출석") && button.textContent?.includes("훈련"));
}

export default function AgilityTrainingGame() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [phase, setPhase] = useState<Phase>("closed");
  const [sequence, setSequence] = useState<Direction[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [requiredCorrect, setRequiredCorrect] = useState(7);
  const [roundTimeMs, setRoundTimeMs] = useState(1400);
  const [countdown, setCountdown] = useState(3);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | "timeout" | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [errorText, setErrorText] = useState("");
  const inputLockRef = useRef(false);

  const resetLocalGame = useCallback(() => {
    setSequence([]);
    setSessionId("");
    setIndex(0);
    setAnswers([]);
    setCorrectCount(0);
    setRequiredCorrect(7);
    setRoundTimeMs(1400);
    setCountdown(3);
    setFeedback(null);
    setResult(null);
    setErrorText("");
    inputLockRef.current = false;
  }, []);

  const openGame = useCallback(() => {
    resetLocalGame();
    setPhase("ready");
  }, [resetLocalGame]);

  useEffect(() => {
    const interceptTraining = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(".activity-card.training button.button.primary.wide");
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openGame();
    };

    document.addEventListener("click", interceptTraining, true);
    return () => document.removeEventListener("click", interceptTraining, true);
  }, [openGame]);

  useEffect(() => {
    const scan = () => {
      const card = document.querySelector<HTMLElement>(".activity-card.training");
      const button = card?.querySelector<HTMLButtonElement>("button.button.primary.wide");
      if (!card || !button) return;

      if (!button.disabled && button.textContent?.includes("훈련 완료")) {
        button.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) node.textContent = "순발력 훈련 시작";
        });
      }

      if (!card.querySelector(".agility-training-note")) {
        const note = document.createElement("p");
        note.className = "agility-training-note";
        note.textContent = "← ↑ → ↓ 방향 지시 10개 중 7개 이상 성공하면 훈련 완료!";
        button.parentElement?.insertBefore(note, button);
      }
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(RESTORE_ACTIVITY_KEY) !== "1") return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (document.querySelector(".activity-page")) {
        sessionStorage.removeItem(RESTORE_ACTIVITY_KEY);
        window.clearInterval(timer);
        return;
      }
      const button = findActivityButton();
      if (button) button.click();
      if (attempts >= 100) {
        sessionStorage.removeItem(RESTORE_ACTIVITY_KEY);
        window.clearInterval(timer);
      }
    }, 75);
    return () => window.clearInterval(timer);
  }, []);

  const beginTraining = useCallback(async () => {
    if (!supabase) {
      setErrorText("실제 로그인 상태에서 훈련할 수 있습니다.");
      return;
    }

    setErrorText("");
    const { data, error } = await supabase.rpc("start_agility_training");
    if (error) {
      setErrorText(error.message);
      return;
    }

    const raw = data as Record<string, unknown> | null;
    const nextSequence = Array.isArray(raw?.sequence) ? raw.sequence.filter(isDirection) : [];
    if (!raw?.session_id || nextSequence.length !== TOTAL_ROUNDS) {
      setErrorText("훈련 데이터를 불러오지 못했습니다. 다시 시도해주세요.");
      return;
    }

    setSessionId(String(raw.session_id));
    setSequence(nextSequence);
    setRequiredCorrect(Number(raw.required_correct) || 7);
    setRoundTimeMs(Number(raw.round_time_ms) || 1400);
    setIndex(0);
    setAnswers([]);
    setCorrectCount(0);
    setCountdown(3);
    setFeedback(null);
    inputLockRef.current = false;
    setPhase("countdown");
  }, [supabase]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("playing");
      return;
    }
    const timer = window.setTimeout(() => setCountdown(value => value - 1), 650);
    return () => window.clearTimeout(timer);
  }, [phase, countdown]);

  const finishTraining = useCallback(async (answerList: Answer[]) => {
    if (!supabase || !sessionId) return;
    setPhase("submitting");
    const { data, error } = await supabase.rpc("finish_agility_training", {
      game_session_id: sessionId,
      answer_payload: answerList
    });

    if (error) {
      setResult({ success: false, score: correctCount, total: TOTAL_ROUNDS, required_correct: requiredCorrect, reward: 0, error: error.message });
      setPhase("result");
      return;
    }

    const payload = data as Record<string, unknown> | null;
    setResult({
      success: Boolean(payload?.success),
      score: Number(payload?.score) || 0,
      total: Number(payload?.total) || TOTAL_ROUNDS,
      required_correct: Number(payload?.required_correct) || requiredCorrect,
      reward: Number(payload?.reward) || 0
    });
    setPhase("result");
  }, [supabase, sessionId, correctCount, requiredCorrect]);

  const submitDirection = useCallback((direction: Answer) => {
    if (phase !== "playing" || inputLockRef.current || index >= sequence.length) return;
    inputLockRef.current = true;

    const expected = sequence[index];
    const correct = direction === expected;
    const nextAnswers = [...answers, direction];
    setAnswers(nextAnswers);
    if (correct) setCorrectCount(value => value + 1);
    setFeedback(direction === "miss" ? "timeout" : correct ? "correct" : "wrong");

    if (index >= sequence.length - 1) {
      window.setTimeout(() => void finishTraining(nextAnswers), 180);
      return;
    }

    window.setTimeout(() => {
      setIndex(value => value + 1);
      setFeedback(null);
      inputLockRef.current = false;
    }, 180);
  }, [phase, index, sequence, answers, finishTraining]);

  useEffect(() => {
    if (phase !== "playing" || !sequence[index]) return;
    const timer = window.setTimeout(() => submitDirection("miss"), roundTimeMs);
    return () => window.clearTimeout(timer);
  }, [phase, index, sequence, roundTimeMs, submitDirection]);

  useEffect(() => {
    if (phase !== "playing") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, Direction | undefined> = {
        ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down",
        a: "left", w: "up", d: "right", s: "down",
        A: "left", W: "up", D: "right", S: "down"
      };
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      submitDirection(direction);
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, submitDirection]);

  useEffect(() => {
    if (phase === "closed") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [phase]);

  const closeGame = useCallback(() => {
    if (phase === "submitting") return;
    if (phase === "result" && result?.success) {
      sessionStorage.setItem(RESTORE_ACTIVITY_KEY, "1");
      window.location.reload();
      return;
    }
    setPhase("closed");
    resetLocalGame();
  }, [phase, result, resetLocalGame]);

  const retry = useCallback(() => {
    resetLocalGame();
    setPhase("ready");
  }, [resetLocalGame]);

  if (phase === "closed") return null;

  const currentDirection = sequence[index];
  const currentMeta = currentDirection ? directionMeta[currentDirection] : null;

  return <div className="agility-game-backdrop" role="presentation">
    <section className="agility-game-modal" role="dialog" aria-modal="true" aria-labelledby="agility-game-title">
      {phase !== "submitting" && <button type="button" className="agility-game-close" aria-label="훈련 창 닫기" onClick={closeGame}><X size={18}/></button>}

      {phase === "ready" && <>
        <div className="agility-game-kicker"><Zap size={15}/> AGILITY TRAINING</div>
        <h2 id="agility-game-title">순발력 방향키 훈련</h2>
        <p className="agility-game-lead">화면에 나타나는 방향과 같은 키를 제한시간 안에 눌러주세요.</p>
        <div className="agility-ready-arrows" aria-hidden="true"><span>←</span><span>↑</span><span>↓</span><span>→</span></div>
        <div className="agility-rules">
          <div><b>10</b><span>총 지시 횟수</span></div>
          <div><b>7+</b><span>완료 기준</span></div>
          <div><b>1.4s</b><span>1회 제한시간</span></div>
        </div>
        <p className="agility-device-help">PC는 방향키 또는 WASD · 모바일은 화면 방향 버튼을 사용합니다.</p>
        {errorText && <div className="agility-error">{errorText}</div>}
        <button type="button" className="button primary wide agility-start" onClick={() => void beginTraining()}>훈련 시작 <Zap size={18}/></button>
      </>}

      {phase === "countdown" && <div className="agility-countdown-wrap">
        <div className="agility-game-kicker">GET READY</div>
        <strong className="agility-countdown">{countdown || "GO!"}</strong>
        <p>방향을 보고 최대한 빠르게 반응하세요!</p>
      </div>}

      {phase === "playing" && currentMeta && <>
        <div className="agility-game-status">
          <span>ROUND <b>{index + 1}</b> / {sequence.length}</span>
          <span>SUCCESS <b>{correctCount}</b></span>
        </div>
        <div className="agility-round-track"><i key={index} style={{ animationDuration: `${roundTimeMs}ms` }}/></div>
        <div className={`agility-direction-card ${feedback || ""}`}>
          <span>{currentMeta.label}</span>
          <strong aria-label={`${currentMeta.label} 방향`}>{currentMeta.symbol}</strong>
          <small>{feedback === "correct" ? "GOOD!" : feedback === "wrong" ? "MISS!" : feedback === "timeout" ? "TIME OUT" : "PRESS NOW"}</small>
        </div>
        <div className="agility-pad" aria-label="모바일 방향 버튼">
          <button type="button" className="up" aria-label="위" onClick={() => submitDirection("up")}><ArrowUp/></button>
          <button type="button" className="left" aria-label="왼쪽" onClick={() => submitDirection("left")}><ArrowLeft/></button>
          <button type="button" className="down" aria-label="아래" onClick={() => submitDirection("down")}><ArrowDown/></button>
          <button type="button" className="right" aria-label="오른쪽" onClick={() => submitDirection("right")}><ArrowRight/></button>
        </div>
        <p className="agility-game-tip">7개 이상 맞히면 오늘 훈련 1회가 완료됩니다.</p>
      </>}

      {phase === "submitting" && <div className="agility-submitting">
        <div className="agility-pulse"><Zap/></div>
        <h2>훈련 결과 확인 중…</h2>
        <p>기록을 저장하고 있어요.</p>
      </div>}

      {phase === "result" && result && <div className={`agility-result ${result.success ? "success" : "fail"}`}>
        <div className="agility-result-icon">{result.success ? <Trophy/> : <RotateCcw/>}</div>
        <div className="agility-game-kicker">TRAINING RESULT</div>
        <h2>{result.success ? (result.score === result.total ? "PERFECT!" : "훈련 완료!") : "조금만 더!"}</h2>
        <strong className="agility-score">{result.score} <small>/ {result.total}</small></strong>
        {result.error ? <div className="agility-error">{result.error}</div> : result.success
          ? <p><b>+{result.reward.toLocaleString("ko-KR")} P</b> 훈련 보상이 지급되었습니다.</p>
          : <p>{result.required_correct}개 이상 성공하면 완료돼요. 이번 시도는 일일 훈련 횟수에서 차감되지 않았습니다.</p>}
        <button type="button" className="button primary wide" onClick={result.success ? closeGame : retry}>
          {result.success ? "확인" : "다시 도전"}{result.success ? <Trophy size={18}/> : <RotateCcw size={18}/>}
        </button>
      </div>}
    </section>
  </div>;
}
