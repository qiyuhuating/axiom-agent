use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use std::hint::black_box;
#[path = "../../daemon/src/history.rs"]
mod history_store;
use history_store::History;

const LIMIT: usize = 256 * 1024;
fn current(history: &mut String, text: &str) {
    history.push_str(text);
    if history.len() > LIMIT {
        let mut start = history.len() - LIMIT;
        while !history.is_char_boundary(start) {
            start += 1;
        }
        history.drain(..start);
    }
}
fn history(c: &mut Criterion) {
    let text = "x\u{4e2d}\u{6587}0123456789\n".repeat(8);
    let mut group = c.benchmark_group("bounded_terminal_history");
    group.throughput(Throughput::Bytes(text.len() as u64));
    let mut string = "a".repeat(LIMIT);
    group.bench_function("current_string_drain", |b| {
        b.iter(|| current(black_box(&mut string), black_box(&text)))
    });
    let mut ring: History = serde_json::from_value(serde_json::json!("a".repeat(LIMIT))).unwrap();
    group.bench_function("production_byte_ring", |b| {
        b.iter(|| black_box(&mut ring).append(black_box(&text)))
    });
    let mut a = "a".repeat(LIMIT);
    let mut b: History = serde_json::from_value(serde_json::json!(&a)).unwrap();
    for _ in 0..100 {
        current(&mut a, &text);
        b.append(&text);
    }
    assert_eq!(serde_json::to_value(&b).unwrap(), serde_json::json!(&a));
    group.finish();
    c.bench_function("snapshot_string_json", |b| {
        b.iter(|| serde_json::to_vec(black_box(&a)).unwrap())
    });
    c.bench_function("snapshot_ring_json", |bench| {
        bench.iter(|| serde_json::to_vec(black_box(&b)).unwrap())
    });
}
criterion_group!(benches, history);
criterion_main!(benches);
