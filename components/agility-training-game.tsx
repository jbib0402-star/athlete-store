"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Trophy, X, Zap } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase";

type Direction = "left" | "up" | "right" | "down";
type GameKind = "direction" | "timing" | "target";
type Answer = Direction | "miss" | number | null;
type Phase = "closed" | "ready" | "briefing" | "countdown" | "playing" | "submitting" | "result";

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
  const [gameKind, setGameKind] = useState<GameKind>("direction");
  const [challenges, setChallenges] = useState<number[]>([]);
  const [starting, setStarting] = useState(false);
  const timingCursor = useRef<HTMLSpanElement | null>(null);
  const displayedTimingMs = useRef(0);
  const startingRef = useRef(false);
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
  const transitionTimer = useRef<number | null>(null);

  useEffect(() => () => { if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current); }, []);

  const resetLocalGame = useCallback(() => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
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
          if (node.nodeType === Node.TEXT_NODE) node.textContent = "랜덤 훈련 시작";
        });
      }

      if (!card.querySelector(".agility-training-note")) {
        const note = document.createElement("p");
        note.className = "agility-training-note";
        note.textContent = "방향키 · 타이밍 스톱 · 표적 터치 중 랜덤 게임! 10회 중 7회 성공하면 훈련 완료.";
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
    if (startingRef.current) return;
    if (!supabase) { setErrorText("실제 로그인 상태에서 훈련할 수 있습니다."); return; }
    startingRef.current = true; setStarting(true); setErrorText("");
    try {
      const { data, error } = await supabase.rpc("start_random_training");
      if (error) throw new Error(error.message);
      const raw = data as Record<string, unknown> | null;
      const nextSequence = Array.isArray(raw?.sequence) ? raw.sequence.filter(isDirection) : [];
      const kind = raw?.game_type;
      if (!raw?.session_id || nextSequence.length !== TOTAL_ROUNDS ||
          (kind !== "direction" && kind !== "timing" && kind !== "target")) throw new Error("훈련 데이터를 불러오지 못했습니다.");
      const nextChallenges = Array.isArray(raw.challenges) ? raw.challenges.map(Number) : [];
      if (nextChallenges.length !== TOTAL_ROUNDS || nextChallenges.some(value => !Number.isInteger(value))) throw new Error("훈련 문제를 불러오지 못했습니다.");
      setGameKind(kind); setChallenges(nextChallenges); setSessionId(String(raw.session_id));
      setSequence(nextSequence); setRequiredCorrect(Number(raw.required_correct) || 7);
      setRoundTimeMs(Number(raw.round_time_ms) || 1400); setIndex(0); setAnswers([]);
      setCorrectCount(0); setCountdown(3); setFeedback(null); inputLockRef.current = false;
      setPhase("briefing");
    } catch (failure) { setErrorText(failure instanceof Error ? failure.message : "훈련을 시작하지 못했습니다."); }
    finally { startingRef.current = false; setStarting(false); }
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
    const { data, error } = await supabase.rpc("finish_random_training", {
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
    const position = typeof direction === "number" ? 100 - Math.abs(100 - (direction % 1800) / 9) : -1000;
    const correct = gameKind === "direction" ? direction === expected
      : gameKind === "target" ? direction === challenges[index]
      : typeof direction === "number" && Math.abs(position - challenges[index]) <= 12;
    const nextAnswers = [...answers, direction];
    setAnswers(nextAnswers);
    if (correct) setCorrectCount(value => value + 1);
    setFeedback(direction === "miss" || direction === null ? "timeout" : correct ? "correct" : "wrong");

    if (index >= sequence.length - 1) {
      transitionTimer.current = window.setTimeout(() => void finishTraining(nextAnswers), 180);
      return;
    }

    transitionTimer.current = window.setTimeout(() => {
      setIndex(value => value + 1);
      setFeedback(null);
      inputLockRef.current = false;
    }, 180);
  }, [phase, index, sequence, answers, finishTraining, gameKind, challenges]);

  useEffect(() => {
    if (phase !== "playing" || feedback || !sequence[index]) return;
    const timer = window.setTimeout(() => submitDirection(gameKind === "direction" ? "miss" : null), roundTimeMs);
    return () => window.clearTimeout(timer);
  }, [phase, index, sequence, roundTimeMs, submitDirection, gameKind, feedback]);

  const stopTiming = useCallback(() => {
    // Judge the exact frame shown to the player, not a later click/release time.
    submitDirection(displayedTimingMs.current);
  }, [submitDirection]);

  useLayoutEffect(() => {
    if (phase !== "playing" || feedback || gameKind !== "timing") return;
    const cursor = timingCursor.current;
    if (!cursor) return;
    const startedAt = performance.now();
    displayedTimingMs.current = 0;
    cursor.style.left = "0%";
    let frame: number;
    const animate = (timestamp: number) => {
      if (inputLockRef.current) return;
      const elapsed = Math.min(roundTimeMs, Math.max(0, Math.floor(timestamp - startedAt)));
      displayedTimingMs.current = elapsed;
      // Only move the cursor; avoid rendering the entire game every frame.
      cursor.style.left = `${100 - Math.abs(100 - (elapsed % 1800) / 9)}%`;
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, index, gameKind, feedback, roundTimeMs]);

  useEffect(() => {
    if (phase !== "playing") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (gameKind === "timing" && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        stopTiming();
        return;
      }
      if (gameKind !== "direction") return;
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
  }, [phase, submitDirection, gameKind, stopTiming]);

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
    <section className="agility-game-modal" role="dialog" aria-modal="true" aria-label="랜덤 훈련 게임">
      {phase !== "submitting" && <button type="button" className="agility-game-close" aria-label="훈련 창 닫기" disabled={starting} onClick={closeGame}><X size={18}/></button>}

      {(phase === "ready" || phase === "briefing") && <>
        <div className="agility-game-kicker"><Zap size={15}/> RANDOM TRAINING</div>
        <h2 id="agility-game-title">{phase === "ready" ? "오늘의 랜덤 훈련" : gameKind === "timing" ? "타이밍 스톱" : gameKind === "target" ? "표적 터치" : "순발력 방향키 훈련"}</h2>
        <p className="agility-game-lead">{phase === "ready" ? "방향키 · 타이밍 스톱 · 표적 터치 중 하나가 랜덤으로 나옵니다." : gameKind === "timing" ? "움직이는 막대가 초록 구간에 들어왔을 때 정지 버튼을 누르세요." : gameKind === "target" ? "9칸 중 초록색 표적을 빠르게 터치하세요." : "화면에 나타나는 방향과 같은 버튼을 제한시간 안에 눌러주세요."}</p>
        <div className="agility-rules">
          <div><b>10</b><span>총 도전 횟수</span></div>
          <div><b>7+</b><span>완료 기준</span></div>
          <div><b>{phase === "ready" ? "3종" : (roundTimeMs / 1000) + "s"}</b><span>{phase === "ready" ? "랜덤 게임" : "1회 제한시간"}</span></div>
        </div>
        <p className="agility-device-help">{phase === "ready" ? "모든 게임은 같은 일일 훈련 횟수와 보상을 사용해요." : gameKind === "timing" ? "모바일은 정지 버튼 · PC는 클릭, 스페이스 또는 Enter" : gameKind === "target" ? "모바일은 표적 터치 · PC는 표적 클릭" : "PC는 방향키 또는 WASD · 모바일은 화면 방향 버튼"}</p>
        {errorText && <div className="agility-error">{errorText}</div>}
        <button type="button" className="button primary wide agility-start" disabled={starting} onClick={() => phase === "ready" ? void beginTraining() : setPhase("countdown")}>{starting ? "게임 선택 중…" : phase === "ready" ? "랜덤 훈련 시작" : "준비 완료 · 시작"} <Zap size={18}/></button>
      </>}

      {phase === "countdown" && <div className="agility-countdown-wrap">
        <div className="agility-game-kicker">GET READY</div>
        <strong className="agility-countdown">{countdown || "GO!"}</strong>
        <p>화면에 집중하세요!</p>
      </div>}

      {phase === "playing" && currentMeta && <>
        <div className="agility-game-status">
          <span>ROUND <b>{index + 1}</b> / {sequence.length}</span>
          <span>SUCCESS <b>{correctCount}</b></span>
        </div>
        <div className="agility-round-track"><i key={index} style={{ animationDuration: `${roundTimeMs}ms` }}/></div>
        {gameKind === "direction" ? <>        <div className={`agility-direction-card ${feedback || ""}`}>
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
</> : gameKind === "timing" ? <div className="timing-game">
          <p>초록 구간에서 멈추세요!</p>
          <div className="timing-lane" aria-label="움직이는 타이밍 막대">
            <span className="timing-zone" style={{ left: `${challenges[index] - 12}%`, width: "24%" }} />
            <span ref={timingCursor} className="timing-cursor" style={{ left: "0%" }} />
          </div>
          <strong aria-live="polite">{feedback === "correct" ? "GOOD!" : feedback ? "MISS!" : "집중!"}</strong>
          <button type="button" className="button primary wide timing-stop" disabled={!!feedback} onPointerDown={event => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); stopTiming(); }} onClick={event => { if (event.detail === 0) stopTiming(); }}>정지!</button>
        </div> : <div className="target-game">
          <p>초록 표적을 터치하세요!</p>
          <div className="target-grid">{Array.from({ length: 9 }, (_, cell) => <button type="button" key={cell} className={cell === challenges[index] ? "target-cell active" : "target-cell"} aria-label={cell === challenges[index] ? "표적" : `빈 칸 ${cell + 1}`} disabled={!!feedback} onClick={() => submitDirection(cell)}>{cell === challenges[index] ? "◎" : "·"}</button>)}</div>
          <strong aria-live="polite">{feedback === "correct" ? "GOOD!" : feedback ? "MISS!" : "TOUCH!"}</strong>
        </div>}
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
