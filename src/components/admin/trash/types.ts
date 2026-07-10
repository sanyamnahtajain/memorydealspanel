/**
 * Serializable view model for a soft-deleted product shown in the Trash. The
 * server page builds these from Prisma rows; all fields are plain JSON so they
 * cross the server → client boundary cleanly.
 */
export interface TrashedProduct {
  id: string;
  name: string;
  sku: string;
  brand: string | null;
  categoryName: string | null;
  /** Primary (or first) image thumbnail URL, if any. */
  imageUrl: string | null;
  /** ISO timestamp the product was soft-deleted. */
  deletedAt: string;
  /** ISO timestamp the product is purged (deletedAt + retention window). */
  purgeAt: string;
}

/** Retention window before a trashed product is permanently purged. */
export const TRASH_RETENTION_DAYS = 30;
