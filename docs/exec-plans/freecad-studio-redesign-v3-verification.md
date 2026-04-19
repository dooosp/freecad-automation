# freecad-studio-redesign-v3 verification

## Verification scope
- Confirm the five Studio surfaces share one visual system and preserve existing functional hooks.
- Confirm the browser shell still boots, routes switch correctly, and runtime/local API status badges still render.

## Required evidence
1. Static validation
   - run the smallest sufficient automated command set discovered from `package.json`
2. Browser validation
   - start the local app with the documented serve command
   - open Console, Review, Package, Model, and Drawing
   - capture screenshots after implementation
3. Skeptical review
   - capture `git diff --name-only` before review
   - perform read-only inspection only
   - capture `git diff --name-only` after review and confirm no change

## Failure handling
- If automated checks fail, record whether the failure is pre-existing or introduced by this task before repairing.
- If browser automation is blocked, record the tool limitation and the exact fallback used.
