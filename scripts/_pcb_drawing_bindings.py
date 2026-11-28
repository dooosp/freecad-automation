"""Bounded PCB drawing references measured on the final FreeCAD solid."""
import math
import re
from html import escape

from _drawing_traceability import _same, _vector_equal
from _drawing_svg import measurement_attributes
from _slot_relief import RADIUS_FIELD


HOLES = ['hole1', 'hole2', 'hole3', 'hole4']
HOLE_GROUP = ','.join(HOLES)
SLOT_REFERENCE = {'axis': 'Y', 'from': {'feature': 'plate', 'boundary': 'y_min'},
                  'to': {'feature': 'slot', 'boundary': 'y_min'}}
KINDS = {
    'PLATE_LENGTH': ('plate_length', 'plate', 'u'),
    'PLATE_WIDTH': ('plate_width', 'plate', 'v'),
    'MOUNTING_HOLE_DIA': ('hole_diameter', HOLE_GROUP, None),
    'MOUNTING_HOLE_PATTERN_X': ('hole_pitch_x', HOLE_GROUP, 'u'),
    'MOUNTING_HOLE_PATTERN_Y': ('hole_pitch_y', HOLE_GROUP, 'v'),
    'CONNECTOR_SLOT_SIZE': ('slot_length', 'slot', 'u'),
    'CONNECTOR_SLOT_WIDTH': ('slot_width', 'slot', 'v'),
    'CONNECTOR_SLOT_POSITION': ('slot_position_y', 'slot', 'v'),
}


def _edge(shape, p0, p1, object_id):
    matches = []
    for index, edge in enumerate(shape.Edges, 1):
        if type(edge.Curve).__name__ not in ('Line', 'LineSegment') or len(edge.Vertexes) != 2:
            continue
        points = [list(v.Point) for v in edge.Vertexes]
        if any(_vector_equal(points[0], a) and _vector_equal(points[1], b)
               for a, b in ((p0, p1), (p1, p0))):
            matches.append((edge, f'{object_id}:Edge{index}'))
    return matches[0] if len(matches) == 1 else None


