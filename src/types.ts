// ── Command & capability schema ──────────────────────────────────────────────

export type CommandOptionType = "user" | "string" | "integer" | "boolean" | "token";

export interface CommandOption {
  name: string;
  type?: CommandOptionType;
  description?: string;
  required?: boolean;
  /**
   * Static list of selectable values for this parameter. When provided, the
   * Bevo app renders a tap-to-select list instead of a free-text field.
   * Can be any strings — not limited to tokens or any particular domain.
   * Takes priority over `type: "token"` if both are set.
   *
   * @example ["sword", "shield", "potion"]
   * @example ["USDC", "ETH", "BTC"]
   */
  choices?: string[];
}

export interface BotCommand {
  name: string;
  description?: string;
  options?: CommandOption[];
}

// ── Message content ───────────────────────────────────────────────────────────

export type BotContentType =
  | "text"
  | "app_card"
  | "embed"
  | "components"
  | "agent_tip"
  | "agent_info"
  | "ephemeral"
  | "payment_request"
  | "contract_call"
  | "butler_action"
  | "approval_request"
  | "reply"
  | "attachment"
  | "link_unfurl";

export type MessageVisibility = "public" | "ephemeral" | "targeted" | "asymmetric";

export type ExecutionStatus =
  | "pending_action"
  | "signed"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "expired";

// ── Rich content structures ───────────────────────────────────────────────────

export interface AppCardAction {
  id: string;
  label: string;
  type?: "link" | "action" | "transaction";
  url?: string;
  payload?: Record<string, unknown>;
}

export interface AppCard {
  type: "app_card" | "payment_request";
  title: string;
  description?: string;
  imageUrl?: string;
  fields?: Array<{ label: string; value: string }>;
  actions?: AppCardAction[];
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedMessage {
  color?: string;
  author?: { name: string; iconUrl?: string; url?: string };
  title?: string;
  url?: string;
  description?: string;
  fields?: EmbedField[];
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; iconUrl?: string };
  timestamp?: string;
}

export type ButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";

export interface ButtonComponent {
  type: "button";
  customId?: string;
  label: string;
  style?: ButtonStyle;
  url?: string;
  disabled?: boolean;
  emoji?: string;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
  default?: boolean;
}

