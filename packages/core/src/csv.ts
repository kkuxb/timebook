/**
 * RFC 4180 标准 CSV 生成纯函数，支持引号转义与可选 UTF-8 BOM。
 */
function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
  withBom = false,
): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return (withBom ? '\uFEFF' : '') + lines.join('\r\n');
}
