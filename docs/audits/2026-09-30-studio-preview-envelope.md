# Saved-model preview envelope — 2026-09-30

The saved-preview service retained a full CAD buffer for every admitted active or queued conversion. Streaming source fingerprints and creating a verified disk snapshot only after admission removed that retention in the bounded probe. It reduced sampled Node memory but increased synthetic byte-volume latency. It does not establish a global memory limit or a production large-model guarantee.

Exact samples, Node/OS versions, fixture sizes, and implementation hashes are in the [measurement record](2026-09-30-studio-preview-envelope-measurements.json). Baseline service code is commit `c19398ca9fc70492472dcd982aea22f75cbfff84`. These are local agent-operated probes, not human UAT or manufacturing validation.

## Reproduce

```sh
# Synthetic service I/O, cache, queue, failure, and real HTTP cancellation probes.
node scripts/studio-preview-benchmark.js --out tmp/codex/preview-envelope.json

# Also generate real STEP geometry and convert 1, 64, and 256 solids with FreeCAD.
node scripts/studio-preview-benchmark.js --native-scale --out tmp/codex/preview-envelope-native.json

# Optionally inspect an existing repo-owned STEP/BREP through the same service.
node scripts/studio-preview-benchmark.js --runtime-input output/example.step --out tmp/codex/preview-envelope-input.json
```

The default is synthetic-only and does not invoke FreeCAD. Each byte-volume scenario runs in a fresh Node child with explicit garbage collection before and after measurement. Source files are written using 64 KiB chunks. Inputs are 0.5, 5, and 20 MiB; each size performs ten uncached/cache-hit pairs, totaling 60 sequential requests and 30 conversions. Synthetic `.step` bytes are repeated ASCII and the converter is injected; their timings describe service I/O, not geometry processing. Cache misses use distinct artifact IDs; hits use the immediately preceding ID. No concurrent unbounded request generator is used.

Memory values are the benchmark Node process's RSS, heap, external memory, and ArrayBuffers. They exclude the parent harness, browser, GPU, and FreeCAD child. Sampling is every 5 ms plus explicit phase boundaries, so reported peaks may miss shorter spikes. OS file caches were not cleared, and unrelated OS/application activity was not controlled. Explicit GC clarifies buffer retention; retained RSS can remain elevated because of the allocator and is not proof of a leak.

Each ordinary worker has a 45-second deadline. The native scale worker has a 240-second deadline, with a 20-second timeout per native invocation; fixtures total at most 64 MiB. A failed probe fails the command. Generated fixture directories are removed on normal completion and handled errors. A forcibly terminated process can leave an ignored temporary directory for inspection.

## Byte-volume comparison

Milliseconds; ten samples per miss/hit column. With ten samples, nearest-rank p95 is the maximum and is not a stable production tail estimate.

| Source | Baseline miss median / p95 | Streamed miss median / p95 | Baseline hit median / p95 | Streamed hit median / p95 |
| --- | ---: | ---: | ---: | ---: |
| 0.5 MiB | 1.502 / 3.976 | 2.265 / 8.869 | 0.371 / 0.443 | 0.417 / 0.577 |
| 5 MiB | 10.086 / 14.065 | 16.433 / 21.737 | 3.162 / 4.936 | 3.920 / 4.095 |
| 20 MiB | 39.476 / 55.029 | 60.103 / 64.500 | 11.415 / 13.293 | 15.191 / 15.964 |

| Source | Baseline Node RSS before / after / sampled peak, MiB | Streamed Node RSS before / after / sampled peak, MiB | Baseline / streamed sampled ArrayBuffer peak, MiB |
| --- | ---: | ---: | ---: |
| 0.5 MiB | 50.69 / 66.56 / 66.56 | 50.23 / 66.47 / 66.47 | 15.05 / 11.28 |
| 5 MiB | 50.44 / 126.53 / 126.53 | 50.67 / 79.00 / 79.00 | 70.06 / 21.96 |
| 20 MiB | 52.03 / 172.91 / 172.91 | 51.97 / 127.31 / 127.31 | 100.06 / 60.58 |

The extra streamed snapshot verification adds an I/O pass for uncached conversions. Both cache paths still fingerprint current source content on each request. The measured benefit is avoiding full-file buffers retained by active/queued CAD requests; there is no speedup claim. Raw samples include a separate post-change repeat made alongside native probes.

## Queue, failure, and cancellation

The memory probe uses a deliberate smaller envelope of one active and two queued distinct conversions with a 20 MiB source. A fourth distinct request receives 503; a duplicate of an admitted queued request shares that work. The first converter intentionally throws, both queued requests proceed, and the failed source can retry. Peak active conversion count remains one; four native-runner invocations serve six requests including the duplicate and retry. These invocations are synthetic.

| Held state after explicit GC | Baseline ArrayBuffers | Streamed ArrayBuffers |
| --- | ---: | ---: |
| One active conversion | 20.02 MiB | 0.02 MiB |
| One active and two queued conversions | 60.02 MiB | 0.02 MiB |
| Entire probe sampled Node RSS peak | 192.38 MiB | 87.67 MiB |

After gate release, the measured queue drain was 66.691 ms before and 90.822 ms after; it excludes the intentionally held wait and is not a user queue-latency prediction. The existing default two-active/eight-queued saturation behavior remains covered by the focused test suite.

