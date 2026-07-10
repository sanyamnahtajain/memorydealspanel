import { EmptyState } from "@/components/common";
import { StorefrontShell } from "@/components/shell/StorefrontShell";

export default function Home() {
  return (
    <StorefrontShell>
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <EmptyState
          illustration="empty-box"
          title="Catalog coming soon"
          description="We're stocking the shelves with chargers, cables, power banks and more. Wholesale pricing unlocks once your account is approved."
        />
      </div>
    </StorefrontShell>
  );
}
