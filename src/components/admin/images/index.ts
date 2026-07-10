/**
 * Product image pipeline UI. Import via `@/components/admin/images`.
 */
export { ImageManager } from "./ImageManager";
export type { ImageManagerHandle, ImageManagerProps } from "./ImageManager";
export { PhotoStrip, PhotoStripEmpty } from "./PhotoStrip";
export type { PhotoStripProps } from "./PhotoStrip";
export {
  useImageUploads,
  type UploadItem,
  type UploadPhase,
  type UseImageUploads,
  type UseImageUploadsOptions,
} from "./use-image-uploads";
