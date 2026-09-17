/**
 * 🏦 ОНБОРДИНГ — приветствие нового игрока (v2, редизайн раунда R).
 *
 * Прежняя версия была «заголовок + абзац текста»: функционально, но плоско —
 * первое впечатление от премиального продукта так не делается. Теперь:
 *
 *  Шаг 1 — герой-витрина: живая 3D-сцена хранилища + золотой вордмарк.
 *  Шаг 2 — четыре игры карточками с иконками (не стена текста).
 *  Шаг 3 — пополнение и старт с выделенными цифрами.
 *
 * Прогресс — полоски-точки (.onboarding-dot), есть «Пропустить»: удерживать
 * игрока текстом нельзя, он должен сам захотеть листать.
 */
import { useState } from 'react';
import { useAuth } from '../../stores/auth';
import VaultScene from '../../three/main/VaultScene';
import Icon from '../ui/Icon';

const games = [
  { icon: 'rocket' as const, name: 'Ракета', text: 'Забери выигрыш до взрыва', tone: 'onb-card--red' },
  { icon: 'swords' as const, name: 'Дуэль', text: 'Орёл или решка один на один', tone: 'onb-card--violet' },
  { icon: 'lock' as const, name: 'Сейф', text: 'Взломай код первым', tone: 'onb-card--gold' },
  { icon: 'percent' as const, name: 'Вклад', text: 'Пассивный доход каждый день', tone: 'onb-card--green' }
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const { setOnboardingDone } = useAuth();

  return (
    <div className="onboarding">
      {step === 0 && (
        <>
          <VaultScene size={280} />
          <div className="onboarding-wordmark">VAULT</div>
          <div className="onboarding-tagline">
            Игровая платформа с реальными выплатами в&nbsp;USDT
          </div>
          <div className="onboarding-badges">
            <span className="onb-badge"><Icon name="shield" size={13} /> Честная механика</span>
            <span className="onb-badge"><Icon name="zap" size={13} /> Мгновенные выплаты</span>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="onboarding-title">Четыре способа заработать</div>
          <div className="onb-grid">
            {games.map((g) => (
              <div key={g.name} className={`onb-card ${g.tone}`}>
                <div className="onb-card__icon"><Icon name={g.icon} size={22} strokeWidth={2} /></div>
                <div className="onb-card__name">{g.name}</div>
                <div className="onb-card__text">{g.text}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="onboarding-title">Пополни и начни</div>
          <div className="onb-deposit">
            <div className="onb-deposit__row">
              <span className="onb-deposit__icon"><Icon name="wallet" size={18} /></span>
              <span>Минимальный депозит — <b className="text-accent">$2</b></span>
            </div>
            <div className="onb-deposit__row">
              <span className="onb-deposit__icon"><Icon name="send" size={18} /></span>
              <span>USDT в сети <b className="text-accent">TON</b> — без комиссии платформы</span>
            </div>
            <div className="onb-deposit__row">
              <span className="onb-deposit__icon"><Icon name="gift" size={18} /></span>
              <span>Первая ставка — самая удачная. Проверь!</span>
            </div>
          </div>
        </>
      )}

      <div className="onb-actions">
        {step < 2 ? (
          <button className="btn btn-big" onClick={() => setStep(step + 1)}>
            {step === 0 ? 'ПОСМОТРЕТЬ ИГРЫ' : 'ДАЛЕЕ'} <Icon name="chevronRight" size={16} strokeWidth={2.4} />
          </button>
        ) : (
          <button className="btn btn-green btn-big" onClick={setOnboardingDone}>
            <Icon name="rocket" size={18} strokeWidth={2} /> Начать игру
          </button>
        )}
        {step < 2 && (
          <button className="onb-skip" onClick={setOnboardingDone}>Пропустить</button>
        )}
      </div>

      <div className="onboarding-dots">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`onboarding-dot${i === step ? ' onboarding-dot--on' : ''}`}
            onClick={() => setStep(i)}
          />
        ))}
      </div>
    </div>
  );
}
