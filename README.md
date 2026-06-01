# SupportHub — Billing Service

Мікросервіс для управління підписками та платежами через Stripe.

## Функціонал

- **Stripe Checkout**: створення сесій для Premium підписки ($50/міс)
- **Stripe Webhooks**: обробка `checkout.session.completed`, `invoice.payment_succeeded/failed`
- **Kafka Consumer**: слухає `organization-access-events` → кешує організації
- **Kafka Producer**: публікує `billing-events` (`PaymentCompleted`, `PaymentFailed`, `SubscriptionUpgraded`)

## Запуск

```bash
cp .env.example .env
# Заповнити STRIPE_SECRET_KEY та STRIPE_WEBHOOK_SECRET

docker-compose up -d
docker exec billing-service npx prisma migrate deploy
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/billing/checkout` | Створити Stripe Checkout Session |
| POST | `/api/billing/webhook` | Stripe Webhook endpoint |
| GET | `/health` | Health check |

## Kafka Events

### Споживає (Consumer)
- **Topic**: `organization-access-events`
- **Event**: `OrganizationCreated` → upsert OrganizationCache

### Публікує (Producer)
- **Topic**: `billing-events`
- **Events**: `PaymentCompleted`, `PaymentFailed`, `SubscriptionUpgraded`
