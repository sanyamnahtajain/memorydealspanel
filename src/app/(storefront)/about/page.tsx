import type { Metadata } from "next";

import { APP_NAME } from "@/lib/constants";
import { ContentPage } from "@/components/storefront/ContentPage";

export const metadata: Metadata = {
  title: `About us — ${APP_NAME}`,
  description: `${APP_NAME} is a wholesale supplier of mobile accessories, offering trade prices to approved retail buyers.`,
};

export const revalidate = 3600;

export default function AboutPage() {
  return (
    <ContentPage
      title="About us"
      intro={`${APP_NAME} is a wholesale supplier of mobile accessories, built for retailers who buy in volume.`}
    >
      <p>
        We stock a wide range of mobile accessories — chargers, cables, power
        adapters, power banks, earphones, cases, screen guards and car
        accessories — from trusted brands, at genuine wholesale prices. Our
        catalog is made for shop owners and resellers who need reliable stock and
        clear trade pricing.
      </p>

      <h2>Prices on approval</h2>
      <p>
        Because our rates are strictly for the trade, prices are shown only to
        verified, approved buyers. Anyone can browse the full catalog and product
        details; to see prices, request access with your business details and
        we&rsquo;ll review it — usually quickly. Once approved, prices unlock
        across the whole catalog for you.
      </p>

      <h2>Why retailers choose us</h2>
      <ul>
        <li>Honest wholesale pricing, visible only to approved buyers.</li>
        <li>A broad, regularly updated range across all accessory categories.</li>
        <li>Fast browsing, search and filters built for buyers who know what they want.</li>
        <li>Direct enquiry over WhatsApp — no friction, no middlemen.</li>
      </ul>

      <h2>How it works</h2>
      <ol>
        <li>Browse the catalog and add products to your enquiry list.</li>
        <li>Request price access with your business name and contact details.</li>
        <li>Once approved, see wholesale prices and send us your enquiry.</li>
      </ol>

      <p>
        Have a question, or want to become a stockist? Head to our{" "}
        <a href="/contact">contact page</a> — we&rsquo;d love to hear from you.
      </p>
    </ContentPage>
  );
}
