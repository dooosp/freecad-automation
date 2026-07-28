# Manufacturing Robotics demo screenshot capture list

- Capture state: `PENDING_P0_CAPTURE`
- Actual browser screenshots in this directory: `0`
- Human participant screenshots: prohibited

Only screenshots captured from the exact frozen P0 candidate may be added.
Do not create mockups, synthetic browser composites, or screenshots from a dirty
development worktree and present them as product evidence.

## Required capture set

| Proposed filename | Locale | View/state | Required visible evidence | State |
| --- | --- | --- | --- | --- |
| `01-en-prerun.png` | EN | pre-run card | approved profile, expected outputs, local/offline and fixed trust statements | `PENDING_P0_CAPTURE` |
| `02-ko-prerun.png` | KO | pre-run card | equivalent Korean meaning and one primary action | `PENDING_P0_CAPTURE` |
| `03-en-success-timeline.png` | EN | successful action 6 | ten actions plus CAD feature, quality and joint links | `PENDING_P0_CAPTURE` |
| `04-ko-handoff.png` | KO | handoff | Design / Manufacturing / Quality / Trust sections | `PENDING_P0_CAPTURE` |
| `05-en-trust-lerobot-gap.png` | EN | trust/gap | `NOT_EXPORTABLE_YET`, compatible false, training-ready false, format and vision distinctions | `PENDING_P0_CAPTURE` |
| `06-ko-blocked-mismatch.png` | KO | bounded failure | `BLOCKED`, stable reason, Revision A/B, `0 / 8`, safe next action | `PENDING_P0_CAPTURE` |

## Capture protocol

1. Freeze and fingerprint a clean detached candidate as defined by the
   [UAT session kit](../human-uat-session-kit.md).
2. Run P0 with a new isolated job store and browser profile.
3. Capture actual Review states at the intended 1440 px portfolio viewport;
   separately verify 320/768/1024 widths, 200% zoom, keyboard, and reduced motion.
4. Crop only browser chrome that adds no evidence. Do not alter product text,
   statuses, counts, colors, or artifact content.
5. Redact or recapture any job ID, absolute path, username, terminal, token,
   private bookmark, notification, participant information, or unrelated tab.
6. Record candidate commit/tree/fingerprint and capture checks in private P0
   evidence. Do not put private paths or machine identity in image metadata.
7. Confirm every screenshot still matches the frozen candidate before adding it.

The six filenames are a capture plan, not evidence that P0 passed. Until actual
files are present and reviewed, README status remains `PENDING_P0_CAPTURE` and
the portfolio must not claim screenshot completion.
