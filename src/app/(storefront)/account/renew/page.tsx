import { redirect } from "next/navigation";

/**
 * Legacy renewal URL (/account/renew) — old links and bookmarks land here.
 * The renewal flow now lives on the account page as a one-tap dialog, so
 * this permanently forwards into it with the dialog auto-opened.
 */
export default function AccountRenewPage(): never {
  redirect("/account?renew=1");
}
