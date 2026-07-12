# Inspection Evidence Collection Guides

These non-canonical guides help a human collect real physical or supplier
inspection measurements for the canonical example packages. They are not
inspection evidence, and they do not satisfy `inspection_evidence` by
themselves.

For supplier, lab, QA reviewer, or physical inspector requests before the
candidate gate, use the [`Stage 5B evidence request packet`](../stage-5b-evidence-request-packet.md).
That packet is also a control document, not evidence.

- [`quality-pass-bracket`](./quality-pass-bracket.md)
- [`plate-with-holes`](./plate-with-holes.md)
- [`motor-mount`](./motor-mount.md)
- [`controller-housing-eol`](./controller-housing-eol.md)
- [`hinge-block`](./hinge-block.md)

Completed real records must first enter the content-addressed ignored quarantine
through `inspection-evidence-quarantine`, then pass validation and a distinct
checksum-bound authorization. Only `inspection-evidence-attach` may create the
matching `docs/examples/<package>/inspection/inspection_evidence.json` envelope
and immutable attachment record. `review-context` may consume that envelope only
with both the canonical authorization and `--evidence-attachment-record`; a
separate readiness authorization is still required afterward.

The former shorthand `review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>`
is preserved only as a warning boundary: that pair is incomplete without the
canonical authorization and immutable attachment receipt, and raw candidates
must never be supplied directly.

Generated quality, drawing, readiness, review-pack, and synthetic fixture files
must not be used as package inspection evidence. The canonical packages remain
`needs_more_evidence` until genuine inspection evidence is attached and the
selected readiness artifacts are regenerated through the canonical flow.

## Exact records still required

Every package still needs a genuine completed source record plus the full
authoritative envelope, inspector/reviewer/authorizer references, source checksum,
privacy/redaction decision, released specification references, measured values,
units, and pass/fail results. The nominal targets below are collection scope only;
they are not measurements or released tolerances.

- `quality-pass-bracket`: first assign an authoritative package revision; then
  inspect 6 mm and 10 mm holes, centers (30, 30) and (125, 70) mm, the
  160 x 100 x 8 mm plate, and 1.0 mm chamfer against a released inspection plan.
- `plate-with-holes` revision `A`: inspect four 4 mm holes, 101 x 54 mm hole
  pattern, 145 x 98 x 4 mm plate, 18 x 10 mm connector slot, 42 mm slot
  position, and 8 mm standoff; confirm rather than infer the tolerance hints.
- `motor-mount` revision `A`: inspect four 9 mm holes, 80 x 50 mm pattern,
  120 x 80 x 10 mm base, 60 mm web, 36 mm rib, and released deburr/edge-break
  acceptance criteria.
- `controller-housing-eol` revision `C`: inspect 172 x 126 x 50 mm housing,
  142 x 96 mm cavity, 42 x 30 mm connector opening, 64 mm datum-to-PCB face,
  four 6 mm holes on a 132 x 86 mm pattern, 2.4 mm groove, plus source-linked
  0.85 Nm torque, barcode pairing, gasket confirmation, and electrical EOL result.
- `hinge-block` revision `A`: inspect two 8 mm hinge-pin holes, two 6 mm mount
  holes, 90 x 50 x 12 mm base, 26 mm ears, and released visual deburr criteria.

No package may use config or drawing nominal values as measured values. Where a
guide says no released tolerance was found, the released inspection plan or
supplier acceptance record remains an external dependency.

See [`../inspection-evidence-contract.md`](../inspection-evidence-contract.md)
for the schema and validation contract.
