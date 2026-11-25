"""Document extraction helper executed in Smith's isolated Python environment."""
import hashlib
import json
from pathlib import Path
import zipfile

LIMIT = 24000


def extract(path):
    path = Path(path)
    raw = path.read_bytes()
    if len(raw) > 512 * 1024:
        raise ValueError('Document exceeds the isolated 512 KB input limit')
    suffix = path.suffix.lower()
    sections = []
    used = 0
    truncated = False

    def add(label, text):
        nonlocal used, truncated
        room = max(0, LIMIT-used)
        sections.append({'location':label, 'text':text[:room]})
        used += min(len(text), room)
        if len(text) > room: truncated = True
        return used < LIMIT

    if suffix in {'.txt', '.md', '.csv', '.json'}:
        text = raw.decode('utf-8-sig')
        if suffix == '.json': json.loads(text)
        add('document', text)
    elif suffix == '.pdf':
        from pypdf import PdfReader
        pdf = PdfReader(path)
        if pdf.is_encrypted: raise ValueError('Encrypted PDF requires a supported unlocking workflow')
        for i, page in enumerate(pdf.pages):
            if i >= 100:
                truncated = True
                break
            if not add('page '+str(i+1), page.extract_text() or ''):
                truncated = truncated or i+1 < len(pdf.pages)
                break
    elif suffix == '.xlsx':
        with zipfile.ZipFile(path) as archive:
            if len(archive.infolist()) > 2000 or sum(i.file_size for i in archive.infolist()) > 20_000_000:
                raise ValueError('Workbook expansion limit exceeded')
        from openpyxl import load_workbook
        book = load_workbook(path, read_only=True, data_only=False, keep_links=False)
        try:
            for sheet in book:
                if sheet.max_column and sheet.max_column > 100: raise ValueError('Workbook exceeds 100 columns')
                for i, row in enumerate(sheet.iter_rows(values_only=True)):
                    if i >= 1000:
                        truncated = True
                        break
                    if not add(sheet.title+'!row '+str(i+1), json.dumps(list(row), default=str)):
                        truncated = True
                        break
                if used >= LIMIT: break
        finally: book.close()
    else:
        raise ValueError('Supported formats: UTF-8 TXT, MD, CSV, JSON, PDF, XLSX')
    return {'status':'completed', 'source_sha256':hashlib.sha256(raw).hexdigest(), 'sections':sections,
            'truncated':truncated, 'scope':'Extracted text only. No PDF OCR; Excel formulas are text and are not calculated.'}


if __name__ == '__main__':
    import sys
    print(json.dumps(extract(sys.argv[1]), ensure_ascii=True))
