# Example Classification

This directory contains both review fixtures and legacy generation demos.

## Review-First Fixtures

Prefer these when orienting to the current product story:

- `ks_bracket.toml`
- `ks_flange.toml`
- `ks_shaft.toml`
- `ks_gear_housing.toml`
- `ks_assembly.toml`
- `import_test.toml`
- `seatbelt_retractor.toml`
- `seatbelt_retractor.reviewed.toml`

These are the best starting points for:

- `fcad inspect`
- `fcad dfm`
- `fcad review`
- targeted `draw`, `tolerance`, and `report`

## Legacy / Compatibility Demos

These remain useful, but they are not the main front door for new contributors:

- `belt_drive.toml`
- `cam_follower.toml`
- `excavator.toml`
- `four_bar_linkage.toml`
- `piston_engine.toml`
- `ptu*.toml`
- `robot_arm_6axis.toml`

Treat them as compatibility coverage for the older generation-first and kinematics-heavy story.
