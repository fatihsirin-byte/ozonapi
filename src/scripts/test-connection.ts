import { listProducts } from "../ozon/products";

listProducts()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("ERROR", e.status, e.message, JSON.stringify(e.body));
    process.exit(1);
  });
