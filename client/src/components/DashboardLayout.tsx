import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { Activity, BellRing, ClipboardCheck, ClipboardList, Droplets, LogOut, PanelLeft, LayoutGrid, Layers, Tv, Wrench } from "lucide-react";
import { CSSProperties, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const menuItems: { icon: typeof Activity; label: string; path: string }[] = [
  { icon: Activity, label: "Occupancy Board", path: "/" },
  { icon: Tv, label: "Public TV Lounge", path: "/display" },
  { icon: ClipboardCheck, label: "Shift Endorsement", path: "/endorsement" },
  { icon: Droplets, label: "RO Water QC Log", path: "/water-qc" },
  { icon: BellRing, label: "Urgent Cases", path: "/urgent" },
  { icon: Wrench, label: "Backup & Repair", path: "/backup" },
  { icon: LayoutGrid, label: "Rooms", path: "/rooms" },
  { icon: ClipboardList, label: "End of Day Report", path: "/report" },
];

/**
 * Routes a guest never reaches. Clinical registries hold patient watch lists
 * and unit compliance findings, so a lounge viewer sees neither the entry nor
 * the page.
 */
export const GUEST_HIDDEN_PATHS = new Set([
  "/rooms",
  "/report",
  "/backup",
  "/urgent",
  "/endorsement",
  "/water-qc",
]);

/** Per-floor board entries loaded from the floors table at runtime. */
function useFloorBoardItems() {
  const { data: floors } = trpc.machines.listFloors.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  return (
    floors?.map(f => ({
      icon: Layers,
      label: `${f.name} Board`,
      path: `/floor/${f.id}`,
      floorId: f.id,
    })) ?? []
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();
  const [, navigate] = useLocation();

  // Staff session (nurse / supervisor / guest) is independent of the OAuth
  // login used by the owner. The sidebar is scoped by the staff role.
  const staffMe = trpc.staff.me.useQuery(undefined, {
    retry: false,
    staleTime: 15_000,
  });
  const staff = staffMe.data ?? null;
  const staffRole = staff?.role ?? null;

  if (loading || staffMe.isLoading) {
    return <DashboardLayoutSkeleton />;
  }

  // A staff session (nurse / supervisor / guest) is a fully valid identity on
  // its own — it must not be pushed to the Manus OAuth wall just because no
  // OAuth account is signed in.
  if (!user && !staff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <img
              src="/images/skti-seal-transparent.png"
              alt="SPMC Kidney and Transplant Institute"
              className="h-28 w-28 rounded-full object-cover shadow-md"
            />
              <p className="smallcaps-detail text-muted-foreground">
              Internal Clinical Staff Portal
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full font-normal"
              onClick={() => navigate("/staff-login")}
            >
              Board staff: Guest / Nurse / Supervisor sign in
            </Button>
            <h1 className="font-display text-4xl tracking-tight text-foreground">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
              Access to the dialysis occupancy board requires staff
              authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => startLogin()}
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-serif"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "280px",
        } as CSSProperties
      }
    >
      <DashboardLayoutContent staff={staff} staffRole={staffRole}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({
  children,
  staff,
  staffRole,
}: {

  children: React.ReactNode;
  staff: { role: string; displayName?: string; assignedFloorId?: number | null } | null;
  staffRole: string | null;
}) {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const [location, setLocation] = useLocation();
  // The chip reports the newest filed RO log. A green "PASSED" with no log
  // behind it is a clinical claim the unit never made.
  const { data: waterQcLogs } = trpc.waterQualityLogs.list.useQuery(undefined, {
    enabled: Boolean(staff) && staffRole !== "guest",
    refetchInterval: 60_000,
    retry: false,
  });
  const waterQcStatus = waterQcLogs?.[0]?.status ?? null;
  const showWaterQcChip = staffRole !== "guest";
  const waterQcPassed = waterQcStatus?.toLowerCase().startsWith("pass") ?? false;
  // Sign out must clear the staff cookie server-side (it also bumps the
  // account's token version), not merely refetch the session.
  const staffLogout = trpc.staff.logout.useMutation({
    onMutate: () => {
      // Instantly clear local session state and redirect to login page in 0ms
      utils.staff.me.setData(undefined, undefined);
      setLocation("/staff-login");
    },
    onSettled: () => {
      void utils.staff.me.invalidate();
    },
  });
  const preloadRoute = (path: string) => {
    if (path === "/urgent") void import("@/pages/Urgent");
    else if (path === "/backup") void import("@/pages/BackupRepair");
    else if (path === "/rooms") void import("@/pages/Rooms");
    else if (path === "/report") void import("@/pages/EndOfDayReport");
    else if (path === "/display") void import("@/pages/PublicKioskDisplay");
    else if (path === "/endorsement") void import("@/pages/ShiftEndorsementPage");
    else if (path === "/water-qc") void import("@/pages/WaterQualityQCPage");
    else if (path.startsWith("/floor/")) void import("@/pages/FloorBoard");
  };
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const sidebarRef = useRef<HTMLDivElement>(null);
  const allFloorBoardItems = useFloorBoardItems();
  const assignedFloor =
    staff?.assignedFloorId
      ? allFloorBoardItems.find(f => f.floorId === staff.assignedFloorId)
      : undefined;
  // Sidebar scoping by staff role: nurses see only their assigned floor,
  // supervisors see every board, guests see every board (read-only).
  const floorBoardItems =
    staffRole === "nurse"
      ?       allFloorBoardItems.filter(f => f.floorId === (staff?.assignedFloorId ?? null))
      : allFloorBoardItems;
  // Read-only viewers (guest, logged-out staff page) don't manage rooms,
  // read reports, or see urgent cases / backup & repair.
  const visibleMenuItems = staffRole === "guest"
    ? menuItems.filter(item => !GUEST_HIDDEN_PATHS.has(item.path))
    : menuItems;
  // Match the exact floor board by path first (e.g. /floor/30001);
  // a bare /floor/ location (a redirect artifact) highlights nothing.
  const activeMenuItem = menuItems.find(item => item.path === location) ??
    floorBoardItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="bg-sidebar border-r border-sidebar-border">
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <SidebarTrigger className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground data-[state=open]:hidden [&_svg]:h-4 [&_svg]:w-4" />
              {!isCollapsed ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src="/images/skti-seal-transparent.png"
                    alt="SPMCKTI logo"
                    className="h-9 w-9 rounded-full object-cover shrink-0"
                  />
                  <span className="flex flex-col min-w-0 leading-tight shrink">
                    <span className="font-display text-lg tracking-tight text-foreground">
                      Dialysis<span className="text-accent">.</span>
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground whitespace-normal break-words">
                      SPMC Kidney &amp; Transplant Institute
                    </span>
                  </span>
                </div>
              ) : (
                <img
                  src="/images/skti-seal-transparent.png"
                  alt="SPMCKTI logo"
                  className="h-8 w-8 rounded-full object-cover"
                />
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {visibleMenuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      onMouseEnter={() => preloadRoute(item.path)}
                      onTouchStart={() => preloadRoute(item.path)}
                      tooltip={item.label}
                      className="h-11 transition-all font-normal data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-medium rounded-sm"
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="text-[13px] tracking-wide">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>

            {floorBoardItems.length > 0 && (
              <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 whitespace-nowrap overflow-hidden text-center group-data-[collapsible=icon]:px-0">
                {isCollapsed ? "FB" : "Floor Boards"}
              </p>
            )}
            <SidebarMenu className="px-2 py-1">
              {floorBoardItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      onMouseEnter={() => preloadRoute(item.path)}
                      onTouchStart={() => preloadRoute(item.path)}
                      tooltip={item.label}
                      className="h-11 transition-all font-normal data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:font-medium rounded-sm"
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="text-[13px] tracking-wide">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-sidebar-border">
            <div className="flex items-center gap-3 rounded-sm px-2 py-2 w-full">
              <Avatar className="h-8 w-8 border border-sidebar-border shrink-0 bg-background">
                <AvatarFallback className="text-xs font-serif text-foreground">
                  {user?.name?.charAt(0).toUpperCase() ?? "S"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-[13px] font-medium truncate leading-none text-foreground">
                  {staff?.displayName || user?.name || "Staff"}
                </p>
                <p className="text-[11px] text-muted-foreground truncate mt-1.5">
                  {staff?.role === "supervisor"
                    ? "SKTI Supervisor"
                    : staff?.role === "auditor"
                      ? "Auditor · edit history"
                      : staff?.role === "nurse"
                        ? `Nurse · ${assignedFloor?.label ?? "assigned board"}`
                        : staff?.role === "guest"
                          ? "Guest · view only"
                          : "Clinical Staff"}
                </p>
              </div>
              {staff ? (
                <button
                  onClick={() => staffLogout.mutate()}
                  disabled={staffLogout.isPending}
                  aria-label="Sign out"
                  className="ml-auto text-muted-foreground hover:text-foreground transition-colors group-data-[collapsible=icon]:hidden"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={logout}
                  aria-label="Sign out"
                  className="ml-auto text-muted-foreground hover:text-foreground transition-colors group-data-[collapsible=icon]:hidden"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          </SidebarFooter>
        </Sidebar>
      </div>

      <SidebarInset className="min-w-0 flex-1 bg-background">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#D4DFE5]/80 bg-[#FBFCFD]/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="h-9 w-9 rounded-sm border border-[#D4DFE5] bg-[#F4F7F8] text-[#1F2A52] hover:bg-[#E8EFF1] hover:text-[#1F2A52]" />
            <span className="font-display text-base tracking-tight text-[#1F2A52]">
              {activeMenuItem?.label ?? "Dialysis Board"}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/display", "_blank")}
              className="hidden sm:inline-flex h-8 px-2.5 text-xs bg-cyan-50 border-cyan-300 text-cyan-900 hover:bg-cyan-100 font-semibold"
            >
              <Tv className="mr-1.5 h-3.5 w-3.5 text-cyan-600" />
              Lounge TV Kiosk ↗
            </Button>
            {showWaterQcChip && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/water-qc")}
              className={`hidden md:inline-flex h-8 px-2.5 text-xs font-semibold ${
                waterQcStatus === null
                  ? "bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100"
                  : waterQcPassed
                    ? "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                    : "bg-red-50 border-red-300 text-red-900 hover:bg-red-100"
              }`}
            >
              <Droplets
                className={`mr-1.5 h-3.5 w-3.5 ${
                  waterQcStatus === null
                    ? "text-slate-500"
                    : waterQcPassed
                      ? "text-emerald-600"
                      : "text-red-600"
                }`}
              />
              RO Water: {waterQcStatus?.toUpperCase() ?? "NO LOG"}
            </Button>
            )}
            {staff && (
              <span className="smallcaps-detail rounded border border-[#D4DFE5] bg-[#F4F7F8] px-2 py-1 text-[#556680]">
                {staff.role === "guest"
                  ? "Guest"
                  : staff.role === "supervisor"
                    ? "Supervisor"
                    : staff.role === "auditor"
                      ? "Auditor"
                      : (staff.displayName ?? "Nurse").replace(/^Nurse · /i, "") + " Nurse"}
              </span>
            )}
          </div>
        </div>
        <main className="flex-1 w-full min-w-0">{children}</main>
      </SidebarInset>
    </>
  );
}
