# Governance

cupel is currently run as a BDFL project. Gabriel D'Alton (@Gabriel-Dalton) has final say on design, scope, and releases. This document says so plainly rather than pretending to a foundation structure that does not exist.

## What would change this

If the project gains sustained outside contributors, the intent is to move to a small maintainer group with documented commit rights and a lazy consensus process. The trigger is real: three or more people doing substantive recurring work for six months or longer. Until then, decisions route through the BDFL.

## Decisions we will not revisit

These were settled at the start of the project. Recurring arguments about them get resolved by pointing here.

1. The code license is Apache-2.0. The explicit patent grant matters in the codec space.
2. `@cupel/core` has no I/O, no platform dependencies, and no codecs. Codecs are injected.
3. Refusal is a first class output. The tool will always be able to answer "do nothing" and say why.
4. The tool never writes files without an explicit flag.
5. The corpus is openly licensed (CC BY 4.0) and every entry carries a license and source field.

## Changing a metric

Metrics may change, but never silently. Any change to `packages/core/src/metrics/` or `packages/core/src/rd/` must be accompanied by a corpus regression run and a posted diff of scores once the corpus exists (milestone M8). Until then, such changes require an explanation of the behavioural difference in the pull request.
