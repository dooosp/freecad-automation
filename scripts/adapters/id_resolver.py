from adapters.common import slugify


def canonical_ref(prefix, value):
    slug = slugify(value)
    if not slug:
        return None
    return f"{prefix}:{slug}"


def normalize_feature_ref(value):
    return canonical_ref("feature", value)


def normalize_characteristic_ref(value):
    return canonical_ref("characteristic", value)


def normalize_issue_ref(value):
    return canonical_ref("issue", value)
