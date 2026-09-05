import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollReveal } from "@/components/ScrollReveal";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowRight, Lock, ShieldCheck, Ticket, Tv, Users } from "lucide-react";

export default function PatientLogin() {
  const [, navigate] = useLocation();
  const [ticketOrId, setTicketOrId] = useState("");

  const utils = trpc.useUtils();

  const patientLoginMut = trpc.staff.patientLogin.useMutation({
    onSuccess: data => {
      utils.staff.me.setData(undefined, {
        accountId: 0,
        username: data.ticket,
        displayName: data.displayName,
        role: "patient",
        assignedFloorId: null,
        fromCookie: true,
      });

      toast.success(`Welcome, ${data.displayName}`, {
        description: data.activeBay
          ? `Assigned to Bay ${data.activeBay} · ${data.activeStatus === "in_treatment" ? "Treatment in progress" : "Waiting"}`
          : "Opening public lounge display.",
      });

      navigate("/kiosk");
      void utils.staff.me.invalidate();
    },
    onError: err => toast.error(err.message || "Sign in failed. Please check your ticket number."),
  });

  const patientGuestMut = trpc.staff.patientGuest.useMutation({
    onSuccess: () => {
      utils.staff.me.setData(undefined, {
        accountId: 0,
        username: "patient.guest",
        displayName: "Lounge Patient",
        role: "patient",
        assignedFloorId: null,
        fromCookie: true,
      });
      navigate("/kiosk");
      void utils.staff.me.invalidate();
    },
    onError: err => toast.error(err.message || "Could not enter kiosk mode."),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketOrId.trim()) {
      toast.error("Please enter your Patient ID or Ticket Number.");
      return;
    }
    patientLoginMut.mutate({ ticketOrId: ticketOrId.trim() });
  };

  return (
    <div className="min-h-screen bg-[#f5f4ef] flex items-center justify-center p-4">
      <ScrollReveal yOffset={36}>
        <div className="w-full max-w-md space-y-6">
          {/* Header Banner with SKTI Seal */}
          <div className="glass-deep relative overflow-hidden border border-[#1F2A52]/25 px-8 py-7 text-center bg-gradient-to-b from-[#1F2A52]/10 to-[#1F2A52]/5 rounded-xl">
            <img
              src="/images/skti-building.jpg"
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-[0.38] saturate-[1.05]"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#F7F9FB]/30 via-transparent to-[#F7F9FB]/30" />
            <div className="relative flex flex-col items-center gap-2.5">
              <img
                src="/images/skti-seal-transparent.png"
                alt="SPMCKTI Seal"
                className="h-24 w-24 rounded-full object-cover drop-shadow-[0_3px_12px_rgba(22,39,70,0.4)]"
              />
              <h1 className="font-serif text-3xl text-[#1F2A52]">Patient Lounge Display</h1>
              <p className="text-sm text-[#4a4a45]">SPMC Kidney &amp; Transplant Institute</p>
            </div>
          </div>

          <Card className="glass-deep border-[#1F2A52]/15 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[#2E9A9B]/15 text-[#1B6E6F]">
                  <Tv className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="font-serif text-xl text-[#1F2A52]">Lounge Kiosk Access</CardTitle>
                  <CardDescription className="text-xs text-[#556680] mt-0.5">
                    View real-time patient queue, bay status, and calling announcements.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <form onSubmit={submit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-input" className="text-xs font-semibold text-[#1F2A52] flex items-center gap-1.5">
                    <Ticket className="h-3.5 w-3.5 text-[#2E9A9B]" />
                    Patient ID or Ticket Number
                  </Label>
                  <Input
                    id="ticket-input"
                    value={ticketOrId}
                    onChange={e => setTicketOrId(e.target.value)}
                    placeholder="e.g. P-4821 or TK-4821"
                    className="h-11 bg-white/80 border-[#D4DFE5] text-[#1F2A52] placeholder:text-[#94A3B8] font-mono tracking-wider text-base"
                    autoFocus
                  />
                  <p className="text-[11px] text-[#7684A0] leading-tight">
                    Located on your hemodialysis intake slip or ticket printout.
                  </p>
                </div>

                {patientLoginMut.isPending && (
                  <p className="text-sm text-[#2E9A9B] font-medium flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#2E9A9B] animate-ping" />
                    Connecting to live kiosk display…
                  </p>
                )}
              </CardContent>

              <CardFooter className="flex-col gap-2.5">
                <Button
                  type="submit"
                  disabled={patientLoginMut.isPending || !ticketOrId.trim()}
                  className="w-full h-11 bg-[#1F2A52] hover:bg-[#151D3A] text-white font-medium shadow-sm transition-all"
                >
                  <Tv className="mr-2 h-4 w-4" />
                  Sign In to View Kiosk
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => patientGuestMut.mutate()}
                  disabled={patientGuestMut.isPending}
                  className="w-full h-10 border-[#D4DFE5] bg-white/60 hover:bg-white text-[#1F2A52] text-xs font-normal"
                >
                  <Users className="mr-1.5 h-3.5 w-3.5 text-[#7684A0]" />
                  Open Kiosk as Lounge Guest (Without Ticket)
                </Button>

                <div className="w-full border-t border-[#1F2A52]/10 mt-3 pt-3 flex items-center justify-between text-xs">
                  <span className="text-[#7684A0] flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Kiosk view only
                  </span>
                  <Link href="/staff-login" className="text-[#2E9A9B] hover:underline font-medium flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Staff Sign In
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardFooter>
            </form>
          </Card>
        </div>
      </ScrollReveal>
    </div>
  );
}
