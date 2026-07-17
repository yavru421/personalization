// Backend/src/index.ts

import { DurableObjectState, WebSocket } from "@cloudflare/workers-types";

export class CrewMapRoom {
  private clients: Map<WebSocket, string | null> = new Map();
  private crewState: Map<string, { lat: number, lng: number, name: string, status?: string, destination?: { lat: number, lng: number } }> = new Map();

  constructor(private state: DurableObjectState, env: any) {
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<string>("crewState");
      if (stored) {
        this.crewState = new Map(JSON.parse(stored));
      }
    });
  }

  async fetch(request: Request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }
    // Type casting because WebSocketPair isn't globally typed well in standard DOM types
    const pair = new (globalThis as any).WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.handleWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private handleWebSocket(ws: WebSocket) {
    this.clients.set(ws, null);
    ws.accept();

    // Send initial sync state immediately
    ws.send(JSON.stringify({ type: "sync", state: Array.from(this.crewState.entries()) }));

    ws.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "update") {
          const { userId, lat, lng, name, status, destination } = data;
          this.clients.set(ws, userId);
          this.crewState.set(userId, { lat, lng, name, status, destination });
          this.state.storage.put("crewState", JSON.stringify(Array.from(this.crewState.entries())));
          
          // Broadcast update to other clients
          const msg = JSON.stringify(data);
          for (const [socket, _] of this.clients.entries()) {
            if (socket !== ws) socket.send(msg);
          }
        } else if (data.type === "chat") {
          const msg = JSON.stringify(data);
          for (const [socket, _] of this.clients.entries()) {
            if (socket !== ws) socket.send(msg);
          }
        }
      } catch (e) {
        // ignore
      }
    });

    ws.addEventListener("close", () => {
      const userId = this.clients.get(ws);
      this.clients.delete(ws);
      if (userId) {
        this.crewState.delete(userId);
        this.state.storage.put("crewState", JSON.stringify(Array.from(this.crewState.entries())));
        const msg = JSON.stringify({ type: "disconnect", userId });
        for (const [socket, _] of this.clients.entries()) {
          socket.send(msg);
        }
      }
    });
  }
}

export default {
  async fetch(request: Request, env: any) {
    const durableObjectId = env.CREW_MAP_ROOM.idFromName("main-crew");
    const obj = env.CREW_MAP_ROOM.get(durableObjectId);
    return obj.fetch(request);
  },
};
