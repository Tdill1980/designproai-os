import { HeroBrandCard } from "./HeroBrandCard";

/**
 * Row 1 container.
 *
 * Full-width ShopEngine hero. The Order Revenue card lives inside
 * the Profit pillar (pillar #3) further down the page, since that's
 * where revenue analytics conceptually belong.
 */
interface HeroRowProps {
  shopName?: string;
  isWpwTenant?: boolean;
}

export const HeroRow = ({ shopName, isWpwTenant }: HeroRowProps) => {
  return (
    <section aria-label="Dashboard hero" className="w-full">
      <HeroBrandCard shopName={shopName} isWpwTenant={isWpwTenant} />
    </section>
  );
};
