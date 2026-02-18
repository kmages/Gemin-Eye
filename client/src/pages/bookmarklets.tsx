import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Eye, Loader2, BookmarkIcon, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SiFacebook, SiLinkedin } from "react-icons/si";

interface BookmarkletData {
  businessName: string;
  facebookCode: string;
  linkedinCode: string;
}

function CopyButton({ code, label, testId }: { code: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast({ title: "Copied!", description: `${label} bookmarklet code copied to clipboard.` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please try selecting and copying manually.", variant: "destructive" });
    }
  };

  return (
    <Button onClick={handleCopy} className="w-full" data-testid={testId}>
      {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
      {copied ? "Copied!" : `Copy ${label} Code`}
    </Button>
  );
}

export default function BookmarkletsPage() {
  const params = useParams<{ businessId: string; chatId: string; token: string }>();
  const { businessId, chatId, token } = params;

  const { data, isLoading, error } = useQuery<BookmarkletData>({
    queryKey: ["/api/bookmarklets", businessId, chatId, token],
    enabled: !!businessId && !!chatId && !!token,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading bookmarklets...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="p-6 max-w-md w-full text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold" data-testid="text-error-title">Link Expired or Invalid</h2>
          <p className="text-sm text-muted-foreground" data-testid="text-error-message">
            This bookmarklet link may have expired. Please request a new one from the Telegram bot.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2">
          <Eye className="w-5 h-5 text-primary" />
          <span className="font-semibold text-lg tracking-tight">Gemin-Eye</span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-page-title">Bookmarklet Setup</h1>
          <p className="text-muted-foreground text-sm" data-testid="text-business-name">
            for <span className="font-medium text-foreground">{data.businessName}</span>
          </p>
        </div>

        <Card className="p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <BookmarkIcon className="w-4 h-4 text-primary" />
            How to Install
          </h2>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">1</span>
              </div>
              <div>
                <p className="text-sm font-medium">Copy the bookmarklet code</p>
                <p className="text-xs text-muted-foreground">Use the copy button below for Facebook or LinkedIn</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">2</span>
              </div>
              <div>
                <p className="text-sm font-medium">Create a new bookmark in your browser</p>
                <p className="text-xs text-muted-foreground">Right-click your bookmarks bar and choose "Add page" or "Add bookmark"</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">3</span>
              </div>
              <div>
                <p className="text-sm font-medium">Paste the code as the URL</p>
                <p className="text-xs text-muted-foreground">Name it "Gemin-Eye FB" or "Gemin-Eye LinkedIn", then paste the copied code into the URL field</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">4</span>
              </div>
              <div>
                <p className="text-sm font-medium">Click the bookmark while on Facebook or LinkedIn</p>
                <p className="text-xs text-muted-foreground">Navigate to a Facebook group or your LinkedIn feed, then click the bookmark to start scanning</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <SiFacebook className="w-4 h-4 text-[#1877F2]" />
            <h2 className="font-semibold">Facebook Scanner</h2>
            <Badge variant="secondary" className="text-xs">Groups</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Scans Facebook group posts for potential leads and sends matches to your Telegram.
          </p>
          <div className="bg-muted/50 p-3 rounded-md">
            <code className="text-xs break-all text-muted-foreground select-all block max-h-20 overflow-y-auto" data-testid="text-facebook-code">
              {data.facebookCode}
            </code>
          </div>
          <CopyButton code={data.facebookCode} label="Facebook" testId="button-copy-facebook" />
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <SiLinkedin className="w-4 h-4 text-[#0A66C2]" />
            <h2 className="font-semibold">LinkedIn Scanner</h2>
            <Badge variant="secondary" className="text-xs">Feed</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Scans your LinkedIn feed for potential leads and sends matches to your Telegram.
          </p>
          <div className="bg-muted/50 p-3 rounded-md">
            <code className="text-xs break-all text-muted-foreground select-all block max-h-20 overflow-y-auto" data-testid="text-linkedin-code">
              {data.linkedinCode}
            </code>
          </div>
          <CopyButton code={data.linkedinCode} label="LinkedIn" testId="button-copy-linkedin" />
        </Card>
      </main>
    </div>
  );
}
