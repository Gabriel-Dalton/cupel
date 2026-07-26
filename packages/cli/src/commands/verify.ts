import type { Command } from 'commander'

/**
 * cupel verify: re-measure shipped outputs against the ledger. Verification
 * re-measures, it never re-encodes. Lands in M6.
 */
export function registerVerify(program: Command): void {
  program
    .command('verify [ledger]')
    .description('Recompute the metrics recorded in the ledger and confirm or refute them.')
    .action(() => {
      throw new Error('cupel verify is not implemented yet (milestone M6)')
    })
}
