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

// Simple command — no parameters
agent.command("ping", (ctx) => {
  ctx.reply("pong!");
});

// type:"token" — shows the user's wallet with CAs and balances
agent.command("price", async (ctx) => {
  const deferred = await ctx.defer();
  const symbol = ctx.payload.options.token as string;        // e.g. "USDC"
  const token  = ctx.payload.resolved.tokens[symbol];        // { symbol, address, chain }
  const price  = await fetchTokenPrice(token.address, token.chain);
  await deferred.update(`Current price: **$${price}**`);
}, {
  description: "Get the price of a token you hold",
  options: [
    { name: "token", type: "token", description: "Token to check", required: true },
  ],
});

// type:"user" — shows an @mention picker
agent.command("pay", async (ctx) => {
  const key       = ctx.payload.options.to as string;        // e.g. "@alice"
  const recipient = ctx.payload.resolved.users[key];          // { principalId, username, displayName }
  const amount    = ctx.payload.options.amount as string;     // e.g. "50"
  await ctx.defer();
  await ctx.client.sendMessage({
    groupId: ctx.payload.groupId!,
    channelId: ctx.payload.channelId!,
    contentType: "onchain_tx",
    card: { type: "app_card", title: `${amount} USDC → ${recipient?.displayName ?? "user"}` },
    metadata: {
      execution: {
        type: "onchain_tx",
        chainId: 8453,
        toPrincipalId: recipient?.principalId,
        amount,
        currency: "USDC",
      },
    },
    targets: [recipient?.principalId],
    signingMode: "butler_or_user",
  });
}, {
  description: "Pay a user",
  options: [
    { name: "to",     type: "user",   description: "Recipient", required: true  },
    { name: "amount", type: "string", description: "Amount",    required: true  },
  ],
});

