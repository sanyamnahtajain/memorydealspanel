"use client";

import { useRouter } from "next/navigation";
import {
  CustomerLoginForm,
  type CustomerLoginResult,
  type CustomerLoginValues,
} from "@/components/auth/CustomerLoginForm";
import { customerLogin } from "@/server/auth/actions";

/**
 * Client wrapper: wires the pure {@link CustomerLoginForm} to the canonical
 * `customerLogin` server action (src/server/auth/actions.ts) and redirects to
 * /account on success.
 *
 * The action's result is adapted to the form's {@link CustomerLoginResult}
 * contract. The action returns `blocked` without a reason (it doesn't surface
 * the admin note); the form falls back to its default blocked copy.
 */
async function submit(
  values: CustomerLoginValues,
): Promise<CustomerLoginResult> {
  const result = await customerLogin(values.phone, values.password);
  switch (result.status) {
    case "ok":
      return { status: "ok" };
    case "blocked":
      return { status: "blocked" };
    case "rate_limited":
      return {
        status: "error",
        message: "Too many attempts. Please wait a minute and try again.",
      };
    case "invalid_credentials":
    default:
      return { status: "error", message: "Invalid mobile number or password." };
  }
}

export function CustomerLoginRedirectForm() {
  const router = useRouter();
  return (
    <CustomerLoginForm
      onSubmit={submit}
      onSuccess={() => {
        router.replace("/account");
        router.refresh();
      }}
    />
  );
}
