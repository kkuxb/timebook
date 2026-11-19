/**
 * 无依赖 RFC-4180 风格 CSV 解析与生成器，支持 UTF-8 BOM、引号内逗号与换行。
 */
export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(rawText: string): ParsedCsv {
  const text = stripBom(rawText);
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      matrix.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      matrix.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    matrix.push(row);
  }

  const nonEmpty = matrix.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let rIdx = 1; rIdx < nonEmpty.length; rIdx += 1) {
    const r = nonEmpty[rIdx];
    const obj: Record<string, string> = {};
    for (let cIdx = 0; cIdx < headers.length; cIdx += 1) {
      obj[headers[cIdx]] = (r[cIdx] ?? '').trim();
    }
    rows.push(obj);
  }

  return { headers, rows };
}

function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  withBom = true,
): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return (withBom ? '\uFEFF' : '') + lines.join('\r\n');
}
