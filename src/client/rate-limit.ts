export interface RateLimitConfig {
  capacity: number
  refillPerSecond: number
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  capacity: 30,
  refillPerSecond: 10,
}

interface Bucket {
  tokens: number
  lastRefill: number
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly config: RateLimitConfig

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT) {
    this.config = config
  }

  consume(key: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? this.create(now)
    this.refill(bucket, now)
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket)
      return false
    }
    bucket.tokens -= 1
    this.buckets.set(key, bucket)
    return true
  }

  forget(key: string): void {
    this.buckets.delete(key)
  }

  private create(now: number): Bucket {
    return { tokens: this.config.capacity, lastRefill: now }
  }

  private refill(bucket: Bucket, now: number): void {
    const elapsedSec = (now - bucket.lastRefill) / 1000
    if (elapsedSec <= 0) return
    bucket.tokens = Math.min(this.config.capacity, bucket.tokens + elapsedSec * this.config.refillPerSecond)
    bucket.lastRefill = now
  }
}
