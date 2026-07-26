import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { gitStatus, guardRefusal } from '../lib/git.js'
import { applyPlan } from '../write/apply.js'
import { planDirectory } from '../write/plan.js'
import { renderPlan } from '../write/render.js'

/**
 * cupel write: the ONLY command that modifies files, and only behind an
 * explicit flag with a clean git tree. Dry run is the default, always.
 */
export function registerWrite(program: Command): void {
  program
    .command('write <target>')
    .description('Apply an optimization plan. Dry run by default; requires --apply to touch files.')
    .option('--apply', 'actually write the outputs and the receipts')
    .option('--force', 'apply even though the target has uncommitted changes')
    .option('--fast', 'skip the avif rungs of the ladder')
    .option('--quiet', 'do not print per-asset progress while sweeping')
    .action(
      async (
        target: string,
        opts: { apply?: boolean; force?: boolean; fast?: boolean; quiet?: boolean },
      ) => {
        const root = resolve(target)
        try {
          const info = await stat(root)
          if (!info.isDirectory()) {
            console.error(`cupel write: ${target} is not a directory`)
            process.exitCode = 1
            return
          }
        } catch {
          console.error(`cupel write: cannot read ${target}`)
          process.exitCode = 1
          return
        }

        // The git guard runs BEFORE the sweep when applying: there is no
        // point spending minutes of encoding to then refuse.
        if (opts.apply === true && opts.force !== true) {
          const refusal = guardRefusal(await gitStatus(root))
          if (refusal !== null) {
            console.error(refusal)
            process.exitCode = 1
            return
          }
        }

        const plan = await planDirectory(root, {
          fast: opts.fast === true,
          onAsset:
            opts.quiet === true
              ? undefined
              : (asset, index, total) => {
                  process.stderr.write(`  sweeping ${index + 1}/${total}: ${asset}\n`)
                },
        })

        const applied = opts.apply === true ? await applyPlan(plan) : null
        console.log(renderPlan(plan, applied))
      },
    )
}
