import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, Target, MessageCircle, Shield, ArrowRight, Zap, Users, Bot, Send, Quote, Globe, Utensils, Brain, Dog, Dumbbell, ExternalLink } from "lucide-react";
import { SiFacebook, SiReddit, SiLinkedin, SiGoogle } from "react-icons/si";
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
            <a href="#clients" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-clients">Clients</a>
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
              <div className="flex items-center gap-2.5">
                <SiFacebook className="w-4 h-4 text-muted-foreground" />
                <SiReddit className="w-4 h-4 text-muted-foreground" />
                <SiLinkedin className="w-4 h-4 text-muted-foreground" />
                <SiGoogle className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Monitors the internet for your next customer</span>
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

      <section id="clients" className="py-20 px-4 sm:px-6 bg-card/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-serif font-bold mb-3" data-testid="text-clients-title">Trusted by Growing Businesses</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              From local restaurants to national breeders, businesses across industries use Gemin-Eye to find customers organically.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { name: "Doro Mind", type: "Mental Health", icon: Brain, url: "https://doromind.com" },
              { name: "Chicago Bocce", type: "Recreation", icon: Dumbbell, url: "https://chicagobocce.com" },
              { name: "LMAITFY.ai", type: "AI Tool", icon: Globe, url: "https://lmaitfy.ai" },
              { name: "Tony's", type: "Diner", icon: Utensils, url: "https://tonysbrookfield.com" },
              { name: "Heart of America Whoodles", type: "Dog Breeder", icon: Dog, url: "https://heartofamericawhoodles.com" },
              { name: "Gemin-Eye", type: "AI SaaS", icon: Eye, url: "https://gemin-eye.com" },
            ].map((client) => (
              <a key={client.name} href={client.url} target="_blank" rel="noopener noreferrer" data-testid={`link-client-${client.name.toLowerCase().replace(/\s+/g, "-")}`}>
                <Card className="p-4 flex flex-col items-center text-center gap-2 hover-elevate h-full" data-testid={`card-client-${client.name.toLowerCase().replace(/\s+/g, "-")}`}>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <client.icon className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium leading-tight" data-testid={`text-client-name-${client.name.toLowerCase().replace(/\s+/g, "-")}`}>{client.name}</p>
                  <p className="text-xs text-muted-foreground" data-testid={`text-client-type-${client.name.toLowerCase().replace(/\s+/g, "-")}`}>{client.type}</p>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                </Card>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-serif font-bold mb-3" data-testid="text-testimonial-title">We Eat Our Own Cooking</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Gemin-Eye uses its own platform to find new clients. If that's not confidence in your product, what is?
            </p>
          </div>
          <Card className="p-8 relative" data-testid="card-testimonial">
            <Quote className="w-10 h-10 text-primary/20 absolute top-6 left-6" />
            <div className="relative space-y-4 pl-4">
              <p className="text-lg leading-relaxed text-foreground/90 italic" data-testid="text-testimonial-quote">
                "We built Gemin-Eye to help businesses find customers without ads or cold outreach. So naturally, we asked ourselves: why not use it to find our own clients? We set up Gemin-Eye as its own client — monitoring Reddit, Facebook Groups, and Google Alerts for entrepreneurs and marketers asking about lead generation, customer acquisition, and organic growth. It works. The same AI that finds dog-breed seekers and bocce enthusiasts also finds SaaS founders who need exactly what we built. We're client number seven, and we're our own best case study."
              </p>
              <div className="flex items-center gap-3 pt-2">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                  <Eye className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm" data-testid="text-testimonial-author">Gemin-Eye Team</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-testimonial-subtitle">Client #7 — Yes, we monitor ourselves</p>
                </div>
                <Badge variant="secondary" className="ml-auto text-xs" data-testid="badge-active-client">
                  <Zap className="w-3 h-3 mr-1" /> Active Client
                </Badge>
              </div>
            </div>
          </Card>
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
