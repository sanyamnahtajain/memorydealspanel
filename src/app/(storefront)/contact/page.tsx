import type { Metadata } from "next";

import { APP_NAME, CONTACT } from "@/lib/constants";
import { ContentPage } from "@/components/storefront/ContentPage";

export const metadata: Metadata = {
  title: `Contact — ${APP_NAME}`,
  description: `Get in touch with ${APP_NAME} for wholesale enquiries and price access.`,
};

export const revalidate = 3600;

export default function ContactPage() {
  return (
    <ContentPage
      title="Contact us"
      intro="Wholesale enquiries, price access, or anything else — reach out and we'll get back to you."
    >
      <h2>Get in touch</h2>
      <ul>
        <li>
          <strong>Phone:</strong>{" "}
          <a href={`tel:${CONTACT.phoneDisplay.replace(/\s/g, "")}`}>
            {CONTACT.phoneDisplay}
          </a>
        </li>
        <li>
          <strong>WhatsApp:</strong>{" "}
          <a
            href={`https://wa.me/${CONTACT.whatsappNumber}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Message us on WhatsApp
          </a>
        </li>
        <li>
          <strong>Hours:</strong> {CONTACT.hours}
        </li>
      </ul>

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
        <a href="/account">account</a>.
      </p>
    </ContentPage>
  );
}
