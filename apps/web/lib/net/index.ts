/**
 * The shared network hardening layer for hosted endpoints (BRIEF 9.3).
 * Any route that touches a user-supplied URL goes through guardedFetch and
 * composes the rate limiter and result cache from here; nothing reaches
 * for the platform fetch directly.
 */

export {
  guardedFetch,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  type AddressResolver,
  type GuardedFetchOptions,
  type GuardedFetchRefusal,
  type GuardedFetchResult,
  type GuardedFetchSuccess,
  type GuardFetcher,
  type GuardFetchInit,
  type GuardFetchResponse,
  type GuardRefusalCode,
} from './guard'
export {
  checkAddress,
  checkHostname,
  parseIpv4,
  parseIpv6,
  type AddressCheck,
  type HostnameCheck,
} from './validate'
export {
  clientIpFrom,
  createRateLimiter,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimiterOptions,
  type RateLimitWindow,
} from './ratelimit'
export { createTtlCache, normalizeUrl, type TtlCache, type TtlCacheOptions } from './cache'
