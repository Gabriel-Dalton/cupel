import type { Command } from 'commander'

/**
 * cupel write: the ONLY command that modifies files, and only behind an
 * explicit flag with a clean git tree. Dry run is the default, always.
 * Lands in M6, and the git guard must exist before any write path does.
 */
export function registerWrite(program: Command): void {
  program
    .command('write <target>')
    .description('Apply an optimization plan. Dry run by default; requires --apply to touch files.')
    .action(() => {
      throw new Error('cupel write is not implemented yet (milestone M6)')
    })
}
