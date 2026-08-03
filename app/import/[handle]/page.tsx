import { Suspense } from "react";
import { HandleEditor } from "./HandleEditor";

export default async function ImportHandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return (
    <Suspense>
      <HandleEditor handle={decodeURIComponent(handle)} />
    </Suspense>
  );
}
