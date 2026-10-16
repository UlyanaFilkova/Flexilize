const russianInflectionEndings = new Set([
  "", "а", "я", "у", "ю", "е", "и", "ы", "о", "ь", "ью",
  "ой", "ей", "ом", "ем", "ов", "ев", "ам", "ям", "ах", "ях", "ами", "ями",
  "ый", "ий", "ого", "его", "ому", "ему", "ым", "им", "ую", "юю", "ая", "яя",
  "ое", "ее", "ые", "ие", "ых", "их", "ыми", "ими"
]);

export function areRussianInflectionVariants(left: string, right: string) {
  const normalizedLeft = String(left || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
  const normalizedRight = String(right || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
  if (normalizedLeft && normalizedLeft === normalizedRight) return true;
  const first = normalizeWord(left);
  const second = normalizeWord(right);
  if (!first || !second) return false;
  if (Math.abs(first.length - second.length) > 4) return false;

  let prefixLength = 0;
  while (prefixLength < first.length && prefixLength < second.length
    && first[prefixLength] === second[prefixLength]) prefixLength += 1;
  if (prefixLength < 3) return false;

  const stem = first.slice(0, prefixLength);
  if (stem.length < 3 || prefixLength < Math.min(first.length, second.length) - 2) return false;
  return russianInflectionEndings.has(first.slice(prefixLength))
    && russianInflectionEndings.has(second.slice(prefixLength));
}

export function uniqueTranslationForms(values: string[]) {
  const unique: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized || unique.some((saved) => areRussianInflectionVariants(saved, normalized))) continue;
    unique.push(normalized);
  }
  return unique;
}

function normalizeWord(value: string) {
  const normalized = String(value || "").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  return /^[а-я-]+$/u.test(normalized) ? normalized : "";
}
