import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, User, Phone } from "lucide-react";
import { normalizePhone, setAppToken } from "@/lib/appAuth";

const MemberLogin = () => {
  const [memberNumber, setMemberNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("auth-member-login", {
        body: {
          member_number: memberNumber.trim(),
          phone_number: normalizePhone(phoneNumber),
        },
      });
      if (error) throw new Error(error.message || "Login failed");
      const appToken = data?.app_token as string | undefined;
      const member = data?.member as any;
      if (!appToken || !member) {
        throw new Error("Invalid login response");
      }
      setAppToken(appToken);

      localStorage.setItem("member_member_id", member.id);
      localStorage.setItem("member_name", member.name);
      localStorage.setItem("member_phone_number", member.phone_number || '');
      localStorage.setItem("member_login_time", new Date().toISOString());

      toast({
        title: "Login successful",
        description: `Welcome back, ${member.name}!`,
      });

      navigate("/member/dashboard");
    } catch (error) {
      console.error('Login error:', error);
      const message = error instanceof Error ? error.message : 'Invalid credentials. Please try again.';
      toast({
        variant: "destructive",
        title: "Member login failed",
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <User className="mx-auto h-10 w-10 text-blue-600 mb-2" />
          <CardTitle className="text-2xl font-bold">Member Login</CardTitle>
          <CardDescription>Access your member dashboard with your phone number</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="memberNumber">
                Member Number
              </label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="memberNumber"
                  type="text"
                  placeholder="e.g. 1"
                  className="pl-10"
                  value={memberNumber}
                  onChange={e => setMemberNumber(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="phoneNumber">
                Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phoneNumber"
                  type="tel"
                  placeholder="e.g. 0712345678"
                  className="pl-10"
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value)}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Enter the phone number registered with your account
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              size="lg"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Logging in..." : "Login"}
            </Button>

            <div className="text-center">
              <span className="text-sm text-muted-foreground">Are you an admin? </span>
              <Link
                to="/admin/login"
                className="text-blue-600 hover:underline font-medium"
              >
                Admin Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default MemberLogin;
