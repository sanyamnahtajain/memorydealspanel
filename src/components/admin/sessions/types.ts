import type { ParsedUserAgent, SessionKind } from "@/server/services/sessions";

/**
 * Serialisable session row handed from the `/admin/sessions` server component
 * to the client table (Dates -> ISO strings so they cross the RSC boundary).
 * The friendly `device` parse is precomputed on the server.
 */
export interface SessionRowData {
  id: string;
  kind: SessionKind;
  subjectId: string;
  subjectName: string;
  subjectDetail: string | null;
  ipAddress: string | null;
  device: ParsedUserAgent;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revoked: boolean;
  revokedAt: string | null;
}
