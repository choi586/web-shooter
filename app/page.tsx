'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { WebShooterAudio } from './audio';
import type { ReceiverHealthMessage, ReceiverMessage, ReceiverWebMessage } from './protocol';
import { WebShooterSerial, type SerialState } from './serial';

type Phase = 'attract' | 'play' | 'result';
type InputSource = 'serial' | 'keyboard' | 'test' | 'demo';
type HandSide = 'right' | 'left';

type DailyStats = {
  date: string;
  sessions: number;
  shots: number;
};

const buildings = [
  { left: '1%', width: '13%', height: '43%' },
  { left: '12%', width: '17%', height: '61%' },
  { left: '28%', width: '13%', height: '48%' },
  { left: '39%', width: '18%', height: '69%' },
  { left: '55%', width: '14%', height: '52%' },
  { left: '67%', width: '18%', height: '64%' },
  { left: '83%', width: '17%', height: '47%' },
];

const targets = [
  { x: 50, y: 26 },
  { x: 35, y: 35 },
  { x: 66, y: 38 },
  { x: 44, y: 48 },
  { x: 70, y: 25 },
  { x: 28, y: 47 },
  { x: 58, y: 51 },
];

const serialLabels: Record<SerialState, string> = {
  unsupported: '브라우저 미지원',
  disconnected: '수신기 연결 필요',
  connecting: '장치 연결 중',
  syncing: '수신기 확인 중',
  ready: '수신기 준비 완료',
  stale: '응답 기다리는 중',
  error: '연결 확인 필요',
};

const defaultConnectionDetail = 'micro:bit B를 USB로 연결한 뒤 시작하세요.';

const localDateKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

