import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DownloadIcon,
  IndianRupeeIcon,
  PackageIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  AppToaster,
  EmptyState,
  PageHeader,
  PricePill,
  SkeletonCard,
  SkeletonProductCard,
  SkeletonRow,
  SkeletonStat,
  StatCard,
  StatusChip,
  type StatusChipVariant,
} from "@/components/common";

import { Demo, Section, Swatch, ThemeDuo } from "./gallery-helpers";
import {
  ConfirmSheetDemo,
  DialogDemo,
  MotionDemo,
  SheetDemo,
  ToastDemo,
} from "./interactive-demos";

export const metadata: Metadata = {
  title: "Design gallery · MemoryDeals",
  robots: { index: false, follow: false },
};

const TOC = [
  ["tokens", "Tokens"],
  ["buttons", "Buttons"],
  ["inputs", "Inputs"],
  ["badges", "Badges"],
  ["tabs", "Tabs"],
  ["page-header", "PageHeader"],
  ["stat-card", "StatCard"],
  ["status-chip", "StatusChip"],
  ["price-pill", "PricePill"],
  ["empty-state", "EmptyState"],
  ["skeletons", "Skeletons"],
  ["table", "Table"],
  ["overlays", "Dialog & Sheet"],
  ["confirm-sheet", "ConfirmSheet"],
  ["toasts", "Toasts"],
  ["motion", "Motion"],
] as const;

const STATUS_VARIANTS: StatusChipVariant[] = [
  "active",
  "inactive",
  "pending",
  "approved",
  "rejected",
  "expired",
  "blocked",
  "inStock",
  "low",
  "outOfStock",
];

const BUTTON_VARIANTS = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

const TABLE_ROWS = [
  { sku: "SD-64-EVO", name: "SanDisk Evo 64GB", stock: "inStock", paise: 42900 },
  { sku: "PD-128-ULT", name: "Ultra Dual Drive 128GB", stock: "low", paise: 89950 },
  { sku: "CB-TYPEC-1M", name: "Type-C braided cable 1m", stock: "outOfStock", paise: 10500 },
] as const;

