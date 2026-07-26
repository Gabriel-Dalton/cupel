import type { Command } from 'commander'

/** cupel audit <target>: read-only page or directory audit. Lands in M4. */
export function registerAudit(program: Command): void {
  program
    .command('audit <target>')
    .description('Audit a page URL or directory. Read only, writes nothing.')
    .action(() => {
      throw new Error('cupel audit is not implemented yet (milestone M4)')
    })
}
