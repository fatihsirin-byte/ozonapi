import { importProducts, getImportStatus } from "../ozon/products";

const DESCRIPTION_CATEGORY_ID = 17028634; // Электроника > Кабели и переходники
const TYPE_ATTRIBUTE_ID = 8229; // Тип / Type
const TYPE_VALUE_ID = 971081965; // Кабель для мобильных устройств / Mobile Device Cable
const BRAND_ATTRIBUTE_ID = 85; // Бренд / Brand
const NO_BRAND_VALUE_ID = 126745801; // Нет бренда / No brand
const MODEL_NAME_ATTRIBUTE_ID = 9048; // Название модели / Model name

async function main() {
  const { result } = await importProducts([
    {
      offer_id: "TEST-CABLE-001",
      name: "TEST DO NOT SELL - USB Cable",
      price: "5",
      currency_code: "USD",
      category_id: DESCRIPTION_CATEGORY_ID,
      description_category_id: DESCRIPTION_CATEGORY_ID,
      type_id: TYPE_VALUE_ID,
      weight: 50,
      weight_unit: "g",
      width: 100,
      height: 20,
      depth: 100,
      dimension_unit: "mm",
      vat: "0",
      images: ["https://picsum.photos/700"],
      attributes: [
        { id: TYPE_ATTRIBUTE_ID, values: [{ dictionary_value_id: TYPE_VALUE_ID, value: "Кабель для мобильных устройств" }] },
        { id: BRAND_ATTRIBUTE_ID, values: [{ dictionary_value_id: NO_BRAND_VALUE_ID, value: "Нет бренда" }] },
        { id: MODEL_NAME_ATTRIBUTE_ID, values: [{ value: "TEST-CABLE-001" }] },
      ],
    },
  ]);

  console.log("task_id:", result.task_id);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await getImportStatus(result.task_id);
    console.log(JSON.stringify(status.result, null, 2));
    if (status.result.items.every((item) => item.status !== "pending")) {
      break;
    }
  }
}

main().catch((e) => {
  console.error("ERROR", e.status, e.message, JSON.stringify(e.body));
  process.exit(1);
});
