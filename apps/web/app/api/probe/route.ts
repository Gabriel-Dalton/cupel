import { createProbeHandler } from './probe'

/**
 * GET /api/probe?url=<image url>
 *
 * Single-image metadata probe (BRIEF 9.1): container, dimensions,
 * DQT-derived quality, encoder fingerprint, headroom. Header parsing
 * only, no pixel decode. All hardening (SSRF validation, redirect
 * re-checks, byte cap, timeout, rate limit, result cache) lives in
 * lib/net and ./probe, where it is unit tested with injected fetchers.
 *
 * Runs on the Node.js runtime; vercel.json caps it at maxDuration 15 and
 * the internal fetch deadline is 10s, so a timeout here is a real signal.
 */
export const runtime = 'nodejs'

export const GET = createProbeHandler()
