import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";
import { useLocation } from "wouter";

export default function PrivacyPolicy() {
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
              <Shield className="h-6 w-6" />
              <span className="text-sm font-semibold uppercase tracking-wider">Clinical Governance</span>
            </div>
            <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
              Privacy Policy
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Last updated: 16 September 2026. Southern Philippines Medical Center Kidney and Transplant Institute.
            </p>
          </CardHeader>
          <CardContent className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">1. Scope</h2>
              <p className="text-muted-foreground">
                The SPMCKTI Dialysis Occupancy Board is an internal hospital operations tool.
                It records hemodialysis machine status, waiting lists, nurse assignments, shift narratives, and water-quality logs for the Kidney and Transplant Institute.
                Processing follows the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">2. Data this board holds</h2>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Patient identifiers entered by staff for a session or waiting-list entry.</li>
                <li>Machine occupancy, isolation tag, urgency, pause time, and repair status.</li>
                <li>Staff usernames, display names, assigned floors, and salted password hashes.</li>
                <li>Shift narratives and an auditor history of narrative edits.</li>
                <li>Reverse-osmosis water quality log entries.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">3. Purpose</h2>
              <p className="text-muted-foreground">
                Data is processed only for unit operations: bay assignment, waiting-list admission, shift handoff, end-of-day reporting, and water-quality compliance.
                The board is not a public patient portal and is not used for marketing.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">4. Access and security</h2>
              <p className="text-muted-foreground">
                Access is role-based. Guests see occupancy status only.
                Nurses write on the assigned floor. Supervisors manage all floors. Auditors read narrative history.
                Sessions use HttpOnly cookies. Search engines are instructed not to index this site.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">5. Cookies</h2>
              <p className="text-muted-foreground">
                The board stores necessary cookies for staff or patient sessions, sidebar state, and theme preference.
                It does not set advertising or cross-site tracking cookies.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">6. Inquiries</h2>
              <p className="text-muted-foreground">
                Direct privacy questions to the SKTI Nursing Supervisory Office at Southern Philippines Medical Center.
                Request a correction of a recorded identifier through the assigned charge nurse or supervisor.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
