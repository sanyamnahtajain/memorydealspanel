import { z } from "zod";

import {
  entityStatusSchema,
  objectIdSchema,
  stockStatusSchema,
} from "@/lib/schemas/shared";
import { PAGE_SIZES } from "@/lib/constants";
import type { PricedProduct } from "@/server/dto/product";

/**
 * Plain (non-"use server") schemas and types backing the admin product list.
 *
 * These live outside `actions/products.ts` because that module is marked
 * `"use server"`, and Next.js forbids a server-action module from exporting
 * anything other than async functions. Server components and client islands
 * import the schema/type values from here; the action re-exports them for
 * runtime use inside the server module.
 */

export const productSortSchema = z.enum([
  "newest",
  "oldest",
  "name-asc",
  "name-desc",
  "price-asc",
  "price-desc",
]);
export type ProductSort = z.infer<typeof productSortSchema>;

export const listProductsInputSchema = z.object({
  search: z.string().trim().max(160).optional(),
  categoryId: objectIdSchema.optional(),
  status: entityStatusSchema.optional(),
  stockStatus: stockStatusSchema.optional(),
  sort: productSortSchema.default("newest"),
  page: z.number().int().positive().default(1),
  take: z.number().int().positive().max(PAGE_SIZES.max).default(PAGE_SIZES.admin),
  includeDeleted: z.boolean().default(false),
});
export type ListProductsInput = z.input<typeof listProductsInputSchema>;

export interface ListProductsResult {
  products: PricedProduct[];
  total: number;
  page: number;
  pageCount: number;
}
