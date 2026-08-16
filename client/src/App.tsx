import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import DashboardLayout from "./components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy-loaded secondary pages for fast initial bundle load
const FloorBoard = lazy(() => import("./pages/FloorBoard"));
const BackupRepair = lazy(() => import("./pages/BackupRepair"));
const Rooms = lazy(() => import("./pages/Rooms"));
const Urgent = lazy(() => import("./pages/Urgent"));
const StaffLogin = lazy(() => import("./pages/StaffLogin"));
const EndOfDayReport = lazy(() => import("./pages/EndOfDayReport"));

function PageLoader() {
  return (
    <div className="w-full p-6 space-y-4 animate-pulse">
      <Skeleton className="h-10 w-48 bg-[#D4DFE5]/60" />
      <Skeleton className="h-64 w-full bg-[#D4DFE5]/40" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path={"/"} component={Home} />
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
  useEffect(() => {
    // Eagerly preload all page chunks in background after initial render
    void import("./pages/FloorBoard");
    void import("./pages/BackupRepair");
    void import("./pages/Rooms");
    void import("./pages/Urgent");
    void import("./pages/StaffLogin");
    void import("./pages/EndOfDayReport");
  }, []);

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
