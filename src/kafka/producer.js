const { producer } = require("./kafkaClient");

const TOPIC = process.env.KAFKA_TOPIC_WRITE || "billing-events";

/**
 * @param {string} eventType  
 * @param {object} payload 
 */
async function publishBillingEvent(eventType, payload) {
  const message = {
    metadata: {
      eventType,
      timestamp: new Date().toISOString(),
      version: 1,
    },
    payload,
  };

  await producer.send({
    topic: TOPIC,
    messages: [{ value: JSON.stringify(message) }],
  });

  console.log(`[Kafka Producer] Published ${eventType} to ${TOPIC}`);
}

module.exports = { publishBillingEvent };
