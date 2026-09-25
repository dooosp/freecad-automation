# Reproduction source

The complete application source is commit [ed317324c9f5ee4152a8d0ad6d6bebdbfb620e88](https://github.com/dooosp/freecad-automation/commit/ed317324c9f5ee4152a8d0ad6d6bebdbfb620e88), proposed in [the pull request](https://github.com/dooosp/freecad-automation/pull/203). Review or check out this commit before reproducing; this ZIP contains a source subset, not the full application.

From the complete repository, install dependencies and run:

```bash
npm ci
npm run check:runtime
node docs/portfolio/usb-hub-plate-change/reproduce.mjs
```

The optional engineering review command and its assumptions are in the case documentation. The source subtree in this bundle is byte-identical to the committed case files. The retained `portfolio-software-fixes.patch` is the previously verified product-code-only patch against base `4dba0d32fe1b10f2266f27501165e56df9f943af`; do not apply it to the already-fixed commit. Runtime-generated results remain in ignored output directories in the source repository. This static publication does not run a FreeCAD server.
