// Command registry. Each command lives in its own module under commands/
// and registers itself on the shared program. Different milestones own
// different command modules; this file stays stable so they never collide.
import { Command } from 'commander'
import { registerInspect } from './commands/inspect.js'
import { registerAudit } from './commands/audit.js'
import { registerWrite } from './commands/write.js'
import { registerVerify } from './commands/verify.js'

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('cupel')
    .description('Assay before you compress. An image toolchain that measures before it touches.')

  registerInspect(program)
  registerAudit(program)
  registerWrite(program)
  registerVerify(program)
  return program
}
