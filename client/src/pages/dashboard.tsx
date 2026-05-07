import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Eye, Target, MessageCircle, TrendingUp, Copy, ExternalLink,
  CheckCircle, Clock, AlertCircle, Zap, ArrowRight, LogOut, Plus, Users, Send, Settings,
  Search, Monitor, Check, Bookmark, Activity, Play, Pause, ChevronDown, ChevronUp,
  X, Tag, Wifi, WifiOff, SlidersHorizontal, Loader2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SiFacebook, SiLinkedin } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import type { Business, Campaign, Lead, AiResponse, ResponseFeedback } from "@shared/schema";

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

interface MonitorStatus {
  lastScan: string | null;
  healthy: boolean;
  disabled: boolean;
  businessCount: number;
}

function formatTimeAgo(isoString: string): string {
  const diffMin = Math.floor((Date.now() - new Date(isoString).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 min ago";
  return `${diffMin} min ago`;
}

function MonitorDot({ healthy, disabled, lastScan }: { healthy: boolean; disabled: boolean; lastScan: string | null }) {
  if (disabled) return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />;
  if (!lastScan)  return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" />;
  if (healthy)    return <span className="w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse" />;
  return <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse" />;
}

function MonitorHealthPanel() {
  const { data, isLoading } = useQuery<Record<string, MonitorStatus>>({
    queryKey: ["/api/health/monitors"],
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  const monitors = [
    { key: "reddit",       label: "Reddit",        interval: "every 5 min" },
    { key: "googleAlerts", label: "Google Alerts",  interval: "every 2 min" },
  ];

  return (
    <Card className="px-4 py-3" data-testid="panel-monitor-health">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
          <Activity className="w-3.5 h-3.5" />
          <span>Monitor Status</span>
        </div>
        {monitors.map(({ key, label, interval }) => {
          const m = data[key];
          if (!m) return null;
          const statusLabel = m.disabled ? "disabled" : m.lastScan ? (m.healthy ? "healthy" : "stalled") : "waiting…";
          const statusColor  = m.disabled || !m.lastScan ? "text-muted-foreground" : m.healthy ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400";
          return (
            <div key={key} className="flex items-center gap-2" data-testid={`monitor-status-${key}`}>
              <MonitorDot healthy={m.healthy} disabled={m.disabled} lastScan={m.lastScan} />
              <span className="text-xs font-medium">{label}</span>
              <span className={`text-xs ${statusColor}`}>
                {statusLabel}
                {m.lastScan && !m.disabled && ` · ${formatTimeAgo(m.lastScan)}`}
              </span>
              {m.businessCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {m.businessCount} {m.businessCount === 1 ? "business" : "businesses"}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const feedbackConfig: Record<string, { label: string; className: string }> = {
  positive:     { label: "Used It",      className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  bad_match:    { label: "Bad Match",    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  too_salesy:   { label: "Too Salesy",   className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  wrong_client: { label: "Wrong Client", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
};

function FeedbackBadge({ feedback }: { feedback?: ResponseFeedback }) {
  if (!feedback) return null;
  const cfg = feedbackConfig[feedback.feedback];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${cfg.className}`} data-testid={`badge-feedback-${feedback.responseId}`}>
      {cfg.label}
    </span>
  );
}

function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function LeadCard({ lead, response, feedback }: { lead: Lead; response?: AiResponse; feedback?: ResponseFeedback }) {
  const { toast } = useToast();

  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive"; icon: any }> = {
    new: { label: "New", variant: "default", icon: AlertCircle },
    responded: { label: "Responded", variant: "secondary", icon: CheckCircle },
    pending: { label: "Pending", variant: "secondary", icon: Clock },
  };

  const config = statusConfig[lead.status] || statusConfig.new;
  const [expanded, setExpanded] = useState(false);

  const rawPost = lead.originalPost ?? "";
  const newlineIdx = rawPost.indexOf("\n");
  const postTitle = newlineIdx > 0 ? rawPost.slice(0, newlineIdx).trim() : "";
  const postBody  = newlineIdx > 0 ? rawPost.slice(newlineIdx + 1).trim() : rawPost;

  // Detect real overflow on the line-clamped element so the More/Less toggle
  // only appears when the text actually gets clipped at 3 lines.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [isLong, setIsLong] = useState(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      // While expanded the element is scrollable so we can't measure clipping;
      // assume still-long until next collapse.
      if (expanded) return;
      setIsLong(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [postBody, expanded]);

  const handleCopy = () => {
    if (response) {
      navigator.clipboard.writeText(response.content);
      toast({ title: "Copied!", description: "Response copied to clipboard." });
    }
  };

  const sendToTelegram = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/telegram/notify-lead", { leadId: lead.id });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      return data;
    },
    onSuccess: (data) => {
      const dest = [data.telegram && "Telegram", data.slack && "Slack"].filter(Boolean).join(" & ");
      toast({ title: "Sent!", description: `Lead notification sent to ${dest}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Could not send", description: err.message, variant: "destructive" });
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
            {lead.createdAt && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5" title={new Date(lead.createdAt as unknown as string).toLocaleString()} data-testid={`text-lead-date-${lead.id}`}>
                <Clock className="w-3 h-3 flex-shrink-0" />
                {timeAgo(lead.createdAt as unknown as string)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <Badge variant={config.variant} className="text-xs">
            <config.icon className="w-3 h-3 mr-1" />
            {config.label}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {lead.intentScore}/10
          </Badge>
          <FeedbackBadge feedback={feedback} />
        </div>
      </div>

      <div className="bg-muted/50 rounded-md overflow-hidden" data-testid={`text-lead-post-${lead.id}`}>
        <div className="px-3 pt-3 pb-2 space-y-1.5">
          {postTitle && (
            <p className="text-sm font-semibold leading-snug text-foreground">
              {postTitle}
            </p>
          )}
          <div ref={bodyRef} className={`text-sm leading-relaxed text-muted-foreground ${expanded ? "max-h-52 overflow-y-auto" : "line-clamp-3"}`}>
            {postBody}
          </div>
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border-t border-border/50"
            data-testid={`button-expand-${lead.id}`}
          >
            {expanded ? (
              <><ChevronUp className="w-3 h-3" /> Less</>
            ) : (
              <><ChevronDown className="w-3 h-3" /> More</>
            )}
          </button>
        )}
      </div>

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
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [localKeywords, setLocalKeywords] = useState<string[]>((campaign.keywords as string[]) || []);
  const isActive = campaign.status === "active";

  const toggleStatus = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/campaigns/${campaign.id}`, { status: isActive ? "inactive" : "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: isActive ? "Campaign paused" : "Campaign activated" });
    },
    onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
  });

  const saveKeywords = useMutation({
    mutationFn: (keywords: string[]) => apiRequest("PATCH", `/api/campaigns/${campaign.id}`, { keywords }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Keywords saved" });
    },
    onError: () => toast({ title: "Failed to save keywords", variant: "destructive" }),
  });

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw || localKeywords.includes(kw)) return;
    const updated = [...localKeywords, kw];
    setLocalKeywords(updated);
    setNewKeyword("");
    saveKeywords.mutate(updated);
  };

  const removeKeyword = (kw: string) => {
    const updated = localKeywords.filter((k) => k !== kw);
    setLocalKeywords(updated);
    saveKeywords.mutate(updated);
  };

  return (
    <Card className="p-5 space-y-3" data-testid={`card-campaign-${campaign.id}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold truncate">{campaign.name}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={isActive ? "default" : "secondary"} className="text-xs">
            {isActive ? "active" : "paused"}
          </Badge>
          <Button
            variant="ghost" size="icon" className="w-7 h-7"
            onClick={() => toggleStatus.mutate()}
            disabled={toggleStatus.isPending}
            data-testid={`button-toggle-campaign-${campaign.id}`}
            title={isActive ? "Pause campaign" : "Activate campaign"}
          >
            {isActive ? <Pause className="w-3.5 h-3.5 text-muted-foreground" /> : <Play className="w-3.5 h-3.5 text-primary" />}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-xs">{campaign.platform}</Badge>
        <span className="text-xs text-muted-foreground">
          {(campaign.targetGroups as string[])?.length || 0} groups
        </span>
      </div>

      <div className="space-y-2">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-expand-keywords-${campaign.id}`}
        >
          <Tag className="w-3 h-3" />
          <span>{localKeywords.length} keyword{localKeywords.length !== 1 ? "s" : ""}</span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {!expanded && localKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {localKeywords.slice(0, 4).map((kw, i) => (
              <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded-md text-muted-foreground">{kw}</span>
            ))}
            {localKeywords.length > 4 && (
              <span className="text-xs text-muted-foreground">+{localKeywords.length - 4} more</span>
            )}
          </div>
        )}

        {expanded && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap gap-1.5">
              {localKeywords.map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md">
                  {kw}
                  <button onClick={() => removeKeyword(kw)} className="hover:text-destructive transition-colors" data-testid={`button-remove-kw-${campaign.id}-${kw}`}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 text-xs bg-muted border border-border rounded-md px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                placeholder="Add keyword…"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                data-testid={`input-new-keyword-${campaign.id}`}
              />
              <Button size="sm" variant="outline" onClick={addKeyword} disabled={!newKeyword.trim()} data-testid={`button-add-keyword-${campaign.id}`}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

interface BookmarkletInfo {
  businessId: number;
  businessName: string;
  bookmarkletPageUrl: string;
  facebookCode: string;
  linkedinCode: string;
}

function SpyGlassCopyButton({ code, label, icon: Icon, testId }: { code: string; label: string; icon: any; testId: string }) {
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
    <Button variant="outline" onClick={handleCopy} data-testid={testId}>
      <Icon className="w-4 h-4 mr-2" />
      {copied ? <><Check className="w-3 h-3 mr-1" /> Copied!</> : `Copy ${label}`}
    </Button>
  );
}

function SpyGlassSection({ bookmarklets }: { bookmarklets: BookmarkletInfo[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold" data-testid="text-spyglass-title">Spy Glass Tools</h2>
        <Badge variant="secondary" className="text-xs">Desktop</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Scan Facebook groups and LinkedIn from your desktop browser. Copy a bookmarklet code, save it as a browser bookmark, then click it while on Facebook or LinkedIn to scan for leads.
      </p>
      <div className="grid gap-4">
        {bookmarklets.map((bm) => (
          <Card key={bm.businessId} className="p-5 space-y-4" data-testid={`card-spyglass-${bm.businessId}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-medium" data-testid={`text-spyglass-biz-${bm.businessId}`}>{bm.businessName}</h3>
              <Button variant="ghost" size="sm" onClick={() => window.open(bm.bookmarkletPageUrl, '_blank')} data-testid={`button-spyglass-page-${bm.businessId}`}>
                <ExternalLink className="w-3 h-3 mr-1" /> Full Setup Guide
              </Button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <SpyGlassCopyButton
                code={bm.facebookCode}
                label="Facebook"
                icon={SiFacebook}
                testId={`button-copy-fb-${bm.businessId}`}
              />
              <SpyGlassCopyButton
                code={bm.linkedinCode}
                label="LinkedIn"
                icon={SiLinkedin}
                testId={`button-copy-li-${bm.businessId}`}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const TONES = [
  { value: "casual",      label: "Casual",       desc: "Friendly & approachable" },
  { value: "empathetic",  label: "Empathetic",    desc: "Warm & supportive" },
  { value: "professional",label: "Professional",  desc: "Authoritative & informative" },
];

function BusinessSettingsPanel({ business }: { business: Business }) {
  const { toast } = useToast();
  const telegramLinked = !!business.telegramChatId;
  const [sliderValue, setSliderValue] = useState(business.intentThreshold ?? 5);

  const updateTone = useMutation({
    mutationFn: (tone: string) => apiRequest("PATCH", `/api/businesses/${business.id}`, { preferredTone: tone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      toast({ title: "Tone updated" });
    },
    onError: () => toast({ title: "Failed to update tone", variant: "destructive" }),
  });

  const updateThreshold = useMutation({
    mutationFn: (threshold: number) => apiRequest("PATCH", `/api/businesses/${business.id}`, { intentThreshold: threshold }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      toast({ title: "Intent threshold updated" });
    },
    onError: () => toast({ title: "Failed to update threshold", variant: "destructive" }),
  });

  const { data: connectLinkData, isLoading: connectLinkLoading } = useQuery<{ deepLink: string }>({
    queryKey: ["/api/businesses", business.id, "connect-link"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${business.id}/connect-link`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch connect link");
      return res.json();
    },
    enabled: !telegramLinked,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card className="p-5 space-y-5" data-testid="panel-business-settings">
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Settings — {business.name}</h2>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Response Tone</p>
          <p className="text-xs text-muted-foreground">Controls how AI crafts replies on your behalf.</p>
          <Select
            value={business.preferredTone}
            onValueChange={(val) => updateTone.mutate(val)}
            disabled={updateTone.isPending}
          >
            <SelectTrigger className="w-full" data-testid="select-tone">
              <SelectValue placeholder="Choose tone" />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t.value} value={t.value} data-testid={`option-tone-${t.value}`}>
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground ml-1 text-xs">— {t.desc}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Intent Threshold</p>
            <span className="text-sm font-semibold text-primary tabular-nums" data-testid="text-intent-threshold">{sliderValue}/10</span>
          </div>
          <p className="text-xs text-muted-foreground">Minimum score a post must reach to be reported as a lead. Lower = more leads, higher = fewer but stronger signals.</p>
          <Slider
            min={1}
            max={10}
            step={1}
            value={[sliderValue]}
            onValueChange={([v]) => setSliderValue(v)}
            onValueCommit={([v]) => updateThreshold.mutate(v)}
            disabled={updateThreshold.isPending}
            className="py-1"
            data-testid="slider-intent-threshold"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1 — More leads</span>
            <span>10 — Fewer, stronger</span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Telegram Alerts</p>
          <p className="text-xs text-muted-foreground">Receive lead notifications and give feedback via Telegram.</p>
          {telegramLinked ? (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="status-telegram-connected">
              <Wifi className="w-4 h-4" />
              <span>Connected</span>
              <span className="text-xs text-muted-foreground">(Chat {business.telegramChatId})</span>
            </div>
          ) : (
            <div className="space-y-3" data-testid="status-telegram-disconnected">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <WifiOff className="w-4 h-4" />
                <span>Not connected</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Click the button below to open Telegram and connect your account in one tap. You'll start receiving lead alerts instantly.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={connectLinkLoading || !connectLinkData?.deepLink}
                onClick={() => connectLinkData?.deepLink && window.open(connectLinkData.deepLink, "_blank")}
                data-testid="button-connect-telegram"
              >
                <Send className="w-3.5 h-3.5 mr-2" />
                {connectLinkLoading ? "Generating link…" : "Connect Telegram"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [platformFilter, setPlatformFilter] = useState("");
  const [highIntentOnly, setHighIntentOnly] = useState(false);

  const { data: adminCheck } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
    enabled: !!user,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = "/";
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

  const { data: leadsData, isLoading: leadsLoading } = useQuery<{ leads: Lead[]; responses: AiResponse[]; feedback: ResponseFeedback[] }>({
    queryKey: ["/api/leads"],
    enabled: !!user,
  });

  const { data: bookmarklets } = useQuery<BookmarkletInfo[]>({
    queryKey: ["/api/my-bookmarklets"],
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
  const feedbackByResponseId = Object.fromEntries((leadsData?.feedback || []).map((f) => [f.responseId, f]));
  const hasBusiness = businesses && businesses.length > 0;

  const PLATFORM_FILTERS = ["All", "Reddit", "Facebook", "LinkedIn", "Google Alerts"];
  const PLATFORM_DB_VALUES: Record<string, string[]> = {
    "Reddit":        ["reddit"],
    "Facebook":      ["facebook"],
    "LinkedIn":      ["linkedin"],
    "Google Alerts": ["google_alerts", "google alerts"],
  };
  const filteredLeads = leads.filter((l) => {
    const dbPlatform = (l.platform ?? "").toLowerCase();
    const platformMatch = !platformFilter || (PLATFORM_DB_VALUES[platformFilter] ?? [platformFilter.toLowerCase()]).some(v => dbPlatform === v || dbPlatform.includes(v));
    const intentMatch = !highIntentOnly || l.intentScore >= 7;
    return platformMatch && intentMatch;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/logo.png" alt="Gemin-Eye" className="w-6 h-6" />
            <span className="font-semibold text-lg tracking-tight">Gemin-Eye</span>
          </div>
          <div className="flex items-center gap-3">
            {bookmarklets && bookmarklets.length > 0 && (
              <Button variant="ghost" size="icon" onClick={() => window.open(bookmarklets[0].bookmarkletPageUrl, '_blank')} data-testid="button-bookmarklets" title="Spy Glass Bookmarklets">
                <Bookmark className="w-4 h-4" />
              </Button>
            )}
            {adminCheck?.isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => setLocation("/admin")} data-testid="button-admin">
                <Settings className="w-4 h-4" />
              </Button>
            )}
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
        {bizLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasBusiness ? (
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

            <MonitorHealthPanel />

            {bookmarklets && bookmarklets.length > 0 && (
              <SpyGlassSection bookmarklets={bookmarklets} />
            )}

            {campaigns && campaigns.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold" data-testid="text-campaigns-title">Campaigns</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {campaigns.map((c) => (
                    <CampaignCard key={c.id} campaign={c} />
                  ))}
                </div>
              </div>
            )}

            {businesses && businesses.map((biz) => (
              <BusinessSettingsPanel key={biz.id} business={biz} />
            ))}

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-lg font-semibold" data-testid="text-leads-title">Recent Leads</h2>
                <div className="flex items-center gap-2 flex-wrap" data-testid="filter-bar">
                  <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                  {PLATFORM_FILTERS.map((p) => {
                    const val = p === "All" ? "" : p;
                    return (
                      <button
                        key={p}
                        onClick={() => setPlatformFilter(val)}
                        className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                          platformFilter === val
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary hover:text-foreground"
                        }`}
                        data-testid={`filter-platform-${p.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setHighIntentOnly(!highIntentOnly)}
                    className={`text-xs px-3 py-1 rounded-md border transition-colors ${
                      highIntentOnly
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-background text-muted-foreground border-border hover:border-amber-400 hover:text-foreground"
                    }`}
                    data-testid="filter-high-intent"
                  >
                    {highIntentOnly ? "✓ High intent (7+)" : "High intent (7+)"}
                  </button>
                  <Badge variant="secondary" className="text-xs">{filteredLeads.length} shown</Badge>
                </div>
              </div>
              {leadsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-40 w-full rounded-md" />
                  ))}
                </div>
              ) : filteredLeads.length === 0 ? (
                <Card className="p-8 text-center space-y-3">
                  <Target className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {leads.length === 0
                      ? "No leads yet. Your AI agent is monitoring target groups."
                      : "No leads match the current filters. Try adjusting the filter options above."}
                  </p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {filteredLeads.map((lead) => {
                    const resp = responses.find((r) => r.leadId === lead.id);
                    const fb = resp ? feedbackByResponseId[resp.id] : undefined;
                    return <LeadCard key={lead.id} lead={lead} response={resp} feedback={fb} />;
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
