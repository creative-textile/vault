import crypto from 'crypto';
import { ensureRedis, redis } from '../db/redis';

/** Redis lease for cross-instance cron/game coordination; DB idempotency remains final protection. */
export async function withRedisLock<T>(key:string,ttlMs:number,fn:()=>Promise<T>):Promise<T|undefined> {
  const token=crypto.randomUUID();
  try {
    await ensureRedis();
    const ok=await redis.set(`lock:${key}`,token,'PX',ttlMs,'NX');
    if(ok!=='OK') return undefined;
  } catch { return fn(); } // single-instance degraded mode; DB constraints/idempotency still protect money
  try { return await fn(); }
  finally {
    try { await redis.eval(`if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`,1,`lock:${key}`,token); } catch {}
  }
}
