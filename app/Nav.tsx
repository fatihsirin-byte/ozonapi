"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

interface NavEntry {
  label: string;
  href?: string; // varsa TEK başlık, tıklayınca doğrudan gider; yoksa açılır menü
  items?: NavItem[];
}

// Sekme sayısı arttıkça (2026-09-25'e kadar 11'e çıkmıştı) üst menü taşmaya/uzamaya başladı —
// kullanıcı talebi (2026-09-25): "header menü çok taştı uzun oldu nasıl men sadeceleştirmesi
// yapabiliriz". Konu bazlı gruplandırıldı (Ürünler/Finans/Lojistik) — sadece "Siparişler" en sık
// kullanılan tek başlık olduğu için (kullanıcı onayıyla) düz link olarak kaldı.
const NAV: NavEntry[] = [
  {
    label: "Ürünler",
    items: [
      { href: "/products", label: "Ürünler" },
      { href: "/hs-kod", label: "HS Kod Arama" },
      { href: "/agirlik-bekleyen", label: "Gerçek Ağırlık Bekleyenler" },
      { href: "/import", label: "Shopify İçe Aktar" },
      { href: "/fiyat", label: "Fiyat" },
    ],
  },
  { label: "Siparişler", href: "/orders" },
  {
    label: "Finans",
    items: [
      { href: "/analitik", label: "Analitik" },
      { href: "/kampanyalar", label: "Kampanyalar" },
      { href: "/pnl", label: "Kâr/Zarar" },
      { href: "/finans-mutabakat", label: "Finans Mütabakatı" },
    ],
  },
  {
    label: "Lojistik",
    items: [
      { href: "/iade-iptal", label: "İade & İptaller" },
      { href: "/ase-durumu", label: "ASE Beyanname" },
      { href: "/aladdin-fatura", label: "Aladdin Fatura" },
    ],
  },
];

function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavDropdown({ entry, pathname }: { entry: NavEntry; pathname: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = entry.items!;
  const isActive = items.some((i) => isActiveHref(pathname, i.href));

  // Menü dışına tıklanınca kapat — dokunmatik/mobil'de hover çalışmadığı için tıkla-aç/kapa
  // kullanıyoruz (2026-09-13'te AYRICA eklenen mobil responsive geçişiyle AYNI gerekçe).
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Bir alt bağlantıya gidince (sayfa değişince) açık kalmasın.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="global-nav-dropdown" ref={rootRef}>
      <button
        type="button"
        className={`global-nav-link global-nav-dropdown-trigger${isActive ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        {entry.label} <span className="global-nav-caret">▾</span>
      </button>
      {open && (
        <div className="global-nav-dropdown-menu">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`global-nav-dropdown-item${isActiveHref(pathname, item.href) ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="global-nav">
      <div className="global-nav-inner">
        <span className="global-nav-brand">Ozon Panel</span>
        <div className="global-nav-links">
          {NAV.map((entry) =>
            entry.href ? (
              <Link
                key={entry.label}
                href={entry.href}
                className={`global-nav-link${isActiveHref(pathname, entry.href) ? " active" : ""}`}
              >
                {entry.label}
              </Link>
            ) : (
              <NavDropdown key={entry.label} entry={entry} pathname={pathname} />
            ),
          )}
        </div>
      </div>
    </nav>
  );
}
