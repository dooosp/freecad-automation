"""Bounded named-dimension observations from the current FreeCAD shape.

Source primitives select geometry; final boundary faces/edges prove it survived.
Face indices are run-local witnesses, never revision-stable feature identities.
No config nominal is used as an observed measurement.
"""
import math

PROJECTION = {'front': (0, 2), 'top': (0, 1), 'right': (1, 2)}


def _close(a, b):
    return math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-4)


def _ids(value):
    return sorted(set(x.strip() for x in str(value or '').split(',') if x.strip()))


def _measurement(intent, view):
    style = intent.get('style', intent.get('dimension_type', 'linear'))
    if style == 'diameter':
        return 'diameter'
    if style != 'linear' or view not in PROJECTION:
        return None
    key = str(intent.get('id', '')).upper()
    axis = {'THK': 2, 'PLATE_THICKNESS': 2, 'STANDOFF_HEIGHT': 2,
            'TOTAL_LENGTH': 0, 'PLATE_LENGTH': 0, 'PLATE_WIDTH': 1}.get(key)
    if key == 'HEIGHT':
        axis = PROJECTION[view][1]
    elif key == 'WIDTH':
        axis = PROJECTION[view][0]
    return f'extent:{axis}' if axis is not None else None


def _lineage(config):
    states = {s['id']: ({s['id']}, set()) for s in config.get('shapes', [])}
    for op in config.get('operations', []):
        kind = op.get('op')
        base = op.get('base', op.get('target'))
        result = op.get('result', base)
        a, cuts = states.get(base, (set(), set()))
        b, bc = states.get(op.get('tool') if isinstance(op.get('tool'), str) else '', (set(), set()))
        if kind == 'fuse':
            states[result] = (a | b, cuts | bc)
        elif kind == 'cut':
            states[result] = (set(a), cuts | b | bc)
        elif kind in ('fillet', 'chamfer'):
            states[result] = (set(a), set(cuts))
        else:
            # Common and shell need their own material/cutter lineage contract.
            states[result] = (set(), set())
    return states.get(config.get('final', next(reversed(states), '')), (set(), set()))


def _bbox(shape):
    b = shape.BoundBox
    return [b.XMin, b.YMin, b.ZMin], [b.XMax, b.YMax, b.ZMax]


def _axis(vector):
    values = [abs(vector.x), abs(vector.y), abs(vector.z)]
    norm = math.sqrt(sum(x*x for x in values))
    if norm <= 0:
        return None
    found = [i for i, x in enumerate(values) if abs(x/norm - 1) < 1e-8]
    return found[0] if len(found) == 1 else None


def _shared_faces(source_face, final, kind):
    return [(i, face) for i, face in enumerate(final.Faces)
            if isinstance(face.Surface, kind)
            and (kind.__name__ != 'Plane' or face.normalAt(0,0).dot(source_face.normalAt(0,0)) > 1-1e-8)
            and face.common(source_face).Area > 1e-6]


def _opposite_normal(source_face, final_face):
    shared = final_face.common(source_face)
    u,v = source_face.Surface.parameter(shared.CenterOfMass)
    point = source_face.Surface.value(u,v)
    fu,fv = final_face.Surface.parameter(point)
    return source_face.normalAt(u,v).dot(final_face.normalAt(fu,fv)) < -1+1e-8


