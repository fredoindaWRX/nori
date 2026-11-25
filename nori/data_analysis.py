"""Bounded local CSV statistics. Input is data, never executable code."""
import csv
import hashlib
import io
import math
import statistics


def summarize_csv(raw):
    if len(raw) > 1_000_000:
        raise ValueError('CSV exceeds 1 MB limit')
    reader = csv.reader(io.StringIO(raw.decode('utf-8-sig')), strict=True)
    header = next(reader, [])
    if not header or len(header) > 100 or any(not h or len(h)>120 for h in header) or len(set(header)) != len(header):
        raise ValueError('CSV requires unique nonempty headers, at most 100 columns')
    values = [[] for _ in header]
    missing = [0]*len(header)
    nonnumeric = [0]*len(header)
    count = 0
    for row in reader:
        count += 1
        if count > 10000 or len(row) != len(header):
            raise ValueError('CSV exceeds 10000 rows or contains mismatched columns')
        for i, cell in enumerate(row):
            if not cell.strip():
                missing[i] += 1
                continue
            try:
                number = float(cell)
                if not math.isfinite(number):
                    raise ValueError()
                values[i].append(number)
            except ValueError:
                nonnumeric[i] += 1
    columns = []
    for i, name in enumerate(header):
        item = dict(name=name, numeric_count=len(values[i]), missing_count=missing[i], nonnumeric_count=nonnumeric[i])
        if values[i]:
            item.update(min=min(values[i]), max=max(values[i]), mean=statistics.fmean(values[i]), median=statistics.median(values[i]))
            if not math.isfinite(item['mean']):
                raise ValueError('Numeric range exceeds supported statistics')
        columns.append(item)
    return dict(status='completed', rows=count, columns=columns, source_sha256=hashlib.sha256(raw).hexdigest(),
                scope='Statistics cover numeric cells only; missing and nonnumeric cells are counted separately. No causal conclusions.')
