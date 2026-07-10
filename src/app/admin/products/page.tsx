import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageIcon, PlusIcon, TablePropertiesIcon } from "lucide-react";

import { getViewer } from "@/server/auth/viewer";
import { isAdmin } from "@/server/types/viewer";
import { listAll } from "@/server/dal/categories";
import { listProductsAction } from "@/server/actions/products";
import {
  productSortSchema,
  type ListProductsInput,
  type ProductSort,
} from "@/server/actions/product-list-schema";
import { entityStatusSchema } from "@/lib/schemas/shared";
import { PAGE_SIZES } from "@/lib/constants";
import { AdminShell } from "@/components/shell/AdminShell";
import { PageHeader, PricePill, StatusChip, EmptyState, Pager } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductFilters } from "@/components/admin/products/ProductFilters";
import { ProductRowActions } from "@/components/admin/products/ProductRowActions";
import type { StockStatus } from "@/lib/schemas/shared";

export const metadata: Metadata = {
  title: "Products — MemoryDeals Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STOCK_VARIANT: Record<StockStatus, "inStock" | "low" | "outOfStock"> = {
  IN_STOCK: "inStock",
  LOW: "low",
  OUT_OF_STOCK: "outOfStock",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Admin product CRUD list (server component).
 *
 * Re-checks admin access (middleware bounces sessionless traffic, but a
 * customer session can still reach here), reads URL filters, and renders a
 * responsive table with thumbnail, name, sku, category, price and status.
 * Row actions (edit / duplicate / toggle / delete) live in a client island.
 *
 * The bulk Excel-style grid is a SEPARATE future route (/admin/products/grid).
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect("/admin/login");
  }

  const params = await searchParams;

  const search = first(params.q);
  const categoryParam = first(params.category);
  const statusParam = first(params.status);
  const sortParam = first(params.sort);
  const pageParam = Number(first(params.page) ?? "1");

  const statusParsed = entityStatusSchema.safeParse(statusParam);
  const sortParsed = productSortSchema.safeParse(sortParam);

  const listInput: ListProductsInput = {
    search: search || undefined,
    categoryId:
      categoryParam && categoryParam !== "all" ? categoryParam : undefined,
    status: statusParsed.success ? statusParsed.data : undefined,
    sort: sortParsed.success ? (sortParsed.data as ProductSort) : "newest",
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const [categories, listResult] = await Promise.all([
    listAll(viewer),
    listProductsAction(listInput),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const products = listResult.ok ? listResult.products : [];
  const total = listResult.ok ? listResult.total : 0;
  const currentPage = listResult.ok ? listResult.page : 1;
  const pageCount = listResult.ok ? listResult.pageCount : 1;
  const listPageSize = listInput.take ?? PAGE_SIZES.admin;
  const hadError = !listResult.ok;

  const hasActiveFilters =
    Boolean(listInput.search) ||
    Boolean(listInput.categoryId) ||
    Boolean(listInput.status);

  return (
    <AdminShell title="Products">
      <div className="space-y-6">
        <PageHeader
          title="Products"
          description={
            total > 0
              ? `${total} product${total === 1 ? "" : "s"} in the catalog.`
              : "Manage your product catalog."
          }
          actions={
            <>
              <Button
                variant="outline"
                render={<Link href="/admin/products/grid" />}
              >
                <TablePropertiesIcon aria-hidden />
                Bulk edit
              </Button>
              <Button render={<Link href="/admin/products/new" />}>
                <PlusIcon aria-hidden />
                New product
              </Button>
            </>
          }
        />

        <ProductFilters categories={categories} />

        {hadError ? (
          <EmptyState
            illustration="no-results"
            title="Couldn't load products"
            description="Something went wrong reading the catalog. Please refresh."
          />
        ) : products.length === 0 ? (
          <EmptyState
            illustration={hasActiveFilters ? "no-results" : "empty-box"}
            title={hasActiveFilters ? "No matching products" : "No products yet"}
            description={
              hasActiveFilters
                ? "Try a different search or clear the filters."
                : "Create your first product to start building the catalog."
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" render={<Link href="/admin/products" />}>
                  Clear filters
                </Button>
              ) : (
                <Button render={<Link href="/admin/products/new" />}>
                  <PlusIcon aria-hidden />
                  New product
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[42%]">Product</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const primary =
                    product.images.find((i) => i.isPrimary) ??
                    product.images[0] ??
                    null;
                  const thumb = primary?.thumbUrl ?? primary?.url ?? null;
                  return (
                    <TableRow key={product.id} className="group">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumb}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              <span className="flex size-full items-center justify-center text-muted-foreground">
                                <PackageIcon className="size-4" aria-hidden />
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={`/admin/products/${product.id}`}
                              className="block truncate font-medium text-foreground transition-fast hover:text-primary focus-visible:underline focus-visible:outline-none"
                            >
                              {product.name}
                            </Link>
                            <p className="truncate font-tabular text-xs text-muted-foreground">
                              {product.sku}
                              {product.brand ? ` · ${product.brand}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {categoryName.get(product.categoryId) ?? "—"}
                      </TableCell>
                      <TableCell>
                        <PricePill paise={product.price} size="sm" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip
                            variant={
                              product.status === "ACTIVE" ? "active" : "inactive"
                            }
                          />
                          <StatusChip
                            variant={STOCK_VARIANT[product.stockStatus]}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <ProductRowActions
                          productId={product.id}
                          productName={product.name}
                          status={product.status}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
            <Pager
              page={currentPage}
              pageCount={pageCount}
              total={total}
              pageSize={listPageSize}
            />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
