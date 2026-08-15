import { TRPCError } from "@trpc/server";

/**
 * Maps backend error codes to user-facing TRPC errors. Unmapped or internal
 * errors fall back to a message-bearing INTERNAL_SERVER_ERROR instead of
 * leaking raw database strings as a bare 500 with no body.
 */
export function mapBackendError(error: unknown): never {
  // Already-decoded tRPC errors (e.g. FORBIDDEN from RBAC guards) must pass
  // through untouched — never swallow them into a 500.
  if (error instanceof TRPCError) throw error;
  const msg = (error as Error)?.message ?? "";
  switch (msg) {
    case "MACHINE_OCCUPIED":
      throw new TRPCError({ code: "CONFLICT", message: "This machine already has an active session." });
    case "DURATION_OUT_OF_RANGE":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Duration must be between 15 minutes and 24 hours." });
    case "NO_WAITING_PATIENT":
      throw new TRPCError({ code: "CONFLICT", message: "This patient is no longer waiting — they may already have been admitted." });
    case "NO_VACANT_MACHINE":
      throw new TRPCError({ code: "CONFLICT", message: "No vacant machine on this board — end or release a session first." });
    case "INVALID_PERIOD":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown reporting period." });
    case "EMPTY_BODY":
      throw new TRPCError({ code: "BAD_REQUEST", message: "The narrative cannot be empty." });
    case "FORBIDDEN_PERIOD":
      throw new TRPCError({ code: "FORBIDDEN", message: "This period is not part of your reporting scope." });
    case "ROOM_EXISTS":
      throw new TRPCError({ code: "CONFLICT", message: "A board with this name already exists." });
    case "ROOM_NAME_REQUIRED":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Board name cannot be empty." });
    case "ROOM_NAME_TOO_LONG":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Board name is too long (max 64 characters)." });
    case "ROOM_HAS_ACTIVE_SESSIONS":
      throw new TRPCError({ code: "CONFLICT", message: "Cannot remove a board with machines currently in treatment. End those sessions first." });
    case "ROOM_HAS_MACHINES":
      throw new TRPCError({ code: "CONFLICT", message: "Cannot remove a board that still has machines. Remove its machines first." });
    case "MACHINE_LABEL_EXISTS":
      throw new TRPCError({ code: "CONFLICT", message: "A machine with this label already exists on the board." });
    case "LABEL_REQUIRED":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Machine label cannot be empty." });
    case "MACHINE_NOT_FOUND":
      throw new TRPCError({ code: "NOT_FOUND", message: "Machine not found." });
    case "MACHINE_IN_TREATMENT":
      throw new TRPCError({ code: "CONFLICT", message: "Cannot move a machine that is currently in treatment. End the session first." });
    case "MACHINE_OFFBOARD":
      throw new TRPCError({ code: "CONFLICT", message: "This machine is in Backup or Repair storage. Return it to a board first, then remove it." });
    case "NO_ACTIVE_SESSION":
      throw new TRPCError({ code: "CONFLICT", message: "This machine has no active session." });
    case "FLOOR_NOT_FOUND":
      throw new TRPCError({ code: "BAD_REQUEST", message: "The selected board no longer exists." });
    case "FLOOR_REQUIRED":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the board this machine returns to." });
    case "SAME_MACHINE":
      throw new TRPCError({ code: "BAD_REQUEST", message: "A machine cannot be swapped with itself." });
    default:
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          msg === "Database not available"
            ? "The database is temporarily unavailable. Please try again in a moment."
            : "Something went wrong on the server. Please try again.",
      });
  }
}
