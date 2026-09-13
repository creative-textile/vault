import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { redis, ensureRedis } from '../../db/redis';
import { config } from '../../config';
import { query } from '../../db/pool';

const memory = new Map<string,{count:number,reset:number}>();
const clientKey=(req:Request) => (req as any).user?.id ? `u:${(req as any).user.id}` : `ip:${req.ip}`;

/** Fixed-window limiter in Redis; in-memory fallback keeps protection during Redis outage. */
export function rateLimit(name:string, limit:number, windowSec:number) {
  return async (req:Request,res:Response,next:NextFunction) => {
    const key=`rl:${name}:${clientKey(req)}:${Math.floor(Date.now()/(windowSec*1000))}`;
    try {
      await ensureRedis();
      const count=await redis.incr(key);
      if (count===1) await redis.expire(key,windowSec+1);
      if (count>limit) return res.status(429).json({error:'Слишком много запросов. Попробуйте позже',retry_after:windowSec});
    } catch {
      const now=Date.now(), cur=memory.get(key);
      const item=!cur||cur.reset<=now?{count:1,reset:now+windowSec*1000}:{count:cur.count+1,reset:cur.reset};
      memory.set(key,item);
      if(item.count>limit) return res.status(429).json({error:'Слишком много запросов. Попробуйте позже',retry_after:Math.ceil((item.reset-now)/1000)});
    }
    next();
  };
}

/** Reject malformed/non-finite/oversized JSON before it reaches money services. */
export function validatePayload(req:Request,res:Response,next:NextFunction) {
  const forbidden=new Set(['__proto__','prototype','constructor']);
  const walk=(v:any,depth=0):boolean => {
    if(depth>8) return false;
    if(typeof v==='number') return Number.isFinite(v);
    if(typeof v==='string') return v.length<=4096;
    if(Array.isArray(v)) return v.length<=100 && v.every(x=>walk(x,depth+1));
    if(v&&typeof v==='object') return Object.keys(v).length<=100 && Object.entries(v).every(([k,x])=>!forbidden.has(k)&&walk(x,depth+1));
    return v==null||typeof v==='boolean';
  };
  if(!walk(req.body)) return res.status(400).json({error:'Некорректные входные данные'});
  next();
}
export const validMoney=(value:any,min=0,max=10_000_000) => {
  const n=typeof value==='number'?value:Number(value);
  return Number.isFinite(n)&&n>=min&&n<=max&&Math.round(n*100)===n*100;
};
export const validId=(value:any) => Number.isSafeInteger(Number(value))&&Number(value)>0;
export function moneyBody(field:string,min=0,max=10_000_000) {
  return (req:Request,res:Response,next:NextFunction) => validMoney(req.body?.[field],min,max)
    ? next() : res.status(400).json({error:`Некорректная сумма: ${field}`});
}
export function pinBody(req:Request,res:Response,next:NextFunction) {
  return /^\d{4}$/.test(String(req.body?.pin||'')) ? next() : res.status(400).json({error:'PIN — 4 цифры'});
}

export function adminPassword(req:Request,res:Response,next:NextFunction) {
  const expected=config.adminPassword;
  if(!expected) return res.status(503).json({error:'ADMIN_PASSWORD не настроен'});
  const supplied=String(req.header('x-admin-password')||'');
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return res.status(401).json({error:'Неверный пароль администратора'});
  next();
}

/** Audit every mutating admin request, including failed attempts after authentication. */
export function adminAudit(req:Request,res:Response,next:NextFunction) {
  if(!['POST','PATCH','PUT','DELETE'].includes(req.method)) return next();
  const started=Date.now();
  res.on('finish',()=>{
    const actor=(req as any).user?.id;
    if(!actor) return;
    const sanitized={...req.body};
    for(const k of ['password','pin','mnemonic']) if(k in sanitized) sanitized[k]='[REDACTED]';
    query(`INSERT INTO admin_audit_log(actor_user_id,method,path,payload,status_code,ip,user_agent,duration_ms)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[actor,req.method,req.originalUrl,JSON.stringify(sanitized),res.statusCode,req.ip,req.header('user-agent')||'',Date.now()-started]).catch(()=>{});
  });
  next();
}

/** Store privacy-preserving hashes and flag identifiers used by multiple accounts. */
export function securityTelemetry(req:Request,res:Response,next:NextFunction) {
  res.on('finish',async()=>{
    const uid=(req as any).user?.id; if(!uid) return;
    const hash=(v:string)=>crypto.createHmac('sha256',config.securityPepper).update(v).digest('hex');
    const ipHash=hash(req.ip||'unknown');
    const deviceRaw=String(req.header('x-device-id')||req.header('user-agent')||'unknown');
    const deviceHash=hash(deviceRaw);
    try {
      await query(`INSERT INTO user_security_identifiers(user_id,ip_hash,device_hash,last_seen) VALUES($1,$2,$3,NOW())
                   ON CONFLICT(user_id,ip_hash,device_hash) DO UPDATE SET last_seen=NOW()`,[uid,ipHash,deviceHash]);
      for(const [kind,value,col] of [['ip',ipHash,'ip_hash'],['device',deviceHash,'device_hash']] as const) {
        const linked=await query(`SELECT COUNT(DISTINCT user_id)::int n FROM user_security_identifiers WHERE ${col}=$1`,[value]);
        if(Number(linked.rows[0].n)>=2) await query(`INSERT INTO antifraud_flags(user_id,kind,risk_score,details,details_hash)
          SELECT DISTINCT user_id,$2,30,$3,$4 FROM user_security_identifiers WHERE ${col}=$1
          ON CONFLICT(user_id,kind,details_hash) DO NOTHING`,[value,`shared_${kind}`,JSON.stringify({accounts:Number(linked.rows[0].n),identifier:value.slice(0,12)}),value]);
      }
    } catch { /* telemetry must never break a request */ }
  });
  next();
}
