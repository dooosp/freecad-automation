#!/usr/bin/env bash
# Seatbelt Retractor Demo — Full Pipeline
# Runs: FreeCAD build → TOML-to-MJCF conversion → MuJoCo validation
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INPUT="$ROOT/configs/examples/seatbelt_retractor.toml"
OUTPUT_DIR="$ROOT/output"
MJCF_OUTPUT="$OUTPUT_DIR/seatbelt_retractor.xml"

echo "═══════════════════════════════════════════════════"
echo " Seatbelt Retractor Demo Pipeline"
echo "═══════════════════════════════════════════════════"

# 1. Build CAD model (FreeCAD via WSL→Windows bridge)
echo ""
echo "▶ Step 1: Building CAD model..."
node "$ROOT/bin/fcad.js" create "$INPUT" 2>&1 | tail -5
echo "  ✓ CAD build complete"

# 2. Convert TOML → MJCF XML
echo ""
echo "▶ Step 2: Converting to MJCF..."
mkdir -p "$OUTPUT_DIR"
node "$ROOT/scripts/toml-to-mjcf.js" "$INPUT" "$MJCF_OUTPUT"
echo "  ✓ MJCF conversion complete → $MJCF_OUTPUT"

# 3. Validate with MuJoCo
echo ""
echo "▶ Step 3: MuJoCo validation..."
python3 "$ROOT/scripts/validate-mjcf.py" "$MJCF_OUTPUT"
echo "  ✓ MuJoCo validation complete"

echo ""
echo "═══════════════════════════════════════════════════"
echo " Pipeline complete!"
echo " CAD:  $OUTPUT_DIR/seatbelt_retractor.step"
echo " MJCF: $MJCF_OUTPUT"
echo " View: http://localhost:3000 → select seatbelt_retractor"
echo "═══════════════════════════════════════════════════"
