import { getCategoryAttributes } from "../ozon/categories";

const DESCRIPTION_CATEGORY_ID = 17028634;
const TYPE_ID = 971081965;

getCategoryAttributes({ descriptionCategoryId: DESCRIPTION_CATEGORY_ID, typeId: TYPE_ID }).then((r) => {
  for (const attr of r.result) {
    if (attr.is_required) {
      console.log(
        `${attr.id}\t${attr.name}\ttype=${attr.type}\tdictionary_id=${attr.dictionary_id}\tcollection=${attr.is_collection}`,
      );
    }
  }
});
