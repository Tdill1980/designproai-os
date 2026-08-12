import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Send, CheckCircle, Loader2, Mail } from "lucide-react";

const AFFILIATE_TESTERS = [
  { email: 'vinylvixenwraps@gmail.com', name: 'Vinyl Vixen Wraps', website: 'vinylvixenwraps.com' },
  { email: 'raheemroyall4@icloud.com', name: 'Raheem Royall' },
  { email: 'nick.wrap88@gmail.com', name: 'Nick Wrap' },
  { email: 'shaun@ghost-ind.com', name: 'Shaun (Ghost Industries)' },
  { email: 'trish@weprintwraps.com', name: 'Trish (WePrintWraps)' },
];

export default function AdminSendInvites() {
  const { toast } = useToast();
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sentEmails, setSentEmails] = useState<Set<string>>(new Set());

  const sendMagicLink = async (email: string) => {
    setSendingTo(email);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-magic-link', {
        body: { email }
      });

      if (error) throw error;

      setSentEmails(prev => new Set([...prev, email]));
      toast({
        title: "Magic Link Sent",
        description: `Invite sent to ${email}`,
      });
    } catch (error: any) {
      console.error('Error sending magic link:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send magic link",
        variant: "destructive",
      });
    } finally {
      setSendingTo(null);
    }
  };

  const sendToAll = async () => {
    for (const tester of AFFILIATE_TESTERS) {
      if (!sentEmails.has(tester.email)) {
        await sendMagicLink(tester.email);
        // Small delay between sends to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Send Tester Invites
            </CardTitle>
            <CardDescription>
              Send magic link login emails to affiliate testers. They'll receive instructions on how to access and test all design tools.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-end">
              <Button 
                onClick={sendToAll}
                disabled={sendingTo !== null}
                variant="outline"
              >
                Send to All Unsent
              </Button>
            </div>

            <div className="space-y-3">
              {AFFILIATE_TESTERS.map((tester) => (
                <div 
                  key={tester.email}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div>
                    <p className="font-medium text-foreground">{tester.name}</p>
                    <p className="text-sm text-muted-foreground">{tester.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {sentEmails.has(tester.email) ? (
                      <Badge variant="secondary" className="bg-green-500/20 text-green-400">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Sent
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => sendMagicLink(tester.email)}
                        disabled={sendingTo !== null}
                      >
                        {sendingTo === tester.email ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-1" />
                            Send Invite
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 rounded-lg bg-muted/50 border">
              <h4 className="font-medium text-foreground mb-2">Email Contents:</h4>
              <p className="text-sm text-muted-foreground">
                Testers will receive Supabase's default magic link email. After clicking the link, they'll be automatically logged in and redirected to ColorPro with full tester access to all tools.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
