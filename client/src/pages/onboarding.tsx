import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Eye, ArrowRight, ArrowLeft, Loader2, Sparkles, Target,
  CheckCircle, Bot, Zap, MapPin, MessageCircle, Copy, ExternalLink
} from "lucide-react";
import { SiFacebook, SiReddit } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";

const businessFormSchema = z.object({
  name: z.string().min(1, "Business name is required"),
  type: z.string().min(1, "Business type is required"),
  contactEmail: z.string().email("Please enter a valid email address"),
  contactPhone: z.string().min(1, "Phone number is required"),
  website: z.string().optional().default(""),
  location: z.string().optional().default(""),
  targetAudience: z.string().min(1, "Target audience is required"),
  coreOffering: z.string().min(10, "Please describe your core offering in more detail"),
  preferredTone: z.string().min(1, "Please select a tone"),
});

type BusinessFormData = z.infer<typeof businessFormSchema>;

interface StrategyResult {
  platforms: Array<{ name: string; icon: string }>;
  groups: string[];
  keywords: string[];
  sampleResponse: string;
  rationale: string;
}

export default function OnboardingPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"profile" | "strategy" | "complete">("profile");
  const [strategy, setStrategy] = useState<StrategyResult | null>(null);
  const [createdBusinessId, setCreatedBusinessId] = useState<number | null>(null);
  const [connectToken, setConnectToken] = useState<string | null>(null);

  const form = useForm<BusinessFormData>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: {
      name: "",
      type: "",
      contactEmail: "",
      contactPhone: "",
      website: "",
      location: "",
      targetAudience: "",
      coreOffering: "",
      preferredTone: "empathetic",
    },
  });

  const generateStrategy = useMutation({
    mutationFn: async (data: BusinessFormData) => {
      const res = await apiRequest("POST", "/api/strategy/generate", data);
      return res.json();
    },
    onSuccess: (data) => {
      setStrategy(data);
      setStep("strategy");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate strategy. Please try again.",
        variant: "destructive",
      });
    },
  });

  const createBusiness = useMutation({
    mutationFn: async (data: BusinessFormData & { strategy: StrategyResult }) => {
      const res = await apiRequest("POST", "/api/businesses", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      if (data?.id) setCreatedBusinessId(data.id);
      if (data?.connectToken) setConnectToken(data.connectToken);
      setStep("complete");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save your business. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmitProfile = (data: BusinessFormData) => {
    generateStrategy.mutate(data);
  };

  const onApproveStrategy = () => {
    if (!strategy) return;
    const formData = form.getValues();
    createBusiness.mutate({ ...formData, strategy });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Eye className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  if (!user) {
    window.location.href = "/api/login";
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLocation("/dashboard")}>
            <Eye className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg tracking-tight">Gemin-Eye</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${step === "profile" ? "bg-primary" : "bg-chart-2"}`} />
            <div className={`w-8 h-0.5 ${step !== "profile" ? "bg-chart-2" : "bg-muted"}`} />
            <div className={`w-2 h-2 rounded-full ${step === "strategy" ? "bg-primary" : step === "complete" ? "bg-chart-2" : "bg-muted"}`} />
            <div className={`w-8 h-0.5 ${step === "complete" ? "bg-chart-2" : "bg-muted"}`} />
            <div className={`w-2 h-2 rounded-full ${step === "complete" ? "bg-primary" : "bg-muted"}`} />
          </div>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        {step === "profile" && (
          <div className="space-y-8">
            <div className="space-y-2">
              <h1 className="text-3xl font-serif font-bold" data-testid="text-onboarding-title">Setup Your Agent</h1>
              <p className="text-muted-foreground">
                Provide the intelligence Gemin-Eye needs to represent you.
              </p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmitProfile)} className="space-y-6">
                <Card className="p-6 space-y-5">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" /> Business Profile
                  </h2>

                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Doro Mind" {...field} data-testid="input-business-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Type / Niche</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Psychiatric care for serious mental illness" {...field} data-testid="input-business-type" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contactEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="e.g., you@yourbusiness.com" {...field} data-testid="input-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input type="tel" placeholder="e.g., (312) 555-1234" {...field} data-testid="input-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., https://yourbusiness.com" {...field} data-testid="input-website" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location / Reach</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Chicago IL, National, or Global / Web-based" {...field} data-testid="input-location" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="targetAudience"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Audience</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Caregivers of patients with schizophrenia" {...field} data-testid="input-target-audience" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="coreOffering"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Core Offering & Unique Value</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe what makes your business unique and what you offer..."
                            className="resize-none"
                            rows={4}
                            {...field}
                            data-testid="input-core-offering"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="preferredTone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preferred Tone</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-tone">
                              <SelectValue placeholder="Select tone" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="empathetic">Empathetic & Supportive</SelectItem>
                            <SelectItem value="professional">Professional & Authoritative</SelectItem>
                            <SelectItem value="casual">Casual & Friendly</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Card>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={generateStrategy.isPending}
                  data-testid="button-generate-strategy"
                >
                  {generateStrategy.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      AI is Analyzing Your Business...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate AI Strategy
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </div>
        )}

        {step === "strategy" && strategy && (
          <div className="space-y-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setStep("profile")} data-testid="button-back">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h1 className="text-3xl font-serif font-bold" data-testid="text-strategy-title">Your AI Strategy</h1>
              </div>
              <p className="text-muted-foreground pl-12">
                Review the strategy Gemin-Eye created for your business.
              </p>
            </div>

            <Card className="p-6 space-y-5">
              <h2 className="font-semibold flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" /> Strategy Rationale
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground" data-testid="text-strategy-rationale">
                {strategy.rationale}
              </p>
            </Card>

            <Card className="p-6 space-y-5">
              <h2 className="font-semibold flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" /> Recommended Platforms & Groups
              </h2>
              <div className="flex flex-wrap gap-2">
                {strategy.platforms.map((p) => (
                  <Badge key={p.name} variant="secondary" className="text-xs">
                    {p.name === "Facebook" && <SiFacebook className="w-3 h-3 mr-1" />}
                    {p.name === "Reddit" && <SiReddit className="w-3 h-3 mr-1" />}
                    {p.name}
                  </Badge>
                ))}
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium">Target Groups</span>
                <div className="grid gap-2">
                  {strategy.groups.map((g, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                      <CheckCircle className="w-3 h-3 text-chart-2 flex-shrink-0" />
                      {g}
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-5">
              <h2 className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> Keywords to Monitor
              </h2>
              <div className="flex flex-wrap gap-2">
                {strategy.keywords.map((kw, i) => (
                  <Badge key={i} variant="secondary" className="text-xs font-mono">{kw}</Badge>
                ))}
              </div>
            </Card>

            <Card className="p-6 space-y-5">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Sample AI Response
              </h2>
              <div className="bg-muted/50 p-4 rounded-md">
                <p className="text-sm leading-relaxed italic text-muted-foreground" data-testid="text-sample-response">
                  "{strategy.sampleResponse}"
                </p>
              </div>
            </Card>

            <Button
              size="lg"
              className="w-full"
              onClick={onApproveStrategy}
              disabled={createBusiness.isPending}
              data-testid="button-approve-strategy"
            >
              {createBusiness.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Setting Up Your Agent...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve & Launch Campaign
                </>
              )}
            </Button>
          </div>
        )}

        {step === "complete" && (
          <div className="py-12 space-y-8">
            <div className="text-center space-y-2">
              <div className="w-20 h-20 mx-auto rounded-full bg-chart-2/10 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-chart-2" />
              </div>
              <h2 className="text-3xl font-serif font-bold" data-testid="text-complete-title">You're All Set!</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                One last step — connect Telegram so we can send leads to your phone.
              </p>
            </div>

            <Card className="p-6 space-y-6">
              <h2 className="font-semibold text-center" data-testid="text-telegram-title">Get Leads on Your Phone in 3 Steps</h2>

              <div className="space-y-5">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-sm font-bold text-primary">1</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Download Telegram</p>
                    <p className="text-xs text-muted-foreground mb-2">Free messaging app — like WhatsApp or iMessage</p>
                    <div className="flex flex-wrap gap-2">
                      <a href="https://apps.apple.com/app/telegram-messenger/id686449807" target="_blank" rel="noopener noreferrer" data-testid="link-telegram-ios">
                        <Badge variant="outline" className="text-xs">iPhone</Badge>
                      </a>
                      <a href="https://play.google.com/store/apps/details?id=org.telegram.messenger" target="_blank" rel="noopener noreferrer" data-testid="link-telegram-android">
                        <Badge variant="outline" className="text-xs">Android</Badge>
                      </a>
                      <a href="https://desktop.telegram.org/" target="_blank" rel="noopener noreferrer" data-testid="link-telegram-desktop">
                        <Badge variant="outline" className="text-xs">Desktop</Badge>
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-sm font-bold text-primary">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Create your account</p>
                    <p className="text-xs text-muted-foreground">Just enter your phone number — takes 30 seconds</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-sm font-bold text-primary">3</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Tap "Connect Telegram" below</p>
                    <p className="text-xs text-muted-foreground mb-3">This links your account — leads go straight to your phone</p>
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={() => window.open(`https://t.me/kmages_bot?start=connect_${createdBusinessId}_${connectToken}`, "_blank")}
                      data-testid="button-open-telegram"
                      disabled={!createdBusinessId || !connectToken}
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Connect Telegram
                      <ExternalLink className="w-3 h-3 ml-2" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 pt-2 border-t">
                <CheckCircle className="w-4 h-4 text-chart-2 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Already have Telegram? Skip to step 3 — just tap Connect.
                </p>
              </div>
            </Card>

            <Button variant="outline" className="w-full" onClick={() => setLocation("/dashboard")} data-testid="button-go-dashboard">
              Skip for now — Go to Dashboard
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
