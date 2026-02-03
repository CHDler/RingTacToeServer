import {Schema, type, MapSchema, ArraySchema} from "@colyseus/schema";

export class ServerBoardKey {
    playerId = 0;     // 0/1/2
    isEmpty = true;

    constructor(init?: Partial<ServerBoardKey>) {
        Object.assign(this, init);
    }
}

export class PlayerState extends Schema {
    @type("int8") playerId = 0;
    @type("string") playerName = "";
    @type("int8") playerOrder = -1;
}

export class RoomState extends Schema {
    @type({ map: PlayerState }) playerStates = new MapSchema<PlayerState>();
    @type("int32") tick = 0;

}


