/**
 * Grimoire REQ Assistant Bot
 *
 * A Nostr bot that listens for mentions in the Grimoire group chat
 * and helps users craft REQ queries for the Nostr protocol.
 */

import "websocket-polyfill";
import { SimplePool, finalizeEvent, getPublicKey, Relay } from "nostr-tools";
import type { NostrEvent, Filter } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { processMessage } from "./llm.js";

// Configuration
const BOT_PRIVATE_KEY =
  process.env.BOT_PRIVATE_KEY ||
  "99079e2ac9596a6e27f53f074b9b5303d7b58da8ee6a88c42e74f7cfb261dbe3";
const RELAY_URL = process.env.RELAY_URL || "wss://groups.0xchat.com";
const GROUP_ID = process.env.GROUP_ID || "NkeVhXuWHGKKJCpn";

// Discovery relays for publishing profile
const DISCOVERY_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://purplepag.es",
  RELAY_URL, // Also publish to the group relay
];

// Derive bot pubkey from private key
const botSecretKey = hexToBytes(BOT_PRIVATE_KEY);
const botPubkey = getPublicKey(botSecretKey);

console.log("Grimoire REQ Assistant Bot");
console.log("==========================");
console.log(`Bot pubkey: ${botPubkey}`);
console.log(`Relay: ${RELAY_URL}`);
console.log(`Group: ${GROUP_ID}`);
console.log("");

// Create relay pool (for discovery relays)
const pool = new SimplePool();

// Track processed event IDs to avoid duplicates
const processedEvents = new Set<string>();

// Group relay connection
let groupRelay: Relay | null = null;

/**
 * Send a NIP-29 join request to the group
 */
async function sendJoinRequest(relay: Relay): Promise<void> {
  const eventTemplate = {
    kind: 9021,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", GROUP_ID]],
    content: "",
  };
  const joinEvent = finalizeEvent(eventTemplate, botSecretKey);

  console.log("Sending join request to group...");
  try {
    await relay.publish(joinEvent);
    console.log("Join request sent");
  } catch (error) {
    // May fail if already a member, that's ok
    console.log(
      "Join request:",
      error instanceof Error ? error.message : "sent (may already be member)",
    );
  }
}

/**
 * Check if a message mentions the bot
 */
function isBotMentioned(event: NostrEvent): boolean {
  // Check p-tags for bot pubkey mention
  for (const tag of event.tags) {
    if (tag[0] === "p" && tag[1] === botPubkey) {
      return true;
    }
  }

  // Also check content for npub mention (fallback)
  // This is less reliable but some clients may not use p-tags
  return false;
}

/**
 * Extract the user's question from a mention message
 * Removes the bot mention prefix from the content
 */
function extractQuestion(event: NostrEvent): string {
  // The content might have nostr:npub... or @npub... mentions
  // Remove them to get the actual question
  let content = event.content;

  // Remove nostr:npub... mentions
  content = content.replace(/nostr:npub1[a-z0-9]+/gi, "").trim();

  // Remove @mention patterns
  content = content.replace(/@[a-z0-9]+/gi, "").trim();

  return content;
}

/**
 * Send a message to the group chat
 */
async function sendGroupMessage(
  content: string,
  replyToEvent?: NostrEvent,
): Promise<void> {
  if (!groupRelay) {
    console.error("Not connected to group relay");
    return;
  }

  const tags: string[][] = [["h", GROUP_ID]];

  // Add reply reference if replying to a message
  if (replyToEvent) {
    tags.push(["q", replyToEvent.id, RELAY_URL, replyToEvent.pubkey]);
  }

  const eventTemplate = {
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };

  const signedEvent = finalizeEvent(eventTemplate, botSecretKey);

  console.log(`Sending message: ${content.substring(0, 100)}...`);

  try {
    await groupRelay.publish(signedEvent);
    console.log(`Message sent: ${signedEvent.id}`);
  } catch (error) {
    console.error("Failed to send message:", error);
  }
}

/**
 * Handle an incoming message that mentions the bot
 */
async function handleMention(event: NostrEvent): Promise<void> {
  // Skip if already processed
  if (processedEvents.has(event.id)) {
    return;
  }
  processedEvents.add(event.id);

  // Don't respond to our own messages
  if (event.pubkey === botPubkey) {
    return;
  }

  const question = extractQuestion(event);

  if (!question) {
    console.log("Empty question, skipping");
    return;
  }

  console.log(`\nReceived question from ${event.pubkey.substring(0, 8)}...`);
  console.log(`Question: ${question}`);

  try {
    // Process with LLM
    const response = await processMessage(question);

    // Send response as a reply
    await sendGroupMessage(response, event);
  } catch (error) {
    console.error("Error processing message:", error);
    await sendGroupMessage(
      "Sorry, I encountered an error processing your request. Please try again.",
      event,
    );
  }
}

/**
 * Publish bot profile to discovery relays
 */
async function publishProfile(): Promise<void> {
  const profile = {
    name: "sancho",
    about: "a grimoire assistant",
    picture: "",
    nip05: "",
  };

  const eventTemplate = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(profile),
  };

  const signedEvent = finalizeEvent(eventTemplate, botSecretKey);

  console.log("Publishing profile to discovery relays...");

  const results = await Promise.allSettled(
    pool.publish(DISCOVERY_RELAYS, signedEvent),
  );

  const successful = results.filter((r) => r.status === "fulfilled").length;
  console.log(
    `Profile published to ${successful}/${DISCOVERY_RELAYS.length} relays\n`,
  );
}

/**
 * Connect to group relay with AUTH support
 */
async function connectToGroupRelay(): Promise<Relay> {
  console.log(`Connecting to group relay: ${RELAY_URL}`);

  const relay = await Relay.connect(RELAY_URL);

  // Handle AUTH challenges - onauth receives an EventTemplate and must return a signed event
  relay.onauth = async (evt) => {
    console.log("Received AUTH challenge, authenticating...");
    const signedEvent = finalizeEvent(evt, botSecretKey);
    console.log("AUTH successful");
    return signedEvent;
  };

  console.log("Connected to group relay");
  return relay;
}

/**
 * Start the bot
 */
async function main(): Promise<void> {
  // Publish profile first
  await publishProfile();

  // Connect to group relay with AUTH support
  groupRelay = await connectToGroupRelay();

  // Send join request to the group
  await sendJoinRequest(groupRelay);

  console.log("\nSubscribing to group messages...");

  // Subscribe to group messages
  const filter: Filter = {
    kinds: [9], // Chat messages
    "#h": [GROUP_ID], // Group filter
    since: Math.floor(Date.now() / 1000), // Only new messages
  };

  const sub = groupRelay.subscribe([filter], {
    onevent(event: NostrEvent) {
      // Check if this message mentions the bot
      if (isBotMentioned(event)) {
        handleMention(event).catch(console.error);
      }
    },
    oneose() {
      console.log("Subscription established, listening for mentions...\n");
    },
  });

  // Handle graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    sub.close();
    groupRelay?.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the process alive
  console.log("Bot is running. Press Ctrl+C to stop.\n");
}

main().catch(console.error);
