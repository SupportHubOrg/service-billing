const express = require("express");
const Stripe = require("stripe");
const { prisma } = require("../db/prisma");

const router = express.Router();

const isTestMode = process.env.RuntimeOptions__IsTestMode === "true" || process.env.NODE_ENV === "test";

let _stripe;
function getStripe() {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

const PRICE_AMOUNT = 5000;
const PRICE_CURRENCY = "usd";

router.post("/checkout", async (req, res) => {
  try {
    const { organizationId } = req.body;

    if (!organizationId) {
      return res.status(400).json({ message: "organizationId is required" });
    }

    let org = await prisma.organizationCache.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      org = await prisma.organizationCache.upsert({
        where: { id: organizationId },
        update: {},
        create: {
          id: organizationId,
          name: "Placeholder Name",
          tier: "FREE",
        },
      });
      console.log(`[Checkout] Created placeholder org cache for ${organizationId}`);
    }

    if (isTestMode) {
      console.log(`[Checkout Mock] Mocking checkout session generation for org: ${organizationId}`);
      return res.status(200).json({
        checkoutUrl: "https://checkout.stripe.com/pay/mock_session_unites_test_loop"
      });
    }

    let stripeCustomerId = org.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await getStripe().customers.create({
        name: org.name,
        metadata: { organizationId },
      });
      stripeCustomerId = customer.id;

      await prisma.organizationCache.update({
        where: { id: organizationId },
        data: { stripeCustomerId },
      });

      console.log(`[Checkout] Created Stripe customer: ${stripeCustomerId}`);
    }

    const session = await getStripe().checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      client_reference_id: organizationId,
      metadata: { organizationId },
      line_items: [
        {
          price_data: {
            currency: PRICE_CURRENCY,
            product_data: {
              name: "SupportHub Premium",
              description: "Premium plan – unlimited agents, advanced routing, priority support",
            },
            unit_amount: PRICE_AMOUNT,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment-cancel`,
    });

    await prisma.transaction.create({
      data: {
        organizationId,
        amount: PRICE_AMOUNT / 100,
        currency: PRICE_CURRENCY.toUpperCase(),
        status: "PENDING",
        stripePaymentId: session.id,
      },
    });

    console.log(`[Checkout] Session created: ${session.id} for org: ${organizationId}`);

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (error) {
    console.error("[Checkout] Error:", error);
    return res.status(500).json({ message: "Failed to create checkout session", error: error.message });
  }
});

module.exports = router;
