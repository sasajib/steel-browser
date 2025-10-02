import { FastifyBaseLogger } from "fastify";
import { createClient, RedisClientType } from "redis";
import { env } from "../env.js";
import { SessionData } from "./context/types.js";

export interface PersistedSessionData {
  userId: string;
  sessionData: SessionData;
  fingerprint?: Record<string, any>;
  userAgent?: string;
  lastAccessed: string;
  createdAt: string;
}

/**
 * Service for persisting browser session data to Redis
 * Allows users to maintain consistent browser fingerprints and session state across multiple sessions
 */
export class SessionPersistenceService {
  private client: RedisClientType | null = null;
  private logger: FastifyBaseLogger;
  private enabled: boolean;
  private readonly SESSION_PREFIX = "steel:session:";
  private readonly SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
    this.enabled = env.ENABLE_SESSION_PERSISTENCE;
  }

  /**
   * Initialize Redis connection
   */
  async connect(): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Session persistence is disabled");
      return;
    }

    try {
      const redisUrl =
        env.REDIS_URL ||
        `redis://${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;

      this.client = createClient({
        url: redisUrl,
        password: env.REDIS_PASSWORD,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              this.logger.error("Too many Redis reconnection attempts, giving up");
              return new Error("Redis connection failed");
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on("error", (err) => {
        this.logger.error({ err }, "Redis client error");
      });

      this.client.on("connect", () => {
        this.logger.info("Redis client connected");
      });

      this.client.on("reconnecting", () => {
        this.logger.warn("Redis client reconnecting");
      });

      await this.client.connect();
      this.logger.info("Session persistence service initialized with Redis");
    } catch (error) {
      this.logger.error({ err: error }, "Failed to connect to Redis");
      // Don't throw - allow the service to continue without persistence
      this.enabled = false;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.info("Redis client disconnected");
      } catch (error) {
        this.logger.error({ err: error }, "Error disconnecting from Redis");
      }
    }
  }

  /**
   * Check if persistence is enabled and connected
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null && this.client.isOpen;
  }

  /**
   * Save session data for a user
   */
  async saveSession(
    userId: string,
    sessionData: SessionData,
    fingerprint?: Record<string, any>,
    userAgent?: string,
  ): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.debug("Session persistence is disabled, skipping save");
      return;
    }

    try {
      const key = this.getSessionKey(userId);
      const data: PersistedSessionData = {
        userId,
        sessionData,
        fingerprint,
        userAgent,
        lastAccessed: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      // Check if session already exists to preserve createdAt
      const existing = await this.getSession(userId);
      if (existing) {
        data.createdAt = existing.createdAt;
      }

      await this.client!.setEx(key, this.SESSION_TTL, JSON.stringify(data));
      this.logger.info({ userId }, "Session data saved to Redis");
    } catch (error) {
      this.logger.error({ err: error, userId }, "Failed to save session data");
      // Don't throw - allow the session to continue without persistence
    }
  }

  /**
   * Retrieve session data for a user
   */
  async getSession(userId: string): Promise<PersistedSessionData | null> {
    if (!this.isEnabled()) {
      this.logger.debug("Session persistence is disabled, skipping get");
      return null;
    }

    try {
      const key = this.getSessionKey(userId);
      const data = await this.client!.get(key);

      if (!data) {
        this.logger.info({ userId }, "No persisted session found");
        return null;
      }

      const parsed: PersistedSessionData = JSON.parse(data);

      // Update last accessed time
      parsed.lastAccessed = new Date().toISOString();
      await this.client!.setEx(key, this.SESSION_TTL, JSON.stringify(parsed));

      this.logger.info({ userId }, "Session data retrieved from Redis");
      return parsed;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Failed to retrieve session data");
      return null;
    }
  }

  /**
   * Delete session data for a user
   */
  async deleteSession(userId: string): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.debug("Session persistence is disabled, skipping delete");
      return;
    }

    try {
      const key = this.getSessionKey(userId);
      await this.client!.del(key);
      this.logger.info({ userId }, "Session data deleted from Redis");
    } catch (error) {
      this.logger.error({ err: error, userId }, "Failed to delete session data");
    }
  }

  /**
   * Check if a session exists for a user
   */
  async hasSession(userId: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    try {
      const key = this.getSessionKey(userId);
      const exists = await this.client!.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Failed to check session existence");
      return false;
    }
  }

  /**
   * List all user IDs with persisted sessions
   */
  async listSessions(): Promise<string[]> {
    if (!this.isEnabled()) {
      return [];
    }

    try {
      const keys = await this.client!.keys(`${this.SESSION_PREFIX}*`);
      return keys.map((key) => key.replace(this.SESSION_PREFIX, ""));
    } catch (error) {
      this.logger.error({ err: error }, "Failed to list sessions");
      return [];
    }
  }

  /**
   * Get Redis key for a user session
   */
  private getSessionKey(userId: string): string {
    return `${this.SESSION_PREFIX}${userId}`;
  }
}
