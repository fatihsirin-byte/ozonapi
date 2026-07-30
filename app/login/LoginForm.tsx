"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.trim() }),
    });

    setSubmitting(false);

    if (!res.ok) {
      setError("Şifre yanlış");
      return;
    }

    router.push(searchParams.get("next") ?? "/products");
    router.refresh();
  }

  return (
    <div className="card">
      <h1 className="login-title">Ozon Panel</h1>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Şifre</label>
          <div className="password-row">
            <input
              type={showPassword ? "text" : "password"}
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="btn-secondary">
              {showPassword ? "Gizle" : "Göster"}
            </button>
          </div>
        </div>
        {error && <div className="status-banner failed" style={{ marginBottom: 16 }}>{error}</div>}
        <button className="btn-primary" type="submit" disabled={submitting} style={{ width: "100%", marginTop: 4 }}>
          {submitting ? "Kontrol ediliyor..." : "Giriş"}
        </button>
      </form>
    </div>
  );
}
