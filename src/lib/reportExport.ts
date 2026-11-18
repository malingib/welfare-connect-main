import { loadXlsx } from './reportExportLibs';

const stamp = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${mi}`;
};

export const createReportFilename = (base: string, ext: 'csv' | 'xlsx' | 'pdf' | 'docx') =>
  `${base}_${stamp()}.${ext}`;

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportRowsToCSV = (
  filename: string,
  rows: Record<string, unknown>[],
  headers: { key: string; label: string }[]
) => {
  const headerLabels = headers.map((h) => h.label);
  const csvRows = [
    headerLabels.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h.key] ?? '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(',')
    ),
  ];

  downloadBlob(filename, new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' }));
};

export const exportRowsToXLSX = async (
  filename: string,
  rows: Record<string, unknown>[],
  headers: { key: string; label: string }[]
) => {
  const XLSX = await loadXlsx();
  const exportData = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h) => {
      obj[h.label] = row[h.key] ?? '';
    });
    return obj;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportData);
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename);
};
