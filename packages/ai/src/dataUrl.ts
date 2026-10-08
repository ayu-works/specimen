/** Split `data:image/jpeg;base64,AAAA` into its media type and base64 payload. */
export function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(dataUrl);
  if (!m) return { mediaType: 'image/jpeg', base64: dataUrl };
  return { mediaType: m[1] ?? 'image/jpeg', base64: m[2] ?? '' };
}
