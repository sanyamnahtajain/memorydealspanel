"use client";

import * as React from "react";

import { useAccessStatus } from "@/components/access/useAccessStatus";

/**
 * Renders its children for everyone EXCEPT a buyer whose prices are already
 * open — e.g. the home page's "How it works / Request access" explainer, which
 * is noise to an approved shop. The page is cached for anonymous visitors, so
 * this decides on the client once the shared viewer context arrives (one
 * request, already made by the page's other personal pieces).
 */
export function UnapprovedOnly({ children }: { children: React.ReactNode }) {
  const { snapshot } = useAccessStatus();
  if (snapshot?.priceAccess) return null;
  return <>{children}</>;
}
