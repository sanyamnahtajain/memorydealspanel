"use client";

/**
 * CityField — a Combobox wrapper for entering a customer's city with
 * typo-reducing suggestions.
 *
 * Two suggestion sources, switched by `source`:
 *   - "static" (public request form): a curated list of major Indian cities.
 *     We MUST NOT expose the customer table to anonymous visitors, so the
 *     public form only ever offers this fixed list.
 *   - "customers" (admin): the DISTINCT set of cities already on file, fetched
 *     via `citiesAction`. Lets an admin snap a new customer onto an existing
 *     spelling ("Bengaluru" vs "Bangalore") instead of forking a new variant.
 *
 * Free text is always allowed (allowCreate) — a real city we haven't seen must
 * still be enterable. This is a thin wrapper around the shared `Combobox`
 * (A1's `@/components/ui/combobox`); all keyboard-nav / popover / debounce
 * behaviour lives there.
 */

import * as React from "react";

import { Combobox } from "@/components/ui/combobox";
import { citiesAction } from "@/server/actions/suggestions";

/**
 * Curated fallback list for the PUBLIC access-request form. Deliberately a
 * static constant (not a DB query) so we never leak the customer roster to
 * anonymous visitors. Ordered by population/commercial relevance for wholesale
 * electronics buyers; free entry covers everything not listed.
 */
export const INDIAN_CITIES: readonly string[] = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Ahmedabad",
  "Chennai",
  "Kolkata",
  "Pune",
  "Jaipur",
  "Surat",
  "Lucknow",
  "Kanpur",
  "Nagpur",
  "Indore",
  "Thane",
  "Bhopal",
  "Visakhapatnam",
  "Patna",
  "Vadodara",
  "Ghaziabad",
  "Ludhiana",
  "Agra",
  "Nashik",
  "Faridabad",
  "Meerut",
  "Rajkot",
  "Varanasi",
  "Srinagar",
  "Aurangabad",
  "Dhanbad",
  "Amritsar",
  "Navi Mumbai",
  "Prayagraj",
  "Ranchi",
  "Howrah",
  "Coimbatore",
  "Jabalpur",
  "Gwalior",
  "Vijayawada",
  "Jodhpur",
  "Madurai",
  "Raipur",
  "Kota",
  "Guwahati",
  "Chandigarh",
  "Solapur",
  "Hubli-Dharwad",
  "Mysuru",
  "Tiruchirappalli",
  "Bareilly",
  "Aligarh",
  "Tiruppur",
  "Moradabad",
  "Gurugram",
  "Noida",
  "Jalandhar",
  "Bhubaneswar",
  "Salem",
  "Warangal",
  "Guntur",
  "Bhiwandi",
  "Saharanpur",
  "Gorakhpur",
  "Bikaner",
  "Amravati",
  "Jamshedpur",
  "Bhilai",
  "Cuttack",
  "Kochi",
  "Dehradun",
  "Ajmer",
  "Mangaluru",
  "Udaipur",
  "Siliguri",
  "Nellore",
  "Erode",
  "Belagavi",
  "Kolhapur",
  "Thiruvananthapuram",
  "Thrissur",
  "Kozhikode",
  "Panaji",
];

export interface CityFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  /**
   * Where suggestions come from. `"static"` = curated public list (safe for
   * anonymous forms); `"customers"` = DISTINCT admin customer cities.
   */
  source: "static" | "customers";
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  autoComplete?: string;
  className?: string;
}

/**
 * Async fetcher for the admin source. Bounded DISTINCT query on the server;
 * we filter/rank client-side inside the Combobox. Returns the static list as a
 * hard fallback if the action fails so the field is never emptied on error.
 */
async function fetchCustomerCities(query: string): Promise<string[]> {
  try {
    const res = await citiesAction(query);
    if (res.ok && res.values.length > 0) return res.values;
  } catch {
    /* fall through to static */
  }
  return INDIAN_CITIES.slice();
}

export function CityField({
  value,
  onValueChange,
  source,
  id,
  name,
  placeholder = "Mumbai",
  disabled,
  autoComplete = "address-level2",
  className,
  ...aria
}: CityFieldProps) {
  return (
    <Combobox
      id={id}
      name={name}
      value={value}
      onValueChange={onValueChange}
      // Static list is passed inline; admin list streams in via onSearch.
      options={source === "static" ? INDIAN_CITIES : undefined}
      onSearch={source === "customers" ? fetchCustomerCities : undefined}
      allowCreate
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      emptyMessage="No matching city — press Enter to keep what you typed"
      className={className}
      aria-invalid={aria["aria-invalid"]}
      aria-describedby={aria["aria-describedby"]}
    />
  );
}
