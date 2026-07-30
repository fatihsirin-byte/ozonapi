// Ozon'un "Rich content" (id 11254) attribute'u için JSON — şema kullanıcının kendi Rich
// content design tool'unda ("Blank page" + tek bir "Text" bloğu) oluşturup kaydettiği gerçek
// çıktıdan alındı (2026-07-30). Riskli/karmaşık widget'lara (görsel, karşılaştırma, video)
// girmiyoruz — sadece doğrulanmış "raTextBlock" widget'ını, kısa paragraflara bölerek
// birden çok blok olarak kullanıyoruz.
const MAX_CHUNK_LENGTH = 400;

function splitIntoChunks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

interface RichTextBlock {
  widgetName: "raTextBlock";
  title?: { items: Array<{ type: "text"; content: string }>; size: string; color: string };
  theme: string;
  padding: string;
  gapSize: string;
  text: {
    size: string;
    align: string;
    color: string;
    items: Array<{ type: "text"; content: string }>;
  };
}

export function buildRichContentJson(descriptionRu: string, title = "Описание"): string {
  const chunks = splitIntoChunks(descriptionRu);
  const content: RichTextBlock[] = chunks.map((chunk, index) => ({
    widgetName: "raTextBlock",
    ...(index === 0
      ? { title: { items: [{ type: "text" as const, content: title }], size: "size5", color: "color1" } }
      : {}),
    theme: "primary",
    padding: "type2",
    gapSize: "m",
    text: {
      size: "size2",
      align: "left",
      color: "color1",
      items: [{ type: "text", content: chunk }],
    },
  }));

  return JSON.stringify({ content, version: 0.3 });
}
