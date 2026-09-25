# Revision Impact Report

- artifact_type: <code>"revision_impact_report"</code>
- generated_at: <code>"2026-09-25T12:05:57.707Z"</code>
- schema_version: <code>"1.0"</code>

## Revisions

### Baseline

- artifact_refs: <code>["input/412d434a2ce448ac/drawing_intent.json","input/4414b888abb5c41b/review-pack.json","input/8292c51e36110b41/comparison-config.json"]</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- part_id: <code>"USB-HUB-PLATE-SIM"</code>
- revision: <code>"A"</code>
- source_hashes: <code>{"config":"8292c51e36110b41f78b68daa1fefb5af008a5064b734111f3d02630cb820d37","drawing_intent":"412d434a2ce448ac05c3264bbb96db3a013978017d19f3211df87f137ea693ef","review_pack":"4414b888abb5c41bb4f4664adf38fb3fb7ec556284bb9b4ca0de854d529d8b72"}</code>

### Candidate

- artifact_refs: <code>["input/5dd1ab1d1daa4a51/review-pack.json","input/6fd08f902a4a266e/drawing_intent.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- part_id: <code>"USB-HUB-PLATE-SIM"</code>
- revision: <code>"B"</code>
- source_hashes: <code>{"config":"bb32ae2311fce02320030988e8fbd7df49a22109125835b3325fed24aa5a4dfa","drawing_intent":"6fd08f902a4a266e6aca3511d1c13c383d3534c47433cc9958d7b7c3a90782d3","review_pack":"5dd1ab1d1daa4a5194ba20da7b16917c26c9099f128dd1d5afec67e809d55e87"}</code>

## Summary

- decision: <code>"reinspection_required"</code>
- material_change_count: <code>8</code>
- readiness_review_required: <code>true</code>
- reinspection_required_count: <code>9</code>
- review_required_count: <code>2</code>
- unable_to_determine_count: <code>0</code>

## Changes

### change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b

- affected_entity_id: <code>"hole_H1"</code>
- after_value: <code>{"dimensions":{"height":6,"id":"hole_H1","position":[120,12,-1],"radius":2.6,"type":"cylinder"},"type":"cylinder"}</code>
- baseline_source_ref: <code>"input/8292c51e36110b41/comparison-config.json"</code>
- before_value: <code>{"dimensions":{"height":6,"id":"hole_H1","position":[130,12,-1],"radius":2.6,"type":"cylinder"},"type":"cylinder"}</code>
- candidate_source_ref: <code>"input/bb32ae2311fce023/comparison-config.json"</code>
- change_id: <code>"change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b"</code>
- change_type: <code>"geometry_feature_modified"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Geometry feature hole_H1 changed under the same explicit stable identity."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"8292c51e36110b41f78b68daa1fefb5af008a5064b734111f3d02630cb820d37","candidate":"bb32ae2311fce02320030988e8fbd7df49a22109125835b3325fed24aa5a4dfa"}</code>
- unit: <code>null</code>

### change_7657e762450c639aec76f6315f41ff78f4c35e65fc33a6cd0e4c40f0fdb1bbf9

- affected_entity_id: <code>"feature:hole_pattern:7c08c061b8"</code>
- after_value: <code>null</code>
- baseline_source_ref: <code>"input/4414b888abb5c41b/review-pack.json"</code>
- before_value: <code>{"critical":null,"details":{"hole_count":4,"hole_diameter_mm":5.2,"pcd_mm":128.156},"region_ref":"region:global","type":"hole_pattern"}</code>
- candidate_source_ref: <code>null</code>
- change_id: <code>"change_7657e762450c639aec76f6315f41ff78f4c35e65fc33a6cd0e4c40f0fdb1bbf9"</code>
- change_type: <code>"geometry_feature_removed"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Geometry feature feature:hole_pattern:7c08c061b8 was removed; existing records remain immutable and require review."</code>
- required_action: <code>"human_review"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"4414b888abb5c41bb4f4664adf38fb3fb7ec556284bb9b4ca0de854d529d8b72","candidate":null}</code>
- unit: <code>null</code>

