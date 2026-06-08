require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { kafka, consumer, producer } = require("./kafka/kafkaClient");
const { startConsumer } = require("./kafka/consumer");
const { prisma } = require("./db/prisma");

const checkoutRouter = require("./routes/checkout");
const webhookRouter = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 5002;

app.use("/api/billing", webhookRouter);

app.use(cors());
app.use(express.json());


app.use("/api/billing", checkoutRouter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "billing-service" });
});

async function createKafkaTopics() {
  try {
    const adminClient = kafka.admin();
    await adminClient.connect();
    
    const existingTopics = await adminClient.fetchTopicMetadata();
    const existingTopicNames = new Set(existingTopics.topics.map(t => t.name));

    const topicsNeeded = [
      process.env.KAFKA_TOPIC_WRITE || "billing-events"
    ];

    const topicsToCreate = topicsNeeded
      .filter(topic => !existingTopicNames.has(topic))
      .map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 }));

    if (topicsToCreate.length > 0) {
      await adminClient.createTopics({ topics: topicsToCreate, validateOnly: false });
      console.log("[Kafka] Topics created:", topicsToCreate.map(t => t.topic).join(", "));
    }

    await adminClient.disconnect();
  } catch (error) {
    console.log("[Kafka] Topics already exist or could not be created:", error.message);
  }
}

async function start() {
  try {
    await createKafkaTopics();
    await producer.connect();
    console.log("[Kafka] Producer connected");

    await consumer.connect();
    console.log("[Kafka] Consumer connected");

    await startConsumer();

    app.listen(PORT, () => {
      console.log(`\n🚀 Billing Service running on port ${PORT}`);
      console.log(`   POST /api/billing/checkout`);
      console.log(`   POST /api/billing/webhook`);
      console.log(`   GET  /health\n`);
    });
  } catch (error) {
    console.error("[Startup] Fatal error:", error);
    process.exit(1);
  }
}

async function shutdown() {
  console.log("\nGracefully shutting down...");
  try {
    await producer.disconnect();
    await consumer.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
