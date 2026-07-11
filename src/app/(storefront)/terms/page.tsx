import type { Metadata } from "next";

import { APP_NAME, CONTACT, LEGAL_UPDATED } from "@/lib/constants";
import { ContentPage } from "@/components/storefront/ContentPage";

export const metadata: Metadata = {
  title: `Terms & conditions — ${APP_NAME}`,
  description: `The terms that govern your use of ${APP_NAME}.`,
};

export const revalidate = 3600;

export default function TermsPage() {
  return (
    <ContentPage
      title="Terms & conditions"
      intro={`The terms that govern your use of ${APP_NAME}.`}
      updated={LEGAL_UPDATED}
    >
      <p>
        These terms govern your access to and use of {APP_NAME}. By browsing the
        catalog, requesting price access, or using an account, you agree to them.
      </p>

      <h2>1. Trade use only</h2>
      <p>
        {APP_NAME} is a wholesale platform intended for retail businesses and
        resellers. Price access is granted at our discretion to buyers we have
        verified as genuine trade customers.
      </p>

      <h2>2. Price access &amp; confidentiality</h2>
      <ul>
        <li>Wholesale prices are shown only to approved, signed-in buyers.</li>
        <li>
          Prices are confidential. You agree not to copy, scrape, publish,
          screenshot for distribution, or share prices with any third party.
        </li>
        <li>
          We may grant, decline, time-limit, extend, or revoke price access at any
          time, and may suspend or block accounts that misuse the service.
        </li>
      </ul>

      <h2>3. Accounts</h2>
      <p>
        You are responsible for keeping your login details secure and for activity
        on your account. Provide accurate business information when requesting
        access; we may revoke access if information is found to be false.
      </p>

      <h2>4. Products, pricing &amp; availability</h2>
      <p>
        We aim to keep product details, stock status and prices accurate, but they
        may change without notice and are subject to availability. Prices shown are
        indicative wholesale rates; final pricing, minimum order quantities (MOQ)
        and taxes are confirmed at the time of order.
      </p>

      <h2>5. Orders &amp; enquiries</h2>
      <p>
        Product enquiries and orders are completed off-platform (for example over
        WhatsApp or phone). Nothing on {APP_NAME} constitutes a binding offer;
        an order is confirmed only when we accept it.
      </p>

      <h2>6. Acceptable use</h2>
      <ul>
        <li>Do not attempt to access prices or data you are not authorised to see.</li>
        <li>Do not use automated tools to scrape the catalog or prices.</li>
        <li>Do not disrupt, probe, or attempt to breach the security of the service.</li>
      </ul>

      <h2>7. Intellectual property</h2>
      <p>
        The {APP_NAME} name, content, and catalog data are our property or that of
        our suppliers, and may not be reused without permission.
      </p>

      <h2>8. Liability</h2>
      <p>
        The service is provided on an &ldquo;as is&rdquo; basis. To the extent
        permitted by law, we are not liable for indirect or consequential losses
        arising from use of the platform.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update these terms from time to time. Continued use after changes
        means you accept the updated terms.
      </p>

      <h2>10. Contact &amp; governing law</h2>
      <p>
        Questions about these terms? Call us on{" "}
        <a href={`tel:${CONTACT.phoneDisplay.replace(/\s/g, "")}`}>
          {CONTACT.phoneDisplay}
        </a>
        . These terms are governed by the laws of India.
      </p>

      <p>
        <em>
          This template is provided as a starting point and should be reviewed by a
          legal professional before you rely on it.
        </em>
      </p>
    </ContentPage>
  );
}