### change_84e2c4acfa2a16fdc5d9669194977ab5d1fc5b61f3add1448904b07334414606

- affected_entity_id: <code>"HORIZONTAL.PITCH"</code>
- after_value: <code>108</code>
- baseline_source_ref: <code>"input/412d434a2ce448ac/drawing_intent.json"</code>
- before_value: <code>118</code>
- candidate_source_ref: <code>"input/6fd08f902a4a266e/drawing_intent.json"</code>
- change_id: <code>"change_84e2c4acfa2a16fdc5d9669194977ab5d1fc5b61f3add1448904b07334414606"</code>
- change_type: <code>"nominal_dimension_change"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Characteristic HORIZONTAL.PITCH has an exact normalized nominal change."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"412d434a2ce448ac05c3264bbb96db3a013978017d19f3211df87f137ea693ef","candidate":"6fd08f902a4a266e6aca3511d1c13c383d3534c47433cc9958d7b7c3a90782d3"}</code>
- unit: <code>"mm"</code>

### change_955c2e479d9ef56eef899a321167f3bfe86a9714637ba21d0ad5a4bcb623f08d

- affected_entity_id: <code>"H1.X"</code>
- after_value: <code>120</code>
- baseline_source_ref: <code>"input/412d434a2ce448ac/drawing_intent.json"</code>
- before_value: <code>130</code>
- candidate_source_ref: <code>"input/6fd08f902a4a266e/drawing_intent.json"</code>
- change_id: <code>"change_955c2e479d9ef56eef899a321167f3bfe86a9714637ba21d0ad5a4bcb623f08d"</code>
- change_type: <code>"nominal_dimension_change"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Characteristic H1.X has an exact normalized nominal change."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"412d434a2ce448ac05c3264bbb96db3a013978017d19f3211df87f137ea693ef","candidate":"6fd08f902a4a266e6aca3511d1c13c383d3534c47433cc9958d7b7c3a90782d3"}</code>
- unit: <code>"mm"</code>

### change_a5f7512311070d26884fca74a87fc14e0713b38d4389e6723c18ea65540b91a1

- affected_entity_id: <code>"H2.X"</code>
- after_value: <code>120</code>
- baseline_source_ref: <code>"input/412d434a2ce448ac/drawing_intent.json"</code>
- before_value: <code>130</code>
- candidate_source_ref: <code>"input/6fd08f902a4a266e/drawing_intent.json"</code>
- change_id: <code>"change_a5f7512311070d26884fca74a87fc14e0713b38d4389e6723c18ea65540b91a1"</code>
- change_type: <code>"nominal_dimension_change"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Characteristic H2.X has an exact normalized nominal change."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"412d434a2ce448ac05c3264bbb96db3a013978017d19f3211df87f137ea693ef","candidate":"6fd08f902a4a266e6aca3511d1c13c383d3534c47433cc9958d7b7c3a90782d3"}</code>
- unit: <code>"mm"</code>

### change_b1890716e201bfe787a38373d3831d932e2a3e1f04c1dae0c42b1324ea55b2b5

- affected_entity_id: <code>"RIGHT.CENTER_MARGIN"</code>
- after_value: <code>22</code>
- baseline_source_ref: <code>"input/412d434a2ce448ac/drawing_intent.json"</code>
- before_value: <code>12</code>
- candidate_source_ref: <code>"input/6fd08f902a4a266e/drawing_intent.json"</code>
- change_id: <code>"change_b1890716e201bfe787a38373d3831d932e2a3e1f04c1dae0c42b1324ea55b2b5"</code>
- change_type: <code>"nominal_dimension_change"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Characteristic RIGHT.CENTER_MARGIN has an exact normalized nominal change."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"412d434a2ce448ac05c3264bbb96db3a013978017d19f3211df87f137ea693ef","candidate":"6fd08f902a4a266e6aca3511d1c13c383d3534c47433cc9958d7b7c3a90782d3"}</code>
- unit: <code>"mm"</code>