def _observe(intent, spec, source, final, view, circles, measurement):
    import Part
    lo, hi = _bbox(source)
    uv = PROJECTION[view]
    kind = str(spec.get('type', '')).lower()
    if spec.get('rotation'):
        raise ValueError('rotated_primitive_unsupported')
    if measurement == 'diameter':
        if kind != 'cylinder':
            raise ValueError('diameter_requires_cylinder')
        sides = [f for f in source.Faces if isinstance(f.Surface, Part.Cylinder)]
        if len(sides) != 1 or _axis(sides[0].Surface.Axis) != ({0,1,2} - set(uv)).pop():
            raise ValueError('diameter_axis_not_normal_to_view')
        side = sides[0]
        actual = 2 * side.Surface.Radius
        center = [(lo[i]+hi[i])/2 for i in range(3)]
        circle = [center[uv[0]], center[uv[1]], actual/2]
        witnesses = [(i,f) for i,f in _shared_faces(side, final, Part.Cylinder)
                     if _opposite_normal(side,f)]
        if not witnesses:
            raise ValueError('named_cylindrical_boundary_missing')
        if not any(all(_close(a,b) for a,b in zip(circle,c)) for c in circles):
            raise ValueError('named_projected_circle_missing')
        return dict(feature_id=spec['id'], value_mm=actual, circle_uv=circle,
                    final_face_indices=[i for i,_ in witnesses])

    axis = int(measurement.split(':')[1])
    if axis not in uv:
        raise ValueError('extent_axis_not_visible')
    actual = hi[axis] - lo[axis]
    if kind == 'box':
        endpoint_faces = []
        for endpoint in (lo[axis], hi[axis]):
            caps = [f for f in source.Faces if isinstance(f.Surface, Part.Plane)
                    and _close(_bbox(f)[0][axis], endpoint)
                    and _close(_bbox(f)[1][axis], endpoint)]
            faces = [f for cap in caps for _,f in _shared_faces(cap, final, Part.Plane)]
            if not faces:
                raise ValueError('named_extent_boundary_missing')
            endpoint_faces.append(faces)
        # An actual surviving outer edge gives both endpoints at one footprint.
        # Testing only bbox or solid/face common would also accept internal faces.
        candidates = []
        for edge in source.Edges:
            if type(edge.Curve).__name__ not in ('Line', 'LineSegment') or len(edge.Vertexes) != 2:
                continue
            points = [list(v.Point) for v in edge.Vertexes]
            if not _close(abs(points[1][axis]-points[0][axis]), actual):
                continue
            points.sort(key=lambda p:p[axis])
            if any(not any(f.distToShape(Part.Vertex(*p))[0] < 1e-6 for f in faces)
                   for p,faces in zip(points,endpoint_faces)):
                continue
            shared = [(i, e) for i,e in enumerate(final.Edges)
                      if type(e.Curve).__name__ in ('Line','LineSegment')
                      and e.common(edge).Length > 1e-6]
            if _close(sum(e.common(edge).Length for _,e in shared), actual):
                candidates.append((points, [i for i,_ in shared]))
        if not candidates:
            raise ValueError('named_extent_boundary_missing')
        # Choose the boundary on the authored label side, so a right-side
        # dimension does not start on the opposite edge and cross the part.
        vertical = axis == uv[1]
        placement = intent.get('placement') or {}
        side = placement.get('side',intent.get('placement_side')) or ('right' if vertical else 'bottom')
        lateral = uv[0] if vertical else uv[1]
        prefer_max = side not in ('left','top_left','bottom_left') if vertical else side in ('top','top_left','top_right')
        points, indices = sorted(candidates, key=lambda c: (
            (-1 if prefer_max else 1)*c[0][0][lateral], tuple(c[0][0])))[0]
        witnesses = dict(final_edge_indices=indices)
    elif kind == 'cylinder' and axis == 2:
        sides = [f for f in source.Faces if isinstance(f.Surface, Part.Cylinder)]
        if len(sides) != 1 or _axis(sides[0].Surface.Axis) != axis:
            raise ValueError('extent_cylinder_axis_unsupported')
        side = sides[0]
        shared = [(i,f) for i,f in _shared_faces(side, final, Part.Cylinder)
                  if _close(_bbox(f)[0][axis],lo[axis]) and _close(_bbox(f)[1][axis],hi[axis])]
        caps = [f for f in source.Faces if isinstance(f.Surface, Part.Plane)
                and _close(_bbox(f)[0][axis], hi[axis])]
        if not shared or not any(_shared_faces(cap, final, Part.Plane) for cap in caps):
            raise ValueError('named_extent_boundary_missing')
        center = [(lo[i]+hi[i])/2 for i in range(3)]
        horizontal = uv[0]
        center[horizontal] = lo[horizontal]
        points = [center[:], center[:]]
        points[0][axis], points[1][axis] = lo[axis], hi[axis]
        from FreeCAD import Vector
        line = Part.makeLine(Vector(*points[0]), Vector(*points[1]))
        if not any(_close(f.common(line).Length,actual) for _,f in shared):
            raise ValueError('named_extent_line_missing')
        if any(not any(e.distToShape(Part.Vertex(*p))[0] < 1e-6 for e in final.Edges) for p in points):
            raise ValueError('named_extent_endpoint_missing')
        witnesses = dict(final_face_indices=[i for i,_ in shared])
    else:
        raise ValueError('extent_primitive_unsupported')
    projected = [[p[uv[0]],p[uv[1]]] for p in points]
    return dict(feature_id=spec['id'], value_mm=actual, points_model_mm=points,
                points_uv_mm=projected, **witnesses)


