import { useState, useEffect } from 'react';
import { safeApi, profileApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { muteSafePrompt } from '../../utils/safePrompt';

interface Props {
  profit: number;
  onClose: () => void;
  onDeposited: () => void;
}

const CHIPS = [25, 50, 100];

export default function SafeDepositPrompt({ profit, onClose, onDeposited }: Props) {
  const { showToast, refreshUser } = useAuth();
  const [percent, setPercent] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [safeTime, setSafeTime] = useState('21:00');
  const [autoSave, setAutoSave] = useState(false);
  const [mutePrompts, setMutePrompts] = useState(false);

  useEffect(() => {
    safeApi.current().then((s: any) => {
      // Время взлома берём у сейфа, в который реально идёт вклад:
      // во время взлома/после розыгрыша это уже сейф следующего дня
      const target = s?.collecting_safe || s?.safe;
      if (target?.crack_at) {
        try {
          const d = new Date(target.crack_at);
          if (!isNaN(d.getTime())) {
            setSafeTime(d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}));
          }
        } catch {}
      }
    }).catch(()=>{});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const amount = Math.round(profit * (percent / 100) * 100) / 100;
  const canDeposit = amount >= 1;

  const deposit = async () => {
    if (!canDeposit || submitting) return;
    setSubmitting(true);
    try {
      await safeApi.deposit(amount);
      showToast(`🔒 $${amount.toFixed(2)} внесено в Сейф`);
      if (autoSave) {
        await profileApi.update({ auto_safe_percent: percent });
        showToast(`✅ Автовклад ${percent}% включён`);
      }
      await refreshUser();
      onDeposited();
    } catch (e: any) {
      showToast(e.message);
    }
    setSubmitting(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, animation: 'sdfFade 0.2s'
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(135deg, #1a0a3e, #2a1a5a)',
        border: '2px solid #ffd700', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 420, animation: 'sdfPop 0.25s'
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{fontSize:48, textAlign:'center', marginBottom:8}}>🔒💎</div>
        <div style={{fontSize:22, fontWeight:900, textAlign:'center', color:'#ffd700', marginBottom:8}}>
          В СЕЙФ?
        </div>
        <div style={{fontSize:13, textAlign:'center', color:'#8888aa', marginBottom:16}}>
          Взлом в <b style={{color:'#fff'}}>{safeTime}</b> МСК. Вложите часть выигрыша —
          получите <span style={{color:'#22c55e', fontWeight:700}}>×1.5</span>, если соберёте код раньше других!
        </div>

        <div style={{textAlign:'center', fontSize:32, fontWeight:900, color:'#ffd700', marginBottom:4}}>
          ${amount.toFixed(2)}
        </div>
        <div style={{textAlign:'center', color:'#8888aa', fontSize:12, marginBottom:14}}>
          Возможный приз: ${(amount * 1.5).toFixed(2)}
        </div>

        <div style={{display:'flex', gap:8, justifyContent:'center', marginBottom:16}}>
          {CHIPS.map(p => (
            <button
              key={p}
              onClick={() => setPercent(p)}
              style={{
                flex:1, padding:'10px 0', borderRadius:12, border:'1px solid rgba(255,255,255,0.1)',
                background: p === percent ? '#ffd700' : '#1a1a3a',
                color: p === percent ? '#000' : '#fff',
                fontWeight:700, fontSize:15, cursor:'pointer'
              }}
            >
              {p}%
            </button>
          ))}
        </div>

        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color:'#fff', marginBottom:14, cursor:'pointer'}}>
          <input
            type="checkbox"
            checked={autoSave}
            onChange={e => setAutoSave(e.target.checked)}
            style={{width:18, height:18, accentColor:'#ffd700'}}
          />
          Вкладывать автоматически ({percent}% от каждого выигрыша)
        </label>

        <button
          className="btn"
          onClick={deposit}
          disabled={!canDeposit || submitting}
          style={{background:'#ffd700', color:'#000'}}
        >
          {submitting ? 'ВНОШУ...' : canDeposit ? `🔒 ВНЕСТИ $${amount.toFixed(2)}` : 'Минимум $1'}
        </button>
        <label style={{display:'flex', alignItems:'center', gap:8, marginTop:12, fontSize:12, color:'#aaa', cursor:'pointer'}}>
          <input type="checkbox" checked={mutePrompts} onChange={e => setMutePrompts(e.target.checked)} />
          Больше не предлагать сегодня
        </label>
        <button className="btn btn-secondary mt" onClick={() => { if (mutePrompts) muteSafePrompt(); onClose(); }}>ПРОПУСТИТЬ</button>
      </div>
      <style>{`
        @keyframes sdfFade { from {opacity:0} to {opacity:1} }
        @keyframes sdfPop { from {transform:scale(0.85);opacity:0} to {transform:scale(1);opacity:1} }
      `}</style>
    </div>
  );
}
