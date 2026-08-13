import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Activity, Eye, EyeOff, ShieldCheck } from "lucide-react";

type Mode = "guest" | "staff";

export default function StaffLogin() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("guest");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const loginMut = trpc.staff.login.useMutation({
    onSuccess: data => {
      toast.success(`Welcome, ${data.displayName}`, {
        description: data.role === "supervisor" ? "You have access to every board." : "Opening your assigned board.",
      });
      if (data.role === "supervisor") navigate("/");
      else if (data.assignedFloorId) navigate(`/floor/${data.assignedFloorId}`);
      else navigate("/");
    },
    onError: err => toast.error(err.message || "Login failed."),
  });

  const enterGuest = () => {
    // Guest mode: no staff cookie needed — boards are readable anonymously
    // (write operations require a nurse/supervisor session).
    navigate("/");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMut.mutate({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen bg-[#f5f4ef] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#1F2A52] text-[#f5f4ef] mb-3">
            <Activity className="w-7 h-7" strokeWidth={1.5} />
          </div>
          <h1 className="font-serif text-3xl text-[#1F2A52]">SPMCKTI Occupancy Board</h1>
          <p className="text-sm text-[#4a4a45] mt-1">SPMC Kidney &amp; Transplant Institute</p>
        </div>

        {mode === "staff" ? (
          <Card className="border-[#1F2A52]/15 shadow-sm">
            <CardHeader>
              <CardTitle className="font-serif text-xl text-[#1F2A52]">Nurse / Supervisor Sign In</CardTitle>
              <CardDescription>
                RDU nurses see their assigned board; the SKTI Supervisor sees all boards.
              </CardDescription>
            </CardHeader>
            <form onSubmit={submit}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="e.g. nurse.rdu-main"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#4a4a45] hover:text-[#1F2A52]"
                      onClick={() => setShowPw(v => !v)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {loginMut.isPending && <p className="text-sm text-[#4a4a45]">Signing you in…</p>}
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button
                  type="submit"
                  className="w-full bg-[#9E1F2B] hover:bg-[#8a1a25] text-white"
                  disabled={loginMut.isPending || !username.trim() || !password}
                >
                  Sign In
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-[#1F2A52]/20 text-[#1F2A52]"
                  onClick={() => setMode("guest")}
                >
                  Back
                </Button>
              </CardFooter>
            </form>
          </Card>
        ) : (
          <div className="space-y-3">
            <Card className="border-[#1F2A52]/15 shadow-sm">
              <CardHeader>
                <CardTitle className="font-serif text-xl text-[#1F2A52]">Welcome</CardTitle>
                <CardDescription>Choose how you'd like to view the board.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <Button
                  onClick={enterGuest}
                  className="w-full justify-between bg-[#1F2A52] hover:bg-[#2a376b] text-white h-11"
                >
                  <span>Enter as Guest</span>
                  <span className="text-xs opacity-70">Read-only · all boards</span>
                </Button>
                <Button
                  onClick={() => setMode("staff")}
                  className="w-full justify-between border-2 border-[#1F2A52] bg-transparent text-[#1F2A52] hover:bg-[#1F2A52]/5 h-11"
                >
                  <span>Nurse / Supervisor Sign In</span>
                  <ShieldCheck className="w-4 h-4 opacity-70" />
                </Button>
              </CardContent>
              <CardFooter className="flex-col gap-3 border-t border-[#1F2A52]/10 pt-4">
                <p className="text-xs text-[#4a4a45] leading-relaxed">
                  Guests can view machine occupancy, waiting lists, and nurse assignments on every board. Signing in as
                  a nurse lets you manage your assigned board; the SKTI Supervisor manages all boards.
                </p>
                <Button variant="ghost" className="text-[#2E9A9B] hover:text-[#2E9A9B]" onClick={() => startLogin()}>
                  Owner / Admin sign in
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