def _hole(shape, spec, z0, z1, object_id, project):
    x, y, _ = spec.get('position', [0, 0, 0])
    radius = spec['radius']
    matches = []
    for index, face in enumerate(shape.Faces, 1):
        surf, bb = face.Surface, face.BoundBox
        if type(surf).__name__ != 'Cylinder':
            continue
        if (not _same(surf.Radius, radius) or not _vector_equal(list(surf.Center)[:2], [x, y])
                or not _vector_equal(list(map(abs, surf.Axis)), [0, 0, 1])
                or not _vector_equal([bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
                                     [x-radius, y-radius, z0, x+radius, y+radius, z1])
                or not math.isclose(face.Area, 2*math.pi*radius*(z1-z0), abs_tol=1e-6, rel_tol=1e-8)):
            continue
        u0, u1, v0, v1 = face.ParameterRange
        point, normal = face.valueAt((u0+u1)/2, (v0+v1)/2), face.normalAt((u0+u1)/2, (v0+v1)/2)
        if not _same(((point.x-x)*normal.x+(point.y-y)*normal.y)/radius, -1):
            continue
        rims = []
        for edge in face.Edges:
            curve = edge.Curve
            if (type(curve).__name__ == 'Circle' and edge.isClosed() and _same(curve.Radius, radius)
                    and _same(edge.Length, 2*math.pi*radius)
                    and _vector_equal(list(curve.Center)[:2], [x, y])
                    and any(_same(curve.Center.z, z) for z in (z0, z1))):
                refs = [i for i, e in enumerate(shape.Edges, 1) if e.isSame(edge)]
                if len(refs) == 1:
                    rims.append((curve.Center.z, edge, f'{object_id}:Edge{refs[0]}'))
        rims.sort(key=lambda item: item[0])
        if len(rims) != 2 or not _same(rims[0][0], z0) or not _same(rims[1][0], z1):
            continue
        _, _, circles, _ = project(rims[1][1], 'top')
        if len(circles) != 1 or not _same(circles[0][2], radius):
            continue
        evidence = {'feature_id': spec['id'], 'face_ref': f'{object_id}:Face{index}',
                    'center_xy_mm': list(surf.Center)[:2], 'radius_mm': surf.Radius,
                    'z_range_mm': [bb.ZMin, bb.ZMax], 'height_mm': bb.ZLength,
                    'lower_edge_ref': rims[0][2], 'upper_edge_ref': rims[1][2],
                    'surface_role': 'inward_hole', 'axis': [0, 0, 1], 'area_mm2': face.Area,
                    'circle_uv_mm': list(circles[0])}
        matches.append(evidence)
    return matches[0] if len(matches) == 1 else None


def resolve_pcb_drawing_bindings(config, shape, object_id, project, datum_targets=None,
                                 slot_relief_evidence=None):
    intents = [d for d in config.get('drawing_plan', {}).get('dim_intents', []) if d.get('id') in KINDS]
    if not intents:
        return {}
    strategy = config.get('drawing_intent', {}).get('datum_strategy', {})
    authored_datums = (strategy.get('primary') == 'plate_top_face'
                       and strategy.get('secondary') == 'left_front_mounting_hole'
                       and strategy.get('tertiary') == 'right_front_mounting_hole')
    if authored_datums and datum_targets is not None:
        datum_targets.update({letter: {'status': 'unresolved', 'view': view, 'source': 'freecad_runtime'}
                              for letter, view in [('A', 'front'), ('B', 'top'), ('C', 'top')]})
    bindings = {}
    for di in intents:
        kind, feature, axis = KINDS[di['id']]
        bindings[('top', di['id'], di.get('feature', ''))] = {
            'status': 'unresolved', 'reason': 'pcb_feature_geometry_unresolved', 'source': 'freecad_runtime',
            'model_object_id': object_id, 'feature_id': feature, 'dimension_kind': kind, 'axis': axis,
            'measurement': 'pcb_hole_diameter' if axis is None else 'pcb_linear_reference'}
    specs = {s['id']: s for s in config.get('shapes', [])}
    plate, slot = specs.get('plate', {}), specs.get('slot', {})
    if (not shape.isValid() or len(shape.Solids) != 1 or plate.get('type') != 'box'
            or plate.get('rotation') or slot.get('type') != 'box' or slot.get('rotation')):
        return bindings
    x0, y0, z0 = plate.get('position', [0, 0, 0])
    x1, y1, z1 = x0+plate['length'], y0+plate['width'], z0+plate['height']
    plate_bounds = [x0, y0, z0, x1, y1, z1]
    plate_edges = [_edge(shape, a, b, object_id) for a, b in [
        ([x0, y0, z1], [x1, y0, z1]), ([x0, y0, z1], [x0, y1, z1]),
        ([x0, y0, z0], [x1, y0, z0]), ([x1, y0, z0], [x1, y0, z1])]]
    holes = [_hole(shape, specs[key], z0, z1, object_id, project) if key in specs else None for key in HOLES]
    valid_holes = all(holes) and len({h['face_ref'] for h in holes}) == 4
    if authored_datums and datum_targets is not None:
        if all(plate_edges):
            top_faces = [i for i, face in enumerate(shape.Faces, 1)
                         if type(face.Surface).__name__ == 'Plane'
                         and _same(face.BoundBox.ZMin, z1) and _same(face.BoundBox.ZMax, z1)
                         and any(plate_edges[0][0].isSame(edge) for edge in face.Edges)]
            _, front, _, _ = project(plate_edges[0][0], 'front')
            if len(top_faces) == 1:
                datum_targets['A'].update(status='resolved', feature_id='plate_top_face',
                    geometry_ref=f'{object_id}:Face{top_faces[0]}', edge_ref=plate_edges[0][1],
                    point_3d_mm=[(x0+x1)/2, y0, z1], point_uv_mm=[(front[0]+front[2])/2, front[1]])
        if valid_holes:
            for letter, member in zip(('B', 'C'), holes[:2]):
                datum_targets[letter].update(status='resolved', feature_id=member['feature_id'],
                    geometry_ref=member['upper_edge_ref'], face_ref=member['face_ref'],
                    point_3d_mm=[*member['center_xy_mm'], z1], point_uv_mm=member['circle_uv_mm'][:2])
    sx0, sy0, _ = slot.get('position', [0, 0, 0])
    sx1, sy1 = sx0+slot['length'], sy0+slot['width']
    slot_points = [[sx0, sy0, z1], [sx1, sy0, z1], [sx1, sy1, z1], [sx0, sy1, z1]]
    clearance_bounds = [sx0, sy0, z0, sx1, sy1, z1]
    has_relief = RADIUS_FIELD in slot
    relief = slot_relief_evidence or {}
    verified_relief = (has_relief and relief.get('geometry_verification') == 'measured'
                       and relief.get('final_shape_id') == object_id
                       and _vector_equal(relief.get('clearance_bounds_mm'), clearance_bounds))
    edge_points = [(point, slot_points[(i + 1) % 4]) for i, point in enumerate(slot_points)]
    if verified_relief:
        # Y-min/max straight walls keep their original ends. The X-side walls
        # stop at the convex joins with the outward semicircles.
        inset = 2 * slot[RADIUS_FIELD]
        edge_points[1] = ([sx1, sy0 + inset, z1], [sx1, sy1 - inset, z1])
        edge_points[3] = ([sx0, sy1 - inset, z1], [sx0, sy0 + inset, z1])
    slot_edges = [_edge(shape, a, b, object_id) for a, b in edge_points]
    wall_refs = []
    for edge in slot_edges:
        candidates = []
        if edge:
            for index, face in enumerate(shape.Faces, 1):
                if (type(face.Surface).__name__ == 'Plane' and _same(face.BoundBox.ZMin, z0)
                        and _same(face.BoundBox.ZMax, z1) and any(edge[0].isSame(e) for e in face.Edges)):
                    candidates.append(f'{object_id}:Face{index}')
        if len(candidates) == 1:
            wall_refs.extend(candidates)
    valid_slot = all(slot_edges) and len(set(wall_refs)) == 4 and (not has_relief or verified_relief)
    if valid_slot:
        from FreeCAD import Vector
        valid_slot = not shape.isInside(Vector((sx0+sx1)/2, (sy0+sy1)/2, (z0+z1)/2), 1e-7, True)

    for di in intents:
        kind, feature, axis = KINDS[di['id']]
        binding = bindings[('top', di['id'], di.get('feature', ''))]
        if (di.get('view') != 'top' or di.get('feature') != feature
                or di.get('style', 'linear') != ('diameter' if axis is None else 'linear')):
            continue
        points, uv, refs, supplemental = None, None, [], {}
        if kind in ('plate_length', 'plate_width') and all(plate_edges):
            index = 0 if kind == 'plate_length' else 1
            points = [[x0, y0, z1], [x1, y0, z1] if index == 0 else [x0, y1, z1]]
            _, bounds, _, _ = project(plate_edges[index][0], 'top')
            uv = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]]
            refs = [{'feature_id': 'plate', 'geometry_ref': plate_edges[index][1], 'kind': 'edge_endpoint'}] * 2
            supplemental['plate_bounds_mm'] = plate_bounds
        elif kind.startswith('hole_') and valid_holes:
            supplemental.update(member_feature_ids=HOLES, members=holes, plate_bounds_mm=plate_bounds)
            if kind == 'hole_diameter':
                if not all(_same(h['radius_mm'], holes[0]['radius_mm']) for h in holes):
                    continue
                binding.update(status='resolved', reason=None, measured_mm=2*holes[0]['radius_mm'],
                               selected_feature_id='hole1', center_uv=holes[0]['circle_uv_mm'][:2],
                               circle_uv_mm=holes[0]['circle_uv_mm'], **supplemental)
                continue
            indices = (0, 1, 2, 3) if kind == 'hole_pitch_x' else (0, 2, 1, 3)
            a, b, c, d = [holes[i] for i in indices]
            component, other = (0, 1) if axis == 'u' else (1, 0)
            value = b['center_xy_mm'][component]-a['center_xy_mm'][component]
            if (not _same(a['center_xy_mm'][other], b['center_xy_mm'][other])
                    or not _same(c['center_xy_mm'][other], d['center_xy_mm'][other])
                    or not _same(d['center_xy_mm'][component]-c['center_xy_mm'][component], value)):
                continue
            points = [[*h['center_xy_mm'], z1] for h in (a, b)]
            uv = [h['circle_uv_mm'][:2] for h in (a, b)]
            refs = [{'feature_id': h['feature_id'], 'geometry_ref': h['upper_edge_ref'], 'kind': 'circle_center'} for h in (a, b)]
            supplemental['verification_pairs_3d_mm'] = [points, [[*h['center_xy_mm'], z1] for h in (c, d)]]
        elif kind in ('slot_length', 'slot_width', 'slot_position_y') and valid_slot:
            supplemental.update(slot_bounds_mm=clearance_bounds, slot_wall_refs=wall_refs)
            if verified_relief:
                supplemental.update(slot_opening_bounds_mm=relief['opening_bounds_mm'],
                                    slot_relief_radius_mm=relief['corners'][0]['radius_mm'],
                                    slot_relief_face_refs=[corner['face_ref'] for corner in relief['corners']])
            if kind == 'slot_position_y':
                binding['reason'] = 'slot_reference_definition_missing'
                if di.get('reference') != SLOT_REFERENCE or not all(plate_edges):
                    continue
                points = [[sx0, y0, z1], [sx0, sy0, z1]]
                # The reference point must actually lie on the final plate edge.
                import Part
                from FreeCAD import Vector
                if plate_edges[0][0].distToShape(Part.Vertex(Vector(*points[0])))[0] > 1e-6:
                    continue
                _, pb, _, _ = project(plate_edges[0][0], 'top')
                _, sb, _, _ = project(slot_edges[0][0], 'top')
                uv = [[sb[0], pb[1]], [sb[0], sb[1]]]
                refs = [{'feature_id': 'plate', 'geometry_ref': plate_edges[0][1], 'kind': 'edge_point'},
                        {'feature_id': 'slot', 'geometry_ref': slot_edges[0][1], 'kind': 'edge_endpoint'}]
                supplemental.update(explicit_reference=di['reference'], reference_source='drawing_plan.dim_intents.reference',
                                    plate_bounds_mm=plate_bounds)
            elif kind == 'slot_width' and verified_relief:
                points = [slot_points[0], slot_points[3]]
                uv = []
                refs = []
                for index in (0, 2):
                    edge, ref = slot_edges[index]
                    _, bounds, _, _ = project(edge, 'top')
                    uv.append([bounds[0], bounds[1]])
                    refs.append({'feature_id': 'slot', 'geometry_ref': ref, 'kind': 'edge_endpoint'})
            else:
                index = 0 if kind == 'slot_length' else 3
                points = [slot_points[0], slot_points[1] if index == 0 else slot_points[3]]
                _, bounds, _, _ = project(slot_edges[index][0], 'top')
                uv = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]]
                refs = [{'feature_id': 'slot', 'geometry_ref': slot_edges[index][1], 'kind': 'edge_endpoint'}] * 2
        if points and uv:
            component = 0 if axis == 'u' else 1
            measured = abs(uv[1][component]-uv[0][component])
            if measured <= 0 or not _same(measured, abs(points[1][component]-points[0][component])):
                continue
            binding.update(status='resolved', reason=None, measured_mm=measured, endpoints_3d_mm=points,
                           endpoints_uv_mm=uv, bounds=[*uv[0], *uv[1]], reference_refs=refs, **supplemental)
    return bindings


