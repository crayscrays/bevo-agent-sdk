import { BevoAgentClient } from "./client.js";
import type {
  BotCommand,
  CommandPayload,
  MessagePayload,
  WebhookEvent,
  WebhookResponse,
  SendMessagePayload,
  UpdateMessagePayload,
  AppCard,
} from "./types.js";

// ── Context objects passed to handlers ───────────────────────────────────────

export interface DeferredContext {
  /** Update the placeholder with a text reply. */
  update(content: string): Promise<void>;
  /** Update the placeholder with a rich card. */
  updateCard(card: AppCard): Promise<void>;
  /** Update the placeholder with a full payload. */
  updateWith(payload: UpdateMessagePayload): Promise<void>;
}

export interface CommandContext {
  /** Parsed command payload from Bevo. */
  readonly payload: CommandPayload;
  /** Pre-authenticated agent client. */
  readonly client: BevoAgentClient;

  /** Reply instantly with plain text (sync — returns from webhook). */
  reply(content: string): void;
  /** Reply instantly with a card (sync — returns from webhook). */
  replyCard(card: AppCard): void;

  /**
   * Defer the response: returns a `DeferredContext` you can update later.
   * Bevo keeps the "thinking" placeholder until you call `deferred.update()`.
   *
   * @example
   * const deferred = await ctx.defer();
   * const result = await expensiveWork();
   * await deferred.update(result);
   */
  defer(): Promise<DeferredContext>;
}

export interface MessageContext {
  /** The incoming @mention payload. */
  readonly payload: MessagePayload;
  /** Pre-authenticated agent client. */
  readonly client: BevoAgentClient;

  /** Reply to the same channel. */
  reply(content: string): Promise<void>;
  /** Reply to the same channel with a rich payload. */
  replyWith(payload: Omit<SendMessagePayload, "groupId" | "channelId">): Promise<void>;
}

// ── Handler types ─────────────────────────────────────────────────────────────

export type CommandHandler = (ctx: CommandContext) => void | Promise<void>;
export type MessageHandler = (ctx: MessageContext) => void | Promise<void>;

// ── Agent options ─────────────────────────────────────────────────────────────

export interface BevoAgentOptions {
  /** Agent API key obtained from the Bevo developer portal. */
  apiKey: string;
  /**
   * Base URL of the Bevo backend (e.g. `https://bevo-server-staging.up.railway.app`).
   * Override for local development.
   */
  apiBase: string;
}

// ── BevoAgent ─────────────────────────────────────────────────────────────────

/**
 * Core agent class. Register command and message handlers, then expose the
 * webhook endpoint via `.express()` (Express) or `.fetch()` (edge / serverless).
 *
 * @example
 * ```ts
 * import { BevoAgent } from "@bevo/agent-sdk";
 *
 * const agent = new BevoAgent({ apiKey: process.env.BEVO_API_KEY!, apiBase: "https://bevo-server-staging.up.railway.app" });
 *
 * agent.command("ping", (ctx) => ctx.reply("pong!"));
 *
 * agent.onMessage(async (ctx) => {
 *   await ctx.reply(`You said: ${ctx.payload.content}`);
 * });
 *
 * // Express
 * app.post("/webhook", agent.express());
 *
 * // Next.js / Cloudflare Workers
 * export const POST = agent.fetch();
 * ```
 */
export class BevoAgent {
  readonly client: BevoAgentClient;

  private readonly commandHandlers = new Map<string, CommandHandler>();
  private messageHandler: MessageHandler | null = null;
  private registeredCommands: BotCommand[] = [];

  constructor(options: BevoAgentOptions) {
    this.client = new BevoAgentClient({
      apiKey: options.apiKey,
      apiBase: options.apiBase,
    });
  }

  /**
   * Register a slash command handler.
   * @param name - Command name without the leading `/`.
   */
  command(name: string, handler: CommandHandler, meta?: Omit<BotCommand, "name">): this {
    this.commandHandlers.set(name.toLowerCase(), handler);
    this.registeredCommands.push({ name, ...meta });
    return this;
  }

