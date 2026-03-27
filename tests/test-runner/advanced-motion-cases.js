import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse as parseTOML } from 'smol-toml';
import {
  ROOT,
  OUTPUT_DIR,
  loadConfig,
  loadExampleConfig,
  normalizeConfig,
  normalizeGeneratedPath,
  runJsonCommand,
  runScript,
  withOutputDirectory,
  describeFreeCADRuntime,
  hasFreeCADRuntime,
} from './shared.js';

export function createAdvancedMotionCases(assert) {
async function testMotionKeyframes() {
  console.log('\n--- Test: Motion keyframe generation ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_motion.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'PTU motion build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present in result');
  assert(result.motion_data.duration === 2.0, `Duration is 2.0s (got ${result.motion_data?.duration})`);
  assert(result.motion_data.loop === true, 'Loop is true');
  assert(result.motion_data.parts !== undefined, 'Parts dict present');

  // Shaft should have keyframes
  const shaft = result.motion_data.parts.input_shaft;
  assert(shaft !== undefined, 'input_shaft motion present');
  assert(shaft.type === 'revolute', `Shaft type is revolute (got ${shaft?.type})`);
  assert(shaft.keyframes.length === 61, `Shaft has 61 keyframes (60 steps + 1) (got ${shaft?.keyframes?.length})`);
  assert(shaft.keyframes[0].angle === 0, 'Shaft starts at 0°');
  assert(shaft.keyframes[shaft.keyframes.length - 1].angle === 360, 'Shaft ends at 360°');

  // Gear should have coupled keyframes
  const gear = result.motion_data.parts.drive_gear;
  assert(gear !== undefined, 'drive_gear motion present');
  assert(gear.type === 'revolute', `Gear type is revolute (got ${gear?.type})`);

  return result;
}

async function testGearRatio() {
  console.log('\n--- Test: Gear ratio coupling ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_motion.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const shaft = result.motion_data.parts.input_shaft;
  const gear = result.motion_data.parts.drive_gear;

  // At final keyframe: shaft=360, gear should be 360*(-0.8333) ≈ -300
  const lastShaft = shaft.keyframes[shaft.keyframes.length - 1].angle;
  const lastGear = gear.keyframes[gear.keyframes.length - 1].angle;
  const expectedGear = lastShaft * -0.8333;

  assert(Math.abs(lastGear - expectedGear) < 0.1,
    `Gear end angle ~${expectedGear.toFixed(1)} (got ${lastGear})`);
  // Gear rotates opposite direction (negative)
  assert(lastGear < 0, `Gear rotates in negative direction (${lastGear})`);
}

async function testMotionBackwardCompat() {
  console.log('\n--- Test: Motion backward compat (no motion config) ---');

  // Use existing bracket.toml which has no motion
  const config = await loadConfig(resolve(ROOT, 'configs/examples/ks_bracket.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Bracket build still succeeds');
  assert(result.motion_data === undefined, 'No motion_data for non-motion config');
}

async function testMotionMatesAssembly() {
  console.log('\n--- Test: Mates assembly without motion still works ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/ptu_assembly_mates.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'PTU mates assembly still succeeds');
  assert(result.motion_data === undefined, 'No motion_data when no joints/motion defined');
}

// ---------------------------------------------------------------------------
// Phase 8 Tests: Extended Parts Library
// ---------------------------------------------------------------------------

async function testHelicalGear() {
  console.log('\n--- Test: Helical gear (library part) ---');

  const config = {
    name: 'test_helical_gear',
    shapes: [{
      id: 'gear',
      type: 'library/helical_gear',
      module: 3,
      teeth: 16,
      width: 12,
      bore_d: 10,
      helix_angle: 15,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 180_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Helical gear creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testDiscCam() {
  console.log('\n--- Test: Disc cam (library part) ---');

  const config = {
    name: 'test_disc_cam',
    shapes: [{
      id: 'cam',
      type: 'library/disc_cam',
      base_radius: 20,
      max_lift: 10,
      width: 15,
      bore_d: 8,
      profile_type: 'harmonic',
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Disc cam creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testPulley() {
  console.log('\n--- Test: Pulley (library part) ---');

  const config = {
    name: 'test_pulley',
    shapes: [{
      id: 'pulley',
      type: 'library/pulley',
      pitch_d: 60,
      width: 20,
      groove_angle: 38,
      groove_depth: 5,
      bore_d: 12,
      num_grooves: 2,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Pulley creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

async function testCoilSpring() {
  console.log('\n--- Test: Coil spring (library part) ---');

  const config = {
    name: 'test_coil_spring',
    shapes: [{
      id: 'spring',
      type: 'library/coil_spring',
      wire_d: 2,
      coil_d: 20,
      pitch: 8,
      num_coils: 5,
    }],
    operations: [],
    export: { formats: ['brep'], directory: resolve(OUTPUT_DIR) },
  };

  const result = await runScript('create_model.py', config, {
    timeout: 120_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Coil spring creation succeeded');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);
}

// ---------------------------------------------------------------------------
// Phase 8 Tests: Extended Kinematics
// ---------------------------------------------------------------------------

async function testBeltDrive() {
  console.log('\n--- Test: Belt drive assembly ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/belt_drive.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Belt drive build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');
  assert(result.motion_data.parts.motor_pulley !== undefined, 'Motor pulley in motion');
  assert(result.motion_data.parts.driven_pulley !== undefined, 'Driven pulley in motion');

  // Belt ratio: motor 720° → driven 360° (ratio 0.5)
  const motor = result.motion_data.parts.motor_pulley;
  const driven = result.motion_data.parts.driven_pulley;
  const lastMotor = motor.keyframes[motor.keyframes.length - 1].angle;
  const lastDriven = driven.keyframes[driven.keyframes.length - 1].angle;
  assert(Math.abs(lastDriven - lastMotor * 0.5) < 0.1,
    `Belt ratio correct: motor ${lastMotor}° → driven ${lastDriven}°`);

  // ── Physics: constant ratio at every keyframe ──
  let maxRatioErr = 0;
  for (let i = 1; i < motor.keyframes.length; i++) {
    const r = driven.keyframes[i].angle / motor.keyframes[i].angle;
    maxRatioErr = Math.max(maxRatioErr, Math.abs(r - 0.5));
  }
  assert(maxRatioErr < 0.001, `Belt ratio constant all frames (max err ${maxRatioErr.toFixed(6)})`);

  // ── Physics: same direction (positive belt, not gear reversal) ──
  assert(lastMotor > 0 && lastDriven > 0, 'Belt: same rotation direction');
}

async function testCamFollower() {
  console.log('\n--- Test: Cam-follower mechanism ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/cam_follower.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Cam follower build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');

  const cam = result.motion_data.parts.cam;
  assert(cam !== undefined, 'Cam part in motion');
  assert(cam.type === 'revolute', 'Cam is revolute');

  const follower = result.motion_data.parts.follower;
  assert(follower !== undefined, 'Follower part in motion');
  assert(follower.type === 'prismatic', `Follower is prismatic (got ${follower?.type})`);

  // At half rotation (180°), harmonic cam should be at max lift (10mm)
  const midIdx = Math.floor(follower.keyframes.length / 2);
  const midDisp = follower.keyframes[midIdx].displacement;
  assert(Math.abs(midDisp - 10) < 0.5, `Follower at 180° near max lift 10mm (got ${midDisp})`);

  // At 0° and 360°, displacement should be near 0
  assert(Math.abs(follower.keyframes[0].displacement) < 0.1, 'Follower at 0° near zero');

  // ── Physics: harmonic profile d(θ) = (max_lift/2)(1-cos(πφ)) ──
  const maxLift = 10;
  const nKf = follower.keyframes.length;
  const step90 = Math.round(90 / 360 * (nKf - 1));
  const step270 = Math.round(270 / 360 * (nKf - 1));
  const d90 = follower.keyframes[step90].displacement;
  const d270 = follower.keyframes[step270].displacement;
  const d360 = follower.keyframes[nKf - 1].displacement;
  assert(Math.abs(d90 - 5) < 0.2, `Harmonic at 90° ≈ 5mm (got ${d90.toFixed(3)})`);
  assert(Math.abs(d270 - 5) < 0.2, `Harmonic at 270° ≈ 5mm (got ${d270.toFixed(3)})`);
  assert(Math.abs(d360) < 0.2, `Follower at 360° returns to ~0 (got ${d360.toFixed(3)})`);
  assert(Math.abs(d90 - d270) < 0.1, `Harmonic symmetry d(90°) ≈ d(270°)`);

  // ── Physics: monotonic rise 0→180° then fall 180→360° ──
  let monotonicRise = true;
  for (let i = 1; i <= midIdx; i++) {
    if (follower.keyframes[i].displacement < follower.keyframes[i - 1].displacement - 0.01) {
      monotonicRise = false; break;
    }
  }
  assert(monotonicRise, 'Monotonic rise 0°→180°');

  let monotonicFall = true;
  for (let i = midIdx + 1; i < nKf; i++) {
    if (follower.keyframes[i].displacement > follower.keyframes[i - 1].displacement + 0.01) {
      monotonicFall = false; break;
    }
  }
  assert(monotonicFall, 'Monotonic fall 180°→360°');
}

async function testFourBarLinkage() {
  console.log('\n--- Test: Four-bar linkage ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/four_bar_linkage.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Four-bar linkage build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');
  assert(result.motion_data.parts.coupler !== undefined, 'Coupler part in motion');
  assert(result.motion_data.parts.rocker !== undefined, 'Rocker part in motion');

  // Coupler is floating (per-keyframe anchor), rocker is revolute
  assert(result.motion_data.parts.coupler.type === 'floating', 'Coupler is floating link');
  assert(result.motion_data.parts.rocker.type === 'revolute', 'Rocker is revolute');

  // Coupler keyframes should have per-keyframe anchor arrays
  const coupler = result.motion_data.parts.coupler;
  assert(Array.isArray(coupler.keyframes[0].anchor), 'Coupler has per-keyframe anchor');

  // Rocker uses delta angles — should start near 0 and oscillate
  const rocker = result.motion_data.parts.rocker;
  assert(Math.abs(rocker.keyframes[0].angle) < 0.1, `Rocker starts near 0° delta (got ${rocker.keyframes[0].angle})`);
  const angles = rocker.keyframes.map(kf => kf.angle);
  const minA = Math.min(...angles);
  const maxA = Math.max(...angles);
  assert(maxA - minA < 180, `Rocker oscillates within <180° range (${minA.toFixed(1)} to ${maxA.toFixed(1)})`);

  // ── Physics: loop closure |BC|=50 at every keyframe ──
  const initRockerDeg = 108.2; // solved initial rocker angle
  let maxClosureErr = 0;
  for (let i = 0; i < coupler.keyframes.length; i++) {
    const B = coupler.keyframes[i].anchor;
    const delta = rocker.keyframes[i].angle;
    const ra = (initRockerDeg + delta) * Math.PI / 180;
    const Cx = 60 + 45 * Math.cos(ra);
    const Cy = 45 * Math.sin(ra);
    const BC = Math.sqrt((Cx - B[0]) ** 2 + (Cy - B[1]) ** 2);
    maxClosureErr = Math.max(maxClosureErr, Math.abs(BC - 50));
  }
  assert(maxClosureErr < 0.5, `Loop closure |BC|=50 all frames (max err ${maxClosureErr.toFixed(4)}mm)`);

  // ── Physics: periodicity — returns to start after 360° ──
  const couplerEnd = coupler.keyframes[coupler.keyframes.length - 1].angle;
  const rockerEnd = rocker.keyframes[rocker.keyframes.length - 1].angle;
  assert(Math.abs(couplerEnd) < 1.0, `Coupler returns to ~0° at 360° (got ${couplerEnd.toFixed(2)}°)`);
  assert(Math.abs(rockerEnd) < 1.0, `Rocker returns to ~0° at 360° (got ${rockerEnd.toFixed(2)}°)`);
}

async function testPistonEngine() {
  console.log('\n--- Test: Piston engine (crank-slider) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/piston_engine.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Piston engine build succeeded');
  assert(result.motion_data !== undefined, 'motion_data present');

  const piston = result.motion_data.parts.piston;
  assert(piston !== undefined, 'Piston part in motion');
  assert(piston.type === 'prismatic', 'Piston is prismatic');

  // At 0° (TDC), displacement = 0
  assert(Math.abs(piston.keyframes[0].displacement) < 0.01,
    `Piston at TDC near 0mm (got ${piston.keyframes[0].displacement})`);

  // At 180° (BDC), displacement = -30mm (piston moves toward crank)
  // Find keyframe near 180°
  const crank = result.motion_data.parts.crank_arm;
  const idx180 = crank.keyframes.findIndex(kf => Math.abs(kf.angle - 180) < 4);
  if (idx180 >= 0) {
    const bdc = piston.keyframes[idx180].displacement;
    assert(Math.abs(bdc - (-30)) < 1, `Piston at BDC near -30mm (got ${bdc})`);
  }

  // Connecting rod is floating link (per-keyframe anchor follows crank pin)
  const rod = result.motion_data.parts.con_rod;
  assert(rod !== undefined, 'Connecting rod in motion');
  assert(rod.type === 'floating', 'Con rod is floating link');
  assert(Array.isArray(rod.keyframes[0].anchor), 'Con rod has per-keyframe anchor');

  // ── Physics: pin→piston distance = rod_length at key angles ──
  const crank_r = 15, rod_l = 50;
  const pistonInitX = 85; // TDC position from TOML
  const pistonY = 30;     // piston Y from TOML
  for (const step of [0, idx180, Math.round(90 / 720 * (crank.keyframes.length - 1))]) {
    if (step < 0) continue;
    const pinA = rod.keyframes[step].anchor;
    const px = pistonInitX + piston.keyframes[step].displacement;
    const dist = Math.sqrt((px - pinA[0]) ** 2 + (pistonY - pinA[1]) ** 2);
    const angle = crank.keyframes[step].angle;
    assert(Math.abs(dist - rod_l) < 0.5, `|pin→piston| = ${rod_l}mm at θ=${angle}° (got ${dist.toFixed(2)})`);
  }

  // ── Physics: stroke = 2×crank_r ──
  const allDisp = piston.keyframes.map(kf => kf.displacement);
  const stroke = Math.max(...allDisp) - Math.min(...allDisp);
  assert(Math.abs(stroke - 2 * crank_r) < 1, `Stroke = ${2 * crank_r}mm (got ${stroke.toFixed(2)})`);

  // ── Physics: periodicity — displacement returns to 0 after 360° ──
  const step360 = Math.round(360 / 720 * (crank.keyframes.length - 1));
  const d360 = piston.keyframes[step360].displacement;
  assert(Math.abs(d360) < 0.5, `Piston returns to ~0mm at 360° (got ${d360.toFixed(2)})`);
}

// ---------------------------------------------------------------------------
// Seatbelt Retractor Demo Tests
// ---------------------------------------------------------------------------

async function testRetractorBuild() {
  console.log('\n--- Test: Seatbelt retractor build (7 parts) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Retractor build succeeded');
  assert(result.model.name === 'seatbelt_retractor', 'Model name matches');
  assert(result.model.volume > 0, `Volume is positive (${result.model.volume})`);

  // Verify all 7 parts built
  const stepFile = resolve(OUTPUT_DIR, 'seatbelt_retractor.step');
  assert(existsSync(stepFile), 'STEP file exists');

  return result;
}

async function testReviewedRetractorBuild() {
  console.log('\n--- Test: Reviewed retractor example build ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.reviewed.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.success === true, 'Reviewed retractor build succeeded');
  assert(result.assembly !== undefined, 'Reviewed retractor returns assembly metadata');
  assert(result.model.volume > 0, `Reviewed retractor volume is positive (${result.model.volume})`);
}

async function testRetractorMotionData() {
  console.log('\n--- Test: Retractor motion data structure ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  assert(result.motion_data !== undefined, 'motion_data present');
  assert(result.motion_data.duration === 4.0, 'Duration is 4s');
  assert(result.motion_data.loop === true, 'Loop is true');

  // Spool (driver) should have revolute keyframes
  const spool = result.motion_data.parts.spool;
  assert(spool !== undefined, 'Spool part in motion');
  assert(spool.type === 'revolute', 'Spool is revolute');
  assert(spool.keyframes.length === 121, `Spool has 121 keyframes (got ${spool.keyframes.length})`);

  // Lock cam (gear coupled)
  const cam = result.motion_data.parts.lock_cam;
  assert(cam !== undefined, 'Lock cam part in motion');
  assert(cam.type === 'revolute', 'Lock cam is revolute');

  // Pawl (cam_follower coupled)
  const pawl = result.motion_data.parts.pawl;
  assert(pawl !== undefined, 'Pawl part in motion');
  assert(pawl.type === 'prismatic', `Pawl is prismatic (got ${pawl?.type})`);

  return result;
}

async function testRetractorCamLock() {
  console.log('\n--- Test: Retractor cam lock (dwell zone) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const pawl = result.motion_data.parts.pawl;
  const spool = result.motion_data.parts.spool;
  const nKf = pawl.keyframes.length;

  // Dwell profile: phase = angle/180 for 0→180°, symmetrically back for 180→360°
  // Dwell zone is phase 0.25–0.75, i.e., 45°–135° and 225°–315°
  // At 90° (phase=0.5): max_lift=6mm (center of dwell)
  // At 180° (phase=1.0): returns to 0mm
  const step45 = Math.round(45 / 720 * (nKf - 1));
  const step90 = Math.round(90 / 720 * (nKf - 1));
  const step135 = Math.round(135 / 720 * (nKf - 1));

  const d45 = pawl.keyframes[step45].displacement;
  const d90 = pawl.keyframes[step90].displacement;
  const d135 = pawl.keyframes[step135].displacement;

  assert(d90 > 5.5, `Pawl at 90° at max lift (got ${d90.toFixed(3)}mm)`);
  assert(d45 > 5.5, `Pawl at 45° in dwell zone (got ${d45.toFixed(3)}mm)`);
  assert(d135 > 5.5, `Pawl at 135° in dwell zone (got ${d135.toFixed(3)}mm)`);
}

async function testRetractorSpoolCamSync() {
  console.log('\n--- Test: Retractor spool-cam sync (1:1 gear) ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const spool = result.motion_data.parts.spool;
  const cam = result.motion_data.parts.lock_cam;

  // 1:1 gear ratio: cam angle should equal spool angle at every keyframe
  let maxSyncErr = 0;
  for (let i = 0; i < spool.keyframes.length; i++) {
    const err = Math.abs(cam.keyframes[i].angle - spool.keyframes[i].angle);
    maxSyncErr = Math.max(maxSyncErr, err);
  }
  assert(maxSyncErr < 0.01, `Spool-cam 1:1 sync (max err ${maxSyncErr.toFixed(4)}°)`);

  // Final angles should both be 720°
  const spoolEnd = spool.keyframes[spool.keyframes.length - 1].angle;
  const camEnd = cam.keyframes[cam.keyframes.length - 1].angle;
  assert(Math.abs(spoolEnd - 720) < 0.01, `Spool ends at 720° (got ${spoolEnd})`);
  assert(Math.abs(camEnd - 720) < 0.01, `Cam ends at 720° (got ${camEnd})`);
}

async function testRetractorPawlProfile() {
  console.log('\n--- Test: Retractor pawl dwell profile shape ---');

  const config = await loadConfig(resolve(ROOT, 'configs/examples/seatbelt_retractor.toml'));
  config.export.directory = resolve(OUTPUT_DIR);

  const result = await runScript('create_model.py', config, {
    timeout: 300_000,
    onStderr: (t) => process.stderr.write(`    ${t}`),
  });

  const pawl = result.motion_data.parts.pawl;
  const nKf = pawl.keyframes.length;

  // At 0° and 360°, pawl displacement should be near 0
  const d0 = pawl.keyframes[0].displacement;
  const step360 = Math.round(360 / 720 * (nKf - 1));
  const d360 = pawl.keyframes[step360].displacement;
  assert(Math.abs(d0) < 0.1, `Pawl at 0° near zero (got ${d0.toFixed(4)})`);
  assert(Math.abs(d360) < 0.1, `Pawl at 360° near zero (got ${d360.toFixed(4)})`);

  // Dwell zone should be flat: between 45° and 135° (phase 0.25–0.75) displacement is max_lift
  const step45 = Math.round(45 / 720 * (nKf - 1));
  const step135 = Math.round(135 / 720 * (nKf - 1));
  let minDwell = Infinity, maxDwell = -Infinity;
  for (let i = step45; i <= step135; i++) {
    const d = pawl.keyframes[i].displacement;
    minDwell = Math.min(minDwell, d);
    maxDwell = Math.max(maxDwell, d);
  }
  const dwellRange = maxDwell - minDwell;
  assert(dwellRange < 0.5, `Dwell zone is flat (range ${dwellRange.toFixed(4)}mm)`);
}

async function testMjcfConversion() {
  console.log('\n--- Test: TOML to MJCF conversion ---');

  const inputToml = resolve(ROOT, 'configs/examples/seatbelt_retractor.toml');
  const outputXml = resolve(OUTPUT_DIR, 'seatbelt_retractor.xml');

  // Run conversion
  const cmd = `node ${resolve(ROOT, 'scripts/toml-to-mjcf.js')} ${inputToml} ${outputXml}`;
  const stdout = execSync(cmd, { encoding: 'utf8', timeout: 30_000 });
  const result = JSON.parse(stdout);

  assert(result.success === true, 'MJCF conversion succeeded');
  assert(result.bodies === 7, `7 assembly parts (got ${result.bodies})`);
  assert(result.joints === 3, `3 joints (got ${result.joints})`);
  assert(result.couplings === 2, `2 couplings (got ${result.couplings})`);

  // Verify XML file exists and is valid XML
  assert(existsSync(outputXml), 'MJCF XML file exists');
  const xml = readFileSync(outputXml, 'utf8');
  assert(xml.includes('<mujoco model="seatbelt_retractor"'), 'XML has correct model name');
  assert(xml.includes('joint name="spool_rev"'), 'XML has spool_rev joint');
  assert(xml.includes('joint name="cam_rev"'), 'XML has cam_rev joint');
  assert(xml.includes('joint name="pawl_prism"'), 'XML has pawl_prism joint');
  assert(xml.includes('<actuator>'), 'XML has actuator section');
  assert(xml.includes('<equality>'), 'XML has equality constraints');
  assert(xml.includes('cam_follower'), 'XML references cam_follower coupling');
}

// ---------------------------------------------------------------------------
// Design Reviewer Tests (require GEMINI_API_KEY)
// ---------------------------------------------------------------------------

async function testDesignReview() {
  console.log('\n--- Test: Design review (Gemini) ---');

  if (!process.env.GEMINI_API_KEY) {
    console.log('  SKIP: GEMINI_API_KEY not set');
    return;
  }

  const inputToml = resolve(ROOT, 'configs/examples/seatbelt_retractor.toml');
  const cmd = `node ${resolve(ROOT, 'scripts/design-reviewer.js')} --review ${inputToml} --json`;
  let result;
  try {
    result = runJsonCommand(cmd, { timeout: 60_000, allowStdoutOnFailure: true });
  } catch (error) {
    assert(false, `Design review crashed: ${error.message}`);
    return;
  }

  assert(result.mode === 'review', 'Mode is review');
  assert(Array.isArray(result.issues), 'Issues is an array');
  assert(result.issues.length >= 3, `Found 3+ issues (got ${result.issues.length})`);
  assert(result.report !== undefined, 'Report object present');

  // Corrected TOML should parse
  if (result.correctedToml) {
    let parsed = false;
    try {
      parseTOML(result.correctedToml);
      parsed = true;
    } catch { /* parse failed */ }
    assert(parsed, 'Corrected TOML parses successfully');
  }
}

async function testDesignGenerate() {
  console.log('\n--- Test: Design generate (Gemini) ---');

  if (!process.env.GEMINI_API_KEY) {
    console.log('  SKIP: GEMINI_API_KEY not set');
    return;
  }

  const cmd = `node ${resolve(ROOT, 'scripts/design-reviewer.js')} --design "simple cam-follower" --json`;
  let result;
  try {
    result = runJsonCommand(cmd, { timeout: 60_000, allowStdoutOnFailure: true });
  } catch (error) {
    assert(false, `Design generate crashed: ${error.message}`);
    return;
  }

  assert(result.mode === 'design', 'Mode is design');
  assert(result.toml !== null && result.toml !== undefined, 'Generated TOML present');

  // TOML should parse
  if (result.toml) {
    let parsed = false;
    let config;
    try {
      config = parseTOML(result.toml);
      parsed = true;
    } catch { /* parse failed */ }
    assert(parsed, 'Generated TOML parses successfully');
    if (config) {
      const parts = config.parts || [];
      assert(parts.length >= 2, `Has 2+ parts (got ${parts.length})`);
      assert(config.assembly !== undefined, 'Has assembly section');
    }
  }
}

// --- Phase 13: Tolerance Analysis Tests ---

  return [
    ['Motion keyframes', testMotionKeyframes],
    ['Gear ratio', testGearRatio],
    ['Motion backward compat', testMotionBackwardCompat],
    ['Motion mates assembly', testMotionMatesAssembly],
    ['Library: helical gear', testHelicalGear],
    ['Library: disc cam', testDiscCam],
    ['Library: pulley', testPulley],
    ['Library: coil spring', testCoilSpring],
    ['Kinematics: belt drive', testBeltDrive],
    ['Kinematics: cam follower', testCamFollower],
    ['Kinematics: four-bar linkage', testFourBarLinkage],
    ['Kinematics: piston engine', testPistonEngine],
    ['Retractor build', testRetractorBuild],
    ['Reviewed retractor build', testReviewedRetractorBuild],
    ['Retractor motion data', testRetractorMotionData],
    ['Retractor cam lock', testRetractorCamLock],
    ['Retractor spool-cam sync', testRetractorSpoolCamSync],
    ['Retractor pawl profile', testRetractorPawlProfile],
    ['MJCF conversion', testMjcfConversion],
    ['Design review', testDesignReview],
    ['Design generate', testDesignGenerate],
  ];
}
