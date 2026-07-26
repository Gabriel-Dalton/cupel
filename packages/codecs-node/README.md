# @cupel/codecs-node

sharp behind the cupel `Encoder` interface. This package owns the Node codec path and nothing else: no decisions, no metrics. It also hosts the browser parity test, which runs identical inputs through this adapter and `@cupel/codecs-wasm` and fails loudly if the two drift.
