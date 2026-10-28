# Tests

The decoders are checked with A2Tools' own `decoder.rs`, copied unchanged into
`../decoder-check/src/` (from A2Tools-DPS-Meter `src-tauri/src/plugins/decoder.rs`),
over PetTracker's fixtures and frames built like PetTracker's tests.

```sh
cp <A2Tools-DPS-Meter>/src-tauri/src/plugins/decoder.rs ../decoder-check/src/
cargo build --manifest-path ../decoder-check/Cargo.toml
D=../decoder-check/target/debug/decoder-check
python3 -I frames.py && $D ../../manifest.json < frames.txt > events.jsonl
python3 -I market_frames.py <PetTracker> && $D ../../manifest.json < market-frames.txt > market-events.jsonl
PLUGIN_DIR=../.. node --test logic.test.cjs market.test.cjs
```

The EU merchant test is made from a capture and lives in the private notes
repo; `../ci.sh` runs it when that repo lies next to this one.
