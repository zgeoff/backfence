// Diacritics fold to their base letter, every other run of non-alphanumerics
// becomes one dash, and the result is empty when nothing survives.
export function toKebab(text: string): string {
  return text
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');
}
