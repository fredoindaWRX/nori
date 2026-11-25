import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { personalFolders } from './personal-files-tools.mjs'

// Create new documents for the owner from Markdown-style text: Word, PDF, Excel,
// Markdown, plain text and CSV. Files are only ever added to Documents/Nori with a
// fresh name; nothing existing is opened, changed or overwritten.
const { zipSync, strToU8 } = createRequire(import.meta.url)('fflate')
const FORMATS = ['docx', 'pdf', 'xlsx', 'md', 'txt', 'csv']
const MAX_CONTENT = 30000

// ---- Markdown-lite -------------------------------------------------------
export function parseBlocks(text) {
  const blocks = [], lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (/^```/.test(line.trim())) {
      const code = []
      while (++i < lines.length && !/^```/.test(lines[i].trim())) code.push(lines[i])
      blocks.push({ type: 'code', text: code.join('\n') }); continue
    }
    let m
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { blocks.push({ type: `h${m[1].length}`, text: m[2].trim() }); continue }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { blocks.push({ type: 'hr' }); continue }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = []
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(lines[i])) continue
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
      }
      i--; blocks.push({ type: 'table', rows }); continue
    }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { blocks.push({ type: 'bullet', text: m[1] }); continue }
    if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { blocks.push({ type: 'number', text: m[2] }); continue }
    const para = [line.trim()]
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:#{1,3}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*\||```)/.test(lines[i + 1])) para.push(lines[++i].trim())
    blocks.push({ type: 'p', text: para.join(' ') })
  }
  return blocks
}

