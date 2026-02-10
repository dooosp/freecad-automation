#!/usr/bin/env node
/**
 * toml-to-mjcf.js — Convert FreeCAD TOML assembly config to MuJoCo MJCF XML.
 *
 * Usage: node scripts/toml-to-mjcf.js <input.toml> <output.xml>
 *
 * Mapping:
 *   parts → body + geom (bounding cylinder/box approximation)
 *   joints → hinge (revolute) / slide (prismatic)
 *   couplings → equality constraints (joint, tendon)
 *   Units: mm → m, density-based mass/inertia auto-calculation
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { parse as parseTOML } from 'smol-toml';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MM_TO_M = 0.001;
const DEFAULT_DENSITY = 7850;  // steel kg/m³

// Material density map (kg/m³)
const MATERIAL_DENSITY = {
  steel: 7850,
  aluminum: 2700,
  brass: 8500,
  plastic: 1200,
  rubber: 1100,
};

// Material friction coefficients [sliding, torsional, rolling] for MuJoCo geom
const MATERIAL_FRICTION = {
  steel: [0.6, 0.005, 0.0001],
  aluminum: [0.4, 0.003, 0.0001],
  brass: [0.35, 0.003, 0.0001],
  plastic: [0.3, 0.002, 0.00005],
  rubber: [0.9, 0.01, 0.0005],
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Estimate bounding geometry for a part from its shape definitions.
 * Returns {type, size, mass, inertia} in SI units (meters, kg).
 */
function estimateGeometry(part) {
  const shapes = part.shapes || [];
  if (shapes.length === 0) return null;

  const primary = shapes[0];  // use first shape for approximation
  const type = primary.type || 'box';
  const material = primary.material || 'steel';  // default steel for backward compat
  const density = MATERIAL_DENSITY[material] || DEFAULT_DENSITY;
  const friction = MATERIAL_FRICTION[material] || MATERIAL_FRICTION.steel;

  let geom;
  if (type.startsWith('library/')) {
    geom = estimateLibraryPart(primary, type.replace('library/', ''), density);
  } else if (type === 'box') {
    geom = estimateBox(primary, density);
  } else if (type === 'cylinder') {
    geom = estimateCylinder(primary, density);
  } else {
    // Fallback: treat as small box
    geom = {
      geomType: 'box',
      size: [0.01, 0.01, 0.01],
      mass: 0.1,
      inertia: [1e-5, 1e-5, 1e-5],
    };
  }

  geom.material = material;
  geom.friction = friction;
  return geom;
}

function estimateBox(spec, density = DEFAULT_DENSITY) {
  const lx = (spec.length || 10) * MM_TO_M;
  const ly = (spec.width || 10) * MM_TO_M;
  const lz = (spec.height || 10) * MM_TO_M;
  const half = [lx / 2, ly / 2, lz / 2];
  const vol = lx * ly * lz;
  const mass = vol * density;
  const inertia = [
    mass * (ly * ly + lz * lz) / 12,
    mass * (lx * lx + lz * lz) / 12,
    mass * (lx * lx + ly * ly) / 12,
  ];
  return { geomType: 'box', size: half, mass, inertia };
}

function estimateCylinder(spec, density = DEFAULT_DENSITY) {
  const r = (spec.radius || 5) * MM_TO_M;
  const h = (spec.height || 10) * MM_TO_M;
  const vol = Math.PI * r * r * h;
  const mass = vol * density;
  const inertia = [
    mass * (3 * r * r + h * h) / 12,
    mass * (3 * r * r + h * h) / 12,
    mass * r * r / 2,
  ];
  return { geomType: 'cylinder', size: [r, h / 2], mass, inertia };
}

