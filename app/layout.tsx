import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "./Nav";
import { OrderNotifications } from "./OrderNotifications";

export const metadata: Metadata = {
  title: "Ozon Ürün Yönetimi",
  description: "Ozon Seller API ürün açma paneli",
};

// Viewport meta etiketi HİÇ yoktu (2026-09-13, kullanıcı bulgusu: "mobil çok kötü") — bu yüzden
// telefonlar sayfayı ~980px masaüstü genişliğinde render edip küçültüyordu, hem her şey minicik
// görünüyordu HEM DE globals.css'teki "@media (max-width: 700px)" kuralları telefonlarda hiçbir
// zaman tetiklenmiyordu (tarayıcı kendi genişliğini gerçek ekran değil bu sanal 980px sanıyordu).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <Nav />
        {children}
        <OrderNotifications />
      </body>
    </html>
  );
}
