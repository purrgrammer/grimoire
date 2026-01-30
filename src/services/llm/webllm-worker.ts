/**
 * WebLLM Worker
 *
 * Offloads model inference to a dedicated web worker to keep UI responsive.
 */

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
