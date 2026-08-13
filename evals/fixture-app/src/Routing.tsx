import { CouponBanner } from "./CouponBanner";
import { CouponForm } from "./CouponForm";

/** Route table for the fixture shop. The eval asks a skill to derive these
 * paths from here — nothing outside src/ knows them, so a case whose routes
 * did not come from this file came from nowhere. */
export const routes = [
  { path: "/coupons", element: <CouponBanner /> },
  { path: "/coupons/new", element: <CouponForm /> },
];
