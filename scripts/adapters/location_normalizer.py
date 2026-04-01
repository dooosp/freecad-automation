from adapters.common import slugify


def normalize_location_ref(value):
    slug = slugify(value)
    if not slug:
        return None
    return f"location:{slug}"
