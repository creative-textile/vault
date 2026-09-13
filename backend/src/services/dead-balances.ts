import { getClient, query } from '../db/pool';
import { getSetting } from './revenue';
import { notifyLifecycleOnce } from './notifications';

/**
 * Предупреждает неактивных владельцев доступного остатка и через семь суток
 * атомарно переводит этот остаток в распределяемый пул Vault Вклада.
 * Замороженные ставки/депозиты не затрагиваются: переносится только users.balance.
 */
export async function processDeadBalances(): Promise<{warned:number; transferred:number; amount:number}> {
  const inactiveDays=Math.max(1,parseInt(await getSetting('dead_balance_inactive_days') || '180'));
  const candidates=await query(
    `SELECT id,balance,notified_dead,dead_deadline FROM users
      WHERE balance>0 AND last_active < NOW()-($1::text||' days')::interval
      ORDER BY id`,[inactiveDays]);
  let warned=0,transferred=0,amount=0;
  for(const row of candidates.rows) {
    if(!row.notified_dead) {
      const marked=await query(`UPDATE users SET notified_dead=TRUE,dead_deadline=NOW()+INTERVAL '7 days'
        WHERE id=$1 AND notified_dead=FALSE AND balance>0 RETURNING dead_deadline`,[row.id]);
      if(marked.rows.length) {
        await notifyLifecycleOnce(row.id,'Ваш баланс станет невостребованным через 7 дней. Войдите в приложение, чтобы сохранить его.',
          'dead_balance_warning','Предупреждение о балансе',{deadline:marked.rows[0].dead_deadline},'dead_balance_warning',row.id);
        warned++;
      }
      continue;
    }
    const client=await getClient();
    try {
      await client.query('BEGIN');
      const claim=await client.query(`UPDATE users SET balance=0,dead_deadline=NULL
        WHERE id=$1 AND balance>0 AND notified_dead=TRUE AND dead_deadline<=NOW()
          AND last_active < NOW()-($2::text||' days')::interval
        RETURNING balance AS balance_after`,[row.id,inactiveDays]);
      if(!claim.rows.length) { await client.query('ROLLBACK'); continue; }
      const cents=Math.round(parseFloat(row.balance)*100), value=cents/100;
      if(cents<=0) { await client.query('ROLLBACK'); continue; }
      await client.query(`INSERT INTO transactions(user_id,type,amount,balance_after,game_type,description)
        VALUES($1,'dead_balance_vault',$2,0,'vault','Невостребованный остаток переведён в пул Vault')`,[row.id,-value]);
      await client.query(`INSERT INTO settings(key,value) VALUES('manual_pool_addition',$1)
        ON CONFLICT(key) DO UPDATE SET value=(COALESCE(settings.value,'0')::numeric+$1::numeric)::text`,[value]);
      await client.query('COMMIT');
      transferred++; amount+=value;
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  return {warned,transferred,amount:Math.round(amount*100)/100};
}
