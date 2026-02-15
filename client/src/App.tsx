import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import LandingPage from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import OnboardingPage from "@/pages/onboarding";
import NotFound from "@/pages/not-found";
import ClientGuidePage from "@/pages/client-guide";
import AdminPage from "@/pages/admin";

function AuthRouter() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/guide" component={ClientGuidePage} />
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AuthRouter />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
