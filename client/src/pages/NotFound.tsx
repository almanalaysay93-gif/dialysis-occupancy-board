import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home, LogIn } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div id="main-content" className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-lg mx-4 glass-panel shadow-lg">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <img
              src="/images/skti-seal-transparent.png"
              alt="SPMC Kidney and Transplant Institute"
              className="h-20 w-20 rounded-full object-cover"
            />
          </div>

          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="font-display text-4xl text-foreground mb-2">Page not found</h1>
          <h2 className="text-lg font-medium text-muted-foreground mb-4">
            This path is not a board, login, or report page.
          </h2>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            Open the occupancy board or sign in as staff.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={() => setLocation("/")}
              className="bg-primary text-primary-foreground"
            >
              <Home className="w-4 h-4 mr-2" />
              Occupancy board
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/staff-login")}
            >
              <LogIn className="w-4 h-4 mr-2" />
              Staff sign in
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
