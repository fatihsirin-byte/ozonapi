import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./Nav";
import { OrderNotifications } from "./OrderNotifications";

export const metadata: Metadata = {
  title: "Ozon Ürün Yönetimi",
  description: "Ozon Seller API ürün açma paneli",
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
