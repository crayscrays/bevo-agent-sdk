# @bevo/agent-sdk

Build agents that work inside the Bevo platform — receive slash commands and @mentions from group chats, send rich messages, read group state, and transact via the Bevo wallet infrastructure.

## Installation

```bash
npm install @bevo/agent-sdk
```

## Quick start

```ts
import { BevoAgent } from "@bevo/agent-sdk";
import express from "express";

const agent = new BevoAgent({
  apiKey: process.env.BEVO_API_KEY!,
  apiBase: process.env.BEVO_API_BASE!, // e.g. https://bevo-server-staging.up.railway.app
});

// ── Slash commands ────────────────────────────────────────────────────────────

agent.command("ping", (ctx) => {
  ctx.reply("pong!");
});

agent.command("price", async (ctx) => {
  // Defer when the work takes more than a second
  const deferred = await ctx.defer();
  const price = await fetchTokenPrice(ctx.payload.options.token as string);
  await deferred.update(`Current price: **$${price}**`);
});

agent.command("pay", async (ctx) => {
  const recipient = ctx.payload.resolved.users[ctx.payload.options.to as string];
  await ctx.defer();
  // ... perform transaction ...
  await ctx.client.updateMessage(ctx.payload.placeholderMessageId, {
    contentType: "payment_request",
    card: {
      type: "payment_request",
      title: "Payment sent",
      description: `Sent to ${recipient?.displayName ?? "user"}`,
    },
  });
});

// ── @mention handler (group) ──────────────────────────────────────────────────

agent.onMessage(async (ctx) => {
  await ctx.reply(`Hi! You said: "${ctx.payload.content}"`);
});

// ── DM handler ────────────────────────────────────────────────────────────────

agent.onDm((ctx) => {
  ctx.reply(`You DMed me: "${ctx.payload.content}"`);
});

// ── Register commands on startup ──────────────────────────────────────────────

await agent.syncCommands();

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.post("/webhook", agent.express());
app.listen(3000);
```

## Serverless / edge runtimes

```ts
// Next.js  app/api/webhook/route.ts
import { agent } from "@/lib/agent";

export const POST = agent.fetch();
```

```ts
// Cloudflare Workers
export default { fetch: agent.fetch() };
```

## Response patterns

### Instant reply
```ts
agent.command("hello", (ctx) => {
  ctx.reply("Hello!");           // plain text
  ctx.replyCard({                // rich card
    type: "app_card",
    title: "Welcome",
    fields: [{ label: "Status", value: "Active" }],
    actions: [{ id: "open", label: "Open App", type: "link", url: "https://..." }],
  });
});
```

### Deferred reply (for async work)
```ts
agent.command("report", async (ctx) => {
  const deferred = await ctx.defer(); // Bevo shows a spinner
  const data = await buildReport();
  await deferred.update(`Report ready:\n\n${data}`);
});
```

### Send messages proactively

Use `agent.client` directly to push messages outside a command handler:

```ts
await agent.client.sendMessage({
  groupId: 42,
  channelId: 7,
  content: "Price alert: ETH crossed $3,000!",
  contentType: "agent_tip",
});
```

## API reference

### `new BevoAgent(options)`

| Option | Type | Description |
|--------|------|-------------|
| `apiKey` | `string` | Agent API key from the developer portal |
| `apiBase` | `string` | Bevo backend URL (e.g. `https://bevo-server-staging.up.railway.app`) |

### `agent.command(name, handler, meta?)`

Register a slash command. `name` is the command without the leading `/`.

**CommandContext**

| Property / Method | Description |
|-------------------|-------------|
| `ctx.payload` | Full `CommandPayload` from Bevo |
| `ctx.client` | `BevoAgentClient` instance |
| `ctx.reply(text)` | Respond inline with plain text |
| `ctx.replyCard(card)` | Respond inline with a rich card |
| `ctx.defer()` | Defer response — returns `DeferredContext` |

**DeferredContext**

| Method | Description |
|--------|-------------|
| `deferred.update(text)` | Replace placeholder with text |
| `deferred.updateCard(card)` | Replace placeholder with card |
| `deferred.updateWith(payload)` | Replace placeholder with full payload |

### `agent.onMessage(handler)`

Handle @mentions in group channels. **MessageContext**:

| Property / Method | Description |
|-------------------|-------------|
| `ctx.payload` | `MessagePayload` (`groupId`, `channelId`, `content`, …) |
| `ctx.client` | `BevoAgentClient` instance |
| `ctx.reply(text)` | Post a text reply to the same channel |
| `ctx.replyWith(payload)` | Post a rich reply |

### `agent.onDm(handler)`

Handle direct messages. The reply is **synchronous** — call `ctx.reply()` inside the handler and the content is returned in the webhook response body so Bevo displays it immediately. **DmContext**:

| Property / Method | Description |
|-------------------|-------------|
| `ctx.payload` | `DmMessagePayload` (`conversationId`, `senderPrincipalId`, `content`, …) |
| `ctx.client` | `BevoAgentClient` instance |
| `ctx.reply(text)` | Reply to this DM (synchronous — call before handler returns) |

### `agent.client` — `BevoAgentClient`

| Method | Description |
|--------|-------------|
| `sendMessage(payload)` | Send to a group channel |
| `updateMessage(id, payload)` | Update a placeholder (deferred pattern) |
| `sendDm(conversationId, content)` | Send a direct message |
| `registerCommands(commands)` | Register / replace slash commands |
| `getGroupMembers(groupId)` | List group members |
| `getGroupState(groupId, key)` | Read persistent KV for this app+group |
| `setGroupState(groupId, key, value)` | Write persistent KV |

## Registering your agent on Bevo

1. Log in to the [Bevo Developer Portal](https://devportal.bevo.app).
2. Click **New App** → fill in slug, name, and description.
3. Enable **Agent** and provide your `webhookUrl` (must be `https://`).
4. Add slash commands under **Commands**.
5. Copy the generated **API Key** — store it as `BEVO_API_KEY` in your env.
6. Submit for review when ready.

Your `webhookUrl` receives `POST` requests with the payloads described above. Respond within **10 seconds** for slash commands (or return `{ type: 5 }` to defer) and within **5 seconds** for @mentions.

## Well-known manifest (optional)

For auto-discovery from the devportal, host a `/.well-known/bevo.json` at your app's root:

```json
{
  "agent": {
    "handle": "my_agent",
    "name": "My Agent",
    "description": "Does useful things in Bevo groups",
    "webhookUrl": "https://my-app.com/webhook",
    "capabilities": ["price-feeds", "payments"],
    "commands": [
      { "name": "ping", "description": "Check if the agent is alive" },
      {
        "name": "pay",
        "description": "Send tokens to a user",
        "options": [
          { "name": "to", "type": "user", "description": "Recipient", "required": true },
          { "name": "amount", "type": "string", "description": "Amount to send", "required": true }
        ]
      }
    ]
  }
}
```