### change_d42b36207d8379e3a15cbcc999b00bac1fbd50884a51b54ca31bca59c18f3ae5

- affected_entity_id: <code>"feature:hole_pattern:cd5c293952"</code>
- after_value: <code>{"critical":null,"details":{"hole_count":4,"hole_diameter_mm":5.2,"pcd_mm":119.013},"region_ref":"region:global","type":"hole_pattern"}</code>
- baseline_source_ref: <code>null</code>
- before_value: <code>null</code>
- candidate_source_ref: <code>"input/5dd1ab1d1daa4a51/review-pack.json"</code>
- change_id: <code>"change_d42b36207d8379e3a15cbcc999b00bac1fbd50884a51b54ca31bca59c18f3ae5"</code>
- change_type: <code>"geometry_feature_added"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Geometry feature feature:hole_pattern:cd5c293952 was added with explicit stable identity."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":null,"candidate":"5dd1ab1d1daa4a5194ba20da7b16917c26c9099f128dd1d5afec67e809d55e87"}</code>
- unit: <code>null</code>

### change_def614ed0f16edd869def05241a571effc13d9821c90942a29ef5f094098e003

- affected_entity_id: <code>"package:revision"</code>
- after_value: <code>"B"</code>
- baseline_source_ref: <code>"input/4414b888abb5c41b/review-pack.json"</code>
- before_value: <code>"A"</code>
- candidate_source_ref: <code>"input/5dd1ab1d1daa4a51/review-pack.json"</code>
- change_id: <code>"change_def614ed0f16edd869def05241a571effc13d9821c90942a29ef5f094098e003"</code>
- change_type: <code>"revision_identity_change"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"The explicit package revision identifier changed."</code>
- required_action: <code>"human_review"</code>
- severity: <code>"informational"</code>
- source_hashes: <code>{"baseline":"4414b888abb5c41bb4f4664adf38fb3fb7ec556284bb9b4ca0de854d529d8b72","candidate":"5dd1ab1d1daa4a5194ba20da7b16917c26c9099f128dd1d5afec67e809d55e87"}</code>
- unit: <code>null</code>

### change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08

- affected_entity_id: <code>"hole_H2"</code>
- after_value: <code>{"dimensions":{"height":6,"id":"hole_H2","position":[120,62,-1],"radius":2.6,"type":"cylinder"},"type":"cylinder"}</code>
- baseline_source_ref: <code>"input/8292c51e36110b41/comparison-config.json"</code>
- before_value: <code>{"dimensions":{"height":6,"id":"hole_H2","position":[130,62,-1],"radius":2.6,"type":"cylinder"},"type":"cylinder"}</code>
- candidate_source_ref: <code>"input/bb32ae2311fce023/comparison-config.json"</code>
- change_id: <code>"change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"</code>
- change_type: <code>"geometry_feature_modified"</code>
- determinability: <code>"determined"</code>
- rationale: <code>"Geometry feature hole_H2 changed under the same explicit stable identity."</code>
- required_action: <code>"reinspect"</code>
- severity: <code>"high"</code>
- source_hashes: <code>{"baseline":"8292c51e36110b41f78b68daa1fefb5af008a5064b734111f3d02630cb820d37","candidate":"bb32ae2311fce02320030988e8fbd7df49a22109125835b3325fed24aa5a4dfa"}</code>
- unit: <code>null</code>

## Evidence Applicability

