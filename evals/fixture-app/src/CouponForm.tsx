export function CouponForm() {
  return (
    <form data-testid="coupon-form">
      <label>
        Code
        <input data-testid="coupon-code" name="code" />
      </label>
      <label>
        Discount %
        <input data-testid="coupon-discount" name="discount" type="number" />
      </label>
      <button data-testid="save-coupon" type="submit">
        Save coupon
      </button>
    </form>
  );
}
