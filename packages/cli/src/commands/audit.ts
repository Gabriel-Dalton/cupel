import { stat } from 'node:fs/promises'
import type { Command } from 'commander'
import { auditDirectory, auditUrl } from '../audit/engine.js'
import { auditJson, renderAudit } from '../audit/render.js'

/**
 * cupel audit <target>: read-only page or directory audit.
 *
 * Network scoping note: the CLI runs on the operator's own machine against
 * sites they chose, so it uses the platform fetch directly. The SSRF guard
 * in apps/web/lib/net exists because the hosted endpoint takes URLs from
 * strangers; that threat model does not apply here, and pretending it does
 * would only stop people auditing their own localhost.
 */
export function registerAudit(program: Command): void {
  program
    .command('audit <target>')
    .description('Audit a page URL or directory. Read only, writes nothing.')
    .option('--json', 'emit the report as JSON')
    .action(async (target: string, opts: { json?: boolean }) => {
      const looksRemote = /^https?:\/\//i.test(target)
      if (!looksRemote) {
        try {
          const info = await stat(target)
          if (!info.isDirectory()) {
            console.error(
              `cupel audit: ${target} is a file, not a directory. Use cupel inspect for one file.`,
            )
            process.exitCode = 1
            return
          }
        } catch {
          console.error(
            `cupel audit: ${target} is neither a readable directory nor an http(s) URL.`,
          )
          process.exitCode = 1
          return
        }
      }

      const report = looksRemote ? await auditUrl(target) : await auditDirectory(target)
      console.log(opts.json === true ? auditJson(report) : renderAudit(report))
    })
}
