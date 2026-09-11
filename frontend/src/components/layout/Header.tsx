import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  back?: boolean;
  right?: React.ReactNode;
}

export default function Header({ title, back = true, right }: Props) {
  const nav = useNavigate();
  return (
    <div className="header">
      {back && <button className="back-btn" onClick={() => nav(-1)}>←</button>}
      <div className="header-title">{title}</div>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
