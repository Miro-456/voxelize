import { BlockUpdate, Coords2, ServerMesh } from "../types";

import { Chunk } from "./chunk";

type ServerChunk = {
  x: number;
  z: number;
  id: string;
  lights: Uint32Array;
  voxels: Uint32Array;
  meshes: ServerMesh[];
};

class Chunks extends Map<string, Chunk> {
  public requested = new Set<string>();
  public toRequest: string[] = [];
  public toProcess: ServerChunk[] = [];
  public toUpdate: BlockUpdate[] = [];
  public toAdd: string[] = [];

  public currentChunk: Coords2;
}

export type { ServerChunk };

export { Chunks };