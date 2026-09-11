import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { duelApi } from '../../api/client';

export default function PendingDuelModal() {
  const [pending, setPending] = useState<any>(null);
  const nav = useNavigate();

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const r = await duelApi.pending();
        if (!active) return;
        if (r?.pending) {
          const seenKey = `duel_seen_${r.pending.id}`;
          const dismissedKey = `duel_dismissed_${r.pending.id}`;
          if (!localStorage.getItem(seenKey) && !localStorage.getItem(dismissedKey)) {
            setPending(r.pending);
          }
        }
      } catch {}
    };
    check();
    const iv = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, []);

  const dismiss = () => {
    if (pending) {
      localStorage.setItem(`duel_dismissed_${pending.id}`, '1');
      localStorage.setItem(`duel_seen_${pending.id}`, '1');
    }
    setPending(null);
  };

  const watch = () => {
    if (!pending) return;
    localStorage.setItem(`duel_seen_${pending.id}`, '1');
    setPending(null);
    nav(`/duel/${pending.id}`, { state: { result: pending } });
  };

  if (!pending) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20
    }}>
      <div style={{
        background: '#12122a', borderRadius: 16, padding: 24, maxWidth: 380, width: '100%',
        border: '2px solid #ffd700', textAlign: 'center'
      }}>
        <div style={{fontSize: 48, marginBottom: 8}}>⚔️</div>
        <div style={{fontSize: 20, fontWeight: 900, marginBottom: 12}}>
          Ваша дуэль на ${Number(pending.amount || 0).toFixed(0)} состоялась!
        </div>
        <div className="text-dim" style={{fontSize:14, marginBottom:20}}>
          Посмотрите результат дуэли 🎲
        </div>
        <div style={{display:'flex', gap:10}}>
          <button className="btn btn-secondary" onClick={dismiss} style={{flex:1}}>ПОЗЖЕ</button>
          <button className="btn" onClick={watch} style={{flex:2}}>▶️ К РЕЗУЛЬТАТУ</button>
        </div>
      </div>
    </div>
  );
}