def link_pcb_drawing_bindings(telemetry, traceability):
    for dimension in telemetry.get('plan_dimensions', []):
        binding = dimension.get('runtime_binding') or {}
        measurement = binding.get('measurement')
        if measurement not in ('pcb_linear_reference', 'pcb_hole_diameter', 'legacy_cylindrical_diameter',
                               'bracket_vertical_reference', 'bracket_fillet_radius'):
            continue
        for link in traceability['links']:
            if link.get('dim_id') != dimension.get('dim_id'):
                continue
            link['feature_id'] = None
            if (binding.get('status') == 'resolved' and dimension.get('status') == 'rendered'
                    and dimension.get('rendered') and _same(dimension.get('value_mm'), binding.get('measured_mm'))):
                feature = binding['feature_id']
                link.update(feature_id=feature, source='freecad_runtime', represented_by=dimension['dim_id'],
                            evidence={**binding, 'model_value_mm': binding['measured_mm']},
                            drawing_object_id=dimension.get('drawing_object_id'), svg_element_id=dimension.get('svg_element_id'))
                if not any(f.get('feature_id') == feature for f in traceability['features']):
                    kind = 'measured_bracket_feature' if measurement.startswith('bracket_') else 'measured_pcb_feature'
                    traceability['features'].append({'feature_id': feature, 'type': kind, 'source': 'freecad_runtime'})
    traceability['summary'].update(feature_count=len(traceability['features']),
        linked_dimensions=sum(bool(link.get('feature_id')) for link in traceability['links']),
        unresolved_dimensions=[link['dim_id'] for link in traceability['links'] if not link.get('feature_id')])


