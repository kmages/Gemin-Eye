import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Eye, Target, MessageCircle, TrendingUp, Copy, ExternalLink,
  CheckCircle, Clock, AlertCircle, Zap, ArrowRight, LogOut, Plus, Users, Send
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Business, Campaign, Lead, AiResponse } from "@shared/schema";

function StatCard({ title, value, icon: Icon, trend, color }: {
  title: string; value: string | number; icon: any; trend?: string; color: string;
}) {
  return (
    <Card className="p-5 space-y-3" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">{title}</span>
        <div className={`w-9 h-9 rounded-md ${color} flex items-center justify-center`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-2xl font-bold">{value}</span>
        {trend && (
          <span className="text-xs text-chart-2 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> {trend}
          </span>
        )}
      </div>
    </Card>
  );
}

function LeadCard({ lead, response }: { lead: Lead; response?: AiResponse }) {
  const { toast } = useToast();

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive"; icon: any }> = {
    new: { label: "New", variant: "default", icon: AlertCircle },
    responded: { label: "Responded", variant: "secondary", icon: CheckCircle },
    pending: { label: "Pending", variant: "secondary", icon: Clock },
  };

  const config = statusConfig[lead.status] || statusConfig.new;

  const handleCopy = () => {
    if (response) {
      navigator.clipboard.writeText(response.content);
      toast({ title: "Copied!", description: "Response copied to clipboard." });
    }
  };

  const sendToTelegram = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/telegram/notify-lead", { leadId: lead.id });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sent to Telegram", description: "Lead notification sent to your Telegram." });
    },
    onError: () => {
      toast({ title: "Failed", description: "Could not send to Telegram.", variant: "destructive" });
    },
  });

  return (
    <Card className="p-5 space-y-4" data-testid={`card-lead-${lead.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{lead.authorName}</p>
            <p className="text-xs text-muted-foreground truncate">{lead.groupName} &middot; {lead.platform}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={config.variant} className="text-xs">
            <config.icon className="w-3 h-3 mr-1" />
            {config.label}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {lead.intentScore}/10
          </Badge>
        </div>
      </div>

      <p className="text-sm leading-relaxed bg-muted/50 p-3 rounded-md" data-testid={`text-lead-post-${lead.id}`}>
        "{lead.originalPost}"
      </p>

      {response && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3 text-chart-2" />
            <span className="text-xs font-medium text-chart-2">AI Response</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground" data-testid={`text-response-${lead.id}`}>
            {response.content}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={handleCopy} data-testid={`button-copy-${lead.id}`}>
              <Copy className="w-3 h-3 mr-1" /> Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendToTelegram.mutate()}
              disabled={sendToTelegram.isPending}
              data-testid={`button-telegram-${lead.id}`}
            >
              <Send className="w-3 h-3 mr-1" /> {sendToTelegram.isPending ? "Sending..." : "Send to Telegram"}
            </Button>
            {lead.postUrl && (
              <Button variant="outline" size="sm" asChild data-testid={`button-link-${lead.id}`}>
                <a href={lead.postUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-3 h-3 mr-1" /> Open Post
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  return (
    <Card className="p-5 space-y-3 hover-elevate" data-testid={`card-campaign-${campaign.id}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold truncate">{campaign.name}</h3>
        <Badge variant={campaign.status === "active" ? "default" : "secondary"} className="text-xs flex-shrink-0">
          {campaign.status}
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-xs">{campaign.platform}</Badge>
        <span className="text-xs text-muted-foreground">
          {(campaign.targetGroups as string[])?.length || 0} groups
        </span>
      </div>
      {campaign.keywords && (campaign.keywords as string[]).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(campaign.keywords as string[]).slice(0, 4).map((kw, i) => (
            <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded-md text-muted-foreground">
              {kw}
            </span>
          ))}
          {(campaign.keywords as string[]).length > 4 && (
            <span className="text-xs text-muted-foreground">+{(campaign.keywords as string[]).length - 4} more</span>
          )}
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = "/api/login";
    }
  }, [authLoading, user]);

  const { data: businesses, isLoading: bizLoading } = useQuery<Business[]>({
    queryKey: ["/api/businesses"],
    enabled: !!user,
  });

  const { data: campaigns, isLoading: campLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
    enabled: !!user,
  });

  const { data: leadsData, isLoading: leadsLoading } = useQuery<{ leads: Lead[]; responses: AiResponse[] }>({
    queryKey: ["/api/leads"],
    enabled: !!user,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Eye className="w-8 h-8 text-primary mx-auto animate-pulse" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const leads = leadsData?.leads || [];
  const responses = leadsData?.responses || [];
  const hasBusiness = businesses && businesses.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/logo.png" alt="Gemin-Eye" className="w-6 h-6" />
            <span className="font-semibold text-lg tracking-tight">Gemin-Eye</span>
          </div>
          <div className="flex items-center gap-3">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user.profileImageUrl || ""} />
              <AvatarFallback className="text-xs">{user.firstName?.[0] || user.email?.[0] || "U"}</AvatarFallback>
            </Avatar>
            <span className="text-sm hidden sm:block">{user.firstName || user.email}</span>
            <Button variant="ghost" size="icon" onClick={() => logout()} data-testid="button-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {!hasBusiness ? (
          <div className="text-center py-20 space-y-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <Eye className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-serif font-bold">Welcome to Gemin-Eye</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Set up your business profile and let AI generate your customer acquisition strategy.
              </p>
            </div>
            <Button size="lg" onClick={() => setLocation("/onboarding")} data-testid="button-setup-business">
              Set Up Your Business <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
                <p className="text-sm text-muted-foreground">{businesses?.[0]?.name}</p>
              </div>
              <Button onClick={() => setLocation("/onboarding")} data-testid="button-new-campaign">
                <Plus className="w-4 h-4 mr-1" /> New Campaign
              </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Active Campaigns"
                value={campaigns?.filter((c) => c.status === "active").length || 0}
                icon={Target}
                color="bg-primary/10 text-primary"
              />
              <StatCard
                title="Leads Found"
                value={leads.length}
                icon={Users}
                color="bg-chart-2/10 text-chart-2"
              />
              <StatCard
                title="Responses Sent"
                value={responses.filter((r) => r.status === "approved").length}
                icon={MessageCircle}
                color="bg-chart-3/10 text-chart-3"
              />
              <StatCard
                title="Avg. Intent Score"
                value={leads.length > 0 ? (leads.reduce((s, l) => s + l.intentScore, 0) / leads.length).toFixed(1) : "0"}
                icon={Zap}
                color="bg-chart-4/10 text-chart-4"
              />
            </div>

            {campaigns && campaigns.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold" data-testid="text-campaigns-title">Active Campaigns</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {campaigns.map((c) => (
                    <CampaignCard key={c.id} campaign={c} />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold" data-testid="text-leads-title">Recent Leads</h2>
                {leads.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{leads.length} total</Badge>
                )}
              </div>
              {leadsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-40 w-full rounded-md" />
                  ))}
                </div>
              ) : leads.length === 0 ? (
                <Card className="p-8 text-center space-y-3">
                  <Target className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No leads yet. Your AI agent is monitoring target groups.</p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {leads.map((lead) => {
                    const resp = responses.find((r) => r.leadId === lead.id);
                    return <LeadCard key={lead.id} lead={lead} response={resp} />;
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
