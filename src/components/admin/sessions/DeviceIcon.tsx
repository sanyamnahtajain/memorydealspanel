import * as React from "react";
import {
  Bot,
  Laptop,
  MonitorSmartphone,
  Smartphone,
  Tablet,
} from "lucide-react";

import type { ParsedUserAgent } from "@/server/services/sessions";

/** Maps a parsed device form-factor to a themed lucide glyph. */
export function DeviceIcon({
  device,
  className,
}: {
  device: ParsedUserAgent["device"];
  className?: string;
}) {
  const Icon =
    device === "mobile"
      ? Smartphone
      : device === "tablet"
        ? Tablet
        : device === "bot"
          ? Bot
          : device === "desktop"
            ? Laptop
            : MonitorSmartphone;
  return <Icon aria-hidden className={className} />;
}
