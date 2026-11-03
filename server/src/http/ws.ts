import type { WebSocket } from "ws";
import type { LiveEvent } from "@ai-reply-for-whatsapp/shared";

export class LiveFeed {
  private sockets = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }

  broadcast(event: LiveEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}
