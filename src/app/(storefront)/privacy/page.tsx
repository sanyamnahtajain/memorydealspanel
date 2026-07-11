import type { Metadata } from "next";

import { APP_NAME, CONTACT, LEGAL_UPDATED } from "@/lib/constants";
import { ContentPage } from "@/components/storefront/ContentPage";

export const metadata: Metadata = {
  title: `Privacy policy — ${APP_NAME}`,
  description: `How ${APP_NAME} collects, uses and protects your information.`,
};

export const revalidate = 3600;

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Privacy policy"
      intro={`How ${APP_NAME} collects, uses and protects your information.`}
      updated={LEGAL_UPDATED}
    >
      <p>
        This policy explains what information we collect when you use {APP_NAME},
        why we collect it, and the choices you have. By requesting price access or
        using your account, you agree to this policy.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Access request details</strong> you provide: business name,
          contact person, phone number, and optionally GST number, email and city.
        </li>
        <li>
          <strong>Account information</strong>: your login phone number and a
          securely hashed password (we never store your password in plain text).
        </li>
        <li>
          <strong>Usage information</strong>: pages and products you view while
          signed in, and basic technical data (device, browser) needed to run the
          service securely.
        </li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To verify that you are a genuine trade buyer and to approve, extend or revoke price access.</li>
        <li>To show you wholesale prices once you are approved.</li>
        <li>To respond to your enquiries and provide customer support.</li>
        <li>To keep the service secure — including preventing misuse and unauthorised access to pricing.</li>
      </ul>

      <h2>How we protect pricing</h2>
      <p>
        Wholesale prices are commercially sensitive. They are shown only to
        approved, signed-in buyers and are never included in pages served to the
        public. We apply access controls, rate limiting and monitoring to keep
        prices confidential.
      </p>

      <h2>Sharing</h2>
      <p>
        We do not sell your information. We share it only with service providers
        who help us operate {APP_NAME} (such as hosting and messaging), under
        appropriate safeguards, or where required by law.
      </p>

      <h2>Retention</h2>
      <p>
        We keep your information for as long as your account is active or as needed
        to provide the service and meet legal obligations. You can ask us to delete
        your account and associated data.
      </p>

      <h2>Cookies &amp; sessions</h2>
      <p>
        We use a secure, http-only session cookie to keep you signed in. We do not
        use advertising trackers.
      </p>

      <h2>Your choices</h2>
      <p>
        You can request access to, correction of, or deletion of your personal
        information by contacting us on{" "}
        <a href={`tel:${CONTACT.phoneDisplay.replace(/\s/g, "")}`}>
          {CONTACT.phoneDisplay}
        </a>{" "}
        or via our Contact page.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy from time to time. The effective date above shows
        when it was last revised.
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
