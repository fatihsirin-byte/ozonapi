import { getCategoryTree } from "../ozon/categories";

function flatten(
  nodes: Awaited<ReturnType<typeof getCategoryTree>>["result"],
  path: string[] = [],
  descriptionCategoryId?: number,
): void {
  for (const node of nodes) {
    const currentId = node.description_category_id ?? descriptionCategoryId;
    const currentPath = node.category_name ? [...path, node.category_name] : path;
    if (node.type_id && !node.disabled) {
      console.log(`${currentId}\t${node.type_id}\t${currentPath.join(" > ")} > ${node.type_name}`);
    }
    if (node.children?.length) {
      flatten(node.children, currentPath, currentId);
    }
  }
}

getCategoryTree().then((r) => {
  console.log(`Total top-level categories: ${r.result.length}`);
  flatten(r.result);
});
