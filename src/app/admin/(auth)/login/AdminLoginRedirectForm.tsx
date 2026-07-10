"use client";

import { useRouter } from "next/navigation";
import {
  AdminLoginForm,
  type AdminLoginResult,
  type AdminLoginValues,
} from "@/components/auth/AdminLoginForm";
import { adminLogin } from "@/server/auth/actions";

/**
 * Client wrapper: wires the pure {@link AdminLoginForm} to the canonical
 * `adminLogin` server action (src/server/auth/actions.ts) and performs the
 * post-login redirect to the dashboard.
 *
 * The action's richer discriminated result is adapted here to the form's
 * compact {@link AdminLoginResult} contract, keeping the form action-agnostic.
 */
async function submit(values: AdminLoginValues): Promise<AdminLoginResult> {
  const result = await adminLogin(values.email, values.password, values.totp);
  switch (result.status) {
    case "ok":
      return { status: "ok" };
    case "totp_required":
      return { status: "totp_required" };
    case "invalid_totp":
      return { status: "error", message: "Incorrect authentication code." };
    case "rate_limited":
      return {
        status: "error",
        message: "Too many attempts. Please wait a minute and try again.",
      };
    case "invalid_credentials":
    default:
      return { status: "error", message: "Invalid email or password." };
  }
}

export function AdminLoginRedirectForm() {
  const router = useRouter();
  return (
    <AdminLoginForm
      onSubmit={submit}
      onSuccess={() => {
        router.replace("/admin/dashboard");
        router.refresh();
      }}
    />
  );
}
