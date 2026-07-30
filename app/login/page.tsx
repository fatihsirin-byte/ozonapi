import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
