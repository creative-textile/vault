import { query } from '../db/pool';

export type ReplayGame='rocket'|'duel'|'safe';
export interface ReplayEnvelope { version:1; game:ReplayGame; id:number; created_at:string; duration_ms:number; outcome:any; animation:any; participants:any[]; share_url:string }
const share=(game:ReplayGame,id:number)=>`/replay/${game}/${id}`;

/** Public, immutable replay projection. It never exposes Telegram ids, balances or the Safe code before completion. */
export async function getReplay(game:ReplayGame,id:number):Promise<ReplayEnvelope|null> {
  if(game==='rocket') {
    const r=(await query(`SELECT r.*,u.username FROM rocket_rounds r JOIN users u ON u.id=r.user_id WHERE r.id=$1`,[id])).rows[0];
    if(!r) return null;
    // Незавершённый раунд реплеить нельзя: envelope содержит `crash_at`,
    // то есть точка взрыва идущего полёта утекала любому, кто переберёт id
    // (`/api/rocket/replay/:id` и `/api/replay/rocket/:id` публичны).
    if(r.cashout_at==null && Number(r.profit||0)===0) return null;
    const crash=Number(r.crash_at),curve=Number(r.flight_curve||.075);
    return {version:1,game,id,created_at:r.started_at||r.created_at,duration_ms:Math.round(Math.log(crash)/curve*1000),
      outcome:{bet:Number(r.bet),crash_at:crash,cashout_at:r.cashout_at==null?null:Number(r.cashout_at),profit:Number(r.profit),payout:r.cashout_at==null?0:Math.round((Number(r.bet)+Number(r.profit))*100)/100,was_beautiful:!!r.was_beautiful},
      animation:{seed:r.replay_seed||`legacy-rocket-${id}`,curve,tick_hz:30},participants:[{name:`@${r.username||'user'}`}],share_url:share(game,id)};
  }
  if(game==='duel') {
    const r=(await query(`SELECT d.*,a.username creator_name,b.username opponent_name FROM duels d JOIN users a ON a.id=d.creator_id LEFT JOIN users b ON b.id=d.opponent_id WHERE d.id=$1`,[id])).rows[0];
    if(!r || r.status!=='finished') return null;
    // Приз считается по той же настройке комиссии, что и выплата в дуэли:
    // раньше здесь были захардкожены x1.8/x0.8 (комиссия 10%), и при изменении
    // commission_percent в админке реплей показывал другие цифры, чем игрок.
    const { getSetting } = await import('./revenue');
    const commission=parseFloat((await getSetting('commission_percent'))||'10');
    const amount=Number(r.amount);
    const prize=Math.round(amount*2*(1-commission/100)*100)/100;
    const net=Math.round((prize/2-amount)*100)/100;
    return {version:1,game,id,created_at:r.finished_at||r.created_at,duration_ms:2800,
      outcome:{amount,result:r.result,winner_id:r.winner_id,prize,profit:net},animation:{seed:`duel-${id}`,trajectory:r.coin_trajectory},
      participants:[{role:'creator',name:`@${r.creator_name||'user'}`,won:Number(r.winner_id)===Number(r.creator_id),net:Number(r.winner_id)===Number(r.creator_id)?net:-amount},{role:'opponent',name:`@${r.opponent_name||'user'}`,won:Number(r.winner_id)===Number(r.opponent_id),net:Number(r.winner_id)===Number(r.opponent_id)?net:-amount}],share_url:share(game,id)};
  }
  const s=(await query(`SELECT * FROM safes WHERE id=$1 AND status='finished'`,[id])).rows[0];
  if(!s) return null;
  const deps=await query(`SELECT d.amount,d.crack_time_ms,d.prize,u.username FROM safe_deposits d JOIN users u ON u.id=d.user_id WHERE d.safe_id=$1 ORDER BY CASE WHEN d.crack_time_ms IS NULL THEN 1 ELSE 0 END,d.crack_time_ms,d.created_at`,[id]);
  return {version:1,game,id,created_at:s.cracked_at||s.date,duration_ms:5000,
    outcome:{bank:Number(s.bank),prize_pool:Number(s.prize_pool),winners_count:s.winners_count,code:s.code},
    animation:{seed:`safe-${id}`,code:s.code,drum_speeds:s.drum_speeds},participants:deps.rows.map((d:any,index:number)=>({rank:index+1,name:`@${d.username||'user'}`,amount:Number(d.amount),time_ms:d.crack_time_ms,prize:Number(d.prize),profit:Math.round((Number(d.prize)-Number(d.amount))*100)/100,won:Number(d.prize)>0})),share_url:share(game,id)};
}