// choices — static tap-to-select list (any strings, not limited to tokens)
agent.command("equip", (ctx) => {
  const item = ctx.payload.options.item as string;           // e.g. "sword"
  ctx.reply(`You equipped the ${item}!`);
}, {
  description: "Equip an item",
  options: [
    { name: "item", type: "string", description: "Item to equip", required: true,
      choices: ["sword", "shield", "potion"] },
  ],
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

## Execution wrappers

Any onchain transaction — token transfer, contract call, multi-step swap — is sent as a single `contentType: "onchain_tx"` message. The structured transaction data lives in `metadata.execution`; the optional `card` field provides the human-readable label the client displays.

The server dispatches the execution in this order:
1. `tradeParams` present → full swap state machine
2. `to` + `data` present → raw calldata submitted as-is
3. `toPrincipalId` + `amount` → server resolves recipient wallet and builds calldata

### Token transfer (server-side wallet resolution)

Pass `toPrincipalId` + `amount` and the server looks up the recipient's wallet address and encodes the transfer calldata for you.

```ts
// Send to one user
await agent.client.sendMessage({
  groupId: 42,
  channelId: 7,
  content: "50 USDC sent to Alice",
  contentType: "onchain_tx",
  card: { type: "app_card", title: "50 USDC → Alice", description: "via TradingBot" },
  metadata: {
    execution: {
      type: "onchain_tx",
      chainId: 8453,
      toPrincipalId: "alice-principal-uuid",
      amount: "50",
      currency: "USDC",
    },
  },
  targets: ["alice-principal-uuid"],
  signingMode: "butler_or_user",
});

// Send to every group member at once
await agent.client.sendMessage({
  groupId: 42,
  channelId: 7,
  content: "Group dues: 10 USDC each",
  contentType: "onchain_tx",
  card: { type: "app_card", title: "10 USDC group fee", description: "Monthly dues" },
  metadata: {
    execution: {
      type: "onchain_tx",
      chainId: 8453,
      amount: "10",
      currency: "USDC",
    },
  },
  targets: "all_butlers",
  signingMode: "butler_or_user",
});
```

### Raw contract call

Pre-encode the calldata in your agent and pass it via `to` + `data`.

```ts
await agent.client.sendMessage({
  groupId: 42,
  channelId: 7,
  content: "Rewards ready to claim",
  contentType: "onchain_tx",
  card: { type: "app_card", title: "Claim rewards", description: "Base" },
  metadata: {
    execution: {
      type: "onchain_tx",
      chainId: 8453,
      to: "0xRewardContract",
      data: encodeFunctionData({ abi, functionName: "claimRewards", args: [] }),
      value: "0x0",
      description: "Claim staking rewards",
    },
  },
  targets: "all_butlers",
  signingMode: "butler_auto",
});
```

### ERC-20 approval + swap (two-step)

Send these sequentially; wait for the approval to confirm on-chain before posting the swap.

```ts
// Step 1 — approve the DEX router to spend tokens
await agent.client.sendMessage({
  groupId: 42,
  channelId: 7,
  content: "Approving 50 USDC…",
  contentType: "onchain_tx",
  card: { type: "app_card", title: "Approve USDC", description: "Required before swap" },
  metadata: {
    execution: {
      type: "onchain_tx",
      chainId: 8453,
      to: "0xUsdcContract",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: ["0xDexRouter", 50_000_000n],
      }),
      value: "0x0",
    },
  },
  targets: [userPrincipalId],
  signingMode: "butler_auto",
});

// Step 2 — swap 50 USDC → ETH
await agent.client.sendMessage({
  groupId: 42,
  channelId: 7,
  content: "Swapping 50 USDC → ETH",
  contentType: "onchain_tx",
  card: { type: "app_card", title: "Swap 50 USDC → ETH", description: "0.5% slippage" },
  metadata: {
    execution: {
      type: "onchain_tx",
      chainId: 8453,
      tradeParams: {
        tokenIn: "0xUsdcContract",
        chainIn: 8453,
        amountIn: 50,
        tokenOut: "native",
        chainOut: 8453,
        slippageBps: 50,
      },
    },
  },
  targets: [userPrincipalId],
  signingMode: "butler_auto",
});
```

### `targets` and `signingMode`

`targets` controls who receives the execution prompt:
- `"all_butlers"` — every group member's butler
- `[principalId, ...]` — specific members only

`signingMode` controls who signs:

| Value | Behaviour |
|-------|-----------|
| `"butler_auto"` | Butler executes automatically if policy allows; silently skips if not (default) |
| `"user_sign"` | Always surface a signing prompt to the user; butler never auto-executes |
| `"butler_or_user"` | Butler executes if policy passes; falls back to a user-facing prompt if it doesn't |

---

## API reference

### `new BevoAgent(options)`

| Option | Type | Description |
|--------|------|-------------|
| `apiKey` | `string` | Agent API key from the developer portal |
| `apiBase` | `string` | Bevo backend URL (e.g. `https://bevo-server-staging.up.railway.app`) |

### `agent.command(name, handler, meta?)`

Register a slash command. `name` is the command without the leading `/`.

**Command option types and selectable lists**

The `type` field controls how the Bevo app renders the input for that parameter:

| type | App behaviour | What the agent receives |
|------|---------------|------------------------|
| `"string"` | Free-text input (default) | Plain string in `options` |
| `"integer"` | Free-text input, numeric keyboard | Number in `options` |
| `"boolean"` | Free-text input | Boolean in `options` |
| `"user"` | @mention picker | `options.name = "@handle"` + full user object in `resolved.users["@handle"]` |
| `"token"` | Wallet token picker with live balances | `options.name = "SYMBOL"` + `{ symbol, address, chain }` in `resolved.tokens["SYMBOL"]` |

**`type: "user"` — mention picker**

The user sees a searchable list of people in the conversation. The selected user's `@handle` is stored in `options`, and the full identity (principalId, username, displayName) is in `resolved.users`:

```ts
agent.command("pay", async (ctx) => {
  const key = ctx.payload.options.to as string;         // e.g. "@alice"
  const user = ctx.payload.resolved.users[key];          // { principalId, username, displayName }
  // use user.principalId for on-chain or API operations
});
```

**`type: "token"` — wallet token picker**

The user sees all tokens they hold, with their contract address (CA) and balance. The selected token's symbol is in `options`; the full details — symbol, CA, and chain — are in `resolved.tokens`:

```ts
agent.command("swap", async (ctx) => {
  const symbol = ctx.payload.options.token as string;         // e.g. "USDC"
  const token = ctx.payload.resolved.tokens[symbol];          // { symbol, address, chain }
  // token.address is the EVM contract address (or "native" for gas tokens)
  // token.chain is the chain identifier, e.g. "base", "eth"
});
```

**`choices` — static selectable list**

Any option can also include a `choices` array — a static list of strings the user can tap to select instead of typing freely. Works with any `type` and takes priority over `type: "token"` if both are set.

```ts
await agent.syncCommands([
  {
    name: "equip",
    description: "Equip an item",
    options: [
      {
        name: "item",
        type: "string",
        description: "Item to equip",
        required: true,
        choices: ["sword", "shield", "potion"],  // tap-to-select list
      },
    ],
  },
  {
    name: "swap",
    description: "Swap a token from your wallet",
    options: [
      {
        name: "token",
        type: "token",              // shows the user's full wallet token picker
        description: "Token to swap",
        required: true,
      },
      { name: "amount", type: "string", description: "Amount", required: true },
    ],
  },
]);
```

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
| `getUser(principalId)` | Look up a user's profile and agent wallet address |
| `getGroupMembers(groupId)` | List group members (each has `agentWalletAddress`, never the user's EOA) |
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
      },
      {
        "name": "equip",
        "description": "Equip an item",
        "options": [
          {
            "name": "item",
            "type": "string",
            "description": "Item to equip",
            "required": true,
            "choices": ["sword", "shield", "potion"]
          }
        ]
      }
    ]
  }
}
```

## Executing trades

For any trading or financial operations — including perpetuals on Hyperliquid, tokenized stocks, spot swaps, and other instruments — use the **[ACP CLI](https://github.com/Virtual-Protocol/acp-cli)** rather than constructing raw on-chain calls yourself.

```bash
npm install -g @virtuals-protocol/acp-cli
```

The ACP CLI handles order routing, slippage, settlement, and the full transaction lifecycle across supported venues. Your agent triggers a trade by invoking the CLI in its handler and returning the result to the user via a message or execution payload.

> **Wallet note:** always pass the user's `agentWalletAddress` (returned by `getUser()` or `getGroupMembers()`) as the signer — never the user's personal EOA.