  /**
   * Register a handler for @mention messages.
   * Called when a user mentions the agent in a group channel.
   */
  onMessage(handler: MessageHandler): this {
    this.messageHandler = handler;
    return this;
  }

  /**
   * Push the registered commands to Bevo. Call this once on startup after
   * all `agent.command()` calls.
   */
  async syncCommands(): Promise<void> {
    await this.client.registerCommands(this.registeredCommands);
  }

  // ── Core webhook handler ──────────────────────────────────────────────────

  /**
   * Process a parsed webhook event body.
   * Returns a `WebhookResponse` for slash commands (or `null` for message events).
   */
  async handleEvent(event: WebhookEvent): Promise<WebhookResponse | null> {
    if (event.event === "slash_command") {
      return this._handleCommand(event.payload);
    }
    if (event.event === "message") {
      await this._handleMessage(event.payload);
      return null;
    }
    return null;
  }

  // ── Express adapter ───────────────────────────────────────────────────────

  /**
   * Returns an Express-compatible request handler.
   * Mount it with `app.post("/webhook", agent.express())`.
   */
  express() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (req: any, res: any): Promise<void> => {
      try {
        const body: WebhookEvent = req.body;
        const response = await this.handleEvent(body);
        if (response !== null) {
          res.status(200).json(response);
        } else {
          res.status(204).end();
        }
      } catch (err) {
        console.error("[bevo-agent-sdk] webhook error:", err);
        res.status(500).json({ error: "Internal agent error" });
      }
    };
  }

  /**
   * Returns a Fetch-API-compatible handler for edge / serverless runtimes
   * (Cloudflare Workers, Next.js App Router, Vercel Edge Functions).
   *
   * @example
   * // Next.js app/api/webhook/route.ts
   * export const POST = agent.fetch();
   */
  fetch() {
    return async (request: Request): Promise<Response> => {
      try {
        const body: WebhookEvent = await request.json();
        const response = await this.handleEvent(body);
        if (response !== null) {
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(null, { status: 204 });
      } catch (err) {
        console.error("[bevo-agent-sdk] webhook error:", err);
        return new Response(JSON.stringify({ error: "Internal agent error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    };
  }

  // ── Private: command handling ─────────────────────────────────────────────

  private async _handleCommand(payload: CommandPayload): Promise<WebhookResponse> {
    const handler = this.commandHandlers.get(payload.commandName.toLowerCase());
    if (!handler) {
      return { content: `Unknown command: /${payload.commandName}` };
    }

    let syncResponse: WebhookResponse | null = null;

    const ctx: CommandContext = {
      payload,
      client: this.client,

      reply: (content: string) => {
        syncResponse = { content };
      },

      replyCard: (card: AppCard) => {
        syncResponse = { card };
      },

      defer: async (): Promise<DeferredContext> => {
        syncResponse = { type: 5 };
        const placeholderMessageId = payload.placeholderMessageId;
        return {
          update: (content: string) =>
            this.client
              .updateMessage(placeholderMessageId, { content, contentType: "text" })
              .then(() => undefined),
          updateCard: (card: AppCard) =>
            this.client
              .updateMessage(placeholderMessageId, {
                card,
                contentType: card.type === "payment_request" ? "payment_request" : "app_card",
              })
              .then(() => undefined),
          updateWith: (p: UpdateMessagePayload) =>
            this.client
              .updateMessage(placeholderMessageId, p)
              .then(() => undefined),
        };
      },
    };

    await handler(ctx);

    return syncResponse ?? { content: "" };
  }

  // ── Private: message handling ─────────────────────────────────────────────

  private async _handleMessage(payload: MessagePayload): Promise<void> {
    if (!this.messageHandler) return;

    const ctx: MessageContext = {
      payload,
      client: this.client,

      reply: (content: string) =>
        this.client
          .sendMessage({ groupId: payload.groupId, channelId: payload.channelId, content })
          .then(() => undefined),

      replyWith: (p) =>
        this.client
          .sendMessage({ groupId: payload.groupId, channelId: payload.channelId, ...p })
          .then(() => undefined),
    };

    await this.messageHandler(ctx);
  }
}
