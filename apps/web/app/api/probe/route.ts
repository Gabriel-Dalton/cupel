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
 * Runs on the Node.js runtime, capped at 15s. The internal fetch deadline
 * is 10s, so a timeout here is a real signal rather than a slow upstream.
 *
 * The cap is declared here rather than in vercel.json's `functions` block
 * on purpose: that block's globs resolve against the deployment's root
 * directory, which for this project is apps/web, so a repo-relative path
 * there matches nothing and fails the build. A route segment export cannot
 * disagree with where the file actually is.
 */
export const runtime = 'nodejs'

export const maxDuration = 15

export const GET = createProbeHandler()
