// Gemini bazen geçerli bir JSON objesinin arkasına rastgele bir kuyruk ekliyor
// (nadir bir tekrar/decode artığı) — basit bir regex bunu da yakalayıp JSON.parse'ı
// bozuyordu. Bunun yerine ilk dengeli { ... } bloğunu (string içindeki parantezleri
// saymadan) karakter karakter takip ederek buluyoruz.
export function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("Gemini geçerli bir JSON döndürmedi");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  throw new Error("Gemini geçerli bir JSON döndürmedi (kapanmamış blok)");
}
