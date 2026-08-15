import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";

/**
 * Staff session strip: shown on boards to identify the active session
 * (Guest / RDU Nurse / SKTI Supervisor) and to sign out. Also provides a
 * link to the staff login page when no session exists.
 */
export default function StaffBar() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const me = trpc.staff.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMut = trpc.staff.logout.useMutation({
    onSuccess: () => {
      utils.staff.me.invalidate();
      toast.success("Signed out.");
      navigate("/staff-login");
    },
  });

  const staff = me.data ?? null;
  const isGuest = staff?.role === "guest";
  const isNurse = staff?.role === "nurse";
  const isAuditor = staff?.role === "auditor";

  if (!staff) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[#4a4a45]">Viewing as guest</span>
        <Button variant="outline" size="sm" className="h-7 px-2 border-[#1F2A52]/25 text-[#1F2A52]" onClick={() => navigate("/staff-login")}>
          Sign in as staff
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {isGuest ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1F2A52]/8 text-[#1F2A52]">
          <UserRound className="w-3 h-3" /> Guest
        </span>
      ) : (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
            staff.role === "supervisor"
              ? "bg-[#9E1F2B] text-white"
              : isAuditor
                ? "bg-[#B8860B]/15 text-[#8a6408]"
                : "bg-[#2E9A9B]/15 text-[#1d6b6c]"
          }`}
        >
          <ShieldCheck className="w-3 h-3" />
          {isNurse ? `Nurse · ${staff.displayName}` : isAuditor ? "Auditor" : "SKTI Supervisor"}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[#4a4a45] hover:text-[#9E1F2B]"
        onClick={() => logoutMut.mutate()}
        disabled={logoutMut.isPending}
      >
        <LogOut className="w-3 h-3 mr-1" /> Sign out
      </Button>
    </div>
  );
}