def replace_pcb_auto_chains(views_svg, telemetry):
    required = {'MOUNTING_HOLE_PATTERN_X', 'MOUNTING_HOLE_PATTERN_Y'}
    rendered = {d.get('dim_id') for d in telemetry.get('plan_dimensions', [])
                if d.get('rendered') and d.get('status') == 'rendered'
                and d.get('runtime_binding', {}).get('status') == 'resolved'
                and d.get('runtime_binding', {}).get('measurement') == 'pcb_linear_reference'}
    if not required <= rendered:
        return False
    pattern = r'<(?:line|polygon|text)\b[^>]*\bdata-auto-chain="(?:horizontal|vertical)"[^>]*(?:/>|>[^<]*</text>)'
    views_svg['top'] = re.sub(pattern, '', views_svg.get('top', ''))
    for entry in telemetry.get('auto_dimensions', []):
        if entry.get('view') == 'top' and entry.get('category') in ('chain_horizontal', 'chain_vertical'):
            entry.update(status='replaced', rendered=False, reason='verified_pcb_hole_center_patterns',
                         represented_by=sorted(required))
    replaced_conflicts = [c for c in telemetry.get('conflicts', []) if c.get('view') == 'top'
                          and c.get('category') in ('chain_horizontal', 'chain_vertical')]
    telemetry['conflicts'] = [c for c in telemetry.get('conflicts', []) if c not in replaced_conflicts]
    telemetry.setdefault('replacements', []).append({
        'source': 'automatic_mixed_circle_chain_and_config_tool_baseline',
        'reason': 'verified_pcb_hole_center_patterns', 'represented_by': sorted(required),
        'replaced_conflicts': replaced_conflicts})
    return True


