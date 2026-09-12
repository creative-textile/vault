import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  back?: boolean;
  right?: React.ReactNode;
}

export default function Header({ title, back = true, right }: Props) {
  const nav = useNavigate();

  // В Telegram WebView страница нередко открывается сразу глубоким URL —
  // истории «назад» просто нет, и nav(-1) не делает ничего (кнопка «мертвая»).
  // react-router хранит индекс текущей записи в history.state.idx.
  const goBack = () => {
    const idx = (window.history.state as any)?.idx;
    if (typeof idx === 'number' && idx > 0) nav(-1);
    else nav('/', { replace: true });
  };

  return (
    <div className="header">
      {back && <button className="back-btn" onClick={goBack}>←</button>}
      <div className="header-title">{title}</div>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
