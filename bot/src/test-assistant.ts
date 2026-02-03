/**
 * Test script for the Grimoire REQ Assistant
 *
 * Usage: npm run assistant "your question here"
 */

import { processMessage } from "./llm.js";

async function main() {
  const question = process.argv.slice(2).join(" ");

  if (!question) {
    console.error('Usage: npm run assistant "your question here"');
    console.error("");
    console.error("Examples:");
    console.error(
      '  npm run assistant "how do I see what my contacts are zapping"',
    );
    console.error('  npm run assistant "find all articles about bitcoin"');
    console.error('  npm run assistant "what kind is used for reactions"');
    process.exit(1);
  }

  console.log("Question:", question);
  console.log("");
  console.log("Processing...");
  console.log("");

  try {
    const response = await processMessage(question);
    console.log("Response:");
    console.log("=========");
    console.log(response);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
