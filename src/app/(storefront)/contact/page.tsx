import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME, CONTACT } from "@/lib/constants";
import { ContentPage } from "@/components/storefront/ContentPage";
import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { phoneDisplayForViewer, whatsappContactHrefForViewer } from "@/server/contact";

export const metadata: Metadata = {
  title: `Contact — ${APP_NAME}`,
  description: `Get in touch with ${APP_NAME} for wholesale enquiries and price access.`,
};

// Reads the viewer (cookies) so the phone / WhatsApp lines can be gated.
export const dynamic = "force-dynamic";

/**
 * Contact page. The shop's phone + WhatsApp are shown ONLY to viewers with
 * live price access (owner request: no access ⇒ no way to reach the shop
 * directly). Everyone else sees how to get access instead. The number is
 * minted server-side per viewer, so a gated render never contains it.
 */
export default async function ContactPage() {
  const viewer = await resolveViewer();
  const whatsappHref = whatsappContactHrefForViewer(viewer);
  const phone = phoneDisplayForViewer(viewer);
  const signedIn = isCustomer(viewer);

  return (
    <ContentPage
      title="Contact us"
      intro="Wholesale enquiries, price access, or anything else — reach out and we'll get back to you."
    >
      <h2>Get in touch</h2>
      {whatsappHref && phone ? (
        <ul>
          <li>
            <strong>Phone:</strong>{" "}
            <a href={`tel:${phone.replace(/\s/g, "")}`}>{phone}</a>
          </li>
          <li>
            <strong>WhatsApp:</strong>{" "}
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              Message us on WhatsApp
            </a>
          </li>
          <li>
            <strong>Hours:</strong> {CONTACT.hours}
          </li>
        </ul>
      ) : (
        <>
          <p>
            Our phone and WhatsApp are available to <strong>approved wholesale
            buyers</strong>. Once your access is live, you can message us from any
            product page or right here.
          </p>
          <p>
            {signedIn ? (
              <>
                Check your access status on your{" "}
                <Link href="/account">account page</Link>.
              </>
            ) : (
              <>
                Browse the <Link href="/search">catalog</Link> and tap{" "}
                <strong>See price</strong> on any product to request access with
                your business details.
              </>
            )}
          </p>
          <ul>
            <li>
              <strong>Hours:</strong> {CONTACT.hours}
            </li>
          </ul>
        </>
      )}

      <h2>Visit / write to us</h2>
      <p>
        {CONTACT.addressLines.map((line, i) => (
          <span key={i}>
            {line}
            {i < CONTACT.addressLines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>

      <h2>Looking for prices?</h2>
      <p>
        Wholesale prices are shown to approved buyers only. Browse the catalog and
        tap <strong>See price</strong> on any product to request access with your
        business details — or check your status anytime from your{" "}
        <Link href="/account">account</Link>.
      </p>
    </ContentPage>
  );
}
