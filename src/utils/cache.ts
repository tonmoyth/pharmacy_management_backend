
import { redis } from "../config/redis";

class RedisService {
    /**
     * Get cached data
     */
    async get<T>(key: string): Promise<T | null> {
        const data = await redis.get(key);

        if (!data) {
            return null;
        }

        try {
            return JSON.parse(data) as T;
        } catch {
            return data as T;
        }
    }

    /**
     * Set data in Redis
     *
     * ttl = seconds
     */
    async set(
        key: string,
        data: unknown,
        ttl?: number
    ): Promise<void> {
        const value = JSON.stringify(data);

        if (ttl) {
            await redis.set(key, value, "EX", ttl);
            return;
        }

        await redis.set(key, value);
    }

    /**
     * Delete cache by key
     */
    async delete(key: string): Promise<void> {
        await redis.del(key);
    }

    /**
     * Check if key exists
     */
    async exists(key: string): Promise<boolean> {
        const result = await redis.exists(key);

        return result === 1;
    }

    /**
     * Set expiration for existing key
     *
     * ttl = seconds
     */
    async expire(
        key: string,
        ttl: number
    ): Promise<void> {
        await redis.expire(key, ttl);
    }

    /**
     * Delete multiple keys by pattern
     *
     * Example:
     * pharmacy:123:medicines:*
     */
    async deleteByPattern(pattern: string): Promise<void> {
        let cursor = "0";

        do {
            const [nextCursor, keys] = await redis.scan(
                cursor,
                "MATCH",
                pattern,
                "COUNT",
                100
            );

            cursor = nextCursor;

            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== "0");
    }
}

export const redisService = new RedisService();

