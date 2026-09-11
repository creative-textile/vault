import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';

export default function SafeCrack() {
  const { showToast, refreshUser } = useAuth();
  const nav = useNavigate();
  const [safe, setSafe] = useState<any>(null);
  const [codeRevealed, setCodeRevealed] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [taps, setTaps] = useState<number[]>([]); // время тапа для каждого барабана
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<'countdown' | 'spinning' | 'done'>('countdown');
  const [countdown, setCountdown] = useState(3);
  const timerRef = useRef<number | null>(null);
  const [currentDigits, setCurrentDigits] = useState<number[]>([0,0,0]);
  const spinRef = useRef<number | null>(null);

  // Анимация цифр на барабанах во время вращения
  useEffect(() => {
    if (phase !== 'spinning') {
      if (spinRef.current) { cancelAnimationFrame(spinRef.current); spinRef.current = null; }
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setCurrentDigits(prev => prev.map((d, i) => {
        if (taps[i] !== undefined) return d;
        // Медленно — одна цифра ≈ за 0.8 сек (достаточно, чтобы тапнуть)
        const speed = 0.7 + i * 0.15; // чуть разная скорость на барабанах
        const next = d + (dt * speed * 0.0013);
        return next % 10;
      }));
      spinRef.current = requestAnimationFrame(tick);
    };
    spinRef.current = requestAnimationFrame(tick);
    return () => { if (spinRef.current) cancelAnimationFrame(spinRef.current); };
  }, [phase, taps, safe]);

  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current) return;
    safeApi.current().then(r => {
      setSafe(r.safe);
      if (r.safe?.status !== 'cracking') {
        nav('/safe');
      }
    });
  }, [nav]);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(t);
    } else if (!codeRevealed && safe) {
      setCodeRevealed(true);
      setTimeout(() => {
        setPhase('spinning');
        setStartedAt(Date.now());
      }, 4000); // 4 сек, чтобы запомнить код
    }
  }, [countdown, codeRevealed, safe]);

  const tapDrum = (i: number) => {
    if (phase !== 'spinning' || taps[i] !== undefined) return;
    const now = Date.now() - startedAt;
    const newTaps = [...taps];
    newTaps[i] = now;
    setTaps(newTaps);

    if (newTaps.filter(t => t !== undefined).length === 3) {
      const maxTap = Math.max(...newTaps);
      // Проверка попадания: та же формула скорости, что и в анимации
      const misses = newTaps.filter((_, idx) => {
        const speed = 0.7 + idx * 0.15;
        const digitAtTap = Math.floor((newTaps[idx] * speed * 0.0013) % 10);
        return digitAtTap !== safe.code[idx];
      }).length;
      const totalTime = maxTap + misses * 500;

      submittedRef.current = true;
      setSubmitted(true);
      setPhase('done');
      safeApi.crack(totalTime).then(() => {
        showToast(`✅ Взлом за ${(totalTime/1000).toFixed(2)}с (промахи: ${misses})`);
      }).catch((e: any) => showToast(e.message));
    }
  };

  if (!safe) return null;

  return (
    <>
      <Header title="🔒 ВЗЛОМ СЕЙФА" />

      <SafeCrackScene phase={phase === 'spinning' ? 'spinning' : phase === 'done' ? 'result' : 'idle'} code={safe.code} drumSpeeds={safe.drum_speeds} />

      {countdown > 0 && (
        <div className="text-center mt">
          <div style={{fontSize:96, fontWeight:900, color:'#ff4444'}}>{countdown}</div>
          <div className="text-dim">Приготовьтесь...</div>
        </div>
      )}

      {codeRevealed && phase === 'countdown' && countdown === 0 && (
        <div className="card card-hl text-center mt">
          <div className="card-title" style={{fontSize:24}}>КОД:</div>
          <div style={{display:'flex', gap:24, justifyContent:'center', fontSize:56, fontWeight:900, color:'#ffd700', margin:'16px 0'}}>
            <span>{safe.code[0]}</span>
            <span>{safe.code[1]}</span>
            <span>{safe.code[2]}</span>
          </div>
          <div className="text-dim">Запоминайте! Барабаны сейчас начнут вращаться...</div>
        </div>
      )}

      {phase === 'spinning' && (
        <>
          <div className="text-center mt" style={{fontSize:18}}>Тапните по нужной цифре!</div>
          <div className="drums">
            {[0,1,2].map(i => {
              const isTapped = taps[i] !== undefined;
              const speed = 0.7 + i * 0.15;
              const tappedDigit = isTapped ? Math.floor(((taps[i] || 0) * speed * 0.0013) % 10) : 0;
              return (
                <div
                  key={i}
                  className="drum"
                  onClick={() => tapDrum(i)}
                  style={{
                    opacity: isTapped ? 0.5 : 1,
                    background: isTapped ? '#111' : '#1a1a3a',
                    position:'relative',
                    color: isTapped ? (tappedDigit === safe.code[i] ? '#22c55e' : '#ef4444') : '#ffd700',
                    fontSize:40
                  }}
                >
                  {isTapped ? tappedDigit : Math.floor(currentDigits[i])}
                </div>
              );
            })}
          </div>
          <div className="text-dim text-center" style={{fontSize:14}}>
            Кликните по барабану в момент, когда видна нужная цифра.<br/>
            Промах = +0.5 сек штраф.
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <div className="card mt text-center">
            <div className="result-text win">✅ ВЗЛОМ!</div>
            <div className="text-dim">Обработка результатов... (30 сек)</div>
            <button className="btn mt" onClick={() => nav('/safe')}>К РЕЗУЛЬТАТАМ</button>
          </div>
          <button className="btn btn-secondary" onClick={() => nav('/')}>🏠 НА ГЛАВНУЮ</button>
        </>
      )}
    </>
  );
}
