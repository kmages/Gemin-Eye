import { useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, MessageCircle, Globe, Facebook, BookOpen } from "lucide-react";
import { SiReddit, SiFacebook, SiTelegram, SiLinkedin } from "react-icons/si";
import { useLocation } from "wouter";

function Section({ number, title, icon, children }: { number: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {icon}
            <h2 className="text-xl font-semibold">{title}</h2>
          </div>
          <div className="space-y-2 text-muted-foreground">{children}</div>
        </div>
      </div>
    </Card>
  );
}

export default function ClientGuidePage() {
  const [, navigate] = useLocation();
  const printRef = useRef<HTMLDivElement>(null);

  function handleDownloadPDF() {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Gemin-Eye Client Setup Guide</title><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; padding: 40px; line-height: 1.6; }
      h1 { font-size: 28px; margin-bottom: 8px; color: #4338ca; }
      .subtitle { font-size: 14px; color: #666; margin-bottom: 32px; }
      .section { margin-bottom: 28px; page-break-inside: avoid; }
      .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
      .section-number { width: 32px; height: 32px; border-radius: 50%; background: #4338ca; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; flex-shrink: 0; }
      .section-title { font-size: 20px; font-weight: 600; }
      .section-badge { font-size: 11px; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
      ul { padding-left: 24px; margin-top: 8px; }
      li { margin-bottom: 6px; }
      .note { background: #f5f3ff; border-left: 3px solid #6d28d9; padding: 12px 16px; margin-top: 12px; border-radius: 0 6px 6px 0; font-size: 13px; }
      .code-block { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; font-family: monospace; font-size: 12px; word-break: break-all; margin-top: 8px; }
      .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #999; text-align: center; }
      .platform-label { font-weight: 600; color: #1a1a2e; }
      @media print { body { padding: 20px; } .section { page-break-inside: avoid; } }
    </style></head><body>
      <h1>Gemin-Eye Setup Guide</h1>
      <p class="subtitle">Your AI-powered customer acquisition system &mdash; step-by-step onboarding</p>

      <div class="section">
        <div class="section-header">
          <div class="section-number">1</div>
          <div class="section-title">Install Telegram</div>
          <span class="section-badge">REQUIRED</span>
        </div>
        <p>All alerts and AI-generated responses are delivered through Telegram.</p>
        <ul>
          <li>Download Telegram from <strong>telegram.org</strong> (available on phone, tablet, and desktop)</li>
          <li>Create an account if you don't have one</li>
          <li>This is where you'll receive lead notifications with suggested responses you can copy-paste</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">2</div>
          <div class="section-title">Set Up Your Business Profile</div>
          <span class="section-badge">REQUIRED</span>
        </div>
        <p>Tell the bot about your business so it knows what to look for.</p>
        <ul>
          <li>Open the Gemin-Eye bot in Telegram (your admin will send you the link)</li>
          <li>Send the command: <strong>/setup</strong></li>
          <li>Answer 3 quick questions:
            <ul>
              <li><strong>Business name</strong> &mdash; e.g., "Heart of America Whoodles"</li>
              <li><strong>What you do/sell</strong> &mdash; e.g., "We breed Whoodle puppies, a Wheaten Terrier and Poodle mix"</li>
              <li><strong>Keywords</strong> &mdash; comma-separated words people might use when looking for you, e.g., "whoodle, whoodle puppy, hypoallergenic dog, wheaten poodle mix"</li>
            </ul>
          </li>
          <li>The bot will confirm your setup and give you a bookmark code (see Step 3)</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">3</div>
          <div class="section-title">Set Up the Facebook Spy Glass</div>
          <span class="section-badge">RECOMMENDED</span>
        </div>
        <p>The Spy Glass is a browser bookmark that scans Facebook Groups for potential customers.</p>
        <ul>
          <li>After completing Step 2, the bot sends you a long code starting with <strong>javascript:void(...</strong></li>
          <li>In Chrome (or your browser), right-click the bookmarks bar</li>
          <li>Click <strong>"Add bookmark"</strong> (or "Add page")</li>
          <li>Name it: <strong>Gemin-Eye</strong></li>
          <li>Paste the code the bot gave you as the <strong>URL</strong></li>
          <li>Save the bookmark</li>
        </ul>
        <div class="note">
          <strong>How to use it:</strong> Go to any Facebook Group, click your "Gemin-Eye" bookmark, and the page will automatically scroll and scan posts. Matching leads are sent to your Telegram instantly. You'll see a purple banner showing progress. Click X to stop, or it will stop automatically after about 5 minutes.
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">4</div>
          <div class="section-title">Join Relevant Facebook Groups</div>
          <span class="section-badge">RECOMMENDED</span>
        </div>
        <p>The Spy Glass works inside Facebook Groups. Join groups where your potential customers hang out.</p>
        <ul>
          <li>Search Facebook for groups related to your industry, location, or niche</li>
          <li>Request to join 5-10 active groups</li>
          <li>Once approved, open each group and click your Gemin-Eye bookmark to scan</li>
          <li>Scan your groups daily or a few times per week for best results</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">5</div>
          <div class="section-title">Set Up the LinkedIn Spy Glass</div>
          <span class="section-badge">RECOMMENDED</span>
        </div>
        <p>The LinkedIn Spy Glass works just like the Facebook one, but for your LinkedIn feed and search results.</p>
        <ul>
          <li>After setup, the bot also sends a second bookmarklet code for LinkedIn</li>
          <li>Create another bookmark the same way (name it <strong>Scan LinkedIn</strong>)</li>
          <li>Paste the LinkedIn code as the URL</li>
        </ul>
        <div class="note">
          <strong>Where to use it:</strong> Open your LinkedIn feed, search results, or any LinkedIn page with posts. Click the "Scan LinkedIn" bookmark and it will auto-scroll and scan for leads matching your keywords. Matched posts get highlighted in blue.
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">6</div>
          <div class="section-title">Reddit Monitoring</div>
          <span class="section-badge">AUTOMATIC</span>
        </div>
        <p>Reddit is monitored automatically &mdash; no action needed from you.</p>
        <ul>
          <li>The system scans relevant subreddits every 90 seconds</li>
          <li>When someone posts a question matching your keywords, you get a Telegram alert</li>
          <li>Each alert includes a suggested response and a direct link to the post</li>
          <li>Your admin sets up which subreddits to monitor based on your business</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">6</div>
          <div class="section-title">Google Alerts &mdash; Web-Wide Monitoring</div>
          <span class="section-badge">OPTIONAL</span>
        </div>
        <p>Monitor the entire web (Quora, forums, blogs, news) for people talking about your topic.</p>
        <ul>
          <li>Go to <strong>google.com/alerts</strong></li>
          <li>Type a keyword (e.g., "whoodle breeder" or "best hypoallergenic dogs")</li>
          <li>Click <strong>"Show options"</strong></li>
          <li>Change <strong>"Deliver to"</strong> from "Email" to <strong>"RSS feed"</strong></li>
          <li>Click <strong>"Create Alert"</strong></li>
          <li>Copy the RSS feed URL (right-click the RSS icon, click "Copy link address")</li>
          <li>In Telegram, send: <strong>/addalert</strong> and paste the RSS URL when prompted</li>
        </ul>
        <div class="note">
          <strong>Tip:</strong> Create 3-5 alerts for different keyword variations. The system checks each feed every 2 minutes automatically.
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">7</div>
          <div class="section-title">Manual Post Scanning via Telegram</div>
          <span class="section-badge">ANYTIME</span>
        </div>
        <p>You can also manually send posts to the bot for analysis at any time.</p>
        <ul>
          <li><strong>Text posts:</strong> Paste the URL and the post text into Telegram</li>
          <li><strong>Screenshots:</strong> Take a screenshot of any post and send the image to the bot &mdash; it reads images automatically</li>
          <li>The bot will score the lead and generate a suggested response</li>
        </ul>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">8</div>
          <div class="section-title">Responding to Leads</div>
          <span class="section-badge">IMPORTANT</span>
        </div>
        <p>When you get a lead alert on Telegram, here's what to do:</p>
        <ul>
          <li>Read the suggested response &mdash; it's written to sound natural, not salesy</li>
          <li>Click <strong>"Open Post"</strong> to go directly to the original post</li>
          <li>Copy the suggested response, personalize it if you want, and post it as a comment/reply</li>
          <li>Use the feedback buttons on the Telegram alert:
            <ul>
              <li><strong>Used It</strong> &mdash; you posted the response (helps the AI learn what works)</li>
              <li><strong>Bad Match</strong> &mdash; the post wasn't relevant to your business</li>
              <li><strong>Too Salesy</strong> &mdash; the response sounded too much like an ad</li>
              <li><strong>Wrong Client</strong> &mdash; matched to the wrong business</li>
            </ul>
          </li>
        </ul>
        <div class="note">
          <strong>Pro tip:</strong> The more feedback you give, the better the AI gets at finding the right leads and writing the right responses for your business.
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-number">9</div>
          <div class="section-title">Telegram Bot Commands Reference</div>
        </div>
        <ul>
          <li><strong>/setup</strong> &mdash; Start the onboarding wizard (first time only)</li>
          <li><strong>/keywords</strong> &mdash; Update your monitoring keywords</li>
          <li><strong>/groups</strong> &mdash; Update target groups/subreddits</li>
          <li><strong>/addalert</strong> &mdash; Add a Google Alerts RSS feed</li>
          <li><strong>/alerts</strong> &mdash; View all your alert feeds</li>
          <li><strong>/removealert</strong> &mdash; Remove an alert feed</li>
          <li><strong>/businesses</strong> &mdash; See all your business profiles</li>
          <li><strong>/help</strong> &mdash; Full guide with all commands</li>
        </ul>
      </div>

      <div class="footer">
        Gemin-Eye &mdash; AI-Powered Customer Acquisition &mdash; Gemin-Eye.com
      </div>
    </body></html>`);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 500);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back">
              <ArrowLeft />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Client Setup Guide</h1>
              <p className="text-muted-foreground text-sm">Everything you need to get your campaign running</p>
            </div>
          </div>
          <Button onClick={handleDownloadPDF} data-testid="button-download-pdf">
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
        </div>

        <div ref={printRef} className="space-y-4">
          <Section number={1} title="Install Telegram" icon={<SiTelegram className="w-5 h-5 text-[#229ED9]" />}>
            <p>All alerts and AI-generated responses are delivered through Telegram.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Download Telegram from <a href="https://telegram.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">telegram.org</a> (available on phone, tablet, and desktop)</li>
              <li>Create an account if you don't have one</li>
              <li>This is where you'll receive lead notifications with suggested responses you can copy-paste</li>
            </ul>
          </Section>

          <Section number={2} title="Set Up Your Business Profile" icon={<MessageCircle className="w-5 h-5 text-primary" />}>
            <p>Tell the bot about your business so it knows what to look for.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Open the Gemin-Eye bot in Telegram (your admin will send you the link)</li>
              <li>Send the command: <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/setup</code></li>
              <li>Answer 3 quick questions:
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li><strong>Business name</strong> — e.g., "Heart of America Whoodles"</li>
                  <li><strong>What you do/sell</strong> — e.g., "We breed Whoodle puppies"</li>
                  <li><strong>Keywords</strong> — comma-separated words people might use, e.g., "whoodle, whoodle puppy, hypoallergenic dog"</li>
                </ul>
              </li>
              <li>The bot confirms your setup and gives you a bookmark code (Step 3)</li>
            </ul>
          </Section>

          <Section number={3} title="Set Up the Facebook Spy Glass" icon={<SiFacebook className="w-5 h-5 text-[#1877F2]" />}>
            <p>The Spy Glass is a browser bookmark that scans Facebook Groups for potential customers.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>After Step 2, the bot sends you a long code starting with <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">javascript:void(...</code></li>
              <li>In Chrome, right-click the bookmarks bar</li>
              <li>Click <strong>"Add bookmark"</strong></li>
              <li>Name it: <strong>Gemin-Eye</strong></li>
              <li>Paste the code as the <strong>URL</strong></li>
              <li>Save the bookmark</li>
            </ul>
            <div className="bg-muted/50 border-l-2 border-primary p-3 rounded-r-md mt-3 text-sm">
              <strong>How to use it:</strong> Go to any Facebook Group, click your "Gemin-Eye" bookmark, and the page will automatically scroll and scan posts. Matching leads are sent to your Telegram instantly. Click X to stop, or it stops automatically after ~5 minutes.
            </div>
          </Section>

          <Section number={4} title="Join Relevant Facebook Groups" icon={<Facebook className="w-5 h-5 text-[#1877F2]" />}>
            <p>The Spy Glass works inside Facebook Groups. Join groups where your potential customers hang out.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Search Facebook for groups related to your industry, location, or niche</li>
              <li>Request to join 5-10 active groups</li>
              <li>Once approved, open each group and click your Gemin-Eye bookmark</li>
              <li>Scan your groups daily or a few times per week for best results</li>
            </ul>
          </Section>

          <Section number={5} title="Set Up the LinkedIn Spy Glass" icon={<SiLinkedin className="w-5 h-5 text-[#0077B5]" />}>
            <p>The LinkedIn Spy Glass works just like the Facebook one, but for your LinkedIn feed and search results.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>After setup, the bot also sends a second bookmarklet code for LinkedIn</li>
              <li>Create another bookmark the same way (name it <strong>"Scan LinkedIn"</strong>)</li>
              <li>Paste the LinkedIn code as the URL</li>
            </ul>
            <div className="bg-muted/50 border-l-2 border-primary p-3 rounded-r-md mt-3 text-sm">
              <strong>Where to use it:</strong> Open your LinkedIn feed, search results, or any LinkedIn page with posts. Click the "Scan LinkedIn" bookmark and it will auto-scroll and scan for leads matching your keywords. Matched posts get highlighted in blue.
            </div>
          </Section>

          <Section number={6} title="Reddit Monitoring" icon={<SiReddit className="w-5 h-5 text-[#FF4500]" />}>
            <p className="font-medium text-green-600 dark:text-green-400">Fully automatic — no action needed from you.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The system scans relevant subreddits every 90 seconds</li>
              <li>When someone posts a question matching your keywords, you get a Telegram alert</li>
              <li>Each alert includes a suggested response and a direct link to the post</li>
              <li>Your admin sets up which subreddits to monitor</li>
            </ul>
          </Section>

          <Section number={7} title="Google Alerts — Web-Wide Monitoring" icon={<Globe className="w-5 h-5 text-primary" />}>
            <p>Monitor the entire web (Quora, forums, blogs, news) for people talking about your topic.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Go to <a href="https://google.com/alerts" target="_blank" rel="noopener noreferrer" className="text-primary underline">google.com/alerts</a></li>
              <li>Type a keyword (e.g., "whoodle breeder")</li>
              <li>Click <strong>"Show options"</strong></li>
              <li>Change <strong>"Deliver to"</strong> to <strong>"RSS feed"</strong></li>
              <li>Click <strong>"Create Alert"</strong></li>
              <li>Copy the RSS feed URL (right-click the RSS icon, "Copy link address")</li>
              <li>In Telegram, send <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/addalert</code> and paste the RSS URL</li>
            </ul>
            <div className="bg-muted/50 border-l-2 border-primary p-3 rounded-r-md mt-3 text-sm">
              <strong>Tip:</strong> Create 3-5 alerts for different keyword variations. The system checks each feed every 2 minutes automatically.
            </div>
          </Section>

          <Section number={8} title="Manual Post Scanning via Telegram" icon={<MessageCircle className="w-5 h-5 text-primary" />}>
            <p>You can manually send any post to the bot for instant analysis.</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Text posts:</strong> Paste the URL + post text into Telegram</li>
              <li><strong>Screenshots:</strong> Send a screenshot of any post — the bot reads images automatically</li>
              <li>The bot scores the lead and generates a suggested response</li>
            </ul>
          </Section>

          <Section number={9} title="Responding to Leads" icon={<BookOpen className="w-5 h-5 text-primary" />}>
            <p>When you get a lead alert on Telegram:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Read the suggested response — it's written to sound natural, not salesy</li>
              <li>Click <strong>"Open Post"</strong> to go directly to the original post</li>
              <li>Copy the response, personalize it if you want, and post it as a reply</li>
              <li>Use the feedback buttons on the alert:
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li><strong>Used It</strong> — you posted the response (helps the AI learn)</li>
                  <li><strong>Bad Match</strong> — the post wasn't relevant</li>
                  <li><strong>Too Salesy</strong> — response sounded too much like an ad</li>
                  <li><strong>Wrong Client</strong> — matched to the wrong business</li>
                </ul>
              </li>
            </ul>
            <div className="bg-muted/50 border-l-2 border-primary p-3 rounded-r-md mt-3 text-sm">
              <strong>Pro tip:</strong> The more feedback you give, the better the AI gets at finding the right leads and writing the right responses.
            </div>
          </Section>

          <Section number={10} title="Telegram Bot Commands" icon={<SiTelegram className="w-5 h-5 text-[#229ED9]" />}>
            <ul className="list-disc pl-5 space-y-1">
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/setup</code> — Start the onboarding wizard</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/keywords</code> — Update your monitoring keywords</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/groups</code> — Update target groups/subreddits</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/addalert</code> — Add a Google Alerts RSS feed</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/alerts</code> — View all your alert feeds</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/removealert</code> — Remove an alert feed</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/businesses</code> — See all your business profiles</li>
              <li><code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">/help</code> — Full guide with all commands</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