- authoritative_evidence_state_changed: <code>false</code>
### assessment_0e34e50379ea02d8fe42278511a7baacd77b96351b020c6bf9b8f1324b77a211

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_0e34e50379ea02d8fe42278511a7baacd77b96351b020c6bf9b8f1324b77a211"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"D2.Y"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_1f7de158cdc45cb980a9ad9debb9528442b63c533d3615a5bbc154214521dfd2

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_1f7de158cdc45cb980a9ad9debb9528442b63c533d3615a5bbc154214521dfd2"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"PLATE.THICKNESS"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_2cb901a67af87019f87ab071a6d3d038f1041d3436be2c8341278908cc0108c9

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_2cb901a67af87019f87ab071a6d3d038f1041d3436be2c8341278908cc0108c9"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"HORIZONTAL.PITCH"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b","change_84e2c4acfa2a16fdc5d9669194977ab5d1fc5b61f3add1448904b07334414606"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_3591efc3a6458cd4b9044273660127353178efd6dd00456202c8304ec9b47e53

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_3591efc3a6458cd4b9044273660127353178efd6dd00456202c8304ec9b47e53"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"H2.X"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_a5f7512311070d26884fca74a87fc14e0713b38d4389e6723c18ea65540b91a1","change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_3dcdd3cce26d82c4f8db15647baa3634c5356e1f3764a14e6a367b7df542f16d

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_3dcdd3cce26d82c4f8db15647baa3634c5356e1f3764a14e6a367b7df542f16d"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"PLATE.WIDTH"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_5b1c39e286cdbcacfd364573d1e5a12ad5743d94e10caa3dc59c7fe0e608d9e6

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_5b1c39e286cdbcacfd364573d1e5a12ad5743d94e10caa3dc59c7fe0e608d9e6"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"D2.X"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_5f9ce04f390f3c383e0a7ca39a1dfdb241cd44b74f350fd5dafcbabfc86a08c2

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_5f9ce04f390f3c383e0a7ca39a1dfdb241cd44b74f350fd5dafcbabfc86a08c2"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"H2.Y"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_68f158f4bc939cbd1bd03a5feb5d3c492abf49d66695ce50aeb5afecafe0cc55

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_68f158f4bc939cbd1bd03a5feb5d3c492abf49d66695ce50aeb5afecafe0cc55"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"D1.X"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_722f67f1e0ba73cb15d0c21aa80dce0258e9542f7745defa40fd6b5e4e5ff81d

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_722f67f1e0ba73cb15d0c21aa80dce0258e9542f7745defa40fd6b5e4e5ff81d"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"PLATE.LENGTH"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_75192ef1af8f4e7df932aa6fcb6f6a7a94afd9f48add28979859cbbb832fbd18

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_75192ef1af8f4e7df932aa6fcb6f6a7a94afd9f48add28979859cbbb832fbd18"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"H2.DIAMETER"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_9c1ea4b7cd3aa8dae535f885f05815bb6b0213139616c807abc73248bb71443e

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_9c1ea4b7cd3aa8dae535f885f05815bb6b0213139616c807abc73248bb71443e"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"H1.Y"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_aa963677842acfc015282ff9052b8baf05f7dfab989ced5df1f4c94a1d20dad5

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_aa963677842acfc015282ff9052b8baf05f7dfab989ced5df1f4c94a1d20dad5"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"H1.X"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b","change_955c2e479d9ef56eef899a321167f3bfe86a9714637ba21d0ad5a4bcb623f08d"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_ab8c3f4abc526a2d26a41bbaf650465ba3f8882bc8860f306d80618ec9fd6be3

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_ab8c3f4abc526a2d26a41bbaf650465ba3f8882bc8860f306d80618ec9fd6be3"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"RIGHT.CENTER_MARGIN"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b","change_b1890716e201bfe787a38373d3831d932e2a3e1f04c1dae0c42b1324ea55b2b5"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_aebf85870808ae5a45ff734ffcf35539099949d1dae6897675451f538b21897e

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_aebf85870808ae5a45ff734ffcf35539099949d1dae6897675451f538b21897e"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"D1.Y"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_b5ffb55b286972a33700b2819ab0298c445af50cc76d2e53ef5efceceeec455a

