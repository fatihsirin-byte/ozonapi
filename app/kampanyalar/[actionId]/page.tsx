import { Suspense } from "react";
import Link from "next/link";
import { ActionDetail } from "./ActionDetail";

export default async function ActionDetailPage({ params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Kampanya</h1>
        <Link href="/kampanyalar">
          <button className="btn-secondary">← Kampanyalara dön</button>
        </Link>
      </div>
      <Suspense>
        <ActionDetail actionId={Number(actionId)} />
      </Suspense>
    </div>
  );
}
