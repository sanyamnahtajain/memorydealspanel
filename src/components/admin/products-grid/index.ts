/**
 * Products bulk-edit grid — public barrel.
 *
 * Wires the generic DealSheet engine (`@/components/grid`) to real products.
 * Server code projects `PricedProduct` → `ProductRow` via `toProductRow`, then
 * renders `<ProductGrid>`; edits flow back through the `saveProductField`
 * action.
 */

export { ProductGrid, type ProductGridProps } from "./ProductGrid";
export {
  buildProductColumns,
  marginLabel,
  type ProductRow,
} from "./productColumns";
export { toProductRow, toUpdateInput } from "./adapters";
