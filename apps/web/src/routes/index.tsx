import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MobileNav } from "@/components/mobile-nav";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="container max-w-4xl mx-auto py-6 flex justify-between items-center px-4">
        <a href="#" className="flex items-center gap-3 group">
          <div className="w-8 h-8 relative rounded-full overflow-hidden transition-transform group-hover:scale-110">
            <img
              src="/youraveragetechbro.jpeg"
              alt="Your Average Tech Bro"
              width="32"
              height="32"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="font-bold text-xl group-hover:text-primary transition-colors">
            Your Average Tech Bro
          </div>
        </a>
        <nav className="hidden md:flex space-x-6">
          <a href="#services" className="hover:text-primary transition-colors">
            Services
          </a>
          <a href="#about" className="hover:text-primary transition-colors">
            About
          </a>
          <a href="#pricing" className="hover:text-primary transition-colors">
            Pricing
          </a>
          <a href="#faq" className="hover:text-primary transition-colors">
            FAQ
          </a>
          <a
            href="https://billing.stripe.com/p/login/fZedRag2Qd16fPG8ww"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            Manage Subscription
          </a>
        </nav>
        <MobileNav />
      </header>

      <section className="container max-w-3xl mx-auto py-16 flex flex-col items-center text-center px-4">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-8">
          Currently Not Accepting New Clients
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-8 font-mono">
          I'm at capacity with my current clients. Join the waitlist to be notified when spots open up.
        </p>
        <p className="text-lg text-muted-foreground max-w-2xl mb-12 font-mono">
          You'll get priority access when I start accepting new clients again.
        </p>
        <Button asChild size="lg" className="px-10 py-6 text-base font-mono">
          <a href="https://forms.gle/TVb8TurNGyiqss3g6" target="_blank" rel="noopener noreferrer">
            Join the Waitlist
          </a>
        </Button>
      </section>

      <section id="services" className="container max-w-3xl mx-auto py-20 px-4">
        <h2 className="text-3xl font-bold mb-12 text-center">
          Here's what you'll get
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Chat</CardTitle>
            </CardHeader>
            <CardContent className="font-mono">
              Message me on Discord as much as you want to get my help on
              building/marketing your SaaS.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>1-1 Coaching Calls</CardTitle>
            </CardHeader>
            <CardContent className="font-mono">
              We'll hop on a call so you can ask me anything you want about
              building/marketing your SaaS.
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator className="max-w-3xl mx-auto" />

      <section
        id="about"
        className="container max-w-3xl mx-auto py-20 px-4 bg-muted/30 rounded-lg my-8"
      >
        <h2 className="text-3xl font-bold mb-12 text-center">
          Why should you work with me?
        </h2>
        <div className="mx-auto flex flex-col md:flex-row gap-8 items-center">
          <div className="flex-shrink-0 w-48 h-48 relative rounded-full overflow-hidden mb-6 md:mb-0 border-4 border-background shadow-lg">
            <img
              src="/youraveragetechbro.jpeg"
              alt="Your Average Tech Bro"
              width="192"
              height="192"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="font-mono">
            <p className="text-lg mb-6">
              I've spent the past 4 years building 13+ different apps. The vast
              majority of them have failed, but in the last year I've been able
              to make 4 different apps that have generated {">"}$1,000/month at
              their peak.
            </p>
            <p className="text-lg mb-6">
              I'm not an expert. I'm not a millionaire. I'm just a normal guy
              that has built a lot of apps and figured out how to market them on
              social media to get users + revenue.
            </p>
          </div>
        </div>
      </section>

      <Separator className="max-w-3xl mx-auto" />

      <section className="container max-w-3xl mx-auto py-20 px-4 my-8">
        <h2 className="text-3xl font-bold mb-12 text-center">
          Who this is for
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>People who don't know how to build an app</CardTitle>
            </CardHeader>
            <CardContent className="font-mono">
              <p>
                Doesn't matter if you don't know how to code at all or are a
                seasoned developer, I will help you learn how to build an app.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                People who don't know how to market their apps
              </CardTitle>
            </CardHeader>
            <CardContent className="font-mono">
              <p>
                I'll help you make social media content to grow your app on
                social media. I'll be your social media marketing assistant.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="container max-w-3xl mx-auto py-20 px-4 my-8">
        <h2 className="text-3xl font-bold mb-12 text-center">
          Should you purchase this service?
        </h2>
        <div className="flex flex-col gap-4 text-md font-mono">
          <p>
            I publish everything I know on my Youtube/Instagram/Tiktok accounts.
          </p>
          <p>
            Everything you need to know to build an app + market an app already
            exists out there on the internet.
          </p>
          <p>
            So, you should only purchase this service if you're 100% sure you
            want my help and want my 1:1 support.
          </p>
          <p>
            I'll provide you any technical advice + marketing advice that I
            possibly can, but I will not build your app or make marketing
            content for your app.
          </p>
          <p>
            Once again, I am not a millionaire nor an expert. I'm just a guy
            that has built a lot of apps and figured out how to market them on
            social media to get users + revenue. What works for me isn't
            guaranteed to work for you.
          </p>
          <p>
            If you do decide to work with me and you are not satisfied with my
            service, I have a 100% refund guaranteed policy. No questions asked.
          </p>
        </div>
      </section>

      <Separator className="max-w-3xl mx-auto" />

      <section
        id="pricing"
        className="container max-w-3xl mx-auto py-20 px-4 bg-muted/30 rounded-lg my-8"
      >
        <h2 className="text-3xl font-bold mb-12 text-center">Currently Not Available</h2>
        <div className="max-w-2xl mx-auto text-center">
          <Card className="border-2 border-primary">
            <CardHeader>
              <CardTitle className="text-2xl">Join the Waitlist</CardTitle>
              <CardDescription className="text-lg">
                Be the first to know when spots open up
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 font-mono">
              <p className="text-lg mb-4">
                I'm currently at capacity with my existing clients and not accepting new ones at the moment.
              </p>
              <p className="text-md text-muted-foreground mb-4">
                Join the waitlist to get priority access when I start accepting new clients again. You'll be notified as soon as spots become available.
              </p>
              <div className="pt-4 space-y-4">
                <h3 className="font-bold text-lg">What you'll get access to when spots open:</h3>
                <div className="flex items-start gap-2 text-left">
                  <div className="mt-1">✓</div>
                  <p>One-off coaching calls for specific problems</p>
                </div>
                <div className="flex items-start gap-2 text-left">
                  <div className="mt-1">✓</div>
                  <p>Monthly coaching with 4 calls per month</p>
                </div>
                <div className="flex items-start gap-2 text-left">
                  <div className="mt-1">✓</div>
                  <p>24/7 messaging support via Discord or WhatsApp</p>
                </div>
                <div className="flex items-start gap-2 text-left">
                  <div className="mt-1">✓</div>
                  <p>Personalized advice on building and marketing your app</p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full font-mono" size="lg">
                <a
                  href="https://forms.gle/TVb8TurNGyiqss3g6"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join the Waitlist →
                </a>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      <Separator className="max-w-3xl mx-auto" />

      <section className="container max-w-3xl mx-auto py-16 px-4 my-8 text-center">
        <h2 className="text-3xl font-bold mb-6">Already a subscriber?</h2>
        <p className="text-lg mb-8 font-mono">
          Manage your subscription, update payment methods, or view billing
          history.
        </p>
        <Button asChild variant="outline" size="lg" className="font-mono">
          <a
            href="https://billing.stripe.com/p/login/fZedRag2Qd16fPG8ww"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2"
          >
            Manage Subscription
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-external-link"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </Button>
      </section>

      <Separator className="max-w-3xl mx-auto" />

      <section id="faq" className="container max-w-3xl mx-auto py-20 px-4 my-8">
        <h2 className="text-3xl font-bold mb-12 text-center">
          Frequently asked questions
        </h2>
        <div className="mx-auto">
          <Accordion
            type="multiple"
            defaultValue={["item-1", "item-2", "item-3", "item-4", "item-5"]}
            className="w-full"
          >
            <AccordionItem value="item-1">
              <AccordionTrigger>What is the refund policy?</AccordionTrigger>
              <AccordionContent className="font-mono">
                I offer a 100% refund guarantee if you're not satisfied with the
                service. Your satisfaction is my priority.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>
                Should you purchase this service?
              </AccordionTrigger>
              <AccordionContent className="font-mono">
                Only if you're 100% sure you want 1:1 help. There are many free
                resources available online, including my YouTube channel. This
                service is for those who want personalized guidance.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger>What apps can you help with?</AccordionTrigger>
              <AccordionContent className="font-mono">
                I can help with a wide range of applications, from simple web
                apps to more complex SaaS products. Whether you're starting from
                scratch or improving an existing app, I can provide guidance.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-4">
              <AccordionTrigger>
                What marketing can you help with?
              </AccordionTrigger>
              <AccordionContent className="font-mono">
                I can help you create social media content, develop marketing
                strategies, and find ways to grow your user base. I'll be your
                social media marketing assistant.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-5">
              <AccordionTrigger>
                Do you build apps/make marketing content for me?
              </AccordionTrigger>
              <AccordionContent className="font-mono">
                No, I don't build the apps or create the marketing content for
                you. Instead, I provide guidance, feedback, and coaching to help
                you build and market your own app. The goal is to empower you
                with the skills and knowledge to do it yourself.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <footer className="bg-muted py-12 mt-auto">
        <div className="container max-w-3xl mx-auto text-center px-4">
          <p className="mb-4 font-mono">
            © 2024 Your Average Tech Bro. All rights reserved.
          </p>
          <div className="flex justify-center space-x-4 font-mono">
            <a
              href="https://twitter.com/youraveragetechbro"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Twitter
            </a>
            <a
              href="https://youtube.com/@youraveragetechbro"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              YouTube
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
