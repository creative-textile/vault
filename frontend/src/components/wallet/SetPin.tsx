import { useState } from 'react';
import Header from '../layout/Header';
import Icon from '../ui/Icon';
import { useAuth } from '../../stores/auth';
import { walletApi } from '../../api/client';
import { useNavigate } from 'react-router-dom';
import { sfx } from '../../audio';

export default function SetPin() {
  const { showToast } = useAuth();
  const nav = useNavigate();
  const [pin, setPin] = useState(['','','','']);
  const [busy, setBusy] = useState(false);

  const save = async (p: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await walletApi.setPin(p);
      sfx.confirm();
      showToast('PIN установлен');
      nav(-1);
    } catch (e: any) {
      sfx.error();
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...pin];
    next[i] = v;
    setPin(next);
    if (v) sfx.tapSoft();
    if (v && i < 3) document.getElementById(`sp-${i+1}`)?.focus();
    if (i === 3 && v) {
      save(next.join(''));
    }
  };

  const filled = pin.every(d => /^\d$/.test(d));

  return (
    <>
      <Header title="PIN-код вывода" icon="key" />
      <div className="card text-center">
        <div className="pin-head">
          <span className="pin-head__icon"><Icon name="shield" size={22} strokeWidth={1.8} /></span>
          <div className="pin-head__title">Придумайте PIN из 4 цифр</div>
          <div className="pin-head__text">
            Он понадобится для каждого вывода средств. Не используйте дату рождения
            и одинаковые цифры — такой код подбирается первым.
          </div>
        </div>

        <div className="pin-input">
          {pin.map((d, i) => (
            <input
              key={i}
              id={`sp-${i}`}
              className={`pin-digit${d ? ' pin-digit--filled' : ''}`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`Цифра ${i + 1}`}
              maxLength={1}
              value={d}
              onChange={e => setDigit(i, e.target.value)}
              onFocus={e => e.target.select()}
            />
          ))}
        </div>

        {/* Явная кнопка: раньше PIN сохранялся только сам, по вводу четвёртой
            цифры, и на экране не было действия, которое можно нажать.
            Класс `btn` даёт тёмный текст по золотому градиенту — контраст
            достаточный даже на солнце. */}
        <button
          className="btn btn-big mt"
          type="button"
          disabled={!filled || busy}
          onClick={() => save(pin.join(''))}
        >
          <Icon name="check" size={18} strokeWidth={2.4} />
          {busy ? 'Сохраняем…' : 'Установить PIN'}
        </button>

        <div className="pin-note">
          <Icon name="lock" size={13} strokeWidth={2} />
          PIN хранится как bcrypt-хеш и никогда не передаётся в открытом виде
        </div>
      </div>
    </>
  );
}
