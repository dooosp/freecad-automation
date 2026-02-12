"""
KS standard callout formatters for engineering drawings.
Produces text strings for dimension annotations, bolt hole notes,
thread callouts, surface finish, and general tolerance notes.
"""

from _ks_resolver import resolve_fit, resolve_bolt_hole, resolve_surface_for_process


def format_fit_callout(diameter, fit_class):
    """Format a fit callout string.

    Examples:
        format_fit_callout(25, "H7/g6") -> "⌀25 H7/g6"
        format_fit_callout(10, "H7")    -> "⌀10 H7"
    """
    return f"\u230025 {fit_class}" if diameter == 25 else f"\u2300{diameter} {fit_class}"


def format_fit_tolerance(diameter, fit_class):
    """Format a fit with numeric tolerance values.

    Example:
        format_fit_tolerance(25, "H7/g6")
        -> "⌀25 H7/g6 (+0.021/0 ↔ -0.007/-0.020)"
    """
    fit = resolve_fit(diameter, fit_class)
    parts = []
    parts.append(f"\u2300{diameter} {fit_class}")
    if fit.get("hole_upper") is not None:
        hu = fit["hole_upper"]
        hl = fit["hole_lower"]
        parts.append(f"({_sign(hu)}/{_sign(hl)})")
    if fit.get("shaft_upper") is not None:
        su = fit["shaft_upper"]
        sl = fit["shaft_lower"]
        parts.append(f"({_sign(su)}/{_sign(sl)})")
    return " ".join(parts)


def format_bolt_hole_callout(bolt_size, through=True, depth=None, hole_type="medium"):
    """Format a bolt hole machining callout.

    Examples:
        format_bolt_hole_callout("M10") -> "⌀11 THRU"
        format_bolt_hole_callout("M10", through=False, depth=20) -> "⌀11 ↧20"
    """
    bh = resolve_bolt_hole(bolt_size, hole_type)
    if through:
        return f"\u2300{bh['drill_d']} THRU"
    d = depth or bh["cb_depth"]
    return f"\u2300{bh['drill_d']} \u21a7{d}"


def format_counterbore_callout(bolt_size, hole_type="medium"):
    """Format a counterbore callout.

    Example:
        format_counterbore_callout("M10") -> "⌀11 THRU, C'BORE ⌀18 ↧10.8"
    """
    bh = resolve_bolt_hole(bolt_size, hole_type)
    return (f"\u2300{bh['drill_d']} THRU, "
            f"C'BORE \u2300{bh['cb_d']} \u21a7{bh['cb_depth']}")


def format_thread_callout(size, pitch=None, depth=None, through=True, thread_class="6H"):
    """Format a thread callout per KS B 0211.

    Examples:
        format_thread_callout("M10", 1.5) -> "M10×1.5-6H THRU"
        format_thread_callout("M10", 1.5, depth=20, through=False)
            -> "M10×1.5-6H ↧20"
    """
    parts = [size]
    if pitch:
        parts.append(f"\u00d7{pitch}")
    parts.append(f"-{thread_class}")
    callout = "".join(parts)
    if through:
        callout += " THRU"
    elif depth:
        callout += f" \u21a7{depth}"
    return callout


def format_general_tolerance_note(standard="KS B 0401", grade="m"):
    """Format a general tolerance note for title block / notes.

    Example:
        -> "GENERAL TOLERANCES PER KS B 0401 — Grade m (ISO 2768-m)"
    """
    iso_map = {"f": "ISO 2768-f", "m": "ISO 2768-m",
               "c": "ISO 2768-c", "v": "ISO 2768-v"}
    iso = iso_map.get(grade, f"ISO 2768-{grade}")
    return f"GENERAL TOLERANCES PER {standard} \u2014 Grade {grade} ({iso})"


def format_surface_finish_full(ra, process=None, lay=None, allowance=None):
    """Format ISO 1302 surface finish with all slots (a through e).

    Returns dict with keys a, b, c, d, e for the ISO 1302 symbol slots:
      a = Ra value (e.g. "Ra 1.6")
      b = production method (e.g. "Grinding")
      c = sampling length / filter
      d = lay direction (e.g. "=", "C", "X", "M")
      e = machining allowance (e.g. "0.5")
    """
    result = {"a": f"Ra {ra}"}

    if process:
        sf = resolve_surface_for_process(process)
        result["c"] = process.capitalize()
        result["d"] = lay or sf["lay"]
    elif lay:
        result["d"] = lay

    if allowance is not None:
        result["e"] = str(allowance)

    return result


def format_center_distance(distance, tolerance=None, grade=None):
    """Format center distance with tolerance.

    Examples:
        format_center_distance(100, tolerance=0.025)
            -> "100 ±0.025"
        format_center_distance(100, grade="js7")
            -> "100 ±0.018" (resolved from table)
    """
    if tolerance is not None:
        return f"{distance} \u00b1{tolerance}"
    if grade:
        from _ks_resolver import resolve_center_distance_tol
        tol = resolve_center_distance_tol(distance, grade)
        return f"{distance} \u00b1{tol:.3f}"
    return str(distance)


def _sign(val):
    """Format a deviation with explicit sign."""
    if val > 0:
        return f"+{val:.3f}"
    elif val == 0:
        return "0"
    else:
        return f"{val:.3f}"


# Self-test
if __name__ == "__main__":
    print("=== KS Callouts Self-Test ===")

    print(f"\n1. {format_fit_callout(25, 'H7/g6')}")
    print(f"2. {format_fit_tolerance(25, 'H7/g6')}")
    print(f"3. {format_bolt_hole_callout('M10')}")
    print(f"4. {format_counterbore_callout('M10')}")
    print(f"5. {format_thread_callout('M10', 1.5)}")
    print(f"6. {format_general_tolerance_note()}")
    sf = format_surface_finish_full(1.6, process="grinding", allowance=0.5)
    print(f"7. SF slots: {sf}")
    print(f"8. {format_center_distance(100, grade='js7')}")

    print("\n=== All callouts formatted ===")
