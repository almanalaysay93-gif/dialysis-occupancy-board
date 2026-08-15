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
import { Activity, BellRing, ClipboardList, LogOut, PanelLeft, LayoutGrid, Layers, Wrench } from "lucide-react";
import { CSSProperties, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const menuItems: { icon: typeof Activity; label: string; path: string }[] = [
  { icon: Activity, label: "Occupancy Board", path: "/" },
  { icon: BellRing, label: "Urgent Cases", path: "/urgent" },
  { icon: Wrench, label: "Backup & Repair", path: "/backup" },
  { icon: LayoutGrid, label: "Rooms", path: "/rooms" },
  { icon: ClipboardList, label: "End of Day Report", path: "/report" },
];

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
              src="/manus-storage/skti-logo_1a83b735.jpg"
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
  // Sign out must clear the staff cookie server-side (it also bumps the
  // account's token version), not merely refetch the session.
  const staffLogout = trpc.staff.logout.useMutation({
    onSettled: async () => {
      await utils.staff.me.invalidate();
      setLocation("/staff-login");
    },
  });
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
  // Read-only viewers (guest, logged-out staff page) don't manage rooms.
  const visibleMenuItems =
    staffRole === "guest"
      ? menuItems.filter(item => item.path !== "/rooms" && item.path !== "/report" && item.path !== "/backup")
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
                    src="/manus-storage/skti-logo_1a83b735.jpg"
                    alt="SPMCKTI logo"
                    className="h-9 w-9 rounded-full object-cover shrink-0"
                  />
                  <span className="flex flex-col min-w-0 leading-tight">
                    <span className="font-display text-lg tracking-tight text-foreground">
                      Dialysis<span className="text-accent">.</span>
                    </span>
                    <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground truncate">
                      SPMC Kidney &amp; Transplant
                    </span>
                  </span>
                </div>
              ) : (
                <img
                  src="/manus-storage/skti-logo_1a83b735.jpg"
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
              <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
                Floor Boards
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

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b border-border h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-sm bg-secondary" />
              <span className="tracking-tight text-foreground">
                {activeMenuItem?.label ?? "Menu"}
              </span>
            </div>
          </div>
        )}
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </>
  );
}
