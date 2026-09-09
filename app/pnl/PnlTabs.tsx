import Link from "next/link";

const TABS = [
  { key: "tum-siparisler", label: "Tüm Siparişler", href: "/pnl" },
  { key: "kargo-kontrolu", label: "Kargo Kontrolü", href: "/pnl/kargo-kontrolu" },
] as const;

export function PnlTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          style={{
            padding: "8px 14px",
            fontWeight: tab.key === active ? 600 : 400,
            borderBottom: tab.key === active ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab.key === active ? "inherit" : "var(--muted)",
          }}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
