import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import FloorBoard from "./pages/FloorBoard";
import BackupRepair from "./pages/BackupRepair";
import Rooms from "./pages/Rooms";
import Urgent from "./pages/Urgent";
import StaffLogin from "./pages/StaffLogin";
import EndOfDayReport from "./pages/EndOfDayReport";
import DashboardLayout from "./components/DashboardLayout";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
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
