# Billing Service

Microservice for managing subscriptions and payments via Stripe.

## Functionality
- **Stripe Checkout**: Creation of sessions for Premium subscription ($50/month)
- **Stripe Webhooks**: Handling `checkout.session.completed`, `invoice.payment_succeeded/failed`
- **Kafka Consumer**: Listens to `organization-access-events` → caches organizations
- **Kafka Producer**: Publishes `billing-events` (`PaymentCompleted`, `PaymentFailed`, `SubscriptionUpgraded`)

## Launch
```bash
cp .env.example .env
# Fill in STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
docker-compose up -d
docker exec billing-service npx prisma migrate deploy
```

## API Endpoints

| Method | Path                    | Description                        |
|--------|-------------------------|------------------------------------|
| POST   | `/api/billing/checkout` | Create Stripe Checkout Session     |
| POST   | `/api/billing/webhook`  | Stripe Webhook endpoint            |
| GET    | `/health`               | Health check                       |

## Kafka Events

### Consumes (Consumer)
- **Topic**: `organization-access-events`
- **Event**: `OrganizationCreated` → upsert OrganizationCache

### Publishes (Producer)
- **Topic**: `billing-events`
- **Events**: `PaymentCompleted`, `PaymentFailed`, `SubscriptionUpgraded`
