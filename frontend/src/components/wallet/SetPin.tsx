import { useState } from 'react';
import Header from '../layout/Header';
import { useAuth } from '../../stores/auth';
import { walletApi } from '../../api/client';
import { useNavigate } from 'react-router-dom';

export default function SetPin() {
  const { showToast } = useAuth();
  const nav = useNavigate();
  const [pin, setPin] = useState(['','','','']);

  const setDigit = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...pin];
    next[i] = v;
    setPin(next);
    if (v && i < 3) document.getElementById(`sp-${i+1}`)?.focus();
    if (i === 3 && v) {
      save(next.join(''));
    }
  };

  const save = async (p: string) => {
    try {
      await walletApi.setPin(p);
      showToast('✅ PIN установлен');
      nav(-1);
    } catch (e: any) {
      showToast(e.message);
    }
  };

  return (
    <>
      <Header title="Установить PIN" />
      <div className="card text-center">
        <div style={{fontSize:18, marginBottom:16}}>Придумайте PIN из 4 цифр для вывода средств</div>
        <div className="pin-input">
          {pin.map((d, i) => (
            <input
              key={i}
              id={`sp-${i}`}
              className="pin-digit"
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => setDigit(i, e.target.value)}
            />
          ))}
        </div>
        <div className="text-dim" style={{marginTop:16}}>PIN хранится как bcrypt-хеш и не передаётся в открытом виде</div>
      </div>
    </>
  );
}
