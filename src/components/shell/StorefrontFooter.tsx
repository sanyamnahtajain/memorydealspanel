import Link from "next/link";
import { ArrowUpRight, Clock, MapPin, MessageCircle } from "lucide-react";

import { APP_NAME, APP_SLOGAN, APP_TAGLINE, CONTACT } from "@/lib/constants";
import { Logo } from "@/components/brand/Logo";
import { SlabyBadge } from "@/components/slaby/SlabyMark";
import { useSlabyBranding } from "@/components/slaby/useSlabyBranding";
import { slabyPlacementOn } from "@/lib/slaby/branding";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Shop",
    links: [
      { label: "All products", href: "/search" },
      { label: "Categories", href: "/categories" },
      { label: "Brands", href: "/brands" },
      { label: "My account", href: "/account" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "FAQ", href: "/faq" },
      { label: "Request access", href: "/account/request-access" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms & conditions", href: "/terms" },
    ],
  },
];

/**
 * Storefront footer — DESKTOP ONLY (StorefrontShell wraps it in `hidden
 * md:block`; owner request: the app-like phone view ends at the tab bar).
 *
 * Layout: hairline top rule → brand block with a one-line positioning →
 * three link columns → contact row (WhatsApp via /contact, Maps, hours) →
 * small print with the owner-toggleable "Built with Slaby" badge.
 *
 * NO phone / WhatsApp number here (owner request): this footer is part of the
 * client shell on every page, so anything in it ships to every visitor. The
 * shop's number is gated per viewer and surfaces only on product pages and the
 * Contact page for approved buyers — the footer just points there.
 */
export function StorefrontFooter() {
  const year = new Date().getFullYear();
  // "Built with Slaby" (owner-toggleable). Client read — this footer renders
  // inside the client shell on every page, so no server config can reach it.
  const slaby = slabyPlacementOn(useSlabyBranding(), "footer");

  return (
    <footer className="md-surface-soft mt-16 border-t border-foreground/10">
      <div className="mx-auto w-full max-w-6xl px-4 pt-12 pb-8 md:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] md:gap-8">
          {/* Brand block */}
          <div className="max-w-sm">
            <Logo size={40} withWordmark wordmarkClassName="text-base text-foreground" />
            <p className="mt-4 font-heading text-xl font-bold tracking-tight text-balance text-foreground">
              {APP_SLOGAN}
            </p>
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              {APP_TAGLINE}
            </p>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="md-eyebrow">{col.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Contact row */}
        <ul className="mt-10 flex flex-wrap items-center gap-2.5 border-t border-foreground/10 pt-6">
          <li>
            <Link
              href="/contact"
              className="group inline-flex min-h-10 items-center gap-2 rounded-full bg-card px-3.5 text-sm font-medium text-foreground shadow-xs ring-1 ring-foreground/5 outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              <MessageCircle className="size-4 text-success" aria-hidden />
              WhatsApp &amp; phone for approved buyers
              <ArrowUpRight
                className="size-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </Link>
          </li>
          <li>
            <a
              href={CONTACT.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex min-h-10 items-center gap-2 rounded-full bg-card px-3.5 text-sm font-medium text-foreground shadow-xs ring-1 ring-foreground/5 outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              <MapPin className="size-4 text-primary" aria-hidden />
              {CONTACT.addressLines[1]}, {CONTACT.addressLines[2]}
              <ArrowUpRight
                className="size-3.5 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </a>
          </li>
          <li className="inline-flex min-h-10 items-center gap-2 px-2 text-sm text-muted-foreground">
            <Clock className="size-4" aria-hidden />
            {CONTACT.hours}
          </li>
        </ul>

        {/* Small print */}
        <div className="mt-8 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {APP_NAME}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p>Wholesale prices are visible to approved buyers only.</p>
            {slaby ? <SlabyBadge placement="footer" className="-mx-2.5" /> : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
