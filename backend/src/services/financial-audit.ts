import { query } from '../db/pool';

/** Снимок финансовых инвариантов. Не смешивает пользовательские обязательства с операционными кассами. */
export async function getFinancialReconciliation() {
  const [users,safe,vault,rocket,cash,negative,frozenMismatch,lastBalanceMismatch] = await Promise.all([
    query(`SELECT COALESCE(SUM(balance),0) balance,COALESCE(SUM(frozen_balance),0) frozen FROM users`),
    query(`SELECT COALESCE(SUM(sd.amount),0) locked FROM safe_deposits sd JOIN safes s ON s.id=sd.safe_id WHERE s.status IN ('collecting','cracking')`),
    query(`SELECT COALESCE(SUM(amount),0) principal,COALESCE(SUM(accumulated_profit),0) profit FROM vault_deposits WHERE status='active'`),
    query(`SELECT COALESCE(SUM(amount),0) amount FROM rocket_bankroll`),
    query(`SELECT COALESCE(SUM(amount),0) amount FROM platform_cashbox`),
    query(`SELECT COUNT(*) n FROM users WHERE balance<0 OR frozen_balance<0 OR frozen_balance>balance`),
    query(`SELECT COUNT(*) n FROM users u WHERE ROUND(u.frozen_balance,2) <> ROUND(COALESCE((SELECT SUM(d.amount) FROM duels d WHERE d.creator_id=u.id AND d.status='waiting'),0),2)`),
    query(`SELECT COUNT(*) n FROM users u WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.user_id=u.id) AND ROUND(u.balance,2) <> ROUND((SELECT t.balance_after FROM transactions t WHERE t.user_id=u.id ORDER BY t.id DESC LIMIT 1),2)`)
  ]);
  const n=(v:any)=>Math.round((parseFloat(v)||0)*100)/100;
  const violations={
    negative_or_over_reserved:Number(negative.rows[0].n),
    duel_reserve_mismatch:Number(frozenMismatch.rows[0].n),
    transaction_tail_mismatch:Number(lastBalanceMismatch.rows[0].n)
  };
  return {
    checked_at:new Date().toISOString(), ok:Object.values(violations).every(v=>v===0), violations,
    user_accounts:{balance:n(users.rows[0].balance),reserved_duels:n(users.rows[0].frozen)},
    obligations:{safe:n(safe.rows[0].locked),vault_principal:n(vault.rows[0].principal),vault_profit:n(vault.rows[0].profit)},
    operating_assets:{rocket_bankroll:n(rocket.rows[0].amount),platform_cashbox:n(cash.rows[0].amount)}
  };
}