def resolve_named_dimension(intent, config, source_shapes, final, view, circles=()):
    """Return observed endpoints or an explicit unresolved reason, fail closed."""
    base = dict(source='freecad_final_topology', status='unresolved',
                dim_id=intent.get('id',''), feature_ids=_ids(intent.get('feature')),
                view=view, style=intent.get('style','linear'), value_mm=None,
                requirement_ids=[], members=[])
    try:
        if view not in PROJECTION or not final.isValid():
            raise ValueError('unsupported_view_or_invalid_shape')
        measurement = _measurement(intent, view)
        if not measurement:
            raise ValueError('measurement_axis_or_datum_unavailable')
        added, cut = _lineage(config)
        allowed = cut if measurement == 'diameter' else added
        specs = {s['id']: s for s in config.get('shapes', [])}
        if not base['feature_ids'] or any(k not in allowed or k not in source_shapes for k in base['feature_ids']):
            raise ValueError('named_feature_lineage_unavailable')
        for key in base['feature_ids']:
            base['members'].append(_observe(intent, specs[key], source_shapes[key], final,
                                            view, circles, measurement))
        values = [m['value_mm'] for m in base['members']]
        base['value_mm'] = values[0]
        if any(not _close(v,values[0]) for v in values):
            raise ValueError('named_group_measurements_disagree')
        nominal = intent.get('value_mm')
        if not isinstance(nominal, (int,float)) or not math.isfinite(nominal) or not _close(nominal,values[0]):
            raise ValueError('nominal_does_not_match_observation')
        base.update(status='resolved', measurement=measurement)
        first = base['members'][0]
        if measurement == 'diameter':
            base['circles_uv'] = [m['circle_uv'] for m in base['members']]
        else:
            points = first['points_uv_mm']
            base['bounds_uv'] = [min(p[0] for p in points), min(p[1] for p in points),
                                 max(p[0] for p in points), max(p[1] for p in points)]
            base['vertical'] = int(measurement.split(':')[1]) == PROJECTION[view][1]
        # Identity is linked by authored feature + view + measurement meaning.
        # The numeric value corroborates that link; it never chooses the axis.
        matches = [r['id'] for r in config.get('drawing_intent',{}).get('required_dimensions',[])
                   if r.get('id') and _ids(r.get('feature')) == base['feature_ids']
                   and r.get('view') == view and _measurement(r,view) == measurement
                   and isinstance(r.get('value_mm'),(int,float)) and _close(r['value_mm'],values[0])]
        if len(matches) == 1:
            base['requirement_ids'] = matches
    except ValueError as error:
        base.update(status='unresolved', reason=str(error))
    except Exception:
        base.update(status='unresolved', reason='topology_observation_unavailable')
    return base
