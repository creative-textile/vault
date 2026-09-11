import { useEffect, useState } from 'react';
import Header from '../layout/Header';
import { useAuth } from '../../stores/auth';
import { walletApi } from '../../api/client';

export default function Deposit() {
  const { user, refreshUser, showToast } = useAuth();
  const [address, setAddress] = useState<string>('');
  const [demoAmount, setDemoAmount] = useState('100');

  useEffect(() => {
    walletApi.depositAddress().then(r => setAddress(r.address)).catch(() => {});
  }, []);

  const doDemoDeposit = async () => {
    const amt = parseFloat(demoAmount);
    if (!amt) return;
    await walletApi.demoDeposit(amt);
    await refreshUser();
    showToast(`✅ +$${amt.toFixed(2)} зачислено (демо)`);
  };

  const copy = () => {
    navigator.clipboard?.writeText(address);
    showToast('Адрес скопирован');
  };

  return (
    <>
      <Header title="Пополнить" />
      <div style={{padding:'4px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        <span className="text-dim">Текущий баланс:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${(user?.balance || 0).toFixed(2)}</span>
      </div>
      <div className="card">
        <div className="card-title text-center">Отправьте USDT (сеть TON):</div>
        <div style={{
          background: '#1a1a3a',
          padding: '14px',
          borderRadius: 12,
          fontFamily: 'monospace',
          fontSize: 15,
          wordBreak: 'break-all',
          margin: '12px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12
        }}>
          <span>{address || 'Генерация...'}</span>
          <button onClick={copy} className="btn btn-small" style={{whiteSpace:'nowrap'}}>📋 Копир.</button>
        </div>

        <div className="text-center text-dim">
          Мин: $2 · Комиссия: 0%<br/>
          Зачисление: 1–3 минуты
        </div>
        <div className="text-center text-red mt" style={{fontSize:14}}>
          ⚠️ Только USDT в сети TON
        </div>
      </div>

      {/* Демо-режим */}
      <div className="card card-hl">
        <div className="card-title">🎮 Демо-пополнение</div>
        <div className="text-dim" style={{marginBottom:12}}>В демо-режиме пополнение мгновенное (без реального USDT)</div>
        <div style={{display:'flex', gap:8}}>
          <input
            className="input"
            type="number"
            value={demoAmount}
            onChange={e => setDemoAmount(e.target.value)}
            placeholder="Сумма"
            min={2}
          />
          <button className="btn btn-green" onClick={doDemoDeposit} style={{whiteSpace:'nowrap', width:'auto'}}>
            + ПОПОЛНИТЬ
          </button>
        </div>
      </div>
    </>
  );
}
