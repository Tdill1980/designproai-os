import test from "node:test";
import assert from "node:assert/strict";
import { completedCheckoutPaymentAllowed } from "../src/server.mjs";

test("normal paid checkout remains authorized", () => {
  assert.equal(completedCheckoutPaymentAllowed("paid", 29900, 0, null), true);
});

test("100 percent promotion code checkout is a legitimate zero-dollar purchase", () => {
  assert.equal(completedCheckoutPaymentAllowed("no_payment_required", 0, 29900, "OWNER100"), true);
});

test("zero-dollar checkout without a promotion code grants nothing", () => {
  assert.equal(completedCheckoutPaymentAllowed("no_payment_required", 0, 29900, null), false);
});

test("no-payment-required checkout with no actual discount grants nothing", () => {
  assert.equal(completedCheckoutPaymentAllowed("no_payment_required", 0, 0, "OWNER100"), false);
});

test("unpaid checkout grants nothing", () => {
  assert.equal(completedCheckoutPaymentAllowed("unpaid", 29900, 0, null), false);
});
