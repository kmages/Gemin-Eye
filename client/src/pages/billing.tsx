import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Check, ExternalLink, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Price {
  id: string;
  unit_amount: number;
  currency: string;
  recurring?: { interval: string } | null;
  metadata?: Record<string, string>;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, string>;
  prices: Price[];
}

interface ProductsResponse {
  data: Product[];
  stripeConnected: boolean;
}

interface SubscriptionResponse {
  tier: "starter" | "pro" | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

const TIER_FEATURES: Record<string, string[]> = {
  starter: [
    "Reddit monitoring across your subreddits",
    "Google Alerts monitoring (RSS-based)",
    "AI-generated, community-compliant replies",
    "Telegram lead alerts",
    "1 business / brand",
  ],
  pro: [
    "Everything in Starter",
    "Facebook Spy Glass bookmarklet",
    "LinkedIn Spy Glass bookmarklet",
    "Slack channel notifications",
    "Multiple businesses",
    "Priority support",
  ],
};

function formatPrice(p: Price) {
  const amount = (p.unit_amount / 100).toFixed(0);
  const interval = p.recurring?.interval || "one-time";
  return `$${amount}/${interval}`;
}

export default function BillingPage() {
  const { toast } = useToast();

  const productsQuery = useQuery<ProductsResponse>({
    queryKey: ["/api/billing/products"],
  });

  const subQuery = useQuery<SubscriptionResponse>({
    queryKey: ["/api/billing/subscription"],
  });

  // Refresh subscription after returning from Stripe Checkout
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "success") {
      toast({ title: "Subscription active", description: "Welcome to Gemin-Eye!" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
    } else if (params.get("status") === "cancelled") {
      toast({ title: "Checkout cancelled", description: "No charge was made." });
    }
  }, [toast]);

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { priceId });
      return (await res.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: any) => {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      return (await res.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: any) => {
      toast({ title: "Could not open billing portal", description: err.message, variant: "destructive" });
    },
  });

  const products = productsQuery.data?.data || [];
  const stripeConnected = productsQuery.data?.stripeConnected ?? true;
  const currentTier = subQuery.data?.tier || null;

  // Sort: Starter first, Pro second
  const sorted = [...products].sort((a, b) => {
    const ta = a.metadata?.tier || "";
    const tb = b.metadata?.tier || "";
    if (ta === "starter") return -1;
    if (tb === "starter") return 1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-semibold" data-testid="link-home">
            Gemin-Eye
          </Link>
          <div className="flex items-center gap-3">
            {currentTier && (
              <Badge variant="default" data-testid="badge-current-tier">
                Current plan: {currentTier}
              </Badge>
            )}
            <Link href="/dashboard">
              <Button variant="ghost" data-testid="link-dashboard">Dashboard</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3" data-testid="text-page-title">Choose your plan</h1>
          <p className="text-muted-foreground text-lg">
            Stop chasing leads. Let Gemin-Eye scan the open web for you.
          </p>
        </div>

        {!stripeConnected && (
          <Card className="max-w-2xl mx-auto mb-8 border-amber-500/40">
            <CardHeader>
              <CardTitle>Stripe not connected</CardTitle>
              <CardDescription>
                The platform owner needs to connect Stripe via the Replit Integrations tab before
                checkout can work. Pricing shown below is the planned tier structure.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {productsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>No plans available yet</CardTitle>
              <CardDescription>
                Once Stripe is connected, run <code className="bg-muted px-1.5 py-0.5 rounded">npx tsx scripts/seed-products.ts</code> to create the Starter and Pro plans.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {sorted.map((product) => {
              const tier = product.metadata?.tier || "starter";
              const isCurrent = currentTier === tier;
              const isPro = tier === "pro";
              const monthly = product.prices.find((p) => p.recurring?.interval === "month") || product.prices[0];
              const features = TIER_FEATURES[tier] || [];

              return (
                <Card
                  key={product.id}
                  className={isPro ? "border-primary shadow-lg" : ""}
                  data-testid={`card-plan-${tier}`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle data-testid={`text-plan-name-${tier}`}>{product.name}</CardTitle>
                      {isPro && <Badge>Most popular</Badge>}
                    </div>
                    <CardDescription>{product.description}</CardDescription>
                    {monthly && (
                      <div className="pt-3">
                        <span className="text-4xl font-bold" data-testid={`text-price-${tier}`}>
                          ${(monthly.unit_amount / 100).toFixed(0)}
                        </span>
                        <span className="text-muted-foreground">
                          /{monthly.recurring?.interval || "mo"}
                        </span>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2.5">
                      {features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    {isCurrent ? (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => portalMutation.mutate()}
                        disabled={portalMutation.isPending}
                        data-testid={`button-manage-${tier}`}
                      >
                        {portalMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <CreditCard className="h-4 w-4 mr-2" />
                        )}
                        Manage subscription
                      </Button>
                    ) : monthly ? (
                      (() => {
                        const isThisLoading =
                          checkoutMutation.isPending && checkoutMutation.variables === monthly.id;
                        return (
                          <Button
                            className="w-full"
                            variant={isPro ? "default" : "outline"}
                            onClick={() => checkoutMutation.mutate(monthly.id)}
                            disabled={checkoutMutation.isPending || !stripeConnected}
                            data-testid={`button-subscribe-${tier}`}
                          >
                            {isThisLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <ExternalLink className="h-4 w-4 mr-2" />
                            )}
                            Subscribe — {formatPrice(monthly)}
                          </Button>
                        );
                      })()
                    ) : (
                      <Button className="w-full" disabled>No price configured</Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        {currentTier && (
          <div className="text-center mt-10 text-sm text-muted-foreground">
            Need to update payment, switch plans, or cancel?{" "}
            <button
              className="text-primary underline"
              onClick={() => portalMutation.mutate()}
              data-testid="link-billing-portal"
            >
              Open the Stripe billing portal
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