def _plan_measurement_identity(entry, context):
    binding = entry.get('runtime_binding') or {}
    if (entry.get('status') != 'rendered' or not entry.get('rendered')
            or binding.get('status') != 'resolved' or binding.get('source') != 'freecad_runtime'
            or not _same(entry.get('value_mm'), binding.get('measured_mm'))):
        return None
    object_id, feature = binding.get('model_object_id'), binding.get('feature_id')
    if not object_id or not feature:
        return None
    if binding.get('measurement') in ('pcb_hole_diameter', 'legacy_cylindrical_diameter'):
        attrs = measurement_attributes(object_id, 'circle', feature, 'Z', 0, binding['measured_mm'])
        attrs.update({'data-center-x': binding['page_center_mm'][0], 'data-center-y': binding['page_center_mm'][1],
                      'data-radius-page-mm': binding['page_radius_mm'], 'data-page-axis': 'circle',
                      'data-scale': 2*binding['page_radius_mm']/binding['measured_mm'], 'data-tolerance-text': '',
                      'data-dimension-source': 'plan'})
        if binding.get('visible_circle_proof') == 'final_projection':
            attrs['data-visible-circle-proof'] = 'final_projection'
        return attrs
    points = binding.get('endpoints_3d_mm')
    page = binding.get('page_endpoints_mm')
    if (not isinstance(points, list) or len(points) != 2 or not isinstance(page, list) or len(page) != 2
            or any(len(p) != 3 for p in points) or any(len(p) != 2 for p in page)):
        return None
    axes = [i for i in range(3) if not _same(points[0][i], points[1][i])]
    if len(axes) != 1:
        return None
    index = axes[0]
    a, b = sorted((points[0][index], points[1][index]))
    if not _same(b-a, binding['measured_mm']):
        return None
    family = 'feature_reference'
    # A whole-body extent and a plate edge share a measurement only if the final
    # body's actual reference planes coincide with those of the measured plate.
    kind = binding.get('dimension_kind')
    if kind in ('plate_length', 'plate_width') and object_id == context.get('model_object_id'):
        plate = binding.get('plate_bounds_mm') or []
        if (len(plate) == 6 and index == (0 if kind == 'plate_length' else 1)
                and _same(a, plate[index]) and _same(b, plate[index+3])
                and _same(a, context['bbox_min_mm'][index]) and _same(b, context['bbox_max_mm'][index])):
            family, feature = 'body_extent', object_id
    if (binding.get('measurement') == 'bracket_vertical_reference' and entry.get('dim_id') == 'HEIGHT'
            and index == 2 and feature == object_id == context.get('model_object_id')
            and _same(a, context['bbox_min_mm'][2]) and _same(b, context['bbox_max_mm'][2])):
        family = 'body_extent'
    attrs = measurement_attributes(object_id, family, feature, 'XYZ'[index], a, b)
    attrs.update({'data-page-axis': binding.get('axis') or ('v' if index == 2 else 'u'),
                  'data-dimension-source': 'plan',
                  'data-reference-a-x': page[0][0], 'data-reference-a-y': page[0][1],
                  'data-reference-b-x': page[1][0], 'data-reference-b-y': page[1][1],
                  'data-scale': math.dist(page[0], page[1])/(b-a), 'data-tolerance-text': ''})
    return attrs


