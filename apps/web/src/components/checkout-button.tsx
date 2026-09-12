import { Button } from "@/components/ui/button";
import { beginMonthlyCoachingCheckout } from "@/server/stripe.functions";

export function CheckoutButton() {
  return (
    <Button
      className="w-full font-mono"
      size="lg"
      onClick={async () => {
        const { checkoutUrl } = await beginMonthlyCoachingCheckout();
        window.location.assign(checkoutUrl);
      }}
    >
      Join Now
    </Button>
  );
}
