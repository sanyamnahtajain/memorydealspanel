"use client";

import { FileSpreadsheetIcon, ImagesIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportWizard } from "@/components/admin/import/ImportWizard";
import { BulkImageUpload } from "@/components/admin/import/BulkImageUpload";

/**
 * Client tab switcher for the Import surface: bulk product import from a
 * spreadsheet under "Products", and bulk photo attach (matched to products by
 * the SKU in each filename) under "Images". Kept client-side so switching is
 * instant and each wizard's in-progress state survives a tab change.
 */
export function ImportTabs() {
  return (
    <Tabs defaultValue="products" className="w-full">
      <TabsList>
        <TabsTrigger value="products">
          <FileSpreadsheetIcon className="size-4" aria-hidden />
          Products
        </TabsTrigger>
        <TabsTrigger value="images">
          <ImagesIcon className="size-4" aria-hidden />
          Images
        </TabsTrigger>
      </TabsList>

      <TabsContent value="products" className="mt-6">
        <ImportWizard />
      </TabsContent>

      <TabsContent value="images" className="mt-6">
        <BulkImageUpload />
      </TabsContent>
    </Tabs>
  );
}