def deduplicate_pcb_overall_dimensions(views_svg, telemetry, model_context):
    """Remove complete repeated reference measurements after verified render."""
    pcb_scope = any(d.get('runtime_binding', {}).get('measurement') == 'pcb_linear_reference'
                    for d in telemetry.get('plan_dimensions', []))
    bracket_scope = any(d.get('runtime_binding', {}).get('measurement') == 'bracket_vertical_reference'
                        for d in telemetry.get('plan_dimensions', []))
    represented = {}
    for entry in telemetry.get('plan_dimensions', []):
        attrs = _plan_measurement_identity(entry, model_context)
        view = entry.get('view')
        if not attrs or view not in views_svg:
            continue
        pattern = r'<text\b(?P<attrs>[^>]*)>(?P<text>[^<]*)</text>'
        matches = [m for m in re.finditer(pattern, views_svg[view])
                   if f'data-dim-id="{entry["dim_id"]}"' in m['attrs']]
        if len(matches) != 1:
            continue
        raw = matches[0]['text'].strip().lstrip('Ø⌀')
        try:
            if not _same(float(raw), entry['value_mm']):
                continue
        except ValueError:
            continue
        addition = ''.join(f' {key}="{escape(str(value), quote=True)}"' for key, value in attrs.items())
        m = matches[0]
        current_attrs = m['attrs']
        for key in attrs:
            current_attrs = re.sub(r'\s' + re.escape(key) + r'''\s*=\s*(["']).*?\1''', '', current_attrs)
        views_svg[view] = views_svg[view][:m.start()] + '<text' + current_attrs + addition + '>' + m['text'] + '</text>' + views_svg[view][m.end():]
        entry['measurement_identity'] = attrs
        if attrs['data-measurement-family'] == 'body_extent':
            represented[(attrs['data-measurement-key'], '')] = entry['dim_id']
    if not pcb_scope and not bracket_scope:
        return
    retained_z = {}
    priorities = {'front': 0, 'top': 1, 'right': 2}
    for entry in sorted(telemetry.get('auto_dimensions', []), key=lambda d: priorities.get(d.get('view'), 9)):
        attrs = entry.get('measurement_identity') or {}
        if attrs.get('data-measurement-family') != 'body_extent' or entry.get('status') != 'rendered':
            continue
        view, annotation = entry['view'], entry['dim_id']
        pattern = (r'<(?:line|polygon|text)\b[^>]*\bdata-annotation-id="' + re.escape(annotation)
                   + r'"[^>]*(?:/>|>[^<]*</text>)')
        members = re.findall(pattern, views_svg.get(view, ''))
        roles = [re.search(r'data-annotation-role="([^"]+)"', member) for member in members]
        roles = [role[1] for role in roles if role]
        labels = [member for member in members if 'data-annotation-role="label"' in member]
        if (any(roles.count(role) != 1 for role in ('extension-a', 'extension-b', 'dimension-line', 'arrow-a', 'arrow-b', 'label'))
                or len(labels) != 1):
            continue
        try:
            if not _same(float(re.search(r'>([^<]*)</text>', labels[0])[1]), entry['value_mm']):
                continue
        except (ValueError, TypeError):
            continue
        identity = (attrs['data-measurement-key'], entry.get('tolerance_text', ''))
        replacement = represented.get(identity)
        if pcb_scope and attrs['data-model-axis'] == 'Z':
            replacement = retained_z.get(identity)
            if replacement is None:
                retained_z[identity] = entry['dim_id']
        if replacement is None:
            continue
        svg, removed = re.subn(pattern, '', views_svg.get(view, ''))
        if removed < 6:
            continue  # No partial deletion of an incomplete/unknown annotation.
        views_svg[view] = svg
        entry.update(status='replaced', rendered=False, reason='verified_model_reference_duplicate', represented_by=replacement)
        telemetry.setdefault('replacements', []).append({'source': annotation,
            'reason': 'verified_model_reference_duplicate', 'represented_by': replacement,
            'measurement_identity': attrs})


