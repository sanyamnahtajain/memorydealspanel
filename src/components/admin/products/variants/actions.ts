import { saveProductVariantsAction } from "@/server/actions/variants";
import type { SaveVariantsInput, VariantsActions, VariantsActionResult } from "./types";

/**
 * The wired variants actions — connects the editor's variants section to the
 * real `saveProductVariantsAction` server mutation (batched save + reconcile).
 */
export const variantsActions: VariantsActions = {
  save: (input) => saveProductVariantsAction(input),
};

/**
 * Integration seam between the variants editor UI and the server mutations.
 *
 * The editor never imports `@/server/actions/variants` directly — that module
 * is owned by a parallel workstream (validation schema, DTO/DAL, and the actual
 * `"use server"` mutations). Instead {@link VariantsSection} receives a
 * {@link VariantsActions} object as a prop, and the server page wires the real
 * implementation. This keeps the UI's typecheck independent of the server half
 * and gives a single, obvious place to connect the two.
 *
 * INTEGRATOR — to wire the real save:
 *
 *   // in src/app/admin/products/[id]/page.tsx (or a small client boundary):
 *   import { saveProductVariantsAction } from "@/server/actions/variants";
 *   const actions: VariantsActions = {
 *     save: (input) => saveProductVariantsAction(input),
 *   };
 *   <ProductEditorForm ... variantsActions={actions} />
 *
 * The server action must accept {@link SaveVariantsInput} and return a
 * {@link VariantsActionResult} — echoing back the canonical rows (with real
 * ids) and the recomputed `fromPrice` (= min ACTIVE variant price) so the
 * editor can reconcile. Until it's wired, {@link unwiredVariantsActions} makes
 * the UI degrade gracefully (a clear error toast) rather than crash.
 */

/**
 * Placeholder actions used until the server mutations are connected. Every call
 * resolves to a typed failure so the editor surfaces a toast instead of
 * throwing. Swap this out per the INTEGRATOR note above.
 */
export const unwiredVariantsActions: VariantsActions = {
  async save(_input: SaveVariantsInput): Promise<VariantsActionResult> {
    void _input;
    return {
      ok: false,
      error:
        "Variant saving isn’t connected yet. Wire saveProductVariantsAction (see variants/actions.ts).",
    };
  },
};
