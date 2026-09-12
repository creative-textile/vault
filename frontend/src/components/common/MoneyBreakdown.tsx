import { useAuth } from '../../stores/auth';

/**
 * «Где деньги» — пояснение к балансу.
 *
 * Цифра на экране — не все деньги игрока. Часть зарезервирована в самом балансе
 * (ставка в ожидании дуэли), а часть СПИСАНА в игры и вернётся позже: вклад в
 * сейф (пока раунд собирается или взламывается) и тело вклада VAULT (пока вклад
 * активен). Раньше пояснялась одна заморозка дуэлей, поэтому после вклада в сейф
 * или открытия вклада игрок видел просто уменьшившуюся цифру и не понимал, куда
 * делись деньги — та же претензия была и к личному кабинету.
 *
 * Суммы приходят из `GET /api/profile` и из socket-события `balance_updated`
 * (на бэкенде их считает `getBalanceSnapshot`), поэтому пояснение обновляется
 * вместе с цифрами, а не по следующему опросу.
 *
 * Компонент ничего не рисует, если пояснять нечего (все суммы нулевые) — на
 * игровых экранах он не занимает места у игрока без вкладов.
 *
 * @param total показывать ли строку «Всего ваших средств» (баланс + сейф +
 *   вклад): на главной и в профиле она уместна, на игровых экранах — лишняя.
 */
export default function MoneyBreakdown({ total = true }: { total?: boolean }) {
  const { user } = useAuth();
  if (!user) return null;

  const balance = Number(user.balance) || 0;
  const frozen = Number(user.frozen_balance) || 0;
  const safe = Number(user.safe_locked) || 0;
  const vault = Number(user.vault_locked) || 0;
  if (frozen <= 0 && safe <= 0 && vault <= 0) return null;

  // Подпись под строкой объясняет, что с деньгами будет: без неё любая сумма
  // вне баланса читается как потерянная
  const rows = [
    {
      key: 'duel', value: frozen, line: '⚔️ заморожено в дуэлях',
      hint: 'ставка в ожидании соперника: вернётся при отмене, при принятии — разыграется'
    },
    {
      key: 'safe', value: safe, line: '🔒 вложено в сейф',
      hint: 'вклад в раунд: можно вернуть до взлома, дальше — разыграется'
    },
    {
      key: 'vault', value: vault, line: '💎 во вкладе VAULT',
      hint: 'тело вклада: вернётся с прибылью по сроку или досрочно (без прибыли)'
    }
  ].filter(r => r.value > 0);

  return (
    <div style={{ marginTop: 8, fontSize: 12, width: '100%' }}>
      {rows.map(r => (
        <div key={r.key} style={{ padding: '3px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span className="text-dim">{r.line}</span>
            <span style={{ color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>${r.value.toFixed(2)}</span>
          </div>
          <div className="text-dim" style={{ fontSize: 10, marginTop: 1 }}>{r.hint}</div>
        </div>
      ))}

      {total && (
        <>
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 10,
            marginTop: 6, paddingTop: 6, borderTop: '1px solid #2a2a4a', alignItems: 'baseline'
          }}>
            <span className="text-dim">Всего ваших средств</span>
            {/* Заморозка дуэлей уже внутри баланса, поэтому не прибавляется */}
            <span style={{ color: '#ffd700', fontWeight: 900, whiteSpace: 'nowrap' }}>
              ${(balance + safe + vault).toFixed(2)}
            </span>
          </div>
          <div className="text-dim" style={{ fontSize: 10, marginTop: 2 }}>
            баланс + сейф + вклад
          </div>
        </>
      )}
    </div>
  );
}
