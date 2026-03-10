def classify_outlier(result):
    deviation = result.get("deviation")
    tol_plus = result.get("tolerance_plus")
    tol_minus = result.get("tolerance_minus")
    if deviation is None:
        return None

    upper = tol_plus if tol_plus is not None else 0.0
    lower = tol_minus if tol_minus is not None else -upper
    if deviation > upper:
        direction = "high"
        magnitude = deviation - upper
    elif deviation < lower:
        direction = "low"
        magnitude = lower - deviation
    else:
        return None

    return {
        "record_id": result.get("record_id"),
        "dimension_name": result.get("dimension_name"),
        "direction": direction,
        "magnitude": round(magnitude, 6),
        "status": result.get("status"),
    }


def summarize_inspection(results):
    outliers = []
    summary = {
        "count": len(results or []),
        "out_of_tolerance": 0,
        "in_tolerance": 0,
        "unknown": 0,
    }

    for result in results or []:
        status = (result.get("status") or "unknown").lower()
        if status == "out_of_tolerance":
            summary["out_of_tolerance"] += 1
        elif status == "in_tolerance":
            summary["in_tolerance"] += 1
        else:
            summary["unknown"] += 1

        outlier = classify_outlier(result)
        if outlier:
            outliers.append(outlier)

    outliers.sort(key=lambda item: item["magnitude"], reverse=True)
    return summary, outliers
