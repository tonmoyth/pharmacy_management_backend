
import Redis from "ioredis";
import { envVeriables } from "./envConfig";

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

            RedisClient.instance.on("connect", () => {
                console.log("✅ Redis connected successfully");
            });

            RedisClient.instance.on("ready", () => {
                console.log("✅ Redis is ready");
            });

            RedisClient.instance.on("error", (error) => {
                console.error(
                    "❌ Redis connection error:",
                    error.message
                );
            });

            RedisClient.instance.on("close", () => {
                console.warn("⚠️ Redis connection closed");
            });
        }

        return RedisClient.instance;
    }
}

export const redis = RedisClient.getInstance();

