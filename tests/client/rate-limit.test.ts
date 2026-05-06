import { describe, expect, test } from 'bun:test'
import { TokenBucketLimiter } from '../../src/client/rate-limit.ts'

describe('TokenBucketLimiter', () => {
  test('allows up to capacity in a burst', () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 1 })
    expect(limiter.consume('a', 0)).toBe(true)
    expect(limiter.consume('a', 0)).toBe(true)
    expect(limiter.consume('a', 0)).toBe(true)
    expect(limiter.consume('a', 0)).toBe(false)
  })

  test('refills tokens over time', () => {
    const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSecond: 2 })
    for (let i = 0; i < 3; i++) limiter.consume('a', 0)
    expect(limiter.consume('a', 0)).toBe(false)
    expect(limiter.consume('a', 500)).toBe(true) // 1 token refilled (2/s * 0.5s)
    expect(limiter.consume('a', 500)).toBe(false)
  })

  test('does not refill above capacity', () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 100 })
    expect(limiter.consume('a', 0)).toBe(true)
    expect(limiter.consume('a', 10_000)).toBe(true)
    expect(limiter.consume('a', 10_000)).toBe(true)
    expect(limiter.consume('a', 10_000)).toBe(false)
  })

  test('keys are isolated', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0 })
    expect(limiter.consume('a', 0)).toBe(true)
    expect(limiter.consume('a', 0)).toBe(false)
    expect(limiter.consume('b', 0)).toBe(true)
  })

  test('forget clears bucket state', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0 })
    expect(limiter.consume('a', 0)).toBe(true)
    expect(limiter.consume('a', 0)).toBe(false)
    limiter.forget('a')
    expect(limiter.consume('a', 0)).toBe(true)
  })
})
