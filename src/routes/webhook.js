const express = require("express");
const Stripe = require("stripe");
const { prisma } = require("../db/prisma");
const { publishBillingEvent } = require("../kafka/producer");

const router = express.Router();

let _stripe;
function getStripe() {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = getStripe().webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(`[Webhook] Signature verification failed: ${err.message}`);
      return res.status(400).json({ message: `Webhook Error: ${err.message}` });
    }

    console.log(`[Webhook] Received event: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          await handleCheckoutCompleted(event.data.object);
          break;
        }

        case "invoice.payment_succeeded": {
          await handleInvoicePaymentSucceeded(event.data.object);
          break;
        }

        case "invoice.payment_failed": {
          await handleInvoicePaymentFailed(event.data.object);
          break;
        }

        default:
          console.log(`[Webhook] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[Webhook] Error handling ${event.type}:`, error);
      return res.status(200).json({ received: true, error: error.message });
    }

    return res.status(200).json({ received: true });
  }
);


async function handleCheckoutCompleted(session) {
  const organizationId =
    session.client_reference_id || session.metadata?.organizationId;

  if (!organizationId) {
    console.error("[Webhook] No organizationId in checkout session");
    return;
  }

  console.log(`[Webhook] checkout.session.completed for org: ${organizationId}`);

  const transaction = await prisma.transaction.updateMany({
    where: { stripePaymentId: session.id, status: "PENDING" },
    data: { status: "SUCCESS" },
  });

  const tx = await prisma.transaction.findFirst({
    where: { stripePaymentId: session.id },
  });

  const subscriptionId = session.subscription;

  if (subscriptionId) {
    try {
      const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId);

      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() + 30);

      const validEndDate = stripeSub && stripeSub.current_period_end
        ? new Date(stripeSub.current_period_end * 1000)
        : fallbackDate;

      await prisma.subscription.upsert({
        where: { stripeSubId: subscriptionId },
        update: {
          status: "ACTIVE",
          currentPeriodEnd: validEndDate,
        },
        create: {
          organizationId,
          stripeSubId: subscriptionId,
          status: "ACTIVE",
          currentPeriodEnd: validEndDate,
        },
      });

      console.log(`[Webhook] Subscription ${subscriptionId} upserted to ACTIVE`);
    } catch (err) {
      console.error(`[Webhook] Failed to process subscription logic:`, err);
    }
  }

  await prisma.organizationCache.update({
    where: { id: organizationId },
    data: { tier: "PRO" },
  });

  console.log(`[Webhook] Organization ${organizationId} upgraded to PRO`);

  await publishBillingEvent("PaymentConfirmed", {
    organizationId,
    transactionId: tx?.id || session.id,
    status: "SUCCESS",
    amount: 50.00,
    tier: "PRO",
    paymentDate: new Date().toISOString()
  });

  await publishBillingEvent("SubscriptionUpdated", {
    organizationId,
    oldTier: "FREE",
    newTier: "PRO",
    updateDate: new Date().toISOString(),
    updateReason: "Checkout session completed"
  });
}

async function handleInvoicePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) return;

  const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId);

  const localSub = await prisma.subscription.findUnique({
    where: { stripeSubId: subscriptionId },
  });

  if (localSub) {
    await prisma.subscription.update({
      where: { stripeSubId: subscriptionId },
      data: {
        status: "ACTIVE",
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
      },
    });

    console.log(`[Webhook] Subscription ${subscriptionId} renewed, period end updated`);
  }
}

async function handleInvoicePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) return;

  const localSub = await prisma.subscription.findUnique({
    where: { stripeSubId: subscriptionId },
  });

  if (localSub) {
    await prisma.subscription.update({
      where: { stripeSubId: subscriptionId },
      data: { status: "PAST_DUE" },
    });

    const tx = await prisma.transaction.create({
      data: {
        organizationId: localSub.organizationId,
        amount: (invoice.amount_due || 0) / 100,
        currency: (invoice.currency || "usd").toUpperCase(),
        status: "FAILED",
        stripePaymentId: invoice.payment_intent,
      },
    });

    await publishBillingEvent("PaymentFailed", {
      organizationId: localSub.organizationId,
      transactionId: tx.id,
      errorCode: "invoice_payment_failed",
      errorMessage: "The recurring invoice payment has failed",
    });

    console.log(`[Webhook] Payment failed for subscription ${subscriptionId}`);
  }
}

module.exports = router;
