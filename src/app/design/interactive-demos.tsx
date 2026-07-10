"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSheet } from "@/components/common/ConfirmSheet";
import { FadeUp, Stagger, ScaleTap, AnimatedNumber } from "@/components/motion/primitives";
import { formatPaise } from "@/components/common/PricePill";

/* ------------------------------------------------------------------ */
/* Dialog / Sheet                                                      */
/* ------------------------------------------------------------------ */

export function DialogDemo() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename category</DialogTitle>
          <DialogDescription>
            The slug updates automatically; existing links keep working.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="design-category-name">Name</Label>
          <Input id="design-category-name" defaultValue="Memory cards" />
        </div>
        <DialogFooter showCloseButton>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SheetDemo() {
  return (
    <>
      <Sheet>
        <SheetTrigger render={<Button variant="outline" />}>Side sheet</SheetTrigger>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Narrow down the catalog.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-2 px-4">
            <Label htmlFor="design-filter-brand">Brand</Label>
            <Input id="design-filter-brand" placeholder="e.g. SanDisk" />
          </div>
          <SheetFooter>
            <Button>Apply filters</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Sheet>
        <SheetTrigger render={<Button variant="outline" />}>Bottom sheet</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
          <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />
          <SheetHeader className="text-center">
            <SheetTitle>Sort products</SheetTitle>
            <SheetDescription>Mobile-first bottom surface.</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <Button variant="outline">Newest first</Button>
            <Button variant="outline">Name A–Z</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* ConfirmSheet                                                        */
/* ------------------------------------------------------------------ */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ConfirmSheetDemo() {
  return (
    <>
      <ConfirmSheet
        title="Publish 12 products?"
        description="They become visible to every approved customer immediately."
        confirmLabel="Publish"
        trigger={<Button variant="outline">Confirm (default)</Button>}
        onConfirm={async () => {
          await wait(1200);
          toast.success("12 products published");
        }}
      />
      <ConfirmSheet
        destructive
        title="Delete 3 products?"
        description="They move to Trash and can be restored for 30 days."
        confirmLabel="Delete"
        trigger={
          <Button variant="destructive">
            <Trash2Icon data-icon="inline-start" />
            Confirm (destructive)
          </Button>
        }
        onConfirm={async () => {
          await wait(1200);
          toast.success("3 products moved to Trash");
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function ToastDemo() {
  return (
    <>
      <Button variant="outline" onClick={() => toast.success("Product saved")}>
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.info("3 customers awaiting approval")}>
        Info
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.warning("Access expires in 2 days", { description: "Ravi Traders · extend from the customer sheet" })}
      >
        Warning
      </Button>
      <Button variant="outline" onClick={() => toast.error("Import failed on row 41")}>
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.promise(wait(1600).then(() => "218 rows"), {
            loading: "Importing spreadsheet…",
            success: (rows) => `Imported ${rows}`,
            error: "Import failed",
          })
        }
      >
        Promise
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Motion primitives                                                   */
/* ------------------------------------------------------------------ */

export function MotionDemo() {
  const [runId, setRunId] = React.useState(0);
  const [amount, setAmount] = React.useState(1249900);

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setRunId((n) => n + 1);
          setAmount((v) => (v === 1249900 ? 2189950 : 1249900));
        }}
      >
        <RefreshCwIcon data-icon="inline-start" />
        Replay
      </Button>
      <div key={runId} className="space-y-4">
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            FadeUp
          </p>
          <FadeUp>
            <div className="rounded-lg border border-border bg-card p-3 text-sm text-card-foreground">
              Enters with the gentle spring.
            </div>
          </FadeUp>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Stagger (40ms)
          </p>
          <Stagger className="grid grid-cols-3 gap-2">
            {["SD cards", "Pendrives", "Cables"].map((label) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-card p-3 text-center text-xs text-card-foreground"
              >
                {label}
              </div>
            ))}
          </Stagger>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              ScaleTap
            </p>
            <ScaleTap className="w-fit">
              <div className="cursor-pointer rounded-lg border border-border bg-card px-4 py-2 text-sm text-card-foreground select-none">
                Press me
              </div>
            </ScaleTap>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              AnimatedNumber (count-up price)
            </p>
            <AnimatedNumber
              value={amount}
              format={formatPaise}
              className="text-xl font-semibold text-foreground"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
