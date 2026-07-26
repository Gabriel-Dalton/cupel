import type { Command } from 'commander'
import { UnreadableInput, examine } from '../lib/analyze.js'
import { renderReport, reportJson } from '../inspect/report.js'

/** cupel inspect <file>: the provenance report. */
export function registerInspect(program: Command): void {
  program
    .command('inspect <file>')
    .description('Report what has already been done to an image file.')
    .option('--json', 'emit the provenance record as JSON')
    .action(async (file: string, opts: { json?: boolean }) => {
      try {
        const examined = await examine(file)
        console.log(opts.json === true ? reportJson(examined) : renderReport(examined))
      } catch (err) {
        if (err instanceof UnreadableInput) {
          // A structured refusal, not a stack trace: the caller asked a
          // reasonable question about a file cupel cannot read.
          console.error(`cupel inspect: ${err.message}`)
          process.exitCode = 1
          return
        }
        throw err
      }
    })
}
