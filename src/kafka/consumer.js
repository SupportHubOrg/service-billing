const { consumer } = require("./kafkaClient");
const { prisma } = require("../db/prisma");

const TOPIC = process.env.KAFKA_TOPIC_READ_ORG || "organization-access-events";

async function startConsumer() {
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  console.log(`[Kafka Consumer] Listening to topic: ${TOPIC}`);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;

      try {
        const rawEvent = JSON.parse(message.value.toString());

        if (!rawEvent?.metadata?.eventType || !rawEvent?.payload) {
          console.warn(`[${topic}] Ignoring bad structure message.`);
          return;
        }

        const eventType = rawEvent.metadata.eventType;
        const payload = rawEvent.payload;
        const offset = message.offset;

        console.log(`\n[Kafka Consumer] Event: ${eventType} (topic=${topic}, partition=${partition}, offset=${offset})`);

        switch (eventType) {
          case "OrganizationCreated": {
            const { organizationId, organizationName } = payload;

            await prisma.organizationCache.upsert({
              where: { id: organizationId },
              update: { name: organizationName },
              create: {
                id: organizationId,
                name: organizationName,
                tier: "FREE",
              },
            });

            console.log(`[Kafka Consumer] Cached organization: ${organizationId} (${organizationName})`);
            break;
          }

          default:
            console.log(`[Kafka Consumer] Event ${eventType} is not handled by billing-service, skipping.`);
            break;
        }
      } catch (error) {
        console.error("[Kafka Consumer] Error processing message:", error);
      }
    },
  });
}

module.exports = { startConsumer };
