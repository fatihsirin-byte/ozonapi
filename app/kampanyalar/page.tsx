import { Suspense } from "react";
import { CampaignsView } from "./CampaignsView";

export default function KampanyalarPage() {
  return (
    <div className="page-wide">
      <div className="topbar">
        <h1>Kampanyalar</h1>
      </div>
      <Suspense>
        <CampaignsView />
      </Suspense>
    </div>
  );
}
