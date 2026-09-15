import { useNavigate } from 'react-router-dom';
import { useAudioSettings } from '../../audio/useAudioSettings';
import { sfx } from '../../audio';
import Icon, { type IconName } from '../ui/Icon';

interface Props {
  title: React.ReactNode;
  back?: boolean;
  right?: React.ReactNode;
  /** Куда ведёт «←». По умолчанию — на одну запись назад по истории. */
  onBack?: () => void;
  /**
   * Иконка раздела. Раньше в `title` вставляли эмодзи («🚀 Ракета»): на Android
   * и в Telegram WebView они рисуются системным шрифтом, съезжают по базовой
   * линии и выглядят детскими наклейками рядом с тёмным «неоновым» интерфейсом.
   */
  icon?: IconName;
}

export default function Header({ title, back = true, right, onBack, icon }: Props) {
  const nav = useNavigate();
  const { settings, toggleMuted, toggleHaptics } = useAudioSettings();

  // В Telegram WebView страница нередко открывается сразу глубоким URL —
  // истории «назад» просто нет, и nav(-1) не делает ничего (кнопка «мертвая»).
  // react-router хранит индекс текущей записи в history.state.idx.
  const goBack = () => {
    sfx.tapSoft();
    if (onBack) return onBack();
    const idx = (window.history.state as any)?.idx;
    if (typeof idx === 'number' && idx > 0) nav(-1);
    else nav('/', { replace: true });
  };

  return (
    <div className="header">
      {back && (
        <button className="back-btn" onClick={goBack} aria-label="Назад">
          <Icon name="chevronLeft" size={20} strokeWidth={2.2} />
        </button>
      )}
      <div className="header-title">
        {icon && <span className="header-title__icon"><Icon name={icon} size={17} strokeWidth={1.9} /></span>}
        <span>{title}</span>
      </div>
      <div style={{ flex: 1 }} />
      {right}
      {/*
        Звук и вибрация выключаются ОТ СЮДА, а не из buried-меню: игра звуковая,
        и её часто открывают в публичном месте. Кнопка обязана быть видна всегда,
        иначе игрок, которому нужен тихий режим, просто закроет игру.
        Долгое нажатие — вибрация, короткое — звук.
      */}
      <button
        className="icon-btn"
        onClick={toggleMuted}
        onContextMenu={(e) => { e.preventDefault(); toggleHaptics(); }}
        aria-label={settings.muted ? 'Включить звук' : 'Выключить звук'}
        title={settings.muted ? 'Звук выключен · долгое нажатие — вибрация' : 'Звук включён · долгое нажатие — вибрация'}
      >
        <Icon name={settings.muted ? 'volumeOff' : 'volume'} size={18} strokeWidth={1.9} />
      </button>
    </div>
  );
}
