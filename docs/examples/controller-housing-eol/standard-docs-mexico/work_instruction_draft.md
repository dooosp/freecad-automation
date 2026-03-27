# Work Instruction Draft

> Draft / generated planning aid. Requires production-engineering review before release to operators.

Part: controller_housing_eol
Profile preset: Mexico-MTY launch profile

## Responsibility Assumptions

- Work instruction owner: Production engineering + training lead
- Operator hint: Operator confirms orientation, serialization scan, and abnormality call escalation.
- Technician hint: Technician owns fixture recovery, recipe reset, and startup verification after downtime.
- Quality engineer hint: Resident QE keeps tightened sampling in place until launch loss stabilizes.
- Production engineer hint: Launch PE owns CT recovery actions, cross-site standard updates, and escalation closure.

## ST10 incoming casting

- Station overview: Receive material, confirm lot/revision, and prepare kits.
- Input material / part: controller_housing_eol
- Key tasks: incoming casting
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: lot/revision handoff
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST20 trim  /  flash removal

- Station overview: Create or stabilize the manufacturable geometry.
- Input material / part: controller_housing_eol
- Key tasks: trim / flash removal
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST30 critical machining

- Station overview: Create or stabilize the manufacturable geometry.
- Input material / part: controller_housing_eol
- Key tasks: critical machining
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST40 cleaning

- Station overview: Remove chips and casting residue.
- Input material / part: controller_housing_eol
- Key tasks: cleaning
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST50 inspection  /  leak surrogate

- Station overview: Capture dimensional evidence and launch quality data.
- Input material / part: controller_housing_eol
- Key tasks: inspection / leak surrogate
- Caution points: Connector keep-out assumption is tight for line-side assembly and inspection; Connector keep-out assumption is tight for line-side assembly and inspection
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST60 assembly preparation

- Station overview: Prepare inserts, labels, and packaging protection.
- Input material / part: controller_housing_eol
- Key tasks: assembly preparation
- Caution points: Connector keep-out assumption is tight for line-side assembly and inspection; Connector keep-out assumption is tight for line-side assembly and inspection
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST70 fixture load  /  unload consideration

- Station overview: Stabilize nest loading, unload sequence, and operator posture.
- Input material / part: controller_housing_eol
- Key tasks: fixture load / unload consideration
- Caution points: Fixture loading sensitivity can extend CT and create false EOL failures
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST80 PCB loading

- Station overview: Load and protect PCB / electronics content before joining and fastening.
- Input material / part: controller_housing_eol
- Key tasks: PCB loading
- Caution points: Traceability mismatch risk exists when housing, PCB, and label records are not paired at build time; PCB stack-up alignment concern should be reviewed against housing and connector datums
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST90 connector seating confirmation

- Station overview: Verify connector seating, side access, and mating stability.
- Input material / part: controller_housing_eol
- Key tasks: connector seating confirmation
- Caution points: Connector keep-out assumption is tight for line-side assembly and inspection; Connector misalignment risk can create mate-force escapes and EOL instability; PCB stack-up alignment concern should be reviewed against housing and connector datums
- Quality checkpoints: connector boss datum to PCB mount face; connector seating depth and alignment
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST100 connector fit confirmation station

- Station overview: Verify connector seating, side access, and mating stability.
- Input material / part: controller_housing_eol
- Key tasks: connector fit confirmation station
- Caution points: Connector keep-out assumption is tight for line-side assembly and inspection; Connector misalignment risk can create mate-force escapes and EOL instability; PCB stack-up alignment concern should be reviewed against housing and connector datums
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST110 gasket application

- Station overview: Protect sealing integrity and visual completeness before closure.
- Input material / part: controller_housing_eol
- Key tasks: gasket application
- Caution points: Gasket miss or sealing path damage can escape without explicit confirmation
- Quality checkpoints: cover sealing groove depth; seal_groove_depth
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST120 sealing confirmation

- Station overview: Protect sealing integrity and visual completeness before closure.
- Input material / part: controller_housing_eol
- Key tasks: sealing confirmation
- Caution points: Gasket miss or sealing path damage can escape without explicit confirmation
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST130 torque-controlled fastening

- Station overview: Control fastening sequence and capture torque trace evidence.
- Input material / part: controller_housing_eol
- Key tasks: torque-controlled fastening
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: fastener torque trace result
- Traceability capture items: No dedicated traceability capture beyond normal lot control.
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST140 torque verification station

- Station overview: Control fastening sequence and capture torque trace evidence.
- Input material / part: controller_housing_eol
- Key tasks: torque verification station
- Caution points: Under-torque / over-torque risk requires traceable fastening control
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST150 barcode  /  serial pairing

- Station overview: Capture serialization and maintain traceability linkage.
- Input material / part: controller_housing_eol
- Key tasks: barcode / serial pairing
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: barcode / serial pairing completeness
- Traceability capture items: serial pairing + operator result + timestamp
- Responsibility note: Production engineering + IT/MES supports this station under the current site preset.

## ST160 barcode pairing station

- Station overview: Capture serialization and maintain traceability linkage.
- Input material / part: controller_housing_eol
- Key tasks: barcode pairing station
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: serial pairing + operator result + timestamp
- Responsibility note: Production engineering + IT/MES supports this station under the current site preset.

## ST170 vision inspection

- Station overview: Run vision-based completeness or alignment confirmation.
- Input material / part: controller_housing_eol
- Key tasks: vision inspection
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST180 vision confirmation station

- Station overview: Run vision-based completeness or alignment confirmation.
- Input material / part: controller_housing_eol
- Key tasks: vision confirmation station
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST190 EOL electrical test

- Station overview: Confirm functional release and protect fixture / probe access.
- Input material / part: controller_housing_eol
- Key tasks: EOL electrical test
- Caution points: Connector misalignment risk can create mate-force escapes and EOL instability; Fixture loading sensitivity can extend CT and create false EOL failures; EOL access / probing constraint can delay release and complicate containment
- Quality checkpoints: EOL electrical / functional release
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST200 EOL electrical test station

- Station overview: Confirm functional release and protect fixture / probe access.
- Input material / part: controller_housing_eol
- Key tasks: EOL electrical test station
- Caution points: Connector misalignment risk can create mate-force escapes and EOL instability; Fixture loading sensitivity can extend CT and create false EOL failures; EOL access / probing constraint can delay release and complicate containment
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

## ST210 functional fit confirmation

- Station overview: Verify downstream install fit and cosmetic / handling release.
- Input material / part: controller_housing_eol
- Key tasks: functional fit confirmation
- Caution points: Confirm standard work, ergonomics, and change-point control.
- Quality checkpoints: Follow line-plan inspection strategy for this station.
- Traceability capture items: inspection + revision + operator result
- Responsibility note: Production engineering + launch coordinator supports this station under the current site preset.

