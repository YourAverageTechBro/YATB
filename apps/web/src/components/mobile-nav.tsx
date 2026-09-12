import { Button } from '@yatb/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@yatb/ui/sheet'
import { Menu } from 'lucide-react'
import { useState } from 'react'

const links = [
  { label: 'Services', href: '#services' },
  { label: 'About', href: '#about' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
] as const

export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[250px] sm:w-[300px]">
        <nav className="flex flex-col gap-6 ml-6 mt-10">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-lg font-medium hover:text-primary transition-colors"
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://billing.stripe.com/p/login/fZedRag2Qd16fPG8ww"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="text-lg font-medium hover:text-primary transition-colors"
          >
            Manage Subscription
          </a>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
