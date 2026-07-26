# @cupel/codecs-wasm

jSquash WASM codecs behind the cupel `Encoder` interface, for the browser playground and edge runtimes. Single threaded builds only, so no COOP/COEP headers are required to use them.

The package itself never touches the filesystem. In environments without bundler driven WASM loading (plain Node, tests), callers supply precompiled `WebAssembly.Module` instances through the `WasmModules` initialization hook.