export function parseRuns(text) {
  const runs = [], pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g
  let last = 0, m
  while ((m = pattern.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    const token = m[0]
    runs.push(token.startsWith('**') ? { text: token.slice(2, -2), bold: true }
      : token.startsWith('`') ? { text: token.slice(1, -1), code: true } : { text: token.slice(1, -1), italic: true })
    last = m.index + token.length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs.filter(run => run.text)
}
const plain = text => parseRuns(text).map(run => run.text).join('')

// ---- Word (.docx) --------------------------------------------------------
const xml = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
function wRuns(text, extra = '') {
  return parseRuns(text).map(run => `<w:r><w:rPr>${extra}${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}${run.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(run.text)}</w:t></w:r>`).join('')
}
const wPara = (text, style, extra = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>` : ''}${wRuns(text)}</w:p>`

export function buildDocx(title, content) {
  const body = [wPara(title, 'Title')]
  for (const block of parseBlocks(content)) {
    if (block.type === 'h1') body.push(wPara(block.text, 'Heading1'))
    else if (block.type === 'h2') body.push(wPara(block.text, 'Heading2'))
    else if (block.type === 'h3') body.push(wPara(block.text, 'Heading3'))
    else if (block.type === 'bullet') body.push(wPara(block.text, 'ListParagraph', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'))
    else if (block.type === 'number') body.push(wPara(block.text, 'ListParagraph', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'))
    else if (block.type === 'hr') body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>')
    else if (block.type === 'code') body.push(...block.text.split('\n').map(line => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`))
    else if (block.type === 'table') {
      const cols = Math.max(...block.rows.map(row => row.length))
      const width = Math.floor(9000 / cols)
      const border = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="A0A0A0"/>`).join('') + '</w:tblBorders>'
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="${width * cols}" w:type="dxa"/>${border}</w:tblPr><w:tblGrid>${'<w:gridCol w:w="' + width + '"/>'.repeat(cols)}</w:tblGrid>`
        + block.rows.map((row, r) => '<w:tr>' + Array.from({ length: cols }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${r === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="E7ECF2"/>' : ''}</w:tcPr><w:p>${wRuns(row[c] ?? '', r === 0 ? '<w:b/>' : '')}</w:p></w:tc>`).join('') + '</w:tr>').join('')
        + '</w:tbl>', '<w:p/>')
    } else body.push(wPara(block.text))
  }
  const style = (id, name, run, para = '', basedOn = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>${para}</w:pPr><w:rPr>${run}</w:rPr></w:style>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + style('Title', 'Title', '<w:b/><w:color w:val="1F3864"/><w:sz w:val="52"/>', '<w:spacing w:after="240"/>')
    + style('Heading1', 'heading 1', '<w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/>', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>')
    + style('Heading2', 'heading 2', '<w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/>', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>')
    + style('Heading3', 'heading 3', '<w:b/><w:color w:val="1F3864"/><w:sz w:val="24"/>', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/>')
    + style('ListParagraph', 'List Paragraph', '', '<w:ind w:left="720"/><w:spacing w:after="60"/>')
    + style('Code', 'Code', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>', '<w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>')
    + '</w:styles>'
  const level = (fmt, text) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ''}</w:lvl>`
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0">${level('bullet', '')}</w:abstractNum><w:abstractNum w:abstractNumId="1">${level('decimal', '%1.')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Nori</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'),
    'word/document.xml': strToU8(document), 'word/styles.xml': strToU8(styles), 'word/numbering.xml': strToU8(numbering),
  })
}

// ---- Excel (.xlsx) -------------------------------------------------------
// Sheets come from Markdown tables or CSV lines; "## Name" starts a new sheet.
export function parseSheets(content) {
  const sheets = []
  let current = null
  const start = name => { current = { name: name || `Sheet${sheets.length + 1}`, rows: [] }; sheets.push(current) }
  for (const raw of String(content).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const heading = /^#{1,3}\s+(.*)$/.exec(line)
    if (heading) { start(heading[1].trim()); continue }
    if (!line || /^\|(?:\s*:?-{2,}:?\s*\|)+$/.test(line)) continue
    if (!current) start()
    current.rows.push(line.startsWith('|') ? line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()) : csvRow(line))
  }
  const used = new Set()
  return sheets.filter(sheet => sheet.rows.length).map(sheet => {
    let name = sheet.name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet'
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 27)} (${n})`
    used.add(name.toLowerCase())
    return { ...sheet, name }
  })
}
function csvRow(line) {
  const cells = []; let cell = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false; else cell += c }
    else if (c === '"') quoted = true
    else if (c === ',') { cells.push(cell.trim()); cell = '' }
    else cell += c
  }
  cells.push(cell.trim())
  return cells
}
const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }
function cellXml(value, ref, header) {
  const text = String(value ?? '')
  if (!header && /^=[A-Za-z(]/.test(text)) return `<c r="${ref}"><f>${xml(text.slice(1))}</f></c>`
  const number = text.replace(/[$,%\s]/g, '')
  if (!header && /^-?\d+(?:\.\d+)?$/.test(number) && number.length < 16) {
    const value = text.trim().endsWith('%') ? Number(number) / 100 : Number(number)
    return `<c r="${ref}"${text.trim().endsWith('%') ? ' s="2"' : text.includes('$') ? ' s="3"' : ''}><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(plain(text))}</t></is></c>`
}
export function buildXlsx(title, content) {
  const sheets = parseSheets(content)
  if (!sheets.length) throw Error('A spreadsheet needs at least one table or CSV row')
  const files = {}
  sheets.forEach((sheet, index) => {
    const cols = Math.max(...sheet.rows.map(row => row.length))
    const widths = Array.from({ length: cols }, (_, c) => Math.min(60, Math.max(8, ...sheet.rows.map(row => plain(String(row[c] ?? '')).length + 2))))
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`
      + sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cellXml(value, `${colName(c)}${r + 1}`, r === 0)).join('')}</row>`).join('')
      + '</sheetData></worksheet>')
  })
  return zipSync({
    ...files,
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF2"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="10" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>'),
  })
}

// ---- PDF -------------------------------------------------------------------
// Standard Helvetica/Courier with WinAnsi encoding: no embedded fonts needed.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const HELV_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611,
  389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 }
// Widths of the WinAnsi punctuation above; Latin-1 letters average 556.
const SPECIAL_W = { 0x80: 556, 0x82: 222, 0x84: 333, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000 }
function winAnsi(text) {
  const out = []
  for (const ch of String(text).normalize('NFC')) {
    const code = ch.codePointAt(0)
    out.push(code >= 32 && code < 127 ? code : WIN[ch] ?? (code >= 160 && code <= 255 ? code : 63))
  }
  return out
}
function widthOf(text, font, size) {
  if (font === 'F4') return winAnsi(text).length * 600 * size / 1000
  const table = font === 'F2' ? HELV_BOLD : HELV
  return winAnsi(text).reduce((sum, code) => sum + (code >= 32 && code < 127 ? table[code - 32] : SPECIAL_W[code] ?? 556), 0) * size / 1000
}
const pdfString = text => '(' + winAnsi(text).map(code => code === 40 || code === 41 || code === 92 ? '\\' + String.fromCharCode(code)
  : code < 127 ? String.fromCharCode(code) : '\\' + code.toString(8).padStart(3, '0')).join('') + ')'

export function buildPdf(title, content) {
  const PAGE_W = 612, PAGE_H = 792, MARGIN = 60, WIDTH = PAGE_W - 2 * MARGIN
  const pages = []
  let ops = [], y = 0
  const newPage = () => { ops = []; pages.push(ops); y = PAGE_H - MARGIN }
  const ensure = height => { if (y - height < MARGIN + 20) newPage() }
  const fontFor = run => run.code ? 'F4' : run.bold ? 'F2' : run.italic ? 'F3' : 'F1'
  // Lay out styled runs word by word, wrapping at the available width.
  function flow(runs, { size = 11, indent = 0, lead = 1.4, color = '0 0 0', forceFont } = {}) {
    const words = []
    for (const run of runs) for (const part of run.text.split(/(\s+)/)) if (part) words.push({ text: part, font: forceFont ?? fontFor(run) })
    let line = [], lineW = 0
    const emit = () => {
      ensure(size * lead)
      y -= size * lead
      let x = MARGIN + indent
      ops.push(`${color} rg`)
      for (const word of line) { ops.push(`BT /${word.font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(word.text)} Tj ET`); x += widthOf(word.text, word.font, size) }
      line = []; lineW = 0
    }
    for (const word of words) {
      const w = widthOf(word.text, word.font, size)
      if (/^\s+$/.test(word.text)) { if (line.length) { line.push(word); lineW += w } continue }
      if (lineW + w > WIDTH - indent && line.length) { while (line.length && /^\s+$/.test(line.at(-1).text)) line.pop(); emit() }
      line.push(word); lineW += w
    }
    if (line.length) emit()
  }
  newPage()
  flow([{ text: title, bold: true }], { size: 22, lead: 1.3, color: '0.12 0.22 0.39' })
  y -= 10
  let number = 0
  for (const block of parseBlocks(content)) {
    if (block.type !== 'number') number = 0
    if (/^h[123]$/.test(block.type)) {
      const size = { h1: 16, h2: 13.5, h3: 12 }[block.type]
      ensure(size * 3); y -= 8
      flow(parseRuns(block.text), { size, lead: 1.35, color: '0.18 0.33 0.59', forceFont: 'F2' }); y -= 2
    } else if (block.type === 'bullet' || block.type === 'number') {
      const marker = block.type === 'bullet' ? '•' : `${++number}.`
      ensure(15); ops.push(`0 0 0 rg BT /F1 11 Tf ${(MARGIN + 8).toFixed(2)} ${(y - 15.4).toFixed(2)} Td ${pdfString(marker)} Tj ET`)
      flow(parseRuns(block.text), { indent: 24 }); y -= 3
    } else if (block.type === 'hr') {
      ensure(14); y -= 7; ops.push(`0.6 0.6 0.6 RG 0.5 w ${MARGIN} ${y.toFixed(2)} m ${PAGE_W - MARGIN} ${y.toFixed(2)} l S`); y -= 7
    } else if (block.type === 'code') {
      for (const line of block.text.split('\n')) flow([{ text: line || ' ', code: true }], { size: 9.5, lead: 1.3, indent: 10 })
      y -= 6
    } else if (block.type === 'table') {
      const cols = Math.max(...block.rows.map(row => row.length)), cellW = WIDTH / cols, pad = 4, size = 9.5
      for (const [r, row] of block.rows.entries()) {
        const font = r === 0 ? 'F2' : 'F1'
        const cells = Array.from({ length: cols }, (_, c) => {
          const lines = []; let current = ''
          for (const word of plain(String(row[c] ?? '')).split(/\s+/).filter(Boolean)) {
            const next = current ? `${current} ${word}` : word
            if (widthOf(next, font, size) > cellW - 2 * pad && current) { lines.push(current); current = word } else current = next
          }
          if (current || !lines.length) lines.push(current)
          return lines
        })
        const height = Math.max(...cells.map(lines => lines.length)) * size * 1.3 + 2 * pad
        ensure(height)
        if (r === 0) ops.push(`0.906 0.925 0.949 rg ${MARGIN} ${(y - height).toFixed(2)} ${WIDTH} ${height.toFixed(2)} re f`)
        ops.push(`0.63 0.63 0.63 RG 0.5 w ${MARGIN} ${(y - height).toFixed(2)} ${WIDTH} ${height.toFixed(2)} re S`)
        cells.forEach((lines, c) => {
          const x = MARGIN + c * cellW
          if (c) ops.push(`${x.toFixed(2)} ${y.toFixed(2)} m ${x.toFixed(2)} ${(y - height).toFixed(2)} l S`)
          lines.forEach((text, l) => ops.push(`0 0 0 rg BT /${font} ${size} Tf ${(x + pad).toFixed(2)} ${(y - pad - (l + 1) * size * 1.3 + 2).toFixed(2)} Td ${pdfString(text)} Tj ET`))
        })
        y -= height
      }
      y -= 10
    } else { flow(parseRuns(block.text)); y -= 6 }
  }
  // Assemble objects: catalog, pages, 4 fonts, then one content stream + page per page.
  const fonts = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier']
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', null,
    ...fonts.map(name => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)]
  const kids = []
  pages.forEach((pageOps, index) => {
    const footer = `0.45 0.45 0.45 rg BT /F1 9 Tf ${(PAGE_W / 2 - 20).toFixed(2)} 30 Td ${pdfString(`Page ${index + 1} of ${pages.length}`)} Tj ET`
    const stream = [...pageOps, footer].join('\n')
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    const contentId = objects.length - 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${contentId} 0 R >>`)
    kids.push(`${objects.length - 1} 0 R`)
  })
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`
  objects.push(`<< /Title ${pdfString(title)} /Creator (Nori) >>`)
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = []
  for (let i = 1; i < objects.length; i++) { offsets[i] = Buffer.byteLength(out, 'latin1'); out += `${i} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${objects.length - 1} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return { bytes: Buffer.from(out, 'latin1'), pages: pages.length }
}

// ---- Saving ----------------------------------------------------------------
function outputFolder(roots) {
  const documents = roots.get('Documents')
  if (!documents) throw Error('Your Documents folder was not found')
  const folder = join(documents, 'Nori')
  mkdirSync(folder, { recursive: true })
  return folder
}
function freshName(folder, title, ext) {
  const base = String(title).replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Document'
  for (let n = 1; n < 1000; n++) {
    const name = `${base}${n > 1 ? ` (${n})` : ''}.${ext}`
    if (!existsSync(join(folder, name))) return name
  }
  throw Error('Too many documents with that name')
}

export function createDocument({ format, title, content }, { roots = personalFolders() } = {}) {
  if (!FORMATS.includes(format)) throw Error(`Format must be one of: ${FORMATS.join(', ')}`)
  const name = String(title ?? '').trim()
  if (!name || name.length > 200) throw Error('Give the document a short title')
  const body = String(content ?? '')
  if (!body.trim()) throw Error('The document needs some content')
  if (body.length > MAX_CONTENT) throw Error('That document is too long to create in one step')
  // Models often repeat the title as the first heading; the title is already printed.
  const same = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const lines = body.replace(/\r\n?/g, '\n').split('\n'), first = lines.findIndex(line => line.trim())
  const heading = /^#{1,3}\s+(.*)$/.exec(lines[first] ?? '')
  const text = heading && same(plain(heading[1])) === same(name) && format !== 'xlsx' && format !== 'csv'
    ? lines.slice(first + 1).join('\n') : body
  let bytes, pages
  if (format === 'docx') bytes = buildDocx(name, text)
  else if (format === 'xlsx') bytes = buildXlsx(name, body)
  else if (format === 'pdf') ({ bytes, pages } = buildPdf(name, text))
  else if (format === 'csv') bytes = Buffer.from('﻿' + parseSheets(body).flatMap(sheet => sheet.rows)
    .map(row => row.map(cell => /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')).join('\r\n'), 'utf8')
  else bytes = Buffer.from(format === 'md' ? `# ${name}\n\n${text}\n` : `${name}\n\n${text}\n`, 'utf8')
  const folder = outputFolder(roots), file = freshName(folder, name, format)
  writeFileSync(join(folder, file), bytes, { flag: 'wx' })
  return { saved: `Documents/Nori/${file}`, format, size_kb: Math.round(bytes.length / 102.4) / 10, ...(pages ? { pages } : {}) }
}

export function createDocumentTools(options = {}) {
  return {
    documentWorker: true,
    definitions: [{ type: 'function', function: { name: 'create_document',
      description: 'Create and save a new document in the owner\'s Documents/Nori folder. Never overwrites existing files. '
        + 'Formats: docx (Word), pdf, xlsx (Excel), md, txt, csv. Write content in Markdown: # / ## / ### headings, paragraphs, - bullets, 1. numbered items, **bold**, *italic*, | tables |. '
        + 'For xlsx or csv, give the data as Markdown tables or CSV lines; "## Name" starts another sheet; the first row is the header; cells starting with = are formulas such as =SUM(B2:B5).',
      parameters: { type: 'object', additionalProperties: false, required: ['format', 'title', 'content'],
        properties: { format: { type: 'string', enum: FORMATS }, title: { type: 'string', maxLength: 200 },
          content: { type: 'string', maxLength: MAX_CONTENT } } } } }],
    async call(name, args) {
      if (name !== 'create_document') throw Error('Unknown document tool')
      return JSON.stringify(createDocument(args ?? {}, options))
    },
  }
}
