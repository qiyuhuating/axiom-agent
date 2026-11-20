# Performance regression lab

Independent development tooling. Nothing in this directory is included in the desktop runtime or installer. Use PowerShell 7 from the repository root on Windows x64. Do not point these programs at a production workspace or profile. The HTTP harness creates random ports, an isolated session directory and a private Pi agent directory, uses no model inference, and stops its own processes.

## Run

```powershell
npm ci
npm run prepare:desktop
$env:AXIOM_BENCH_OUT = 'benchmarks/results/baseline'
node benchmarks/http.mjs
cargo bench --locked --manifest-path benchmarks/Cargo.toml
node benchmarks/http.mjs --profile
node benchmarks/profile.mjs benchmarks/results/baseline/host.cpuprofile
```

HTTP reports use 40 warmup requests and 400 sequential measurements per route, with nearest-rank P50/P95/P99 in milliseconds. Increase AXIOM_BENCH_COUNT for more tail samples. AXIOM_BENCH_RUNTIME selects an explicitly staged Windows runtime. Start a fresh fixture for each scenario; record the Git revision and payload hashes. The cold startup estimate includes readiness polling (100 ms granularity), and first Pi state measures RPC startup, not model TTFT. Idle CPU/private bytes/working set cover the fixture process tree for a short three-second interval; working-set sums double-count shared pages. This is not a soak test and excludes Tauri/WebView2 in the HTTP run.

Repeat after rebuilding the candidate to a different result directory. Compare unprofiled HTTP runs on the same hardware and OS:

```powershell
$env:AXIOM_BENCH_OUT = 'benchmarks/results/candidate'
node benchmarks/http.mjs
node benchmarks/compare.mjs benchmarks/results/baseline/http.json benchmarks/results/candidate/http.json
```

Run at least three alternating baseline/candidate trials under the same power policy, temperature and workload before enforcing latency budgets. The hosted CI run is informational; its noisy timing is not a merge gate. Criterion is independent of the runtime crate and uses the actual production history implementation alongside the previous algorithm.

## CPU profiles and ETW

Node's --cpu-prof runs against the real private HTTP host with a separate workload. The summary ranks sampled self time, including idle (not total CPU time). Do not use profiled runs for latency comparisons. On Windows, from an elevated PS7 shell:

```powershell
& benchmarks/etw.ps1 -Output benchmarks/results/etw
```

The wrapper checks that WPR is not already recording, starts the CPU profile and stops only its own recording. Open cpu.etl in Windows Performance Analyzer, load symbols if needed, filter CPU Usage (Sampled) by the fixture PIDs and the time range in profile-run.json; look at inclusive/exclusive stack time. ETW can capture system-wide information, including unrelated processes; the ignored results folder stays local. Do not upload raw traces or CPU profiles.

## Actual installed WebView2

Use a verified NSIS installer, an isolated desktop configuration and a new terminal archive. See daemon/README.md for the test-only CDP launch environment and local Playwright module. With AXIOM_TEST_PLAYWRIGHT_MODULE set to the absolute module path, run:

```powershell
node benchmarks/ui.mjs 18764 http://127.0.0.1:<host-port>
```

The driver connects to the actual WebView2 page, captures navigation/paint timings, creates a real PowerShell 7 PTY, samples 30 commands from Enter to visible output, and closes the terminal. It does not measure full app launch to interactivity; browser timings begin at navigation. Never enable CDP in the ordinary application environment. Re-run with the same installer/fixture and compare ui.json.

## Initial local baseline (2026-11-19)

Ryzen AI 9 H 365, Windows x64, Node 24.16.0. HTTP baseline staged f4fb959; candidate adds the history ring and single-fetch runtime-health path. One measured unprofiled trial per implementation after initial exploratory runs, 400 samples per endpoint. This is directional evidence, not a universal hardware promise.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Gateway /api/runtime-health P50 | 0.668 ms | 0.527 ms |
| Gateway /api/runtime-health P99 | 1.316 ms | 1.147 ms |
| Direct Node /api/runtime-health P50 | 0.570 ms | 0.354 ms |
| Gateway /api/terminals P50 | 1.284 ms | 1.318 ms |
| Gateway /api/terminals P99 | 5.141 ms | 4.964 ms |
| Rust PTY list direct P50 | 0.123 ms | 0.123 ms |

Baseline gateway host ready 771 ms; runtime ready 1940 ms; first Pi state 310 ms. The idle fixture after workload includes three Node processes (~766 MiB summed private bytes) and two Rust processes (~4.8 MiB), plus console hosts. These are process-tree snapshots, not installed desktop totals. The 3-second sample is insufficient to establish steady-state CPU or memory growth.

Installed ea27731 UI: first contentful paint 112 ms from navigation; terminal ready 513 ms; Enter-to-visible-output P50 48.2 ms, P95 71.1 ms, maximum 76.3 ms (30 commands). WebView2 and shell execution/rendering dominate this measurement; it is not pure transport latency. The candidate has not yet been installed for UI comparison.

Node CPU profile's largest sampled non-idle self-time entries: writeLatin1String 249 ms, DOMException 190 ms, compileSourceTextModule 168 ms, writev 135 ms, open 127 ms, GC 122 ms. WPR CPU trace captured successfully. WPA is not installed on the baseline machine; ETW stack attribution remains pending.

## Optimization order

1. Reduce process lifetime/memory: on-demand Pi and eventual single native host, guided by the measured process tree. Requires phase-2/3 parity; no engine rewrite.
2. Remove redundant RPC/HTTP work: public health now reuses the same authenticated backend identity response rather than requesting it twice. No stale cache or write replay. Ordinary terminal forwarding still performs identity checks; do not remove them without a protocol guarantee.
3. Bounded terminal history: avoid shifting 256 KiB on each append. Criterion compares the production ring against the original String algorithm, including JSON snapshot cost. Rust tests cover exact retained UTF-8 suffix and legacy archive format. Snapshot serialization can be slower; prioritize the repeated append path and remeasure persistence under large output.
4. Frontend incremental state and job events rather than full history refresh/polling. Next baseline should include long transcripts, jobs and 72-hour soak; no artificial benchmark-only behavior.

Criterion (30 samples, 1 s warm-up, 2 s measurement): old 1.787 microseconds per 144-byte append, production ring 5.109 ns; this is a saturated in-cache append microbenchmark, not an end-to-end speedup. Full 256 KiB JSON snapshot rises from 61.669 to 70.975 microseconds. Both UTF-8/legacy archive unit tests and seven packaged terminal integration tests plus the gateway HTTP integration test passed.
