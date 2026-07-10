"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductSort } from "@/server/actions/product-list-schema";

export interface ProductFiltersProps {
  categories: { id: string; name: string; parentId: string | null }[];
}

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
] as const;

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

/**
 * URL-param filter bar for the products list: debounced search, category and
 * status selects, and a sort select. All state lives in the query string so
 * the server component re-renders with fresh data and the view is shareable.
 */
export function ProductFilters({ categories }: ProductFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get("q") ?? "";
  const currentCategory = searchParams.get("category") ?? "all";
  const currentStatus = searchParams.get("status") ?? "all";
  const currentSort = (searchParams.get("sort") as ProductSort) ?? "newest";

  const [searchDraft, setSearchDraft] = React.useState(currentSearch);

  // Keep the input in sync when the URL changes from outside (e.g. Clear) —
  // the React-recommended "adjust state during render" pattern instead of a
  // setState-in-effect. When the committed URL value changes we snap the draft
  // to it and remember what we synced from.
  const [syncedSearch, setSyncedSearch] = React.useState(currentSearch);
  if (currentSearch !== syncedSearch) {
    setSyncedSearch(currentSearch);
    setSearchDraft(currentSearch);
  }

  const pushParams = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page"); // any filter change returns to page 1
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  // Debounce search commits so we don't navigate on every keystroke.
  React.useEffect(() => {
    if (searchDraft === currentSearch) return;
    const timer = setTimeout(() => {
      pushParams((params) => {
        if (searchDraft.trim()) params.set("q", searchDraft.trim());
        else params.delete("q");
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft, currentSearch, pushParams]);

  const setParam = (key: string, value: string, clearOn = "all") => {
    pushParams((params) => {
      if (value && value !== clearOn) params.set(key, value);
      else params.delete(key);
    });
  };

  const categoryOptions = React.useMemo(
    () => [
      { value: "all", label: "All categories" },
      ...[...categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          value: c.id,
          label: c.parentId ? `— ${c.name}` : c.name,
        })),
    ],
    [categories],
  );

  const hasFilters =
    currentSearch !== "" ||
    currentCategory !== "all" ||
    currentStatus !== "all" ||
    currentSort !== "newest";

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-4 text-muted-foreground"
        />
        <Input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search name, SKU or brand…"
          aria-label="Search products"
          className="pl-8"
        />
      </div>

      <Select
        value={currentCategory}
        onValueChange={(value) => setParam("category", value as string)}
        items={categoryOptions}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categoryOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentStatus}
        onValueChange={(value) => setParam("status", value as string)}
        items={STATUS_OPTIONS}
      >
        <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentSort}
        onValueChange={(value) =>
          setParam("sort", value as string, "newest")
        }
        items={SORT_OPTIONS}
      >
        <SelectTrigger className="w-full sm:w-44" aria-label="Sort products">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(pathname)}
          className="text-muted-foreground"
        >
          <XIcon aria-hidden />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
