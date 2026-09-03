import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import DashboardLayout from "./components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

// Lazy-loaded secondary pages for fast initial bundle load
const FloorBoard = lazy(() => import("./pages/FloorBoard"));
const BackupRepair = lazy(() => import("./pages/BackupRepair"));
const Rooms = lazy(() => import("./pages/Rooms"));
const Urgent = lazy(() => import("./pages/Urgent"));
const StaffLogin = lazy(() => import("./pages/StaffLogin"));
const EndOfDayReport = lazy(() => import("./pages/EndOfDayReport"));
const PublicKioskDisplay = lazy(() => import("./pages/PublicKioskDisplay"));
const ShiftEndorsementPage = lazy(() => import("./pages/ShiftEndorsementPage"));
const WaterQualityQCPage = lazy(() => import("./pages/WaterQualityQCPage"));

function PageLoader() {
  return (
    <div className="w-full p-6 space-y-4 animate-pulse">
      <Skeleton className="h-10 w-48 bg-[#D4DFE5]/60" />
      <Skeleton className="h-64 w-full bg-[#D4DFE5]/40" />
    </div>
  );
}

/**
 * Clinical registries are staff-only. Hiding the buttons is not enough — a
 * guest who types the URL is sent back to the board.
 */
function ClinicalRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { data: staff, isLoading } = trpc.staff.me.useQuery(undefined, {
    retry: false,
    staleTime: 15_000,
  });
  if (isLoading) return <PageLoader />;
  if (!user && staff?.role === "guest") return <Redirect to="/" />;
  return <>{children}</>;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/display"} component={PublicKioskDisplay} />
        <Route path={"/kiosk"} component={PublicKioskDisplay} />
        <Route path={"/endorsement"}>
          <ClinicalRoute>
            <ShiftEndorsementPage />
          </ClinicalRoute>
        </Route>
        <Route path={"/water-qc"}>
          <ClinicalRoute>
            <WaterQualityQCPage />
          </ClinicalRoute>
        </Route>
        <Route path={"/rooms"} component={Rooms} />
        <Route path={"/backup"} component={BackupRepair} />
        <Route path={"/urgent"} component={Urgent} />
        <Route path={"/staff-login"} component={StaffLogin} />
        <Route path={"/report"} component={EndOfDayReport} />
        <Route path={"/floor/:id"}>
          <DashboardLayout>
            <FloorBoard />
          </DashboardLayout>
        </Route>
        <Route path={"/404"} component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