The cancellation probe starts an actual loopback HTTP server with an injected converter and 0.5 MiB synthetic sources. One cancelled client receives `AbortError` while its peer receives HTTP 200 from the shared conversion. Cancelling every client retains the occupied conversion slot; another source receives HTTP 503 until work is released. The completed shared result remains available. Two conversions serve seven recorded HTTP request outcomes. Abort completion after the explicit abort call took 1.672 ms before and 1.631 ms after in these single observations; no cancellation latency distribution is claimed.

## Real FreeCAD geometry sweep

FreeCAD 1.1.4 generated disjoint 8 × 6 × 4 mm boxes on a regular grid. All three STEP files together were 1,912,403 bytes, well below the 64 MiB benchmark bound. Each file received three sequential uncached conversions and three cache hits; all returned complete binary STL. Source hashes were checked before and after every size's probe. Geometry is reproducible; STEP metadata such as timestamps can change file hashes between runs.

| Solids / faces | STEP bytes | STL triangles / bytes | Uncached milliseconds, all three samples | Hit median, ms | Node RSS before / after / sampled peak, MiB |
| --- | ---: | ---: | --- | ---: | ---: |
| 1 / 6 | 6,841 | 12 / 684 | 208.369, 202.201, 202.866 | 0.166 | 50.97 / 52.34 / 52.34 |
| 64 / 384 | 367,516 | 768 / 38,484 | 322.317, 321.150, 386.275 | 0.403 | 52.42 / 58.53 / 58.53 |
| 256 / 1,536 | 1,538,046 | 3,072 / 153,684 | 664.601, 654.327, 663.860 | 1.174 | 58.72 / 69.00 / 69.00 |

The scale sweep uses one child process and a fresh service per size; allocator history therefore carries forward in its RSS baseline. These simple solids do not represent large curved assemblies, tiny features, invalid topology, or difficult STEP parser cases. Three samples are insufficient for a useful tail percentile.

An additional saved `quality_pass_bracket` STEP from the repository's prior runtime-smoke outputs was 32,571 bytes and produced 3,076 STL triangles / 153,884 bytes. Three actual uncached conversions took 424.866, 225.936, and 235.653 ms; the hit median was 0.220 ms. Node RSS went from 50.84 to 53.25 MiB with sampled peak 53.25 MiB. Its original SHA-256 remained unchanged. This is a separate existing curved-hole input, not a before/after native speed comparison.

## Change and regression evidence

Only the preview service's CAD source I/O changed. Every request still fingerprints the current source, cache keys still include job/artifact/SHA-256, and duplicate in-flight conversions still coalesce. After slot admission the service streams a private snapshot and compares its hash to the requested hash before native conversion. A source changed while queued or during snapshot copying is rejected with the existing 409 changed-source error. A final streamed source check detects changes during conversion. Temporary cleanup, cache limits, queue limits, authority checks, and raw STL behavior remain in place.

Two regressions failed before implementation: active-plus-queued 16 MiB fixtures retained exactly 33,554,432 source-buffer bytes, and a queued changed source still launched a native converter before rejection. Both pass after the change. The isolated memory regression asserts held ArrayBuffers remain below one source-file size, with ample margin for stream buffers; it does not assert an environment-sensitive RSS threshold.

`node --test tests/artifact-model-preview-cache.test.js tests/artifact-model-preview-limits.test.js tests/artifact-model-preview-api.test.js` passed all nine tests, covering same-size source mutation, conversion-time mutation, queued mutation before conversion, retry, cache/duplicate behavior, default saturation, shutdown, source preservation, unsupported/private artifacts, hostile Origin, deleted artifacts, cross-job symlinks, and one/all-client cancellation. Benchmark assertions, JS syntax, Python AST parsing, and `git diff --check` passed. The combined repository suite is verified by the owning task; this report does not substitute for that outcome.

Independent review subsequently found that the benchmark's original lexical output-path check could follow a symlink and overwrite its input or escape the repository. The benchmark now canonicalizes existing paths and missing-path parents before starting, rejects input/output same-file aliases, and revalidates destination and directory identity before saving through a private temporary file and atomic rename. Seven path-preservation regressions and a complete synthetic CLI rerun passed; six unsafe-path tests failed before the repair. This changes benchmark path handling only. The measurement record preserves the historical `benchmark_sha256` and samples, with the later harness fingerprint stored separately under `post_measurement_hardening`; the measured service hash is unchanged.

## Limits and next decision

This is a measured local envelope, not a newly imposed source-size or supported-model limit. Native conversion concurrency remains two with eight queued requests; completed mesh cache remains six entries of at most 32 MiB each. Hashing requests are not separately concurrency-limited. Source file size, native process memory, temporary disk usage, returned STL buffers, and aggregate service memory are not capped by this change. Direct saved-STL reads retain their existing whole-buffer behavior and output-size validation.

NOT MEASURED: browser time-to-first-frame, browser/GPU memory, FreeCAD process or combined-process RSS, true OS-cache-cold startup, representative large curved/assembly models, longer than this short repeated-request exercise, multi-user deployment, Windows/Linux runtime behavior, crash recovery during an active native process, and production latency objectives. No physical/manufacturing-readiness claim is made.

Before declaring production large-model support, measure representative real assemblies through the browser with combined-process memory and first-frame timing. Use those measurements to choose any further resource or source-size policy; do not derive one from synthetic 20 MiB byte files or this 256-box sweep alone.
