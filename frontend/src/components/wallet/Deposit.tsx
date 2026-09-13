import { useCallback, useEffect, useState } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import Header from '../layout/Header';
import { useAuth } from '../../stores/auth';
import { walletApi, publicConfig } from '../../api/client';

export default function Deposit() {
  const { user, refreshUser, showToast } = useAuth();
  const [address, setAddress] = useState<string>('');
  const [addressError,setAddressError]=useState('');
  const [addressLoading,setAddressLoading]=useState(true);
  const [demoAmount, setDemoAmount] = useState('100');
  /**
   * Карточка демо-пополнения рисуется ТОЛЬКО в демо-режиме.
   *
   * Раньше она показывалась всегда, а сервер в реальном режиме отвечал 403:
   * игрок видел рабочую на вид кнопку «+ ПОПОЛНИТЬ», которая никогда не
   * срабатывает. Флаг demo_mode приходит из /api/config (там же сервер
   * отключает сам эндпоинт).
   */
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => { publicConfig().then((c: any) => setDemoMode(c?.demo_mode === true)).catch(() => {}); }, []);

  const loadAddress=useCallback(async()=>{
    setAddressLoading(true); setAddressError('');
    for(let attempt=0;attempt<3;attempt++) {
      try { const r=await walletApi.depositAddress(); if(!r?.address)throw new Error('Пустой адрес'); setAddress(r.address);setAddressLoading(false);return; }
      catch(e:any) { if(attempt<2) await new Promise(r=>setTimeout(r,700*(attempt+1))); else setAddressError(e.message||'Не удалось получить адрес'); }
    }
    setAddressLoading(false);
  },[]);
  useEffect(()=>{let active=true; loadAddress(); const onVisible=()=>{if(active&&document.visibilityState==='visible')loadAddress()}; document.addEventListener('visibilitychange',onVisible); return()=>{active=false;document.removeEventListener('visibilitychange',onVisible)}},[loadAddress]);

  const doDemoDeposit = async () => {
    const amt = parseFloat(demoAmount); if (!amt) return;
    try { await walletApi.demoDeposit(amt); await refreshUser(); showToast(`✅ +$${amt.toFixed(2)} зачислено (демо)`); }
    catch(e:any){showToast(e.message||'Пополнение не выполнено')}
  };
  const copy = () => { if(!address)return; navigator.clipboard?.writeText(address); showToast('Адрес скопирован'); };

  return <>
    <Header title="Пополнить" />
    <div style={{padding:'4px 0',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:14}}><span className="text-dim">Текущий баланс:</span><span className="text-accent" style={{fontWeight:700,fontSize:18}}>${(user?.balance||0).toFixed(2)}</span></div>
    <MoneyBreakdown />
    <div className="card"><div className="card-title text-center">Отправьте USDT (сеть TON):</div>
      <div style={{background:'var(--bg-3)',padding:14,borderRadius:12,fontFamily:'monospace',fontSize:15,wordBreak:'break-all',margin:'12px 0',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
        <span>{address || (addressLoading?'Генерация…':'Адрес пока не получен')}</span><button disabled={!address} onClick={copy} className="btn btn-small" style={{whiteSpace:'nowrap'}}>📋 Копир.</button>
      </div>
      {addressError&&<div className="text-center text-red"><div>{addressError}</div><button className="btn btn-small mt" onClick={loadAddress}>↻ Повторить</button></div>}
      <div className="text-center text-dim">Мин: $2 · Комиссия: 0%<br/>Зачисление: 1–3 минуты</div><div className="text-center text-red mt" style={{fontSize:14}}>⚠️ Только USDT в сети TON</div>
    </div>
    {demoMode && (
      <div className="card card-hl"><div className="card-title">🎮 Демо-пополнение</div><div className="text-dim" style={{marginBottom:12}}>В демо-режиме пополнение мгновенное (без реального USDT)</div><div style={{display:'flex',gap:8}}><input className="input" type="number" value={demoAmount} onChange={e=>setDemoAmount(e.target.value)} placeholder="Сумма" min={2}/><button className="btn btn-green" onClick={doDemoDeposit} style={{whiteSpace:'nowrap',width:'auto'}}>+ ПОПОЛНИТЬ</button></div></div>
    )}
  </>;
}
