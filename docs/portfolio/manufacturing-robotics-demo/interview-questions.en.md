# Manufacturing Robotics Studio demo — interview questions

Every answer is bounded to repository evidence. Human UAT and bilingual meaning
review are `NOT_RUN`; LeRobot compatibility and training readiness are `false`.

## 1. What problem did this project solve?

A CLI producing eight correct files did not make the result understandable to
a non-developer. I preserved the existing generator and exposed a Review journey
that explains ten actions, CAD/robot/quality links, role handoffs, and limits.

## 2. Why did you avoid a new Studio workspace?

The dataset explanation follows CAD review, so it belongs in the existing Review
workspace. Reusing that route preserves the user mental model and limits
regression scope; the task did not need a new top-level domain surface.

## 3. Why can the browser not select arbitrary files?

Paths, revisions, hashes, and inline task JSON would weaken reproducibility and
the security boundary. A server-owned profile pins five approved inputs by path,
size, and SHA-256. The request exposes only the profile and one bounded mismatch
enum.

## 4. Why not generate the data in the UI?

Duplicating generation would let CLI and Studio contracts drift. Studio submits
a tracked job; the existing service remains the only generator and validator.
The UI interprets registered output but does not compute canonical artifacts.

## 5. Why is the exact-eight contract important?

Six domain files and two manifests form one review unit. Partial publication
could look complete, so the existing atomic contract is preserved. The revision
mismatch registers zero of eight successful artifacts.

## 6. What does `VALID SYNTHETIC DEMO` mean?

It means schema, references, bilingual coverage, timeline, lineage, and fixed
boundaries pass inside this synthetic contract. It does not mean robot execution,
sensor measurement, physical inspection, process safety, production readiness,
or release approval.

## 7. Why not automatically update to Revision B?

If the authoritative design is A and only the review is B, software cannot
silently decide which one is right. The safe behavior is a stable mismatch code,
expected/received identities, zero output, and regeneration from authoritative A.

## 8. Why is this not a LeRobot Dataset v3 export?

The output is semantic JSON. A v3 claim would require frame-level Parquet,
indices/timestamps/FPS, feature and episode metadata, statistics, numeric state
and action vectors, writer finalization, and validation with the pinned loader.
Those are absent, so compatibility and training readiness remain false.

## 9. Is missing MP4 the universal compatibility blocker?

No. Camera observations are a vision-modality gap for this inspection scenario,
not a universal v3 requirement. The general blockers here are frame tables,
index/time/FPS, metadata, statistics, numeric state/action, and loader validation.

## 10. How do automated tests differ from human UAT?

Automation verifies contracts, aggregation math, locale/accessibility structure,
and fail-closed behavior. Only P1–P5 measure human understanding. Synthetic
records require an explicit test-only switch and can only produce `TEST_ONLY`
with human UAT still `NOT_RUN`.

## 11. What are the human acceptance thresholds?

At least four of five must independently reach the summary and explain the four
core concepts. Fixed next-action predictions require at least 32 of 40 correct.
The completed-path median must be no more than four primary actions and depends
on MR-UAT-01 passing. Material Korean/English meaning errors must be exactly zero.

## 12. How do you protect privacy and prevent denominator manipulation?

Raw records stay in an owner-only directory outside the repository. The closed
schema permits no names or free-form notes. The public aggregate contains counts,
never participant rows, locale mappings, or raw paths. Missing or invalid
attempts are replaced under the same anonymous label; the five-person and
forty-prediction denominators never shrink.

## 13. What engineering judgment are you most proud of?

I prioritized evidence integrity over a larger feature claim: reused the service,
closed browser inputs, retained atomic zero-on-failure behavior, and compared the
output with an immutable official standard source to prevent false compatibility.

## 14. What comes next?

Freeze one candidate, run P0, obtain human Korean/English meaning review, then
run P1–P5 and make only observation-backed changes. A LeRobot adapter should be
a separate goal after real or explicitly synthetic sampled numeric data and
pinned writer/loader validation exist.
