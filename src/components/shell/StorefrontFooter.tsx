import Link from "next/link";
import { MapPin, MessageCircle } from "lucide-react";

import { APP_NAME, APP_TAGLINE, CONTACT } from "@/lib/constants";
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
      { label: "My account", href: "/account" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "FAQ", href: "/faq" },
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
 * Storefront footer: brand blurb, quick links, and contact details. Rendered by
 * StorefrontShell below the page content. Token-styled; works in light/dark.
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
    <footer className="mt-12 border-t border-border bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6">
        <div className="grid gap-8 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          {/* Brand + contact */}
          <div>
            <Logo size={40} withWordmark wordmarkClassName="text-base text-foreground" />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              {APP_TAGLINE}
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  WhatsApp &amp; phone for approved buyers
                </Link>
              </li>
              <li>
                <a
                  href={CONTACT.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MapPin className="size-4" aria-hidden />
                  Find us on Maps
                </a>
              </li>
            </ul>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {col.title}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
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