def render_pcb_datums(view, bounds, cx, cy, scale, targets):
    """Render only the authored PCB datum features, with measured leader origins."""
    if not targets:
        return None  # Preserve the existing route for other, unsupported recipes.
    u0, v0, u1, v1 = bounds
    bcx, bcy = (u0+u1)/2, (v0+v1)/2
    output = []
    for letter, target in targets.items():
        if target['view'] != view:
            continue
        if target['status'] != 'resolved':
            output.append(f'<text data-dim-id="DATUM_{letter}" data-linear-status="unresolved" '
                          f'data-reason="datum_geometry_unresolved" x="{cx}" y="{cy+35}" fill="#D00">'
                          f'[REVIEW: DATUM {letter}]</text>')
            continue
        u, v = target['point_uv_mm']
        x, y = cx+(u-bcx)*scale, cy-(v-bcy)*scale
        target['page_point_mm'] = [x, y]
        frame_x = x + (-18 if letter == 'B' else 18 if letter == 'C' else 8)
        frame_y = y + (18 if letter in ('B', 'C') else 20)
        output.append(f'<g class="datums-{view}" data-datum-name="{letter}" '
                      f'data-feature-id="{escape(target["feature_id"], quote=True)}" '
                      f'data-geometry-ref="{escape(target["geometry_ref"], quote=True)}" '
                      f'data-reference-x="{x}" data-reference-y="{y}">')
        output.append(f'<line data-datum-leader="true" x1="{x:.2f}" y1="{y:.2f}" '
                      f'x2="{frame_x:.2f}" y2="{frame_y-2.5:.2f}" stroke="#000" stroke-width="0.25"/>')
        # The triangle tip, not a fixed view-box corner, identifies the feature.
        output.append(f'<polygon data-datum-marker="true" points="{x:.2f},{y:.2f} '
                      f'{x-1:.2f},{y+2:.2f} {x+1:.2f},{y+2:.2f}" fill="#000"/>')
        output.append(f'<rect x="{frame_x-2.5:.2f}" y="{frame_y-2.5:.2f}" width="5" height="5" '
                      f'fill="white" stroke="#000" stroke-width="0.25"/>')
        output.append(f'<text x="{frame_x:.2f}" y="{frame_y+1.2:.2f}" text-anchor="middle" '
                      f'font-family="sans-serif" font-size="3.5" fill="#000">{letter}</text></g>')
    return '\n'.join(output)
