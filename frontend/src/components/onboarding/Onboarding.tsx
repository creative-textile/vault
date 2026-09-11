import { useState } from 'react';
import { useAuth } from '../../stores/auth';
import VaultScene from '../../three/main/VaultScene';

const screens = [
  {
    title: 'Добро пожаловать в VAULT',
    text: 'Игровая платформа с реальными выплатами в USDT'
  },
  {
    title: 'Четыре способа заработать',
    text: '🚀 Ракета — забери до взрыва\n⚔️ Дуэль — орёл или решка\n🔒 Сейф — взломай первым\n💎 Вклад — пассивный доход'
  },
  {
    title: 'Пополни и начни',
    text: 'Минимум: $2 (USDT в сети TON)\nПополни баланс и запускай первую игру!'
  }
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const { setOnboardingDone } = useAuth();

  return (
    <div className="onboarding">
      {step === 0 && <VaultScene size={280} />}
      <div className="onboarding-title">{screens[step].title}</div>
      <div className="onboarding-text" style={{whiteSpace: 'pre-line'}}>
        {screens[step].text}
      </div>

      {step < screens.length - 1 ? (
        <button className="btn" onClick={() => setStep(step + 1)}>ДАЛЕЕ →</button>
      ) : (
        <button className="btn btn-green btn-big" onClick={setOnboardingDone}>🚀 НАЧАТЬ</button>
      )}

      <div style={{display:'flex', gap:8, marginTop: 24}}>
        {screens.map((_, i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%',
            background: i === step ? '#ffd700' : '#333355'
          }} />
        ))}
      </div>
    </div>
  );
}
