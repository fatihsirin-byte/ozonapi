"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/products", label: "Ürünler" },
  { href: "/orders", label: "Siparişler" },
  { href: "/import", label: "Shopify İçe Aktar" },
  { href: "/fiyat", label: "Fiyat" },
];

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="global-nav">
      <div className="global-nav-inner">
        <span className="global-nav-brand">Ozon Panel</span>
        <div className="global-nav-links">
          {LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link key={link.href} href={link.href} className={`global-nav-link${isActive ? " active" : ""}`}>
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
