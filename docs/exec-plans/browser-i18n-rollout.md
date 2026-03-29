# Browser i18n rollout (English + Korean)

## Mission
Ship bilingual browser-facing UI support for English and Korean across:
- the public homepage
- studio
- the browser-facing local API landing/info page

The goal is a lightweight, maintainable browser i18n system with English fallback, without changing runtime behavior except for locale selection and translated browser-visible copy.

## Global non-negotiables
- Add a lightweight i18n layer.
- Do not introduce a heavy i18n framework.
- Keep runtime behavior unchanged except for locale selection and translated browser copy.
- Keep code identifiers, endpoint names, schema keys, route paths, JSON keys, CLI command names, test IDs, and internal variable names in English unless a display wrapper is clearly safer.
- Translate browser-visible text only:
  - titles
  - headings
  - labels
  - buttons
  - badges
  - helper text
  - empty states
  - aria labels
  - status text
  - notices
  - summaries
  - server-rendered browser copy
- Support both English and Korean.
- Missing keys must safely fall back to English.
- The selected locale must persist across reloads and, where practical, across homepage, studio, and `/api`.
- Prefer one obvious place to continue adding strings later.
- Keep the legacy viewer intact unless a touched phase directly includes its browser-visible text.
- Do not widen scope into a framework migration.

## Working method
For each phase:
1. Read the relevant files and nearby helpers.
2. Use repo search to find related browser-visible strings before editing.
3. Implement the smallest coherent slice for that phase.
4. Run the smallest safe verification for touched areas.
5. Update `tmp/codex/browser-i18n-status.md`.
6. Repair failures before continuing.

## Branch
Recommended branch:
- `feat/browser-i18n-en-ko`

## Terminology conventions
Use consistent terminology in both locales.

Preferred product/UI terms:
- Start / 시작
- Model / 모델
- Drawing / 도면
- Preview / 미리보기
- Tracked run / 추적 실행
- Review / 검토
- Artifacts / 산출물
- Jobs / 작업

Preferred operational status terms:
- queued / 대기 중
- running / 실행 중
- succeeded / 성공
- failed / 실패
- cancelled / 취소됨
- unavailable / 사용할 수 없음
- loading / 불러오는 중
- ready / 준비됨

Use natural Korean suitable for an engineering tool, not literal awkward translation.

If a technical identifier such as an id, route, or schema key must remain English, keep it unchanged and localize only the surrounding visible copy.

## Locale architecture requirements
Implement a small shared locale layer.

Preferred structure:
- `public/js/i18n/en.js`
- `public/js/i18n/ko.js`
- `public/js/i18n/index.js`

The helper may include:
- locale resolution
- key lookup
- simple interpolation
- English fallback

Preferred locale resolution:
1. explicit saved user choice
2. otherwise browser language
3. otherwise English

Preferred persistence bridge:
- canonical shared mechanism: cookie `ui_locale`
- allowed values: `en`, `ko`
- browser reads and writes the cookie
- server-rendered `/api` reads the same cookie
- optional localStorage mirror is allowed only if helpful, but the cookie is the source of truth

## Phase 0 — Bootstrap / discovery

### Objective
Map the browser-visible surfaces and propose the smallest viable i18n architecture before major edits.

### Before changing code
Inspect:
- `public/index.html`
- `public/studio.html`
- `public/js/studio-shell.js`
- `public/js/studio/**/*.js`
- any scripts imported by `public/index.html` and `public/studio.html`
- `src/server/local-api-server.js`
- tests touching homepage, studio state, or local API server

Also use repo search to find:
- browser-visible English strings
- any existing locale utilities
- browser entry points under `public/`
- server-rendered browser-facing HTML/plain-text responses

### Deliverables for this phase
Document in `tmp/codex/browser-i18n-status.md`:
1. browser entry points and where visible English is concentrated,
2. the smallest safe locale module layout for English and Korean,
3. the best locale source-of-truth and persistence strategy across client-rendered and server-rendered browser surfaces,
4. first edit wave, second edit wave, and risk areas,
5. the smallest relevant tests/sanity checks to run later.

### Constraints
Do not perform broad refactors in this phase.

## Phase 1 — i18n foundation + locale selection + shared chrome

### Objective
Establish the bilingual i18n foundation and shared locale controls for browser-facing surfaces.

