"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markContactDoneAction } from "@/server/actions/contact";

/** Mark one contact message handled: pending spinner, toast, live refresh. */
export function MarkDoneButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await markContactDoneAction({ id });
      if (result.ok) {
        toast.success("Marked as done");
        router.refresh();
      } else {
        toast.error(result.error);
        // "Already handled" usually means another admin got there first —
        // refresh so the list shows the truth.
        router.refresh();
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? (
        <Loader2Icon className="animate-spin" aria-hidden />
      ) : (
        <CheckIcon aria-hidden />
      )}
      Mark as done
    </Button>
  );
}
