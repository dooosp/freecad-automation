from adapters.common import is_blank, normalize_header, unique_list


class ColumnMapper:
    def __init__(self, row, row_index):
        self.row = row or {}
        self.row_index = row_index
        self.field_map = {}
        self.diagnostics = []

    def pick(self, field_name, keys, default=None, required=False):
        matches = []
        seen = set()
        for key in keys:
            column = normalize_header(key)
            if column in seen:
                continue
            seen.add(column)
            value = self.row.get(column)
            if is_blank(value):
                continue
            matches.append((column, value))

        if matches:
            self.field_map[field_name] = matches[0][0]
            values = unique_list([str(value).strip() for _, value in matches])
            if len(matches) > 1 and len(values) > 1:
                self.diagnostics.append({
                    "code": "ambiguous_field_mapping",
                    "message": f"Row {self.row_index} has conflicting values for {field_name} across columns: {', '.join(column for column, _ in matches)}.",
                    "severity": "warning",
                    "row": self.row_index,
                    "field": field_name,
                    "columns": [column for column, _ in matches],
                    "values": values,
                })
            return matches[0][1]

        if required:
            self.diagnostics.append({
                "code": "missing_field",
                "message": f"Row {self.row_index} missing {field_name}.",
                "severity": "warning",
                "row": self.row_index,
                "field": field_name,
                "columns": [normalize_header(key) for key in keys],
            })
        return default
