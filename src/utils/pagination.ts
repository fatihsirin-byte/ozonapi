// Geçerli sayfanın etrafında birkaç sayfa numarası, artı her zaman ilk ve son sayfa gösterir;
// aradaki boşluklar "..." ile belirtilir (ör. 1 … 4 5 [6] 7 8 … 20).
export function buildPageList(current: number, totalPages: number, siblings = 1): Array<number | "..."> {
  if (totalPages <= 1) return [1];
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let p = current - siblings; p <= current + siblings; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: Array<number | "..."> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("...");
    result.push(p);
    prev = p;
  }
  return result;
}