export default function DesignGalleryPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader
        backHref="/"
        backLabel="Home"
        title="Design gallery"
        description="Every common component in every state, on light and dark, straight from the tokens. Internal review artifact — 404s in production."
        actions={
          <Badge variant="secondary" className="font-tabular">
            Phase 1
          </Badge>
        }
      />

      <nav aria-label="Sections" className="no-scrollbar sticky top-0 z-10 -mx-4 mt-6 overflow-x-auto border-b border-border bg-background/90 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <ul className="flex w-max items-center gap-1">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground transition-fast hover:bg-muted hover:text-foreground"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-10 space-y-14">
        {/* ------------------------------------------------ Tokens */}
        <Section
          id="tokens"
          title="Color tokens"
          description="Semantic palette — components may only reference these."
        >
          <ThemeDuo>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Swatch name="background" className="bg-background" />
              <Swatch name="foreground" className="bg-foreground" />
              <Swatch name="card" className="bg-card" />
              <Swatch name="muted" className="bg-muted" />
              <Swatch name="primary" className="bg-primary" />
              <Swatch name="accent" className="bg-accent" />
              <Swatch name="secondary" className="bg-secondary" />
              <Swatch name="success" className="bg-success" />
              <Swatch name="warning" className="bg-warning" />
              <Swatch name="destructive" className="bg-destructive" />
              <Swatch name="border" className="bg-border" />
              <Swatch name="ring" className="bg-ring" />
            </div>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Buttons */}
        <Section id="buttons" title="Buttons" description="shadcn/ui — all variants and sizes.">
          <ThemeDuo>
            <Demo label="Variants">
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ))}
            </Demo>
            <Demo label="Sizes">
              <Button size="xs">Extra small</Button>
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Add product">
                <PlusIcon />
              </Button>
            </Demo>
            <Demo label="With icon / disabled / loading-style">
              <Button>
                <PlusIcon data-icon="inline-start" />
                Add product
              </Button>
              <Button variant="outline" disabled>
                Disabled
              </Button>
              <Button variant="secondary">
                <DownloadIcon data-icon="inline-start" />
                Export XLSX
              </Button>
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Inputs */}
        <Section id="inputs" title="Inputs & Select" description="Text fields and the select control.">
          <ThemeDuo>
            <Demo label="States" className="max-w-sm flex-col items-stretch gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="in-default">Product name</Label>
                <Input id="in-default" placeholder="e.g. SanDisk Evo 64GB" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="in-value">With value</Label>
                <Input id="in-value" defaultValue="Ultra Dual Drive 128GB" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="in-invalid">Invalid</Label>
                <Input
                  id="in-invalid"
                  aria-invalid
                  defaultValue="-42"
                  aria-describedby="in-invalid-msg"
                />
                <p id="in-invalid-msg" className="text-xs text-destructive">
                  Stock cannot be negative.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="in-disabled">Disabled</Label>
                <Input id="in-disabled" disabled placeholder="Read-only for staff" />
              </div>
            </Demo>
            <Demo label="Select">
              <Select
                defaultValue="sd"
                items={[
                  { value: "sd", label: "SD cards" },
                  { value: "pendrive", label: "Pendrives" },
                  { value: "cable", label: "Cables" },
                ]}
              >
                <SelectTrigger className="w-44" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sd">SD cards</SelectItem>
                  <SelectItem value="pendrive">Pendrives</SelectItem>
                  <SelectItem value="cable">Cables</SelectItem>
                </SelectContent>
              </Select>
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Badges */}
        <Section id="badges" title="Badges" description="shadcn/ui badge — all variants.">
          <ThemeDuo>
            <Demo label="Variants">
              <Badge>default</Badge>
              <Badge variant="secondary">secondary</Badge>
              <Badge variant="destructive">destructive</Badge>
              <Badge variant="outline">outline</Badge>
              <Badge variant="ghost">ghost</Badge>
              <Badge variant="link">link</Badge>
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Tabs */}
        <Section id="tabs" title="Tabs" description="Default (filled) and line variants.">
          <ThemeDuo>
            <Demo label="Default" className="block">
              <Tabs defaultValue="products">
                <TabsList>
                  <TabsTrigger value="products">Products</TabsTrigger>
                  <TabsTrigger value="customers">Customers</TabsTrigger>
                  <TabsTrigger value="requests" disabled>
                    Requests
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="products" className="pt-2 text-muted-foreground">
                  60 products across 8 categories.
                </TabsContent>
                <TabsContent value="customers" className="pt-2 text-muted-foreground">
                  12 customers in mixed access states.
                </TabsContent>
                <TabsContent value="requests" className="pt-2 text-muted-foreground">
                  Approval queue.
                </TabsContent>
              </Tabs>
            </Demo>
            <Demo label="Line" className="block">
              <Tabs defaultValue="all">
                <TabsList variant="line">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="published">Published</TabsTrigger>
                  <TabsTrigger value="drafts">Drafts</TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="pt-2 text-muted-foreground">
                  Everything, newest first.
                </TabsContent>
                <TabsContent value="published" className="pt-2 text-muted-foreground">
                  Visible on the storefront.
                </TabsContent>
                <TabsContent value="drafts" className="pt-2 text-muted-foreground">
                  Hidden from customers.
                </TabsContent>
              </Tabs>
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ PageHeader */}
        <Section
          id="page-header"
          title="PageHeader"
          description="Title, description, actions slot, optional back link."
        >
          <ThemeDuo>
            <Demo label="Full" className="block">
              <PageHeader
                backHref="/design"
                backLabel="Products"
                title="SanDisk Evo 64GB"
                description="Edit details, photos and stock. Changes autosave."
                actions={
                  <>
                    <Button variant="outline">Duplicate</Button>
                    <Button>
                      <PlusIcon data-icon="inline-start" />
                      Add photo
                    </Button>
                  </>
                }
              />
            </Demo>
            <Demo label="Title only" className="block">
              <PageHeader title="Dashboard" />
            </Demo>
            <Demo label="Title + description" className="block">
              <PageHeader
                title="Customers"
                description="Approve, extend or revoke price access."
              />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ StatCard */}
        <Section
          id="stat-card"
          title="StatCard"
          description="Dashboard KPI card with optional delta and icon; includes skeleton variant."
        >
          <ThemeDuo>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Revenue (30d)"
                value="₹4,20,500"
                delta={12.5}
                deltaLabel="vs last month"
                icon={<IndianRupeeIcon />}
              />
              <StatCard
                label="Active customers"
                value={48}
                delta={-3.2}
                deltaLabel="vs last month"
                icon={<UsersIcon />}
              />
              <StatCard label="Products" value={612} delta={0} icon={<PackageIcon />} />
              <StatCard label="Pending requests" value={7} />
              <StatCard label="Loading" value="" skeleton />
            </div>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ StatusChip */}
        <Section
          id="status-chip"
          title="StatusChip"
          description="Dot + label, semantic token colors. Lifecycle and stock variants."
        >
          <ThemeDuo>
            <Demo label="All variants">
              {STATUS_VARIANTS.map((variant) => (
                <StatusChip key={variant} variant={variant} />
              ))}
            </Demo>
            <Demo label="Custom label">
              <StatusChip variant="pending" label="Awaiting review" />
              <StatusChip variant="expired" label="Lapsed 3d ago" />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ PricePill */}
        <Section
          id="price-pill"
          title="PricePill"
          description="Integer paise in, ₹ with tabular numerals out. The locked variant seeds the storefront PriceGate — blurred shimmer, no real amount."
        >
          <ThemeDuo>
            <Demo label="Sizes (49950 · 1250000 · 9900)">
              <PricePill paise={49950} size="sm" />
              <PricePill paise={1250000} size="md" />
              <PricePill paise={9900} size="lg" />
            </Demo>
            <Demo label="Grouping & edge cases">
              <PricePill paise={123456789} />
              <PricePill paise={0} />
              <PricePill paise={-45050} />
            </Demo>
            <Demo label="Locked (PriceGate seed)">
              <PricePill variant="locked" size="sm" />
              <PricePill variant="locked" size="md" />
              <PricePill variant="locked" size="lg" />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ EmptyState */}
        <Section
          id="empty-state"
          title="EmptyState"
          description="Three built-in minimal illustrations plus title, description and action slot."
        >
          <ThemeDuo>
            <div className="grid gap-3">
              <EmptyState
                illustration="empty-box"
                title="No products yet"
                description="Add your first product or import a spreadsheet to get started."
                action={
                  <>
                    <Button>
                      <PlusIcon data-icon="inline-start" />
                      Add product
                    </Button>
                    <Button variant="outline">Import XLSX</Button>
                  </>
                }
                className="border border-dashed border-border"
              />
              <EmptyState
                illustration="no-results"
                title="No results for “sandsik”"
                description="Check the spelling or try a broader term like “SD card”."
                className="border border-dashed border-border"
              />
              <EmptyState
                illustration="locked"
                title="Prices are locked"
                description="Request access and we will approve your account within a day."
                action={<Button>Request access</Button>}
                className="border border-dashed border-border"
              />
            </div>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Skeletons */}
        <Section
          id="skeletons"
          title="Skeletons"
          description="CSS shimmer, token-colored. One per page archetype."
        >
          <ThemeDuo>
            <Demo label="SkeletonStat + SkeletonCard" className="grid grid-cols-1 items-stretch sm:grid-cols-2">
              <SkeletonStat />
              <SkeletonCard />
            </Demo>
            <Demo label="SkeletonRow ×3" className="block">
              <div className="overflow-hidden rounded-xl border border-border">
                <SkeletonRow columns={4} />
                <SkeletonRow columns={4} />
                <SkeletonRow columns={4} className="border-b-0" />
              </div>
            </Demo>
            <Demo label="SkeletonProductCard" className="grid max-w-sm grid-cols-2 items-stretch">
              <SkeletonProductCard />
              <SkeletonProductCard />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Table composition */}
        <Section
          id="table"
          title="Table composition"
          description="ui/table with StatusChip and PricePill — the DealSheet look at rest."
        >
          <ThemeDuo>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TABLE_ROWS.map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.sku}
                      </TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>
                        <StatusChip variant={row.stock} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PricePill paise={row.paise} size="sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      SD-256-EXT
                    </TableCell>
                    <TableCell>Extreme Pro 256GB (anon view)</TableCell>
                    <TableCell>
                      <StatusChip variant="inStock" />
                    </TableCell>
                    <TableCell className="text-right">
                      <PricePill variant="locked" size="sm" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Dialog & Sheet */}
        <Section
          id="overlays"
          title="Dialog & Sheet"
          description="Note: overlays portal to <body>, so they follow the page theme (light here) regardless of which panel opened them."
        >
          <ThemeDuo>
            <Demo label="Dialog">
              <DialogDemo />
            </Demo>
            <Demo label="Sheets">
              <SheetDemo />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ ConfirmSheet */}
        <Section
          id="confirm-sheet"
          title="ConfirmSheet"
          description="Dialog on desktop, bottom sheet under 768px (resize to test). Async confirm shows a spinner and blocks dismissal; destructive variant styles the confirm button."
        >
          <ThemeDuo>
            <Demo label="Default & destructive">
              <ConfirmSheetDemo />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Toasts */}
        <Section
          id="toasts"
          title="Toasts (AppToaster)"
          description="Configured sonner outlet — top-center, close button, token surfaces. Toasts portal to <body> and follow the page theme."
        >
          <ThemeDuo>
            <Demo label="Fire one">
              <ToastDemo />
            </Demo>
          </ThemeDuo>
        </Section>

        {/* ------------------------------------------------ Motion */}
        <Section
          id="motion"
          title="Motion primitives"
          description="From @/components/motion/primitives — gentle/snappy springs, 40ms stagger, tabular count-up."
        >
          <ThemeDuo>
            <MotionDemo />
          </ThemeDuo>
        </Section>
      </div>

      <AppToaster />
    </main>
  );
}