### Requirements
- Add a lightweight shared locale layer for browser copy.
- Prefer:
  - `public/js/i18n/en.js`
  - `public/js/i18n/ko.js`
  - `public/js/i18n/index.js`
- Use English as the fallback locale.
- Add locale resolution with the smallest safe persistence strategy:
  - saved user choice first
  - otherwise browser language
  - otherwise English
- Use the minimal shared persistence bridge that can also be read by the server-rendered `/api` page.
- Add a visible language selector or toggle to the appropriate shared browser UI surfaces.
- The selector should make English and Korean clearly selectable and should not feel hidden.
- Translate the most global/shared copy first:
  - page title(s)
  - app/studio labels
  - shell/sidebar labels and summaries
  - top-bar badges
  - shared toolbar buttons
  - jobs center / log drawer titles if owned by shell-level code
  - common actions such as open, close, refresh, dismiss
  - shared status words such as loading, ready, unavailable, queued, running, succeeded, failed, cancelled
  - browser-visible accessibility labels
- Update `public/studio.html` and any shared homepage/studio shell code required for this foundation.
- Keep document structure and accessibility behavior intact.
- Do not translate deep workspace body copy yet unless required for the shared mechanism.

### Acceptance
- English and Korean are both supported by a shared locale system.
- The selected locale can be changed from the browser UI and persists across reloads on touched client-rendered surfaces.
- Shared shell/chrome copy now comes from the locale layer with English fallback.
- No behavior change beyond locale selection and localized copy.

### Tests
- Run the smallest safe checks for touched shell/state/localization files.
- Add or update lightweight tests only if needed for locale helper behavior.

### Phase summary must include
- new locale files/modules,
- locale persistence decision,
- shared shell/chrome surfaces now bilingual,
- what remains for homepage body copy and workspace-specific phases.

## Phase 2 — Homepage + Start / Model / Drawing bilingual rollout

### Objective
Move the public homepage and the Start / Model / Drawing surfaces onto the bilingual locale system.

### Before editing
- Inspect `public/index.html` and the actual scripts/components it loads.
- Do not assume homepage copy lives only in static HTML.
- Use repo search to find browser-visible English strings used by the homepage entry path.

### Requirements
Move browser-visible strings in the homepage entry path and these studio areas into the shared locale layer where practical:
- homepage entry HTML and its referenced scripts/components
- `public/js/studio/workspaces.js`
- `public/js/studio/model-workspace.js`
- `public/js/studio/drawing-workspace.js`
- any helper used only by those surfaces

Translate browser-visible copy for both English and Korean:
- hero/title/subtitle copy
- CTA labels
- feature cards
- helper text
- empty states
- headings and descriptions
- validation/build/drawing status summaries
- drawing preview copy
- tracked run labels
- start launchpad cards and explanatory text

Keep technical values unchanged where appropriate:
- route names
- ids
- JSON field names
- code constants
- API identifiers

If an id or route must remain English, keep the identifier but wrap surrounding user-facing copy naturally in each locale.

Preserve existing tracked-run and path-redaction behavior.

### Acceptance
- The homepage plus Start, Model, and Drawing surfaces switch cleanly between English and Korean.
- The copy feels coherent and professional in both locales.
- No behavior regressions were introduced.

### Tests
- Run the smallest relevant safe checks for homepage/start/model/drawing.
- Keep existing start/model/drawing tests passing.

### Phase summary must include
- which homepage and workspace files were translated,
- terminology decisions standardized,
- any strings intentionally left in English and why.

## Phase 3 — Review / Artifacts / Jobs center / notices / log drawer bilingual rollout

### Objective
Translate the operational studio surfaces into the shared bilingual system.

### Requirements
Move browser-visible strings in these areas into the shared locale layer where practical:
- `public/js/studio/review-workspace.js`
- `public/js/studio/artifacts-workspace.js`
- `public/js/studio/jobs-center.js`
- `public/js/studio/artifact-insights.js`
- relevant user-visible shell/job-monitor/completion/log-notice copy in `public/js/studio-shell.js`

Translate browser-visible copy for both English and Korean:
- review card labels
- review empty states
- artifact detail labels
- open/download/re-entry button labels
- jobs center headings and action labels
- queue controls
- completion notice titles/messages/buttons
- log drawer titles and any browser-facing log/help copy the user actually reads
