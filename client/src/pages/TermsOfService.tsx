import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { useLocation } from "wouter";

export default function TermsOfService() {
  const [, setLocation] = useLocation();

  return (
    <div id="main-content" className="min-h-screen bg-background py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the occupancy board
        </Button>

        <Card className="glass-panel shadow-lg border">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2 text-primary">
              <FileText className="h-6 w-6" />
              <span className="text-sm font-semibold uppercase tracking-wider">Institutional Guidelines</span>
            </div>
            <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
              Terms of Use
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Last updated: 16 September 2026. Southern Philippines Medical Center Kidney and Transplant Institute.
            </p>
          </CardHeader>
          <CardContent className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">1. Acceptance</h2>
              <p className="text-muted-foreground">
                Staff, guests, and authorized patients who open this board accept these terms and hospital administrative rules.
                The board is for official SKTI hemodialysis operations only.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">2. Authorized use</h2>
              <p className="text-muted-foreground">
                Sign in with the staff account assigned to you, or enter as a guest for read-only occupancy.
                Do not share passwords. Sign out on a shared station. Report unauthorized access to the supervisor.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">3. Clinical records</h2>
              <p className="text-muted-foreground">
                Enter only identifiers and session facts that the unit needs for treatment and handoff.
                Do not invent patient identifiers. Narrative reports must reflect the shift that you worked.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">4. Availability</h2>
              <p className="text-muted-foreground">
                The board may stop during maintenance or a database outage.
                Keep the paper census available when the board is offline.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">5. Changes</h2>
              <p className="text-muted-foreground">
                Hospital administration may update these terms to match Department of Health and hospital policy.
                The date at the top of this page is the effective date.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