- applicability_status: <code>"reinspection_required"</code>
- assessment_id: <code>"assessment_b5ffb55b286972a33700b2819ab0298c445af50cc76d2e53ef5efceceeec455a"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"H1.DIAMETER"</code>
- human_decision_required: <code>true</code>
- rationale: <code>"Applicability follows the explicit normalized changes linked to this stable characteristic."</code>
- reinspection_action: <code>"Perform a later authorized reinspection and attach genuine evidence through the separate onboarding workflow."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b"]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_ef165bb52e2d6af1052b152089d450cb40392ccb51cb9237737aa1d2dbd82978

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_ef165bb52e2d6af1052b152089d450cb40392ccb51cb9237737aa1d2dbd82978"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"D2.DIAMETER"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

### assessment_ff46cfde5fca51d3c2c96397d8e4e53fc509c1d0e7289a476f3b8d3867dc77d6

- applicability_status: <code>"unaffected"</code>
- assessment_id: <code>"assessment_ff46cfde5fca51d3c2c96397d8e4e53fc509c1d0e7289a476f3b8d3867dc77d6"</code>
- authoritative_evidence_state_changed: <code>false</code>
- baseline_package_revision: <code>"A"</code>
- candidate_package_revision: <code>"B"</code>
- evidence_or_characteristic_id: <code>"D1.DIAMETER"</code>
- human_decision_required: <code>false</code>
- rationale: <code>"No normalized engineering change is linked to this stable characteristic."</code>
- reinspection_action: <code>null</code>
- related_change_ids: <code>[]</code>
- source_envelope_or_receipt_ref: <code>null</code>

## Reinspection Plan

- human_authorization_required: <code>true</code>
- status: <code>"planned"</code>
### plan_0c3d4806e4dad94a1c52f00662f6f16e12f7ed720a2bae8baf04a83cebdc1c14

