import type { Metadata } from "next";

import { APP_NAME } from "@/lib/constants";
import { ContentPage } from "@/components/storefront/ContentPage";

export const metadata: Metadata = {
  title: `FAQ — ${APP_NAME}`,
  description: `Common questions about buying wholesale on ${APP_NAME}.`,
};

export const revalidate = 3600;

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Why can't I see prices?",
    a: (
      <p>
        Our wholesale prices are for the trade, so they&rsquo;re shown only to
        approved buyers. Browse any product and tap <strong>See price</strong> to
        request access.
      </p>
    ),
  },
  {
    q: "How do I get price access?",
    a: (
      <p>
        Tap <strong>See price</strong> on any product and share your business
        details (business name, contact person and phone number; GST is optional).
        We review requests and approve genuine trade buyers — usually quickly.
        You&rsquo;ll be able to sign in and check your status anytime from your{" "}
        <a href="/account">account</a>.
      </p>
    ),
  },
  {
    q: "How long does approval take?",
    a: (
      <p>
        We aim to review requests promptly during business hours. You&rsquo;ll be
        notified once your access is approved, and prices will unlock across the
        whole catalog.
      </p>
    ),
  },
  {
    q: "Do I need a GST number?",
    a: (
      <p>
        A GST number helps us verify your business faster, but it&rsquo;s optional.
        You can still request access without one.
      </p>
    ),
  },
  {
    q: "Does my access expire?",
    a: (
      <p>
        Access may be granted for a set period. If it expires, you&rsquo;ll see a
        prompt to request renewal — it only takes a moment.
      </p>
    ),
  },
  {
    q: "How do I place an order?",
    a: (
      <p>
        Add products to your enquiry list and send it to us over WhatsApp, or
        contact us directly. We&rsquo;ll confirm availability, minimum order
        quantity and final pricing.
      </p>
    ),
  },
  {
    q: "Are the prices final?",
    a: (
      <p>
        Prices shown are indicative wholesale rates. Final pricing, minimum order
        quantities and taxes are confirmed when you place your order.
      </p>
    ),
  },
];

export default function FaqPage() {
  return (
    <ContentPage
      title="Frequently asked questions"
      intro="Everything you need to know about buying wholesale with us."
    >
      {FAQS.map((item, i) => (
        <section key={i}>
          <h3>{item.q}</h3>
          {item.a}
        </section>
      ))}

      <p>
        Still have a question? <a href="/contact">Contact us</a> — we&rsquo;re
        happy to help.
      </p>
    </ContentPage>
  );
}
