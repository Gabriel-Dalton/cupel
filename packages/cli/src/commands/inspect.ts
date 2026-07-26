import type { Command } from 'commander'

/** cupel inspect <file>: the provenance report. Lands in M3. */
export function registerInspect(program: Command): void {
  program
    .command('inspect <file>')
    .description('Report what has already been done to an image file.')
    .action(() => {
      throw new Error('cupel inspect is not implemented yet (milestone M3)')
    })
}
