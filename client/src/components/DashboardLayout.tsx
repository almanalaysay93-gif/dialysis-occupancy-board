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
import { Activity, BellRing, LogOut, PanelLeft, LayoutGrid } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const menuItems = [
  { icon: Activity, label: "Occupancy Board", path: "/" },
  { icon: BellRing, label: "Urgent Cases", path: "/urgent" },
  { icon: LayoutGrid, label: "Rooms", path: "/rooms" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F1E7]">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#8A7A5F]">
              Internal Clinical Staff Portal
            </p>
            <h1 className="font-display text-4xl tracking-tight text-[#2B2620]">
              Sign in to continue
            </h1>
            <p className="text-sm text-[#6B6152] text-center max-w-sm leading-relaxed">
              Access to the dialysis occupancy board requires staff
              authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => startLogin()}
            size="lg"
            className="w-full bg-[#2B2620] text-[#F6F1E7] hover:bg-[#1A1611] font-serif"
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
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

function DashboardLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="bg-[#EFE9DC] border-r border-[#D9CFBA]/60">
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={() => {}}
                aria-hidden
                className="h-8 w-8 flex items-center justify-center shrink-0"
                tabIndex={-1}
              >
                <PanelLeft className="h-4 w-4 text-[#8A7A5F]" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-display text-lg tracking-tight text-[#2B2620]">
                    Dialysis<span className="text-[#8A6A3F]">.</span>
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-11 transition-all font-normal data-[active=true]:bg-[#2B2620] data-[active=true]:text-[#F6F1E7] data-[active=true]:font-medium rounded-sm"
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="text-[13px] tracking-wide">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3 border-t border-[#D9CFBA]/60">
            <div className="flex items-center gap-3 rounded-sm px-2 py-2 w-full">
              <Avatar className="h-8 w-8 border border-[#D9CFBA] shrink-0 bg-[#F6F1E7]">
                <AvatarFallback className="text-xs font-serif text-[#2B2620]">
                  {user?.name?.charAt(0).toUpperCase() ?? "S"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-[13px] font-medium truncate leading-none text-[#2B2620]">
                  {user?.name || "Staff"}
                </p>
                <p className="text-[11px] text-[#8A7A5F] truncate mt-1.5">
                  Clinical Staff
                </p>
              </div>
              <button
                onClick={logout}
                aria-label="Sign out"
                className="ml-auto text-[#8A7A5F] hover:text-[#2B2620] transition-colors group-data-[collapsible=icon]:hidden"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </SidebarFooter>
        </Sidebar>
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b border-[#D9CFBA]/60 h-14 items-center justify-between bg-[#F6F1E7]/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-sm bg-[#EFE9DC]" />
              <span className="tracking-tight text-[#2B2620]">
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
