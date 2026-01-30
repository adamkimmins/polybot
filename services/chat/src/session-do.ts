import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export type Message = {
  role: "user" | "assistant";
  content: string;
};

export class SessionDO extends DurableObject<Env> {
  private messages: Message[] = [];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);

    state.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<Message[]>("messages");
      if (stored) this.messages = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/add") {
      const message = await request.json<Message>();
      await this.addMessage(message);
      return new Response("ok");
    }

    if (request.method === "GET" && url.pathname === "/messages") {
      return new Response(JSON.stringify(this.messages), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method === "POST" && url.pathname === "/clear") {
      await this.clear();
      return new Response("cleared");
    }

    return new Response("Not found", { status: 404 });
  }

  private async addMessage(message: Message) {
    this.messages.push(message);
    if (this.messages.length > 20) this.messages.shift();
    await this.ctx.storage.put("messages", this.messages);
  }

  private async clear() {
    this.messages = [];
    await this.ctx.storage.delete("messages");
  }
}