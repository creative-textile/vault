import Redis from 'ioredis';
import { config } from '../config';

export const redis = new Redis(config.redisUrl, { lazyConnect:true, maxRetriesPerRequest:1, enableOfflineQueue:false });
redis.on('error', err => console.warn('[REDIS]', err.message));
export async function ensureRedis() { if(redis.status==='wait'||redis.status==='end') await redis.connect(); return redis; }
export default redis;
