import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, Target, MessageCircle, Shield, ArrowRight, Zap, Users, Bot, Send } from "lucide-react";
import { SiFacebook, SiReddit } from "react-icons/si";
import { useTheme } from "@/components/theme-provider";

const demoPost = {
  author: "Sarah M.",
  group: "West Suburbs Community",
  text: "Hey everyone, looking for a reliable estate planning lawyer in the West Suburbs. Any recommendations?",
};

const demoResponse = "Hi Sarah! A friend of mine recently worked with Mitchell & Associates on their estate plan and had a wonderful experience. They're based right in Brookfield and really take the time to explain everything. Might be worth giving them a call!";

function TypingAnimation({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index < text.length) {
      const timer = setTimeout(() => {
        setDisplayed((prev) => prev + text[index]);
        setIndex((prev) => prev + 1);
      }, 18);
      return () => clearTimeout(timer);
    } else {
      onComplete?.();
    }
  }, [index, text, onComplete]);

  return (
    <span>
      {displayed}
      {index < text.length && (
        <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse" />
      )}
    </span>
  );
}

function DemoPreview() {
  const [stage, setStage] = useState<"post" | "thinking" | "response">("post");

  useEffect(() => {
    const t1 = setTimeout(() => setStage("thinking"), 2500);
    const t2 = setTimeout(() => setStage("response"), 4500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="relative">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium" data-testid="text-demo-author">{demoPost.author}</p>
            <p className="text-xs text-muted-foreground">{demoPost.group}</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-demo-post">
          "{demoPost.text}"
        </p>

        {stage === "thinking" && (
          <div className="flex items-center gap-2 pt-2">
            <Bot className="w-4 h-4 text-primary animate-pulse" />
            <span className="text-xs text-primary font-medium">AI Agent Thinking...</span>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        {stage === "response" && (
          <div className="border-t pt-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-chart-2/20 flex items-center justify-center">
                <Send className="w-3 h-3 text-chart-2" />
              </div>
              <span className="text-xs font-medium text-chart-2">Gemin-Eye Response</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/80" data-testid="text-demo-response">
              <TypingAnimation text={demoResponse} />
            </p>
          </div>
        )}
      </Card>
      <div className="absolute -top-3 -right-3">
        <Badge variant="secondary" className="text-xs">Live Demo</Badge>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  const features = [
    {
      icon: Target,
      title: "Hyper-Targeted",
      description: "We find the exact people asking for your service right now. No wasted impressions.",
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      icon: MessageCircle,
      title: "Subtle & Human",
      description: "Our AI crafts responses that look like friendly advice, not disruptive ads.",
      color: "text-chart-2",
      bg: "bg-chart-2/10",
    },
    {
      icon: Shield,
      title: "Trusted Channels",
      description: "By participating in niche groups, your brand leverages built-in community trust.",
      color: "text-chart-3",
      bg: "bg-chart-3/10",
    },
  ];

  const howItWorks = [
    {
      step: "01",
      title: "Describe Your Business",
      description: "Tell us who you are, what you offer, and who your ideal customer is.",
      icon: Users,
    },
    {
      step: "02",
      title: "AI Generates Your Strategy",
      description: "Our top-tier AI analyzes your business and identifies the best groups, keywords, and platforms to target.",
      icon: Bot,
    },
    {
      step: "03",
      title: "Monitor & Respond",
      description: "Gemin-Eye watches for high-intent posts and crafts human-like responses. You approve and post in seconds via Telegram alerts.",
      icon: Zap,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Eye className="w-6 h-6 text-primary" />
            <span className="font-semibold text-lg tracking-tight" data-testid="text-brand-name">Gemin-Eye</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild data-testid="button-login">
              <a href="/api/login">Log In</a>
            </Button>
            <Button size="sm" asChild data-testid="button-get-started">
              <a href="/api/login">Get Started <ArrowRight className="w-4 h-4 ml-1" /></a>
            </Button>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="space-y-6">
            <Badge variant="secondary" className="text-xs" data-testid="badge-tagline">
              <Zap className="w-3 h-3 mr-1" /> AI-Powered Customer Acquisition
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold leading-tight tracking-tight" data-testid="text-hero-title">
              Customer Acquisition,{" "}
              <span className="text-primary">Reimagined.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg leading-relaxed" data-testid="text-hero-subtitle">
              Stop blasting ads to millions. Gemin-Eye monitors specific interest groups and responds to high-intent questions as a helpful human.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" asChild data-testid="button-hero-cta">
                <a href="/api/login">
                  Get Started Free <ArrowRight className="w-4 h-4 ml-2" />
                </a>
              </Button>
              <Button variant="outline" size="lg" asChild data-testid="button-hero-demo">
                <a href="#how-it-works">View Demo</a>
              </Button>
            </div>
            <div className="flex items-center gap-4 pt-2">
              <div className="flex items-center gap-1.5">
                <SiFacebook className="w-4 h-4 text-muted-foreground" />
                <SiReddit className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Monitors Facebook, Reddit & more</span>
            </div>
          </div>

          <div className="lg:pl-8">
            <DemoPreview />
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-4 sm:px-6 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-serif font-bold mb-3" data-testid="text-features-title">The Smartest Way to Sell</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Direct, intentional response advertising that finds your customers where they're already asking.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {features.map((f) => (
              <Card key={f.title} className="p-6 space-y-4 hover-elevate" data-testid={`card-feature-${f.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <div className={`w-10 h-10 rounded-md ${f.bg} flex items-center justify-center`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-semibold text-lg">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-serif font-bold mb-3" data-testid="text-how-title">How It Works</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              From setup to your first lead in minutes, not months.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {howItWorks.map((step) => (
              <div key={step.step} className="text-center space-y-4" data-testid={`step-${step.step}`}>
                <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <step.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="text-xs font-mono text-primary font-semibold">STEP {step.step}</div>
                <h3 className="font-semibold text-lg">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-card/50">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-serif font-bold" data-testid="text-cta-title">Ready to Find Your Next Customer?</h2>
          <p className="text-muted-foreground">
            Join businesses that are already using AI to turn community conversations into qualified leads.
          </p>
          <Button size="lg" asChild data-testid="button-cta-final">
            <a href="/api/login">
              Start For Free <ArrowRight className="w-4 h-4 ml-2" />
            </a>
          </Button>
        </div>
      </section>

      <footer className="border-t py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Gemin-Eye</span>
          </div>
          <p className="text-xs text-muted-foreground">&copy; 2026 Gemin-Eye. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
