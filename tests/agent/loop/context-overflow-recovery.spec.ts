import assert from "node:assert/strict";
import test from "node:test";

import { AgentLoop } from "../../../src/agent/loop/AgentLoop.js";
import type { AgentRuntimeConfig } from "../../../src/agent/runtime/AgentRuntimeConfig.js";
import type {
  AgentRouterRuntime,
  AgentRuntimeDependencies,
} from "../../../src/agent/runtime/AgentRuntimeDependencies.js";
import { TokenBudgetManager } from "../../../src/context/budget/TokenBudgetManager.js";
import type {
  CanonicalMessage,
  CanonicalModelEvent,
} from "../../../src/model/protocol/canonical.js";
import { createDefaultPermissionContext } from "../../../src/permission/protocol/types.js";
import { ToolRegistry } from "../../../src/tool/registry/ToolRegistry.js";

const contextOverflowError: CanonicalModelEvent = {
  type: "error",
  error: {
    provider: "custom",
    model: "text-model",
    protocol: "openai",
    code: "context_overflow",
    status: 400,
    message: "request exceeds the available context size",
    retryable: false,
    recoverableViaCompact: true,
  },
};

test("agent loop gives up instead of looping forever when truncate-head recovery keeps failing", async () => {
  let executeCalls = 0;
  const loop = createLoop(async function* () {
    executeCalls += 1;
    yield contextOverflowError;
  });

  const events: Array<{ type: string }> = [];
  for await (const event of loop.run({
    sessionId: "context-overflow-loop",
    turnId: "turn-1",
    messages: userMessages(),
  })) {
    events.push(event);
  }

  // initial request + two bounded truncate-head retries, then a surfaced failure.
  assert.equal(executeCalls, 3);
  assert.ok(events.some((event) => event.type === "turn_failed"));
});

function createLoop(
  execute: AgentRouterRuntime["execute"],
): AgentLoop {
  const tokenBudget = new TokenBudgetManager();
  const router: AgentRouterRuntime = {
    invalidateSticky: () => ({ orchestrating: false }),
    decide: async ({ request }) => ({
      provider: request.provider,
      model: request.model,
      scenarioType: "default",
      isSubagent: false,
      orchestrating: false,
      resolvedFrom: "explicit",
      mutations: {},
    }),
    execute,
    stream: async function* (): AsyncIterable<CanonicalModelEvent> {
      yield { type: "message_end", finishReason: "stop" };
    },
    materializeRequest: (decision, request) => ({
      ...request,
      provider: decision.provider,
      model: decision.model,
    }),
    observeUsage: () => undefined,
  };
  const context: AgentRuntimeDependencies["context"] = {
    prepareForModel: async (input) => ({
      messages: input.messages,
      systemPrompt: undefined,
      systemPromptParts: [],
      tools: input.tools,
      diagnostics: [],
      boundaries: [],
    }),
    applyToolResults: async (input) => ({ messages: input.messages, diagnostics: [] }),
    recoverFromModelError: async () => ({
      type: "truncate_head_and_retry",
      keepRatio: 0.5,
      reason: "ptl-first-attempt",
    }),
    captureTurn: async () => undefined,
  };
  const config: AgentRuntimeConfig = {
    provider: "custom",
    model: "text-model",
    cwd: "/workspace/project",
    maxContextTokens: 32_768,
    permissionMode: "bypassPermissions",
    permissionContext: createDefaultPermissionContext({
      cwd: "/workspace/project",
      mode: "bypassPermissions",
      canPrompt: false,
      bypassAvailable: true,
    }),
  };

  return new AgentLoop(config, {
    router,
    tools: {
      registry: new ToolRegistry(),
      scheduler: { async executeAll() { return []; } },
    },
    context,
    tokenAccounting: {
      evaluateRequestBudget: async () => tokenBudget.snapshotFromTokens(10, 32_768),
    } as unknown as AgentRuntimeDependencies["tokenAccounting"],
  });
}

function userMessages(): CanonicalMessage[] {
  return [{
    role: "user",
    content: [{ type: "text", text: "Keep going" }],
  }];
}
