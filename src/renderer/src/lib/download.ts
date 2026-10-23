/**
 * Text handed to the person as a file (2026-10-19): an exported loop. The
 * window's own download, a blob and a link pressed, which the browser and
 * Electron both answer with their own save.
 */
export function saveText(file: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Let go once the browser has taken it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
