import Redis from 'ioredis';
import { envVeriables } from './envConfig';

class RedisClient {
    private static instance: Redis;

    static getInstance(): Redis {
        if (!RedisClient.instance) {
            RedisClient.instance = new Redis({
                host: envVeriables.REDIS_HOST,
                port: Number(envVeriables.REDIS_PORT),
                password: envVeriables.REDIS_PASSWORD,
                maxRetriesPerRequest: 3,
                retryStrategy(times) {
                    return Math.min(times * 50, 2000);
                },
            });

            RedisClient.instance.on('connect', () => {
                console.log('✅ Redis connected successfully');
            });

            RedisClient.instance.on('error', (err) => {
                console.error('❌ Redis connection error:', err.message);
            });
        }
        return RedisClient.instance;
    }
}

export const redis = RedisClient.getInstance();