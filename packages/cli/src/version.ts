/**
 * The tool string stamped into every ledger entry. Kept in sync with
 * packages/cli/package.json by hand: a receipt has to name the version that
 * produced it, and reading package.json at runtime would break the moment
 * the CLI is bundled.
 */
export const CUPEL_VERSION = '0.1.0'
export const CUPEL_TOOL = `cupel@${CUPEL_VERSION}`
