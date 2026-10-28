// Runs A2Tools' own plugin decoder (src/decoder.rs, copied unchanged from
// A2Tools-DPS-Meter src-tauri/src/plugins/decoder.rs) over frames, exactly as
// PluginHost::on_frame does: every decoder of the frame's opcode, in manifest
// order, on the body after the two type bytes. Prints one JSON line per event.
//   decoder-check <manifest.json>  < frames.txt   (one "<op> <family> <hex body>" per line)
mod decoder;
use std::io::BufRead;

fn main() {
    let path = std::env::args().nth(1).expect("manifest path");
    let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let specs: Vec<decoder::DecoderSpec> = serde_json::from_value(manifest["decoders"].clone()).unwrap();
    let decoders: Vec<decoder::Decoder> = specs.iter().map(|s| decoder::Decoder::compile(s).unwrap_or_else(|e| panic!("{e}"))).collect();
    eprintln!("{} decoders compiled", decoders.len());
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        let mut parts = line.split_whitespace();
        let op = u8::from_str_radix(parts.next().unwrap(), 16).unwrap();
        let fam = u8::from_str_radix(parts.next().unwrap(), 16).unwrap();
        let hex: String = parts.collect();
        let body: Vec<u8> = (0..hex.len() / 2).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap()).collect();
        for d in decoders.iter().filter(|d| d.opcode == [op, fam]) {
            if let Some(data) = d.decode(&body) {
                println!("{}", serde_json::json!({"event": format!("decoded:{}", d.name), "data": data}));
            }
        }
        println!("{}", serde_json::json!({"event": "--frame-end--", "frame": line}));
    }
}
