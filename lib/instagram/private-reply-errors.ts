import { MetaApiError } from "@/lib/meta/client";

const TERMINAL_SUBCODE = /\b(?:2534001|2534025)\b/;

export function isTerminalPrivateReplyError(error: unknown): error is MetaApiError {
  // PermissionError currently retains the subcode only in Meta's message.
  return error instanceof MetaApiError && error.code === 100 &&
    (TERMINAL_SUBCODE.test(String(error.subcode)) ||
      /\bsub=(?:2534001|2534025)\b/.test(error.message));
}

export function isTerminalPrivateReplyLog(log: {
  status: string;
  errorMessage?: string | null;
} | null | undefined): boolean {
  return log?.status === "FAILED" && TERMINAL_SUBCODE.test(log.errorMessage ?? "");
}
