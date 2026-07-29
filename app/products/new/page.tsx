import { ProductWizard } from "./ProductWizard";

export default function NewProductPage() {
  return (
    <div className="page">
      <div className="topbar">
        <h1>Yeni Ürün</h1>
      </div>
      <ProductWizard />
    </div>
  );
}
