import { Suspense } from "react";
import { AnalyticsView } from "./AnalyticsView";

export default function AnalitikPage() {
  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Analitik</h1>
      </div>
      <Suspense>
        <AnalyticsView />
      </Suspense>
    </div>
  );
}
