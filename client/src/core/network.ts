import { protocol } from "@voxelize/transport/src/protocol";
import DOMUrl from "domurl";
import * as fflate from "fflate";
import DecodeWorker from "web-worker:./workers/decode-worker";

import { Client } from "..";
import { WorkerPool } from "../libs/worker-pool";
import { ChunkUtils } from "../utils";

const { Message } = protocol;

/**
 * A custom WebSocket type that supports protocol buffer sending.
 */
type ProtocolWS = WebSocket & {
  /**
   * Send a protocol buffer encoded message to the server.
   */
  sendEvent: (event: any) => void;
};

/**
 * Parameters to initializing a Voxelize {@link Network} connection to the server.
 */
type NetworkParams = {
  /**
   * The HTTP url to the backend. Example: `http://localhost:4000`
   */
  serverURL: string;

  /**
   * On disconnection, the timeout to attempt to reconnect. Defaults to 5000.
   */
  reconnectTimeout: number;

  /**
   * The secret to joining a server.
   */
  secret?: string;
};

/**
 * A **built-in** network connector to the Voxelize backend. Establishes a WebSocket connection to the backend
 * server and handles the Protocol Buffer encoding and decoding.
 *
 * @category Core
 */
class Network {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Network instance.
   */
  public params: NetworkParams;

  /**
   * The WebSocket client for Voxelize.
   */
  public ws: ProtocolWS;

  /**
   * A {@link https://github.com/Mikhus/domurl | domurl Url instance} constructed with `network.params.serverURL`,
   * representing a HTTP connection URL to the server.
   */
  public url: DOMUrl<{
    [key: string]: any;
  }>;

  /**
   * The name of the world that the client is connected to.
   */
  public world: string;

  /**
   * A native URL instance constructed with `network.params.serverURL`,
   * representing a WebSocket connection URL to the server.
   */
  public socket: URL;

  /**
   * Whether or not the network connection is established.
   */
  public connected = false;

  private pool: WorkerPool = new WorkerPool(DecodeWorker, {
    maxWorker: (window.navigator.hardwareConcurrency || 4) * 2,
  });

  private reconnection: any;

  /**
   * Construct a built in Voxelize Network instance.
   *
   * @hidden
   */
  constructor(client: Client, params: NetworkParams) {
    this.client = client;
    this.params = params;

    this.url = new DOMUrl(this.params.serverURL);
    this.url.protocol = this.url.protocol.replace(/ws/, "http");
    this.url.hash = "";

    const socketURL = new DOMUrl(this.params.serverURL);
    socketURL.path = "/ws/";

    this.socket = new URL(socketURL.toString());
    this.socket.protocol = this.socket.protocol.replace(/http/, "ws");
    this.socket.hash = "";
    this.socket.searchParams.set("secret", this.params.secret || "");
    this.socket.searchParams.set("client_id", this.client.id || "");
  }

  /**
   * Used internally in `client.connect` to connect to the Voxelize backend.
   *
   * @hidden
   */
  connect = async () => {
    // if websocket connection already exists, disconnect it
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();

      if (this.reconnection) {
        clearTimeout(this.reconnection);
      }
    }

