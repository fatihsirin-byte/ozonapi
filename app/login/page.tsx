import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="page" style={{ maxWidth: 360, paddingTop: 100 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
