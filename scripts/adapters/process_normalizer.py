from adapters.common import slugify


PROCESS_ALIASES = {
    "drilling": "drill",
    "drilled": "drill",
    "heat_treatment": "heat_treat",
    "heat_treating": "heat_treat",
    "machined": "machining",
    "machine": "machining",
}

INSPECTION_STATUS_ALIASES = {
    "pass": "in_tolerance",
    "passed": "in_tolerance",
    "ok": "in_tolerance",
    "good": "in_tolerance",
    "accept": "in_tolerance",
    "accepted": "in_tolerance",
    "within_tolerance": "in_tolerance",
    "in_tolerance": "in_tolerance",
    "within_spec": "in_tolerance",
    "fail": "out_of_tolerance",
    "failed": "out_of_tolerance",
    "reject": "out_of_tolerance",
    "rejected": "out_of_tolerance",
    "ng": "out_of_tolerance",
    "nok": "out_of_tolerance",
    "out_of_tolerance": "out_of_tolerance",
    "out_of_spec": "out_of_tolerance",
    "oos": "out_of_tolerance",
    "unknown": "unknown",
}

QUALITY_STATUS_ALIASES = {
    "open": "open",
    "new": "open",
    "active": "open",
    "investigating": "open",
    "closed": "closed",
    "resolved": "closed",
    "complete": "closed",
    "completed": "closed",
    "waived": "waived",
    "accepted": "waived",
    "hold": "on_hold",
    "on_hold": "on_hold",
    "pending": "pending",
}

SEVERITY_ALIASES = {
    "critical": "critical",
    "blocker": "critical",
    "high": "high",
    "major": "high",
    "medium": "medium",
    "med": "medium",
    "moderate": "medium",
    "low": "low",
    "minor": "low",
    "info": "info",
    "informational": "info",
}


def normalize_process_step(value):
    slug = slugify(value)
    if not slug:
        return None
    return PROCESS_ALIASES.get(slug, slug)


def normalize_process_ref(value):
    process_step = normalize_process_step(value)
    if not process_step:
        return None
    return f"process:{process_step}"


def normalize_inspection_status(value):
    slug = slugify(value)
    if not slug:
        return None
    return INSPECTION_STATUS_ALIASES.get(slug, slug)


def normalize_quality_status(value):
    slug = slugify(value)
    if not slug:
        return None
    return QUALITY_STATUS_ALIASES.get(slug, slug)


def normalize_severity(value):
    slug = slugify(value)
    if not slug:
        return None
    return SEVERITY_ALIASES.get(slug, slug)