- affected_entity_id: <code>"H2.DIAMETER"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>5.2</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_0c3d4806e4dad94a1c52f00662f6f16e12f7ed720a2bae8baf04a83cebdc1c14"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature H2.DIAMETER for the candidate revision."</code>
- related_change_ids: <code>["change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:H2.DIAMETER"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_59a5d5085556ff0e2cdae8730a2d932f657dfa58125731d1d62d879d27d23398

- affected_entity_id: <code>"H2.X"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>120</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_59a5d5085556ff0e2cdae8730a2d932f657dfa58125731d1d62d879d27d23398"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature H2.X for the candidate revision."</code>
- related_change_ids: <code>["change_a5f7512311070d26884fca74a87fc14e0713b38d4389e6723c18ea65540b91a1","change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/412d434a2ce448ac/drawing_intent.json","input/6fd08f902a4a266e/drawing_intent.json","input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:H2.X"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_815767f03d76c2a850d2adf3bf8ebba75391f756322ec0270ef87d7c9ed3c9b7

- affected_entity_id: <code>"feature:hole_pattern:cd5c293952"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>null</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_815767f03d76c2a850d2adf3bf8ebba75391f756322ec0270ef87d7c9ed3c9b7"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature feature:hole_pattern:cd5c293952 for the candidate revision."</code>
- related_change_ids: <code>["change_d42b36207d8379e3a15cbcc999b00bac1fbd50884a51b54ca31bca59c18f3ae5"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/5dd1ab1d1daa4a51/review-pack.json"]</code>
- specification_ref: <code>null</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_9e0f78772d303e1acbc0f77f71b70444f6520858cbb7311fa187171e727922f9

- affected_entity_id: <code>"H1.DIAMETER"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>5.2</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_9e0f78772d303e1acbc0f77f71b70444f6520858cbb7311fa187171e727922f9"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature H1.DIAMETER for the candidate revision."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:H1.DIAMETER"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_a7f2e5876296169da862a7ecce7448412faf46d7d41705f43352febb90a00639

- affected_entity_id: <code>"H1.X"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>120</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_a7f2e5876296169da862a7ecce7448412faf46d7d41705f43352febb90a00639"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature H1.X for the candidate revision."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b","change_955c2e479d9ef56eef899a321167f3bfe86a9714637ba21d0ad5a4bcb623f08d"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/412d434a2ce448ac/drawing_intent.json","input/6fd08f902a4a266e/drawing_intent.json","input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:H1.X"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_b73b1cc6e0c94bf0e39d3fda5b01fe2ec22661d2a8bca5239078384899e4dd9d

- affected_entity_id: <code>"HORIZONTAL.PITCH"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>108</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_b73b1cc6e0c94bf0e39d3fda5b01fe2ec22661d2a8bca5239078384899e4dd9d"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature HORIZONTAL.PITCH for the candidate revision."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b","change_84e2c4acfa2a16fdc5d9669194977ab5d1fc5b61f3add1448904b07334414606"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/412d434a2ce448ac/drawing_intent.json","input/6fd08f902a4a266e/drawing_intent.json","input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:HORIZONTAL.PITCH"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_c6fd25279782d3db170e717ab66fa5fc91b4d1e7d763f2c14bbdb1e389e16553

- affected_entity_id: <code>"H2.Y"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>62</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_c6fd25279782d3db170e717ab66fa5fc91b4d1e7d763f2c14bbdb1e389e16553"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature H2.Y for the candidate revision."</code>
- related_change_ids: <code>["change_f832c9716e5116440713313a3ff9aaedf4fdde5167f00153f92eecbad68ece08"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:H2.Y"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_dac9cc2ce181754bd365a8faf945850930513e637d5c86e4dfe62a6dc1e4660e

- affected_entity_id: <code>"H1.Y"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>12</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_dac9cc2ce181754bd365a8faf945850930513e637d5c86e4dfe62a6dc1e4660e"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature H1.Y for the candidate revision."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:H1.Y"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

### plan_f6bf82a6d9ce0faf81d4d45757b7d9778ffe21606489daa393d6d172529acbfd

- affected_entity_id: <code>"RIGHT.CENTER_MARGIN"</code>
- attachment_authorization_required: <code>true</code>
- candidate_revision: <code>"B"</code>
- execution_status: <code>"not_started"</code>
- human_reviewer_required: <code>true</code>
- nominal_value: <code>22</code>
- package_slug: <code>"usb-hub-plate-simulated"</code>
- plan_item_id: <code>"plan_f6bf82a6d9ce0faf81d4d45757b7d9778ffe21606489daa393d6d172529acbfd"</code>
- readiness_regeneration_required_later: <code>true</code>
- reason: <code>"One or more determined engineering changes require future reinspection; this item is not completed evidence."</code>
- recommended_inspection_scope: <code>"Reinspect stable characteristic or feature RIGHT.CENTER_MARGIN for the candidate revision."</code>
- related_change_ids: <code>["change_044428516f57b4dccf1fe0355f938a6ae5fe3386d09f1a39eb7bb632ebe6926b","change_b1890716e201bfe787a38373d3831d932e2a3e1f04c1dae0c42b1324ea55b2b5"]</code>
- required_evidence_fields: <code>["characteristic_id","measured_value","result","source_document_sha256","unit"]</code>
- source_artifact_refs: <code>["input/412d434a2ce448ac/drawing_intent.json","input/6fd08f902a4a266e/drawing_intent.json","input/8292c51e36110b41/comparison-config.json","input/bb32ae2311fce023/comparison-config.json"]</code>
- specification_ref: <code>"USB-SIM-REQUIREMENTS:RIGHT.CENTER_MARGIN"</code>
- suggested_method: <code>null</code>
- tolerance: <code>null</code>

## Boundaries

- canonical_artifacts_mutated: <code>false</code>
- evidence_superseded: <code>false</code>
- existing_evidence_mutated: <code>false</code>
- generated_review_artifact: <code>true</code>
- inspection_evidence_attached: <code>false</code>
- measured_values_generated: <code>false</code>
- readiness_regenerated: <code>false</code>
- release_published: <code>false</code>