const formatSignalAge = (timestamp: number | null) => {
  if (!timestamp) return '아직 없음';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 2) return '방금';
  if (seconds < 60) return `${seconds}초 전`;
  return `${Math.floor(seconds / 60)}분 전`;
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>('attract');
  const [hits, setHits] = useState(0);
  const [remainingMs, setRemainingMs] = useState(35_000);
  const [sessionDuration, setSessionDuration] = useState(35);
  const [targetIndex, setTargetIndex] = useState(0);
  const [shotId, setShotId] = useState(0);
  const [shotActive, setShotActive] = useState(false);
  const [burstText, setBurstText] = useState('READY');
  const [showPrompt, setShowPrompt] = useState(false);
  const [paused, setPaused] = useState(false);

  const [connection, setConnection] = useState<SerialState>('disconnected');
  const [connectionDetail, setConnectionDetail] = useState(defaultConnectionDetail);
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);
  const [lastValidPerformanceAt, setLastValidPerformanceAt] = useState(0);
  const [lastWeb, setLastWeb] = useState<ReceiverWebMessage | null>(null);
  const [health, setHealth] = useState<ReceiverHealthMessage | null>(null);

  const [operatorOpen, setOperatorOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.72);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [handSide, setHandSide] = useState<HandSide>('right');
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [stats, setStats] = useState<DailyStats>({
    date: localDateKey(),
    sessions: 0,
    shots: 0,
  });
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });

  const phaseRef = useRef<Phase>('attract');
  const hitsRef = useRef(0);
  const targetIndexRef = useRef(0);
  const durationRef = useRef(35);
  const endAtRef = useRef(0);
  const lockUntilRef = useRef(0);
  const presentationLockRef = useRef(false);
  const lastInputAtRef = useRef(0);
  const sessionUsesSerialRef = useRef(false);
  const sessionIsRealRef = useRef(false);
  const pausedRef = useRef(false);
  const pauseStartedAtRef = useRef(0);
  const audioRef = useRef<WebShooterAudio | null>(null);
  const serialRef = useRef<WebShooterSerial | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const shotTimersRef = useRef<number[]>([]);

  const setCurrentPhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearShotTimers = useCallback(() => {
    shotTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    shotTimersRef.current = [];
  }, []);

  const advanceTarget = useCallback(() => {
    const candidates = targets.map((_, index) => index).filter((index) => index !== targetIndexRef.current);
    const next = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
    targetIndexRef.current = next;
    setTargetIndex(next);
  }, []);

  const resetExperience = useCallback(() => {
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    clearShotTimers();
    finishTimerRef.current = null;
    lockUntilRef.current = 0;
    presentationLockRef.current = false;
    hitsRef.current = 0;
    setHits(0);
    setRemainingMs(durationRef.current * 1000);
    setShotActive(false);
    setBurstText('READY');
    setShowPrompt(false);
    setPaused(false);
    pausedRef.current = false;
    sessionUsesSerialRef.current = false;
    sessionIsRealRef.current = false;
    targetIndexRef.current = 0;
    setTargetIndex(0);
    setCurrentPhase('attract');
  }, [clearShotTimers, setCurrentPhase]);

  const finishSession = useCallback(() => {
    if (phaseRef.current !== 'play') return;
    setCurrentPhase('result');
    setShotActive(false);
    setShowPrompt(false);
    setPaused(false);
    pausedRef.current = false;
    setBurstText('COMPLETE!');
    audioRef.current?.playFinish();

    if (sessionIsRealRef.current) {
      setStats((current) => ({
        date: localDateKey(),
        sessions: current.date === localDateKey() ? current.sessions + 1 : 1,
        shots: current.date === localDateKey() ? current.shots : hitsRef.current,
      }));
    }

    finishTimerRef.current = window.setTimeout(resetExperience, 5000);
  }, [resetExperience, setCurrentPhase]);

  const resumeFromPause = useCallback(() => {
    if (!pausedRef.current) return;
    const pausedFor = performance.now() - pauseStartedAtRef.current;
    endAtRef.current += pausedFor;
    lastInputAtRef.current += pausedFor;
    pausedRef.current = false;
    setPaused(false);
  }, []);

  const triggerShot = useCallback(
    (source: InputSource) => {
      const now = performance.now();

      if (source === 'serial') {
        setDemoMode(false);
        sessionUsesSerialRef.current = true;
        if (presentationLockRef.current) lockUntilRef.current = 0;
      }

      if (source === 'keyboard' && pausedRef.current) {
        sessionUsesSerialRef.current = false;
        resumeFromPause();
      } else if (pausedRef.current) {
        return;
      }

      if (phaseRef.current === 'result' || now < lockUntilRef.current) return;
      lockUntilRef.current = now + 650;

      const presentationOnly = source === 'demo' || source === 'test';
      presentationLockRef.current = presentationOnly;
      if (!presentationOnly) {
        sessionIsRealRef.current = true;
        lastInputAtRef.current = now;
        setShowPrompt(false);

        if (phaseRef.current === 'attract') {
          setCurrentPhase('play');
          hitsRef.current = 1;
          setHits(1);
          endAtRef.current = now + durationRef.current * 1000;
          setRemainingMs(durationRef.current * 1000);
        } else {
          hitsRef.current += 1;
          setHits(hitsRef.current);
        }

        setStats((current) => ({
          date: localDateKey(),
          sessions: current.date === localDateKey() ? current.sessions : 0,
          shots: current.date === localDateKey() ? current.shots + 1 : 1,
        }));
      }

      setShotId((current) => current + 1);
      setShotActive(true);
      setBurstText('THWIP!');
      audioRef.current?.playShot();

      const hitTimer = window.setTimeout(() => {
        setBurstText('HIT! +100');
        audioRef.current?.playHit(
          !presentationOnly && endAtRef.current > 0 && endAtRef.current - performance.now() < 1300,
        );
      }, 285);

      const targetTimer = window.setTimeout(() => advanceTarget(), 560);
      const settleTimer = window.setTimeout(() => {
        setShotActive(false);
        setBurstText(phaseRef.current === 'attract' ? 'READY' : 'NICE!');
      }, 620);

      shotTimersRef.current.push(hitTimer, targetTimer, settleTimer);
    },
    [advanceTarget, resumeFromPause, setCurrentPhase],
  );

  useEffect(() => {
    audioRef.current = new WebShooterAudio();
    return () => audioRef.current?.destroy();
  }, []);

  useEffect(() => {
    const handleMessage = (message: ReceiverMessage) => {
      setLastSignalAt(Date.now());
      setLastValidPerformanceAt(performance.now());
      if (message.type === 'WEB') setLastWeb(message);
      if (message.type === 'HEARTBEAT' || message.type === 'STATUS') setHealth(message);
    };

    const controller = new WebShooterSerial({
      onState: (state, detail) => {
        setConnection(state);
        setConnectionDetail(detail ?? defaultConnectionDetail);
      },
      onMessage: handleMessage,
      onWeb: (message) => {
        setLastWeb(message);
        triggerShot(message.bootId === 0 ? 'test' : 'serial');
      },
    });

    serialRef.current = controller;
    void controller.autoConnect();

    return () => {
      controller.destroy();
      serialRef.current = null;
    };
  }, [triggerShot]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    hitsRef.current = hits;
  }, [hits]);

  useEffect(() => {
    targetIndexRef.current = targetIndex;
  }, [targetIndex]);

  useEffect(() => {
    durationRef.current = sessionDuration;
    if (phaseRef.current === 'attract') setRemainingMs(sessionDuration * 1000);
  }, [sessionDuration]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    audioRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedSettings = window.localStorage.getItem('web-shooter-settings-v1');
        if (storedSettings) {
          const parsed = JSON.parse(storedSettings) as Partial<{
            duration: number;
            muted: boolean;
            volume: number;
            reducedMotion: boolean;
            handSide: HandSide;
          }>;
          if ([30, 35, 45].includes(parsed.duration ?? 0)) setSessionDuration(parsed.duration!);
          if (typeof parsed.muted === 'boolean') setMuted(parsed.muted);
          if (typeof parsed.volume === 'number') setVolume(Math.max(0, Math.min(1, parsed.volume)));
          if (typeof parsed.reducedMotion === 'boolean') setReducedMotion(parsed.reducedMotion);
          if (parsed.handSide === 'left' || parsed.handSide === 'right') setHandSide(parsed.handSide);
        }

        const storedStats = window.localStorage.getItem('web-shooter-stats-v1');
        if (storedStats) {
          const parsed = JSON.parse(storedStats) as DailyStats;
          if (parsed.date === localDateKey()) setStats(parsed);
        }
      } catch {
        // Local preferences are optional; the experience works without storage.
      }
      setSettingsLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(
        'web-shooter-settings-v1',
        JSON.stringify({ duration: sessionDuration, muted, volume, reducedMotion, handSide }),
      );
    } catch {
      // The event screen can keep running when browser storage is unavailable.
    }
  }, [handSide, muted, reducedMotion, sessionDuration, settingsLoaded, volume]);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem('web-shooter-stats-v1', JSON.stringify(stats));
    } catch {
      // Daily totals are helpful but never allowed to interrupt the experience.
    }
  }, [settingsLoaded, stats]);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      const now = performance.now();

      if (connection === 'ready' && lastValidPerformanceAt > 0 && now - lastValidPerformanceAt > 3000) {
        serialRef.current?.markStale();
      }

      if (phaseRef.current !== 'play') return;

      if (pausedRef.current) {
        if (now - pauseStartedAtRef.current > 10_000) resetExperience();
        return;
      }

      const remaining = Math.max(0, endAtRef.current - now);
      setRemainingMs(remaining);
      const inactiveFor = now - lastInputAtRef.current;
      setShowPrompt(inactiveFor > 8000);

      if (inactiveFor > 20_000) {
        resetExperience();
        return;
      }

      if (remaining <= 0) finishSession();
    }, 100);

    return () => window.clearInterval(ticker);
  }, [connection, finishSession, lastValidPerformanceAt, resetExperience]);

  useEffect(() => {
    if (phaseRef.current !== 'play' || !sessionUsesSerialRef.current) return;

    if (connection === 'ready') {
      resumeFromPause();
      return;
    }

    if (connection === 'disconnected' || connection === 'stale' || connection === 'error') {
      if (!pausedRef.current) {
        pausedRef.current = true;
        pauseStartedAtRef.current = performance.now();
        setPaused(true);
      }
    }
  }, [connection, resumeFromPause]);

  useEffect(() => {
    if (!demoMode) return;
    let timer = 0;

    const schedule = () => {
      const delay = 3000 + Math.random() * 2000;
      timer = window.setTimeout(() => {
        triggerShot('demo');
        schedule();
      }, delay);
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, [demoMode, triggerShot]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setConnectionDetail('브라우저 메뉴에서 전체화면을 켜주세요.');
    }
  }, []);

  const connectReceiver = useCallback(async () => {
    await audioRef.current?.activate();
    await serialRef.current?.requestAndConnect();
  }, []);

  const disconnectReceiver = useCallback(async () => {
    await serialRef.current?.disconnect();
  }, []);

  const startOperation = useCallback(() => {
    void audioRef.current?.activate();
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
    if (connection !== 'ready' && connection !== 'connecting' && connection !== 'syncing') {
      void serialRef.current?.requestAndConnect();
    }
    setOperatorOpen(false);
  }, [connection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button')) return;

      if (event.code === 'Space') {
        event.preventDefault();
        void audioRef.current?.activate();
        triggerShot('keyboard');
      } else if (event.key.toLowerCase() === 'r') {
        resetExperience();
      } else if (event.key.toLowerCase() === 'd') {
        setDemoMode((current) => !current);
      } else if (event.key.toLowerCase() === 'm') {
        setMuted((current) => !current);
      } else if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === 'o') {
        setOperatorOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetExperience, toggleFullscreen, triggerShot]);

  const target = targets[targetIndex];
  const effectStyle = useMemo(() => {
    const cityTop = Math.max(72, Math.min(viewport.height * 0.09, 104));
    const cityHeight = Math.max(1, viewport.height - cityTop);
    const originX = handSide === 'right' ? 79 : 21;
    const originY = 74;
    const dx = ((target.x - originX) / 100) * viewport.width;
    const dy = ((target.y - originY) / 100) * cityHeight;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    return {
      '--target-x': `${target.x}%`,
      '--target-y': `${target.y}%`,
      '--web-origin-x': `${originX}%`,
      '--web-origin-y': `${originY}%`,
      '--web-length': `${length}px`,
      '--web-angle': `${angle}deg`,
    } as CSSProperties;
  }, [handSide, target.x, target.y, viewport]);

  const connectionTone =
    connection === 'ready' ? 'ready' : connection === 'connecting' || connection === 'syncing' ? 'working' : 'warning';
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const sessionProgress = Math.max(0, Math.min(100, (remainingMs / (sessionDuration * 1000)) * 100));
  const statusHeadline =
    phase === 'result'
      ? `${hits} HIT`
      : showPrompt
        ? '손목을 꺾고 앞으로 촥!'
        : phase === 'play'
          ? '다음 목표를 향해 촥!'
          : '손목을 꺾고 앞으로 촥!';

  return (
    <main
      className={`experience ${shotActive ? 'is-shooting' : ''} hand-${handSide} ${
        reducedMotion ? 'reduce-motion' : ''
      }`}
      style={effectStyle}
    >
      <div className="halftone" aria-hidden="true" />
      <div className="speed-lines" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-kicker">PHYSICAL INTERACTION</span>
          <span className="brand-title">WEB SHOOTER</span>
        </div>

        <div className="top-actions">
          {demoMode && <span className="demo-badge">DEMO</span>}
          <button
            type="button"
            className={`connection-pill ${connectionTone}`}
            onClick={() => setOperatorOpen(true)}
            aria-label={`운영자 설정 열기. ${serialLabels[connection]}`}
          >
            <span className="connection-dot" />
            {serialLabels[connection]}
          </button>
        </div>
      </header>

      <section className="city" aria-label="야간 도시 웹슈터 체험 화면">
        <div className="moon" aria-hidden="true" />
        {buildings.map((building, index) => (
          <div
            className={`building building-${index + 1}`}
            key={building.left}
            style={{ left: building.left, width: building.width, height: building.height }}
          >
            <span className="roof-detail" />
          </div>
        ))}

        <div className={`target ${shotActive ? 'target-hit' : ''}`} role="img" aria-label="현재 웹 발사 목표">
          <span className="target-cross horizontal" />
          <span className="target-cross vertical" />
          <span className="target-ring ring-one" />
          <span className="target-ring ring-two" />
          <span className="target-core" />
          <span className="target-label">LOCKED</span>
          {shotActive && (
            <span className="web-splat" key={`splat-${shotId}`}>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
        </div>

        <div className={`comic-burst ${shotActive ? 'active' : ''}`} aria-live="polite">
          <span>{burstText}</span>
        </div>

        {shotActive && (
          <div className="shot-fx" key={`shot-${shotId}`} aria-hidden="true">
            <span className="web-strand strand-one" />
            <span className="web-strand strand-two" />
            <span className="web-strand strand-three" />
            <b>THWIP!</b>
          </div>
        )}

        <div className="first-person-arm" aria-hidden="true">
          <div className="forearm">
            <span className="arm-ink ink-one" />
            <span className="arm-ink ink-two" />
            <span className="gauntlet gauntlet-a" />
            <span className="gauntlet gauntlet-b" />
            <span className="web-shooter-unit">
              <i />
            </span>
          </div>
          <div className="hand">
            <span className="finger finger-one" />
            <span className="finger finger-two" />
            <span className="finger finger-three" />
          </div>
        </div>
      </section>

      {phase === 'play' && (
        <section className="play-hud" aria-label="현재 체험 점수">
          <div>
            <span className="hud-label">WEB HITS</span>
            <strong>{hits}</strong>
          </div>
          <div className={`timer-chip ${secondsLeft <= 5 ? 'urgent' : ''}`}>
            <span>{secondsLeft <= 5 ? `${secondsLeft}` : 'LIVE'}</span>
            <i style={{ width: `${sessionProgress}%` }} />
          </div>
        </section>
      )}

      {phase !== 'result' && (
        <section className={`instruction-card ${showPrompt ? 'attention' : ''}`} aria-live="polite">
          <span className="instruction-number">{phase === 'play' ? String(hits + 1).padStart(2, '0') : '01'}</span>
          <div>
            <p className="instruction-eyebrow">YOUR BODY IS THE CONTROLLER</p>
            <h1>{statusHeadline}</h1>
            <p>스파이더 포즈를 만든 뒤 팔을 빠르게 뻗어보세요.</p>
          </div>
          <div className="gesture-guide" aria-hidden="true">
            <span className="gesture-hand">🤟</span>
            <span className="gesture-arrow">➜</span>
            <span className="gesture-impact">촥!</span>
          </div>
        </section>
      )}

      {phase === 'result' && (
        <section className="result-card" aria-live="assertive">
          <span className="result-kicker">MISSION COMPLETE</span>
          <strong>{hits} HIT</strong>
          <p>멋진 발사! 다음 웹슈터를 위해 준비 중...</p>
          <span className="result-score">+{hits * 100}</span>
        </section>
      )}

      {paused && (
        <section className="pause-card" role="alert">
          <span>PAUSED</span>
          <strong>수신기를 다시 연결해 주세요</strong>
          <p>10초 안에 연결되면 이어서 체험합니다. Space 키로 대체 진행도 가능해요.</p>
        </section>
      )}

      <button
        type="button"
        className="operator-launch"
        onClick={() => setOperatorOpen(true)}
        aria-label="운영자 설정 열기"
      >
        <span>OPERATE</span>
        <b>운영 설정</b>
      </button>

      {operatorOpen && (
        <div className="operator-backdrop" role="presentation" onMouseDown={() => setOperatorOpen(false)}>
          <aside
            className="operator-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operator-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>EVENT CONTROL</span>
                <h2 id="operator-title">운영자 설정</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setOperatorOpen(false)} aria-label="닫기">
                ×
              </button>
            </header>

            <div className="operator-scroll">
              <section className="control-section device-section">
                <div className="section-heading">
                  <div>
                    <span>01 / DEVICE</span>
                    <h3>수신기 연결</h3>
                  </div>
                  <span className={`panel-status ${connectionTone}`}>{serialLabels[connection]}</span>
                </div>
                <p className="detail-copy">{connectionDetail}</p>
                {connection === 'unsupported' && (
                  <p className="warning-copy">최신 데스크톱 Chrome에서 직접 열어주세요.</p>
                )}
                <dl className="signal-grid">
                  <div>
                    <dt>최근 신호</dt>
                    <dd>{formatSignalAge(lastSignalAt)}</dd>
                  </div>
                  <div>
                    <dt>무선 세기</dt>
                    <dd>{lastWeb ? `${lastWeb.rssi} dBm` : '—'}</dd>
                  </div>
                  <div>
                    <dt>수신 웹</dt>
                    <dd>{health?.webLines ?? 0}</dd>
                  </div>
                  <div>
                    <dt>중복 제거</dt>
                    <dd>{health?.duplicates ?? 0}</dd>
                  </div>
                </dl>
                <div className="button-row">
                  {connection === 'ready' || connection === 'syncing' ? (
                    <button type="button" className="secondary-button" onClick={() => void disconnectReceiver()}>
                      연결 해제
                    </button>
                  ) : (
                    <button type="button" className="primary-button" onClick={() => void connectReceiver()}>
                      micro:bit B 연결
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void audioRef.current?.activate();
                      triggerShot('test');
                    }}
                  >
                    시험 발사
                  </button>
                </div>
              </section>

              <section className="control-section">
                <div className="section-heading">
                  <div>
                    <span>02 / EXPERIENCE</span>
                    <h3>체험 설정</h3>
                  </div>
                </div>

                <label className="control-label">
                  체험 시간
                  <span className="segmented-control">
                    {[30, 35, 45].map((duration) => (
                      <button
                        type="button"
                        className={sessionDuration === duration ? 'selected' : ''}
                        key={duration}
                        onClick={() => setSessionDuration(duration)}
                      >
                        {duration}초
                      </button>
                    ))}
                  </span>
                </label>

                <label className="control-label">
                  화면 속 팔
                  <span className="segmented-control">
                    <button
                      type="button"
                      className={handSide === 'left' ? 'selected' : ''}
                      onClick={() => setHandSide('left')}
                    >
                      왼손
                    </button>
                    <button
                      type="button"
                      className={handSide === 'right' ? 'selected' : ''}
                      onClick={() => setHandSide('right')}
                    >
                      오른손
                    </button>
                  </span>
                </label>

                <label className="switch-row">
                  <span>
                    <b>자동 데모</b>
                    <small>3~5초 간격으로 발사를 시연합니다</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={demoMode}
                    onChange={(event) => setDemoMode(event.target.checked)}
                  />
                </label>

                <label className="switch-row">
                  <span>
                    <b>움직임 줄이기</b>
                    <small>흔들림과 강한 스피드라인을 끕니다</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={(event) => setReducedMotion(event.target.checked)}
                  />
                </label>

                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={resetExperience}>
                    체험 초기화
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void toggleFullscreen()}>
                    {fullscreen ? '전체화면 종료' : '전체화면'}
                  </button>
                </div>
              </section>

              <section className="control-section">
                <div className="section-heading">
                  <div>
                    <span>03 / SOUND</span>
                    <h3>효과음</h3>
                  </div>
                  <button type="button" className="text-button" onClick={() => setMuted((current) => !current)}>
                    {muted ? '음소거 해제' : '음소거'}
                  </button>
                </div>
                <label className="volume-control">
                  <span>볼륨</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(event) => setVolume(Number(event.target.value))}
                    aria-label="효과음 볼륨"
                  />
                  <b>{Math.round(volume * 100)}%</b>
                </label>
              </section>

              <section className="control-section stats-section">
                <div className="section-heading">
                  <div>
                    <span>04 / TODAY</span>
                    <h3>오늘의 운영 기록</h3>
                  </div>
                </div>
                <div className="big-stats">
                  <div>
                    <strong>{stats.sessions}</strong>
                    <span>완료 세션</span>
                  </div>
                  <div>
                    <strong>{stats.shots}</strong>
                    <span>실제 발사</span>
                  </div>
                </div>
              </section>

              <details className="shortcut-help">
                <summary>키보드 단축키</summary>
                <p>Space 발사 · R 초기화 · D 데모 · M 음소거 · F 전체화면 · O 설정</p>
              </details>
            </div>

            <footer>
              <button type="button" className="start-button" onClick={startOperation}>
                운영 시작
                <span>연결 + 사운드 + 전체화면</span>
              </button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );
}
