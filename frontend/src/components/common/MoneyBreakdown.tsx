import { useAuth } from '../../stores/auth';

/**
 * Краткая заморозка для игровых экранов и полная раскладка только для профиля.
 * `balance` уже включает резерв открытых дуэлей, поэтому общая сумма средств —
 * balance + safe + vault (не плюс frozen второй раз).
 */
export default function MoneyBreakdown({ detailed = false }: { detailed?: boolean }) {
  const { user } = useAuth();
  if (!user) return null;

  const balance = Number(user.balance) || 0;
  const frozen = Number(user.frozen_balance) || 0;
  const safe = Number(user.safe_locked) || 0;
  const vault = Number(user.vault_locked) || 0;

  if (!detailed) {
    return frozen > 0 ? (
      <div className="text-dim" style={{ marginTop: 6, fontSize: 12 }}>
        ⚔️ Заморожено: <b style={{ color: '#fff' }}>${frozen.toFixed(2)}</b>
      </div>
    ) : null;
  }

  const rows = [
    { key: 'available', label: 'Доступно', value: balance - frozen },
    { key: 'duel', label: '⚔️ В дуэлях', value: frozen },
    { key: 'safe', label: '🔒 В сейфе', value: safe },
    { key: 'vault', label: '💎 Во вкладе', value: vault }
  ];

  return (
    <div style={{ marginTop: 8, fontSize: 12, width: '100%' }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0' }}>
          <span className="text-dim">{r.label}</span>
          <b style={{ color: '#fff', whiteSpace: 'nowrap' }}>${r.value.toFixed(2)}</b>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6, paddingTop: 6, borderTop: '1px solid #2a2a4a' }}>
        <span className="text-dim">Всего средств</span>
        <b style={{ color: '#ffd700', whiteSpace: 'nowrap' }}>${(balance + safe + vault).toFixed(2)}</b>
      </div>
    </div>
  );
}
