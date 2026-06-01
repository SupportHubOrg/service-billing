const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "billing-service",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

const consumer = kafka.consumer({
  groupId: "billing-group",
});

const producer = kafka.producer();

module.exports = { kafka, consumer, producer };