    return new Promise<void>((resolve) => {
      // initialize a websocket connection to socket
      const ws = new WebSocket(this.socket.toString()) as ProtocolWS;
      ws.binaryType = "arraybuffer";
      // custom Protobuf event sending
      ws.sendEvent = (event: any) => {
        ws.send(Network.encodeSync(event));
      };
      ws.onopen = () => {
        this.connected = true;
        this.client.emit("connected");

        clearTimeout(this.reconnection);

        resolve();
      };
      ws.onerror = console.error;
      ws.onmessage = ({ data }) => {
        this.decode(new Uint8Array(data)).then((data) => {
          this.onEvent(data);
          this.client.emit("network-event", data);
        });
      };
      ws.onclose = () => {
        this.connected = false;
        this.client.emit("disconnected");
        this.client.peers.reset();

        // fire reconnection every "reconnectTimeout" ms
        if (this.params.reconnectTimeout) {
          this.reconnection = setTimeout(() => {
            this.connect();
          }, this.params.reconnectTimeout);
        }
      };

      this.ws = ws;
    });
  };

  /**
   * Used internally to disconnect from the Voxelize backend.
   *
   * @hidden
   */
  disconnect = () => {
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.close();

    this.client.emit("disconnected");

    if (this.reconnection) {
      clearTimeout(this.reconnection);
    }
  };

  /**
   * Encode and send a protocol buffer message to the server.
   *
   * @param event - An object that obeys the protocol buffers.
   */
  send = (event: any) => {
    this.ws.sendEvent(event);
  };

  /**
   * Decode a byte array into protocol buffer objects.
   *
   * @param data - Data to offload to the worker pool to decode.
   */
  decode = async (data: Uint8Array) => {
    return new Promise<any>((resolve) => {
      this.pool.addJob({
        message: data,
        buffers: [data.buffer],
        resolve,
      });
    });
  };

  /**
   * The number of active workers decoding network packets.
   */
  get concurrentWorkers() {
    return this.pool.workingCount;
  }

  private onEvent = (event: any) => {
    const { type, entities } = event;

    if (entities && entities.length) {
      entities.forEach((entity: any) => {
        this.client.entities.onEvent(entity);
      });
    }

    switch (type) {
      case "INIT": {
        const {
          peers,
          json: { blocks, ranges, id, params },
        } = event;

        if (id) {
          if (this.client.id && this.client.id !== id) {
            throw new Error(
              "Something went wrong with IDs! Better check if you're passing two same ID's to the same Voxelize server."
            );
          }

          this.client.id = id;
        }

        if (params) {
          this.client.world.setParams(params);
        }

        if (peers) {
          peers.forEach((peer: any) => {
            if (peer.id === this.client.id) return;
            this.client.peers.addPeer(peer.id);
          });
        }

        this.client.loader.load().then(() => {
          if (blocks && ranges) {
            this.client.registry.load(blocks, ranges);
          }

          this.client.emit("ready");
          this.client.ready = true;
        });

        break;
      }
      case "JOIN": {
        const { text: id } = event;
        if (!this.client.id || this.client.id === id) return;
        this.client.peers.addPeer(id);

        break;
      }
      case "LEAVE": {
        const { text: id } = event;
        this.client.peers.removePeer(id);

        break;
      }
      case "PEER": {
        const { peers } = event;

        peers.forEach((peer: any) => {
          if (peer.id === this.client.id) return;
          this.client.peers.updatePeer(peer);
        });

        break;
      }
      case "LOAD": {
        const { chunks } = event;

        if (chunks) {
          chunks.forEach((chunk) => {
            this.client.world.handleServerChunk(chunk);
          });
        }

        break;
      }
      case "CHAT": {
        const { chat } = event;

        if (chat) {
          this.client.chat.add(chat);
        }

        break;
      }
      case "UPDATE": {
        const { updates, chunks } = event;

        if (updates) {
          const particleUpdates = updates
            .filter(({ voxel }) => {
              return voxel === 0;
            })
            .map(({ vx, vy, vz }) => {
              const name = ChunkUtils.getVoxelName([vx, vy, vz]);
              let original = this.client.world.blockCache.get(name);

              if (original === undefined)
                original = this.client.world.getVoxelByVoxel(vx, vy, vz);

              const result = {
                voxel: [vx, vy, vz],
                type: original,
              };

              this.client.world.blockCache.delete(name);

              return result;
            });

          updates.forEach((update) => {
            const { vx, vy, vz, voxel, light } = update;
            const chunk = this.client.world.getChunkByVoxel(vx, vy, vz);

            if (chunk) {
              chunk.setRawValue(vx, vy, vz, voxel || 0);
              chunk.setRawLight(vx, vy, vz, light || 0);
            }
          });

          this.client.particles.addBreakParticles(particleUpdates, {
            count: particleUpdates.length > 3 ? 10 : 24,
          });
        }

        if (chunks) {
          chunks.forEach((chunk) => {
            this.client.world.handleServerChunk(chunk, true);
          });
        }

        break;
      }
    }
  };

  static decodeSync = (buffer: any) => {
    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      buffer = fflate.unzlibSync(buffer);
    }

    const message = Message.decode(buffer);
    // @ts-ignore
    message.type = Message.Type[message.type];
    if (message.json) {
      message.json = JSON.parse(message.json);
    }
    return message;
  };

  static encodeSync(message: any) {
    if (message.json) {
      message.json = JSON.stringify(message.json);
    }
    message.type = Message.Type[message.type];
    if (message.entities) {
      message.entities.forEach(
        (entity) => (entity.metadata = JSON.stringify(entity.metadata))
      );
    }
    return protocol.Message.encode(protocol.Message.create(message)).finish();
  }
}

export type { NetworkParams, ProtocolWS };

export { Network };