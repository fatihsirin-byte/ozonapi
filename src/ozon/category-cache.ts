import { getCategoryTree, type OzonCategoryTreeNode } from "./categories";

export interface FlatCategory {
  descriptionCategoryId: number;
  typeId: number;
  path: string;
  typeName: string;
}

const TTL_MS = 6 * 60 * 60 * 1000;

let cache: { items: FlatCategory[]; fetchedAt: number } | null = null;
let inflight: Promise<FlatCategory[]> | null = null;

function flatten(nodes: OzonCategoryTreeNode[], path: string[] = [], descriptionCategoryId?: number): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    const currentId = node.description_category_id ?? descriptionCategoryId;
    const currentPath = node.category_name ? [...path, node.category_name] : path;
    if (node.type_id && !node.disabled && currentId) {
      result.push({
        descriptionCategoryId: currentId,
        typeId: node.type_id,
        path: currentPath.join(" > "),
        typeName: node.type_name ?? "",
      });
    }
    if (node.children?.length) {
      result.push(...flatten(node.children, currentPath, currentId));
    }
  }
  return result;
}

async function loadCategories(): Promise<FlatCategory[]> {
  const { result } = await getCategoryTree("TR");
  return flatten(result);
}

// Kategori ağacı büyük ve nadiren değişiyor; her istekte Ozon'a gitmemek için process içi TTL'li cache tutuyoruz.
export async function getFlatCategories(): Promise<FlatCategory[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.items;
  }
  if (!inflight) {
    inflight = loadCategories()
      .then((items) => {
        cache = { items, fetchedAt: Date.now() };
        return items;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function findCategory(descriptionCategoryId: number, typeId: number): Promise<FlatCategory | null> {
  const categories = await getFlatCategories();
  return categories.find((c) => c.descriptionCategoryId === descriptionCategoryId && c.typeId === typeId) ?? null;
}

export async function searchCategories(query: string, limit = 20): Promise<FlatCategory[]> {
  const categories = await getFlatCategories();
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  return categories
    .filter((c) => c.path.toLowerCase().includes(normalized) || c.typeName.toLowerCase().includes(normalized))
    .slice(0, limit);
}