export interface SelectMenuComponent {
  type: "select_menu";
  customId: string;
  placeholder?: string;
  options: SelectOption[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

export interface ActionRow {
  type: "action_row";
  components: Array<ButtonComponent | SelectMenuComponent>;
}

// ── Webhook event payloads ────────────────────────────────────────────────────

export interface ResolvedUser {
  principalId: string;
  username: string | null;
  displayName: string | null;
}

/** Full details for a token the user selected via a type:"token" parameter. */
export interface ResolvedToken {
  symbol: string;
  /** EVM contract address, or "native" for the chain's native gas token. */
  address: string;
  chain: string;
}

export interface CommandPayload {
  commandName: string;
  options: Record<string, unknown>;
  resolved: {
    /** Keyed by "@handle". Present for options with type:"user". */
    users: Record<string, ResolvedUser>;
    /** Keyed by token symbol. Present for options with type:"token". */
    tokens: Record<string, ResolvedToken>;
  };
  rawArgs: string;
  /** Present for group slash commands. */
  groupId?: number;
  /** Present for group slash commands. */
  channelId?: number;
  /** Present for DM slash commands. */
  conversationId?: string;
  senderId: string;
  messageId: string | number;
  placeholderMessageId: string | number;
  createdAt: string;
}

export interface MessagePayload {
  id: number;
  groupId: number;
  channelId: number;
  senderId: string;
  content: string;
  contentType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DmMessagePayload {
  conversationId: string;
  messageId: string;
  senderPrincipalId: string;
  content: string;
  createdAt: string;
}

export interface SlashCommandEvent {
  event: "slash_command";
  payload: CommandPayload;
}

export interface MessageEvent {
  event: "message";
  payload: MessagePayload;
}

export interface DmMessageEvent {
  event: "dm_message";
  payload: DmMessagePayload;
}

export type WebhookEvent = SlashCommandEvent | MessageEvent | DmMessageEvent;

// ── Agent API I/O ─────────────────────────────────────────────────────────────

// ── Execution wrapper types (EXECUTION message metadata.execution) ────────────

export type ExecutionType =
  | "payment_request"
  | "contract_call"
  | "butler_action"
  | "approval_request"
  | "trade";

/** Controls who signs an EXECUTION wrapper message. */
export type ExecutionSigningMode = "butler_auto" | "user_sign" | "butler_or_user";

/**
 * Structured transaction data stored in metadata.execution for EXECUTION messages
 * (contentType: payment_request | contract_call | butler_action | approval_request).
 */
export interface ExecutionPayload {
  type: ExecutionType;
  chainId?: number;
  contractAddress?: string;
  functionName?: string;
  args?: unknown[];
  /** Raw wei amount as hex string. */
  value?: string;
  /** Human-readable amount, e.g. "50 USDC". */
  amount?: string;
  currency?: string;
  fromPrincipalId?: string;
  toPrincipalId?: string;
  description?: string;
  /** Originating agent id — stamped by the server for butler policy trust checks. */
  agentId?: string;
  /** Full swap intent for type === "trade". */
  tradeParams?: {
    tokenIn: string;
    chainIn: number;
    amountIn: number;
    tokenOut: string;
    chainOut: number;
    slippageBps?: number;
    deadlineSecs?: number;
    recipient?: string;
  };
}

export interface SendMessagePayload {
  groupId: number;
  channelId: number;
  content?: string;
  contentType?: BotContentType;
  card?: AppCard;
  embed?: EmbedMessage;
  components?: ActionRow[];
  metadata?: Record<string, unknown>;
  /**
   * Butler fan-out: "all_butlers" broadcasts to every group member's butler;
   * an array of principalIds targets specific members only.
   * Only triggered when contentType is "butler_action" or "payment_request"
   * and metadata.execution is set.
   */
  targets?: "all_butlers" | string[];
  /**
   * Controls who signs the execution.
   * Defaults to "butler_auto" (butler executes if policy passes; silently skips if not).
   */
  signingMode?: ExecutionSigningMode;
}

export interface UpdateMessagePayload {
  content?: string;
  contentType?: BotContentType;
  card?: AppCard;
  embed?: EmbedMessage;
  components?: ActionRow[];
  metadata?: Record<string, unknown>;
}

export interface SendDmPayload {
  conversationId: string;
  content: string;
}

export interface GroupMember {
  id: number;
  groupId: number;
  principalId: string;
  walletAddress?: string;
  roleIds: string[];
  joinedAt: string;
  displayName?: string;
  username?: string;
  avatar?: string | null;
  isOnline?: boolean;
}

export interface GroupMessage {
  id: number;
  groupId: number;
  channelId: number;
  content: string;
  contentType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DmMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

// ── Webhook response shapes ───────────────────────────────────────────────────

/** Synchronous text reply returned from the webhook handler. */
export interface SyncTextResponse {
  content: string;
  type?: 4;
}

/** Synchronous card reply returned from the webhook handler. */
export interface SyncCardResponse {
  card: AppCard;
  type?: 4;
}

/** Deferred ACK — Bevo keeps the thinking placeholder; agent will PATCH later. */
export interface DeferredAck {
  type: 5;
}

export type WebhookResponse = SyncTextResponse | SyncCardResponse | DeferredAck;

// ── Agent user lookup ─────────────────────────────────────────────────────────

export interface AgentUser {
  principalId: string;
  username: string | null;
  displayName: string | null;
  walletAddress: string | null;
}

// ── Permission scopes ─────────────────────────────────────────────────────────

export type BevoPermission =
  | "wallet.read"
  | "wallet.send"
  | "wallet.sign"
  | "user.read"
  | "contacts.read"
  | "groups.read"
  | "chat.write"
  | "bots.manage";

// ── App category ──────────────────────────────────────────────────────────────

export type AppCategory =
  | "defi"
  | "nfts"
  | "games"
  | "social"
  | "utilities"
  | "other";
