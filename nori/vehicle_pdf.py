"""Text-only scanner PDF extraction, with explicit page provenance."""
from io import BytesIO
from pypdf import PdfReader

MAX_BYTES = 5 * 1024 * 1024

def extract_report(data):
    if not isinstance(data, bytes) or not data.startswith(b'%PDF-'):
        raise ValueError('Choose a PDF report')
    if len(data) > MAX_BYTES:
        raise ValueError('PDF exceeds 5 MB')
    reader = PdfReader(BytesIO(data))
    if reader.is_encrypted:
        raise ValueError('Export an unencrypted report')
    if not 1 <= len(reader.pages) <= 30:
        raise ValueError('Report must contain 1 to 30 pages')
    sections = []
    missing = []
    for number, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or '').strip()
        if not text:
            missing.append(number)
        else:
            sections.append(f'[PDF page {number}]\n{text}')
        if sum(len(part) for part in sections) > 40000:
            raise ValueError('Extracted report exceeds 40000 characters')
    if missing:
        raise ValueError('Some pages have no readable text; OCR or a text export is needed. Pages: ' + ', '.join(map(str, missing)))
    return {'report':'\n\n'.join(sections), 'pages':len(reader.pages),
            'source':'User-supplied PDF text; layout and measurements not independently verified'}

if __name__ == '__main__':
    import sys
    import json
    try:
        result=extract_report(sys.stdin.buffer.read(MAX_BYTES+1))
    except Exception:
        result={'error':'PDF could not be read completely. Use an unencrypted text PDF of at most 30 pages and 5 MB; image-only pages need OCR.'}
    print(json.dumps(result))
