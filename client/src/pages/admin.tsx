import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Eye, Settings, ChevronLeft, ChevronDown, ChevronRight, Pencil, Trash2,
  Plus, Save, X, Users, Target, Hash, Globe, Mail, Phone, Link2, Power,
  MessageCircle, ExternalLink, Copy, Zap, AlertCircle, CheckCircle, Clock
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Business, Campaign, Lead, AiResponse } from "@shared/schema";

type AdminBusiness = Business & { campaigns: Campaign[]; leadCount: number };

function TagEditor({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
      setInput("");
    }
  };

  const removeTag = (idx: number) => {
    onChange(tags.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, i) => (
          <Badge key={i} variant="secondary" className="text-xs gap-1">
            {tag}
            <button onClick={() => removeTag(i)} className="ml-0.5 opacity-60 hover:opacity-100">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          className="flex-1"
          data-testid="input-tag-add"
        />
        <Button variant="outline" size="sm" onClick={addTag} data-testid="button-add-tag">
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function CampaignEditor({ campaign, onSave, onDelete }: {
  campaign: Campaign;
  onSave: (data: Partial<Campaign>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [status, setStatus] = useState(campaign.status);
  const [keywords, setKeywords] = useState<string[]>((campaign.keywords as string[]) || []);
  const [targetGroups, setTargetGroups] = useState<string[]>((campaign.targetGroups as string[]) || []);

  const handleSave = () => {
    onSave({ name, status, keywords, targetGroups });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(campaign.name);
    setStatus(campaign.status);
    setKeywords((campaign.keywords as string[]) || []);
    setTargetGroups((campaign.targetGroups as string[]) || []);
    setEditing(false);
  };

  if (!editing) {
    return (
      <Card className="p-4 space-y-3" data-testid={`card-admin-campaign-${campaign.id}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="secondary" className="text-xs flex-shrink-0">{campaign.platform}</Badge>
            <span className="font-medium text-sm truncate">{campaign.name}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Badge variant={campaign.status === "active" ? "default" : "secondary"} className="text-xs">
              {campaign.status}
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} data-testid={`button-edit-campaign-${campaign.id}`}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-campaign-${campaign.id}`}>
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Target className="w-3 h-3" />
            <span>{(campaign.targetGroups as string[])?.length || 0} groups</span>
          </div>
          {(campaign.targetGroups as string[])?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(campaign.targetGroups as string[]).map((g, i) => (
                <span key={i} className="text-xs bg-muted px-1.5 py-0.5 rounded-md">{g}</span>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hash className="w-3 h-3" />
            <span>{(campaign.keywords as string[])?.length || 0} keywords</span>
          </div>
          {(campaign.keywords as string[])?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(campaign.keywords as string[]).map((kw, i) => (
                <span key={i} className="text-xs bg-muted px-1.5 py-0.5 rounded-md">{kw}</span>
              ))}
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4 border-primary/30" data-testid={`card-edit-campaign-${campaign.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Editing Campaign</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={handleCancel}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-campaign-name" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Status</label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="select-campaign-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Target Groups / Subreddits</label>
          <TagEditor tags={targetGroups} onChange={setTargetGroups} placeholder="Add group (e.g. r/chicago)" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Keywords</label>
          <TagEditor tags={keywords} onChange={setKeywords} placeholder="Add keyword" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave} data-testid="button-save-campaign">
          <Save className="w-3 h-3 mr-1" /> Save
        </Button>
      </div>
    </Card>
  );
}

function AdminLeadCard({ lead, response }: { lead: Lead; response?: AiResponse }) {
  const { toast } = useToast();
  const [expandedPost, setExpandedPost] = useState(false);
  const [expandedResponse, setExpandedResponse] = useState(false);
  const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive"; icon: any }> = {
    new: { label: "New", variant: "default", icon: AlertCircle },
    matched: { label: "Matched", variant: "default", icon: Zap },
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

  const postText = lead.originalPost;
  const postIsLong = postText.length > 200;
  const responseText = response?.content || "";
  const responseIsLong = responseText.length > 250;

  return (
    <Card className="p-4 space-y-3" data-testid={`card-admin-lead-${lead.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="text-xs flex-shrink-0">{lead.platform}</Badge>
          <span className="text-xs text-muted-foreground truncate">{lead.groupName}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={config.variant} className="text-xs">
            <config.icon className="w-3 h-3 mr-1" />
            {config.label}
          </Badge>
          <Badge variant="secondary" className="text-xs">{lead.intentScore}/10</Badge>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{lead.authorName} &middot; {new Date(lead.createdAt).toLocaleDateString()}</p>
        <div
          className="text-sm bg-muted/50 p-2.5 rounded-md leading-relaxed cursor-pointer"
          onClick={() => postIsLong && setExpandedPost(!expandedPost)}
          data-testid={`text-admin-lead-post-${lead.id}`}
        >
          <p className="whitespace-pre-wrap">{expandedPost || !postIsLong ? postText : postText.slice(0, 200) + "..."}</p>
          {postIsLong && (
            <span className="text-xs text-primary mt-1 inline-block">{expandedPost ? "Show less" : "Show more"}</span>
          )}
        </div>
      </div>
      {response && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-chart-2" />
            <span className="text-xs font-medium text-chart-2">AI Response</span>
            {response.status && (
              <Badge variant="secondary" className="text-xs ml-1">{response.status}</Badge>
            )}
          </div>
          <div
            className="text-sm text-muted-foreground leading-relaxed cursor-pointer"
            onClick={() => responseIsLong && setExpandedResponse(!expandedResponse)}
            data-testid={`text-admin-response-${lead.id}`}
          >
            <p className="whitespace-pre-wrap">{expandedResponse || !responseIsLong ? responseText : responseText.slice(0, 250) + "..."}</p>
            {responseIsLong && (
              <span className="text-xs text-primary mt-1 inline-block">{expandedResponse ? "Show less" : "Show more"}</span>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {response && (
          <Button variant="outline" size="sm" onClick={handleCopy} data-testid={`button-admin-copy-${lead.id}`}>
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
        )}
        {lead.postUrl && (
          <Button variant="outline" size="sm" asChild data-testid={`button-admin-open-${lead.id}`}>
            <a href={lead.postUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3 h-3 mr-1" /> Open Post
            </a>
          </Button>
        )}
      </div>
    </Card>
  );
}

function BusinessPanel({ business, onRefresh }: { business: AdminBusiness; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editingBiz, setEditingBiz] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLeads, setShowLeads] = useState(false);
  const { toast } = useToast();

  const [bizName, setBizName] = useState(business.name);
  const [bizType, setBizType] = useState(business.type);
  const [bizEmail, setBizEmail] = useState(business.contactEmail || "");
  const [bizPhone, setBizPhone] = useState(business.contactPhone || "");
  const [bizWebsite, setBizWebsite] = useState(business.website || "");
  const [bizAudience, setBizAudience] = useState(business.targetAudience);
  const [bizOffering, setBizOffering] = useState(business.coreOffering);
  const [bizTone, setBizTone] = useState(business.preferredTone);

  const [newCampName, setNewCampName] = useState("");
  const [newCampPlatform, setNewCampPlatform] = useState("Reddit");

  const { data: leadsData, isLoading: leadsLoading } = useQuery<{ leads: Lead[]; responses: AiResponse[]; campaigns: { id: number; name: string; platform: string }[] }>({
    queryKey: ["/api/admin/leads", business.id],
    enabled: expanded && showLeads,
  });

  const updateBiz = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/admin/businesses/${business.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Business updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
      setEditingBiz(false);
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteBiz = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/admin/businesses/${business.id}`);
    },
    onSuccess: () => {
      toast({ title: "Business deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const updateCamp = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/campaigns/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
    },
    onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
  });

  const deleteCamp = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/campaigns/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Campaign deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
    },
    onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
  });

  const createCamp = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/campaigns", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign created" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] });
      setShowNewCampaign(false);
      setNewCampName("");
      setNewCampPlatform("Reddit");
    },
    onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
  });

  return (
    <Card className="overflow-visible" data-testid={`card-admin-business-${business.id}`}>
      <div
        className="p-5 cursor-pointer hover-elevate"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-business-${business.id}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {expanded ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{business.name}</h3>
              <p className="text-xs text-muted-foreground truncate">{business.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="secondary" className="text-xs">
              <Target className="w-3 h-3 mr-1" />{business.campaigns.length} campaigns
            </Badge>
            <Badge variant="secondary" className="text-xs">
              <Users className="w-3 h-3 mr-1" />{business.leadCount} leads
            </Badge>
          </div>
        </div>
        {!expanded && (
          <div className="flex flex-wrap items-center gap-2 mt-2 ml-7">
            {business.contactEmail && (
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{business.contactEmail}</span>
            )}
            {business.contactPhone && (
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{business.contactPhone}</span>
            )}
            {business.website && (
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Link2 className="w-3 h-3" />{business.website}</span>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t px-5 pb-5 space-y-5">
          <div className="pt-4 flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium">Business Details</h4>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setEditingBiz(!editingBiz); }} data-testid={`button-edit-biz-${business.id}`}>
                <Pencil className="w-3 h-3 mr-1" /> {editingBiz ? "Cancel" : "Edit"}
              </Button>
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }} data-testid={`button-delete-biz-${business.id}`}>
                <Trash2 className="w-3 h-3 mr-1 text-destructive" /> Delete
              </Button>
            </div>
          </div>

          {editingBiz ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                  <Input value={bizName} onChange={(e) => setBizName(e.target.value)} data-testid="input-biz-name" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                  <Input value={bizType} onChange={(e) => setBizType(e.target.value)} data-testid="input-biz-type" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                  <Input value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} data-testid="input-biz-email" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
                  <Input value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} data-testid="input-biz-phone" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Website</label>
                  <Input value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)} data-testid="input-biz-website" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Target Audience</label>
                <Textarea value={bizAudience} onChange={(e) => setBizAudience(e.target.value)} className="resize-none" data-testid="input-biz-audience" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Core Offering</label>
                <Textarea value={bizOffering} onChange={(e) => setBizOffering(e.target.value)} className="resize-none" data-testid="input-biz-offering" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Preferred Tone</label>
                <Select value={bizTone} onValueChange={setBizTone}>
                  <SelectTrigger data-testid="select-biz-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empathetic">Empathetic</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="helpful">Helpful</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => updateBiz.mutate({
                    name: bizName, type: bizType,
                    contactEmail: bizEmail || null, contactPhone: bizPhone || null, website: bizWebsite || null,
                    targetAudience: bizAudience, coreOffering: bizOffering, preferredTone: bizTone,
                  })}
                  disabled={updateBiz.isPending}
                  data-testid="button-save-biz"
                >
                  <Save className="w-3 h-3 mr-1" /> {updateBiz.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">Email:</span> {business.contactEmail || "—"}</div>
              <div><span className="text-muted-foreground">Phone:</span> {business.contactPhone || "—"}</div>
              <div><span className="text-muted-foreground">Website:</span> {business.website || "—"}</div>
              <div><span className="text-muted-foreground">Tone:</span> {business.preferredTone}</div>
              <div className="col-span-2"><span className="text-muted-foreground">Audience:</span> {business.targetAudience}</div>
              <div className="col-span-2"><span className="text-muted-foreground">Offering:</span> {business.coreOffering}</div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium">Campaigns ({business.campaigns.length})</h4>
              <Button variant="outline" size="sm" onClick={() => setShowNewCampaign(true)} data-testid={`button-add-campaign-${business.id}`}>
                <Plus className="w-3 h-3 mr-1" /> Add Campaign
              </Button>
            </div>

            {showNewCampaign && (
              <Card className="p-4 space-y-3 border-primary/30">
                <span className="text-sm font-medium">New Campaign</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                    <Input value={newCampName} onChange={(e) => setNewCampName(e.target.value)} placeholder="Campaign name" data-testid="input-new-camp-name" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Platform</label>
                    <Select value={newCampPlatform} onValueChange={setNewCampPlatform}>
                      <SelectTrigger data-testid="select-new-camp-platform">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Reddit">Reddit</SelectItem>
                        <SelectItem value="Facebook">Facebook</SelectItem>
                        <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                        <SelectItem value="google_alerts">Google Alerts</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowNewCampaign(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={() => createCamp.mutate({ businessId: business.id, name: newCampName || `${newCampPlatform} Campaign`, platform: newCampPlatform, keywords: [], targetGroups: [] })}
                    disabled={createCamp.isPending}
                    data-testid="button-create-campaign"
                  >
                    <Plus className="w-3 h-3 mr-1" /> {createCamp.isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </Card>
            )}

            <div className="space-y-3">
              {business.campaigns.map((camp) => (
                <CampaignEditor
                  key={camp.id}
                  campaign={camp}
                  onSave={(data) => updateCamp.mutate({ id: camp.id, data })}
                  onDelete={() => deleteCamp.mutate(camp.id)}
                />
              ))}
              {business.campaigns.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No campaigns yet</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium">Leads ({business.leadCount})</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLeads(!showLeads)}
                data-testid={`button-toggle-leads-${business.id}`}
              >
                <MessageCircle className="w-3 h-3 mr-1" /> {showLeads ? "Hide Leads" : "Show Leads"}
              </Button>
            </div>

            {showLeads && (
              <div className="space-y-4">
                {leadsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 w-full rounded-md" />
                    ))}
                  </div>
                ) : leadsData && leadsData.leads.length > 0 ? (
                  (leadsData.campaigns || []).map((camp) => {
                    const campLeads = leadsData.leads.filter((l) => l.campaignId === camp.id);
                    if (campLeads.length === 0) return null;
                    return (
                      <div key={camp.id} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Target className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium">{camp.name}</span>
                          <Badge variant="secondary" className="text-xs">{camp.platform}</Badge>
                          <span className="text-xs text-muted-foreground">({campLeads.length})</span>
                        </div>
                        <div className="space-y-3 pl-5 border-l-2 border-border ml-1.5">
                          {campLeads.map((lead) => {
                            const resp = leadsData.responses.find((r) => r.leadId === lead.id);
                            return <AdminLeadCard key={lead.id} lead={lead} response={resp} />;
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Card className="p-6 text-center">
                    <Target className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No leads found for this business yet.</p>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {business.name}?</DialogTitle>
            <DialogDescription>
              This will permanently delete this business and all its campaigns. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { deleteBiz.mutate(); setShowDeleteConfirm(false); }}
              disabled={deleteBiz.isPending}
              data-testid="button-confirm-delete-biz"
            >
              {deleteBiz.isPending ? "Deleting..." : "Delete Business"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type AllLeadsBiz = {
  business: { id: number; name: string };
  campaigns: { id: number; name: string; platform: string }[];
  leads: Lead[];
  responses: AiResponse[];
};

function AllLeadsView() {
  const { data, isLoading } = useQuery<AllLeadsBiz[]>({
    queryKey: ["/api/admin/all-leads"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-md" />)}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="p-8 text-center space-y-3">
        <Target className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No leads found across any business.</p>
      </Card>
    );
  }

  const totalLeads = data.reduce((sum, b) => sum + b.leads.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{totalLeads} total leads across {data.length} businesses</span>
      </div>
      {data.map((entry) => (
        <Card key={entry.business.id} className="overflow-visible" data-testid={`card-allleads-biz-${entry.business.id}`}>
          <div className="p-4 border-b">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                <span className="font-medium">{entry.business.name}</span>
              </div>
              <Badge variant="secondary" className="text-xs">{entry.leads.length} leads</Badge>
            </div>
          </div>
          <div className="p-4 space-y-4">
            {entry.campaigns.map((camp) => {
              const campLeads = entry.leads.filter((l) => l.campaignId === camp.id);
              if (campLeads.length === 0) return null;
              return (
                <div key={camp.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{camp.name}</span>
                    <Badge variant="secondary" className="text-xs">{camp.platform}</Badge>
                    <span className="text-xs text-muted-foreground">({campLeads.length})</span>
                  </div>
                  <div className="space-y-3 pl-5 border-l-2 border-border ml-1.5">
                    {campLeads.map((lead) => {
                      const resp = entry.responses.find((r) => r.leadId === lead.id);
                      return <AdminLeadCard key={lead.id} lead={lead} response={resp} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"businesses" | "leads">("businesses");

  const { data: adminCheck } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/check"],
    enabled: !!user,
  });

  const { data: businesses, isLoading } = useQuery<AdminBusiness[]>({
    queryKey: ["/api/admin/businesses"],
    enabled: !!user && adminCheck?.isAdmin === true,
  });

  const { data: monitoringStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/admin/monitoring"],
    enabled: !!user && adminCheck?.isAdmin === true,
  });

  const toggleMonitoring = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/admin/monitoring", { enabled });
      return res.json();
    },
    onSuccess: (data: { enabled: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/monitoring"] });
      toast({ title: data.enabled ? "Monitoring enabled" : "Monitoring disabled" });
    },
    onError: () => toast({ title: "Failed to toggle monitoring", variant: "destructive" }),
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Eye className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Eye className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  if (!adminCheck) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Eye className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  if (!adminCheck.isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center space-y-3 max-w-md">
          <Settings className="w-8 h-8 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-semibold">Admin Access Required</h2>
          <p className="text-sm text-muted-foreground">You don't have permission to view this page.</p>
          <Button variant="outline" onClick={() => setLocation("/dashboard")} data-testid="button-back-home">
            <ChevronLeft className="w-3 h-3 mr-1" /> Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/dashboard")} data-testid="button-admin-back">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-primary" />
              <span className="font-semibold text-lg">Admin Panel</span>
            </div>
          </div>
          <Badge variant="secondary" className="text-xs">
            {businesses?.length || 0} clients
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Power className="w-5 h-5 text-primary" />
              <div>
                <h3 className="font-medium text-sm">Monitoring</h3>
                <p className="text-xs text-muted-foreground">
                  {monitoringStatus?.enabled ? "All monitors are running (Reddit, Google Alerts, bookmarklet scans)" : "All monitoring is paused — no new leads will be generated"}
                </p>
              </div>
            </div>
            <Switch
              checked={monitoringStatus?.enabled ?? false}
              onCheckedChange={(checked) => toggleMonitoring.mutate(checked)}
              disabled={toggleMonitoring.isPending}
              data-testid="switch-monitoring-toggle"
            />
          </div>
        </Card>

        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "businesses" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("businesses")}
            data-testid="button-tab-businesses"
          >
            <Users className="w-3 h-3 mr-1" /> Businesses
          </Button>
          <Button
            variant={activeTab === "leads" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("leads")}
            data-testid="button-tab-leads"
          >
            <MessageCircle className="w-3 h-3 mr-1" /> All Leads
          </Button>
        </div>

        {activeTab === "businesses" ? (
          isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-md" />
              ))}
            </div>
          ) : businesses && businesses.length > 0 ? (
            businesses.map((biz) => (
              <BusinessPanel key={biz.id} business={biz} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/businesses"] })} />
            ))
          ) : (
            <Card className="p-8 text-center space-y-3">
              <Users className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No businesses yet.</p>
            </Card>
          )
        ) : (
          <AllLeadsView />
        )}
      </main>
    </div>
  );
}
