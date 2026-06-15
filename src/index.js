require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { execSync } = require("child_process");
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

async function ensureRequiredTopicsExist() {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    
    const requiredTopics = [
      process.env.KAFKA_TOPIC_READ_ORG || "organization-access-events",
      process.env.KAFKA_TOPIC_WRITE || "billing-events"
    ];

    const topicsToCreate = requiredTopics
      .filter(topic => !existingTopics.includes(topic))
      .map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 }));

    if (topicsToCreate.length > 0) {
      await admin.createTopics({
        topics: topicsToCreate,
        waitForLeaders: true
      });
      console.log(`[Kafka Admin] Programmatically provisioned required topics: ${topicsToCreate.map(t => t.topic).join(", ")}`);
    } else {
      console.log("[Kafka Admin] All required infrastructure topics are present on the broker.");
    }
  } catch (error) {
    console.error("[Kafka Admin] Fatal error verifying or establishing application topics:", error);
    throw error;
  } finally {
    await admin.disconnect();
  }
}

async function start() {
  try {
    console.log("[Prisma] Pushing structural schema definitions to BillingDb...");
    execSync("npx prisma db push --accept-data-loss --skip-generate", { stdio: "inherit" });
    console.log("[Prisma] Database tables aligned successfully.");

    await ensureRequiredTopicsExist();

    await producer.connect();
    console.log("[Kafka] Producer connected");

    await consumer.connect();
    console.log("[Kafka] Consumer connected");

    await startConsumer();

    app.listen(PORT, () => {
      console.log(`\nBilling Service running on port ${PORT}`);
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