function estimateLibraryPart(spec, libType, density = DEFAULT_DENSITY) {
  // Approximate library parts as bounding cylinders
  switch (libType) {
    case 'pulley': {
      const r = ((spec.pitch_d || 40) / 2) * MM_TO_M;
      const h = (spec.width || 15) * MM_TO_M;
      const vol = Math.PI * r * r * h * 0.6;  // hollow factor
      const mass = vol * density;
      return {
        geomType: 'cylinder', size: [r, h / 2], mass,
        inertia: [mass * (3 * r * r + h * h) / 12, mass * (3 * r * r + h * h) / 12, mass * r * r / 2],
      };
    }
    case 'disc_cam': {
      const rBase = (spec.base_radius || 15) * MM_TO_M;
      const rMax = rBase + (spec.max_lift || 5) * MM_TO_M;
      const h = (spec.width || 10) * MM_TO_M;
      const vol = Math.PI * rMax * rMax * h * 0.7;
      const mass = vol * density;
      return {
        geomType: 'cylinder', size: [rMax, h / 2], mass,
        inertia: [mass * (3 * rMax * rMax + h * h) / 12, mass * (3 * rMax * rMax + h * h) / 12, mass * rMax * rMax / 2],
      };
    }
    case 'coil_spring': {
      const r = ((spec.coil_d || 20) / 2) * MM_TO_M;
      const pitch = spec.pitch || 4;
      const numCoils = spec.num_coils || 5;
      const h = (pitch * numCoils) * MM_TO_M;
      const wireR = ((spec.wire_d || 2) / 2) * MM_TO_M;
      const coils = numCoils;
      const wireLen = 2 * Math.PI * r * coils;
      const vol = Math.PI * wireR * wireR * wireLen;
      const mass = vol * density;
      return {
        geomType: 'cylinder', size: [r, h / 2], mass,
        inertia: [mass * (3 * r * r + h * h) / 12, mass * (3 * r * r + h * h) / 12, mass * r * r / 2],
      };
    }
    case 'helical_gear':
    case 'spur_gear': {
      const r = ((spec.module || 2) * (spec.teeth || 20) / 2) * MM_TO_M;
      const h = (spec.width || spec.face_width || 10) * MM_TO_M;
      const vol = Math.PI * r * r * h * 0.7;
      const mass = vol * density;
      return {
        geomType: 'cylinder', size: [r, h / 2], mass,
        inertia: [mass * (3 * r * r + h * h) / 12, mass * (3 * r * r + h * h) / 12, mass * r * r / 2],
      };
    }
    default: {
      // Generic library part → small cylinder
      const r = 0.01;
      const h = 0.01;
      const mass = 0.1;
      return {
        geomType: 'cylinder', size: [r, h], mass,
        inertia: [1e-5, 1e-5, 1e-5],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Dwell cam profile — polynomial approximation for MJCF equality constraint
// ---------------------------------------------------------------------------

/**
 * Sample dwell cam displacement at N points for MJCF spline/userdata.
 * Matches _kinematics.py _cam_displacement with profile="dwell".
 */
function sampleDwellProfile(maxLift, nSamples = 36) {
  const samples = [];
  for (let i = 0; i <= nSamples; i++) {
    const angleDeg = (360 * i) / nSamples;
    let theta = (angleDeg * Math.PI / 180) % (2 * Math.PI);
    let phase;
    if (theta <= Math.PI) {
      phase = theta / Math.PI;
    } else {
      phase = (2 * Math.PI - theta) / Math.PI;
    }

    let lift;
    if (phase >= 0.25 && phase <= 0.75) {
      lift = maxLift;
    } else if (phase < 0.25) {
      lift = maxLift * (1 - Math.cos(Math.PI * phase / 0.25)) / 2;
    } else {
      lift = maxLift * (1 - Math.cos(Math.PI * (1 - phase) / 0.25)) / 2;
    }
    samples.push({ angle: angleDeg, lift: Math.round(lift * 10000) / 10000 });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// MJCF XML builder
// ---------------------------------------------------------------------------

function indent(level) {
  return '  '.repeat(level);
}

function xmlAttr(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}="${v.join(' ')}"`;
      return `${k}="${v}"`;
    })
    .join(' ');
}

function posToMjcf(pos) {
  if (!pos) return [0, 0, 0];
  return pos.map(v => Math.round(v * MM_TO_M * 10000) / 10000);
}

/**
 * Convert parsed TOML config to MJCF XML string.
 */
function tomlToMjcf(config) {
  const modelName = config.name || 'unnamed';
  const parts = config.parts || [];
  const assembly = config.assembly || {};
  const asmParts = assembly.parts || [];
  const joints = assembly.joints || [];
  const couplings = assembly.couplings || [];
  const motion = assembly.motion || {};

  // Build part geometry lookup
  const partGeom = {};
  for (const p of parts) {
    partGeom[p.id] = estimateGeometry(p);
  }

  // Build placed parts list (ref → position)
  const placedParts = [];
  for (const ap of asmParts) {
    const ref = ap.ref;
    const pos = posToMjcf(ap.position);
    const geom = partGeom[ref];
    if (geom) {
      placedParts.push({ id: ref, pos, geom });
    }
  }

  // Build joint lookup: joint_id → {part, type, axis, anchor}
  const jointMap = {};
  for (const j of joints) {
    jointMap[j.id] = {
      part: j.part,
      type: j.type || 'revolute',
      axis: j.axis || [0, 0, 1],
      anchor: posToMjcf(j.anchor || [0, 0, 0]),
    };
  }

  // Map joint type to MJCF type
  const mjcfJointType = (t) => {
    if (t === 'revolute' || t === 'cylindrical') return 'hinge';
    if (t === 'prismatic') return 'slide';
    return 'hinge';
  };

  // --- Start XML ---
  const lines = [];
  lines.push(`<mujoco model="${modelName}">`);

  // Compiler settings
  lines.push(`${indent(1)}<compiler angle="radian" coordinate="local"/>`);

  // Options
  lines.push(`${indent(1)}<option timestep="0.001" gravity="0 0 -9.81"/>`);

  // Defaults
  lines.push(`${indent(1)}<default>`);
  lines.push(`${indent(2)}<joint damping="0.5" armature="0.01"/>`);
  lines.push(`${indent(2)}<geom condim="3" friction="0.8 0.005 0.0001"/>`);
  lines.push(`${indent(1)}</default>`);

  // Worldbody
  lines.push(`${indent(1)}<worldbody>`);
  lines.push(`${indent(2)}<light diffuse="0.8 0.8 0.8" pos="0.5 0.5 1" dir="-0.5 -0.5 -1"/>`);
  lines.push(`${indent(2)}<geom type="plane" size="1 1 0.01" rgba="0.9 0.9 0.9 1"/>`);

  // Find which parts have joints
  const partJoints = {};  // part_id → [{jointId, ...}]
  for (const [jid, jinfo] of Object.entries(jointMap)) {
    if (!partJoints[jinfo.part]) partJoints[jinfo.part] = [];
    partJoints[jinfo.part].push({ jointId: jid, ...jinfo });
  }

  // Emit bodies
  for (const pp of placedParts) {
    const g = pp.geom;
    const bodyName = pp.id;
    const hasJoint = partJoints[pp.id];

    lines.push(`${indent(2)}<body name="${bodyName}" pos="${pp.pos.join(' ')}">`);

    // Inertial
    lines.push(`${indent(3)}<inertial pos="0 0 0" mass="${g.mass.toFixed(6)}" diaginertia="${g.inertia.map(v => v.toFixed(8)).join(' ')}"/>`);

    // Geom (with per-material friction if available)
    const frictionAttr = g.friction ? ` friction="${g.friction.join(' ')}"` : '';
    if (g.geomType === 'box') {
      lines.push(`${indent(3)}<geom type="box" size="${g.size.map(v => v.toFixed(4)).join(' ')}"${frictionAttr} rgba="0.6 0.6 0.8 1"/>`);
    } else if (g.geomType === 'cylinder') {
      lines.push(`${indent(3)}<geom type="cylinder" size="${g.size.map(v => v.toFixed(4)).join(' ')}"${frictionAttr} rgba="0.7 0.7 0.7 1"/>`);
    }

    // Joints
    if (hasJoint) {
      for (const jj of hasJoint) {
        const jType = mjcfJointType(jj.type);
        const relAnchor = [
          jj.anchor[0] - pp.pos[0],
          jj.anchor[1] - pp.pos[1],
          jj.anchor[2] - pp.pos[2],
        ].map(v => Math.round(v * 10000) / 10000);

        lines.push(`${indent(3)}<joint name="${jj.jointId}" type="${jType}" axis="${jj.axis.join(' ')}" pos="${relAnchor.join(' ')}"/>`);
      }
    } else {
      // Fixed body — no joint (welded to world)
    }

    lines.push(`${indent(2)}</body>`);
  }

  lines.push(`${indent(1)}</worldbody>`);

  // Actuators — one for the driver joint
  if (motion.driver && jointMap[motion.driver]) {
    lines.push(`${indent(1)}<actuator>`);
    const driverType = jointMap[motion.driver].type;
    if (driverType === 'prismatic') {
      lines.push(`${indent(2)}<position name="driver_act" joint="${motion.driver}" kp="100" ctrlrange="-1 1"/>`);
    } else {
      lines.push(`${indent(2)}<position name="driver_act" joint="${motion.driver}" kp="100" ctrlrange="-12.566 12.566"/>`);
    }
    lines.push(`${indent(1)}</actuator>`);
  }

  // Equality constraints from couplings
  if (couplings.length > 0) {
    lines.push(`${indent(1)}<equality>`);
    for (let i = 0; i < couplings.length; i++) {
      const c = couplings[i];
      const ctype = c.type || 'gear';
      const cName = `coupling_${i}`;

      if (ctype === 'gear' || ctype === 'belt') {
        // Gear/belt: joint equality with ratio
        const ratio = c.ratio || 1.0;
        // MuJoCo joint equality: polycoef = "0 ratio 0 0 0" maps joint1 = ratio * joint2
        lines.push(`${indent(2)}<joint name="${cName}" joint1="${c.follower}" joint2="${c.driver}" polycoef="0 ${ratio} 0 0 0"/>`);
      } else if (ctype === 'cam_follower') {
        // Cam-follower: approximate with polynomial or custom constraint
        // For dwell profile, we use a weld approximation with softness
        const maxLift = (c.max_lift || 10) * MM_TO_M;
        const profile = c.cam_profile || 'harmonic';
        // Add as userdata comment + approximate joint equality
        lines.push(`${indent(2)}<!-- cam_follower: ${c.driver} → ${c.follower}, profile=${profile}, max_lift=${c.max_lift}mm -->`);
        // Use a polynomial approximation: follower ≈ f(driver)
        // For harmonic: displacement ≈ (max_lift/2)(1 - cos(driver))
        // For dwell: use piecewise — approximate as polynomial for MuJoCo
        // Simple quadratic approximation for validation purposes
        lines.push(`${indent(2)}<joint name="${cName}" joint1="${c.follower}" joint2="${c.driver}" polycoef="0 0 ${(maxLift / (Math.PI * Math.PI)).toFixed(8)} 0 0" solimp="0.95 0.99 0.001" solref="0.02 1"/>`);
      }
    }
    lines.push(`${indent(1)}</equality>`);
  }

  // Sensor — joint position sensors
  if (joints.length > 0) {
    lines.push(`${indent(1)}<sensor>`);
    for (const j of joints) {
      lines.push(`${indent(2)}<jointpos name="sens_${j.id}" joint="${j.id}"/>`);
    }
    lines.push(`${indent(1)}</sensor>`);
  }

  // Custom data: cam follower profile samples (for external tools)
  const camCouplings = couplings.filter(c => c.type === 'cam_follower');
  if (camCouplings.length > 0) {
    lines.push(`${indent(1)}<!-- Cam follower profile data (for reference) -->`);
    for (const c of camCouplings) {
      const samples = sampleDwellProfile(c.max_lift || 10);
      const sampleStr = samples.map(s => `${s.angle}:${s.lift}`).join(',');
      lines.push(`${indent(1)}<!-- cam_profile driver="${c.driver}" follower="${c.follower}" samples="${sampleStr}" -->`);
    }
  }

  lines.push('</mujoco>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node scripts/toml-to-mjcf.js <input.toml> <output.xml>');
    process.exit(1);
  }

  const inputPath = resolve(args[0]);
  const outputPath = resolve(args[1]);

  const raw = readFileSync(inputPath, 'utf8');
  const config = parseTOML(raw);

  const xml = tomlToMjcf(config);
  writeFileSync(outputPath, xml, 'utf8');

  // Output summary as JSON for scripting
  const bodyCount = (config.assembly?.parts || []).length;
  const jointCount = (config.assembly?.joints || []).length;
  const couplingCount = (config.assembly?.couplings || []).length;

  console.log(JSON.stringify({
    success: true,
    input: inputPath,
    output: outputPath,
    model: config.name || 'unnamed',
    bodies: bodyCount,
    joints: jointCount,
    couplings: couplingCount,
  }));
}

// Also export for testing
export { tomlToMjcf, estimateGeometry, sampleDwellProfile, posToMjcf, MATERIAL_DENSITY, MATERIAL_FRICTION };

main();
