import type {
  BotCommand,
  SendMessagePayload,
  UpdateMessagePayload,
  GroupMember,
  GroupMessage,
  DmMessage,
} from "./types.js";

export interface BevoAgentClientOptions {
  apiKey: string;
  apiBase: string;
}

/**
 * HTTP client for the Bevo agent API (`/api/agent/*`).
 * Authenticates with the agent API key via `Authorization: Bearer`.
 */
export class BevoAgentClient {
  private readonly apiKey: string;
  private readonly apiBase: string;

  constructor({ apiKey, apiBase }: BevoAgentClientOptions) {
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.apiBase}/api/agent${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Bevo API ${method} ${path} → ${res.status}: ${text}`);
    }

    const text = await res.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  /** Send a message to a group channel. */
  sendMessage(payload: SendMessagePayload): Promise<{ message: GroupMessage }> {
    return this.request("POST", "/send", payload);
  }

  /**
   * Update a placeholder message (deferred response pattern).
   * Pass the `placeholderMessageId` from the command payload.
   */
  updateMessage(
    messageId: number,
    payload: UpdateMessagePayload
  ): Promise<{ message: GroupMessage }> {
    return this.request("PATCH", `/messages/${messageId}`, payload);
  }

  /** Send a direct message to a conversation. */
  sendDm(
    conversationId: string,
    content: string
  ): Promise<{ message: DmMessage }> {
    return this.request("POST", "/dm-send", { conversationId, content });
  }

  /**
   * Register (or replace) slash commands for this agent.
   * Passing an empty array clears all commands.
   */
  registerCommands(commands: BotCommand[]): Promise<{ ok: true; registered: number }> {
    return this.request("PUT", "/commands", { commands });
  }

  /** List members of a group. */
  async getGroupMembers(groupId: number): Promise<GroupMember[]> {
    const res = await this.request<{ members: GroupMember[] }>(
      "GET",
      `/groups/${groupId}/members`
    );
    return res.members;
  }

  /** Read a per-app-group persistent KV value. */
  async getGroupState(groupId: number, key: string): Promise<unknown> {
    const res = await this.request<{ key: string; value: unknown }>(
      "GET",
      `/groups/${groupId}/state/${encodeURIComponent(key)}`
    );
    return res.value;
  }

  /** Write a per-app-group persistent KV value. */
  setGroupState(groupId: number, key: string, value: unknown): Promise<{ success: true }> {
    return this.request("PUT", `/groups/${groupId}/state/${encodeURIComponent(key)}`, {
      value,
    });
  }
}
