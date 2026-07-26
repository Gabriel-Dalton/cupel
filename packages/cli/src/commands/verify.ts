import type { Command } from 'commander'
import { renderVerify, verifyJson } from '../verify/render.js'
import { exitCodeFor, verifyLedger } from '../verify/verify.js'

/**
 * cupel verify: re-measure shipped outputs against the ledger. Verification
 * re-measures, it never re-encodes.
 */
export function registerVerify(program: Command): void {
  program
    .command('verify [ledger]')
    .description('Recompute the metrics recorded in the ledger and confirm or refute them.')
    .option('--json', 'emit the verification report as JSON')
    .action(async (ledger: string | undefined, opts: { json?: boolean }) => {
      const target = ledger ?? '.'
      try {
        const report = await verifyLedger(target)
        console.log(opts.json === true ? verifyJson(report) : renderVerify(report))
        process.exitCode = exitCodeFor(report)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`cupel verify: cannot read a ledger at ${target} (${message})`)
        process.exitCode = 1
      }
    })
}
