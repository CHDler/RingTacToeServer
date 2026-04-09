"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomState = exports.PlayerState = exports.ServerBoardKey = void 0;
const schema_1 = require("@colyseus/schema");
class ServerBoardKey {
    constructor(init) {
        this.playerId = 0; // 0/1/2
        this.isEmpty = true;
        Object.assign(this, init);
    }
}
exports.ServerBoardKey = ServerBoardKey;
class PlayerState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.playerId = 0;
        this.playerName = "";
        this.playerOrder = -1;
        this.chosenMark = 0;
        this.useWXName = false;
    }
}
exports.PlayerState = PlayerState;
__decorate([
    (0, schema_1.type)("int8")
], PlayerState.prototype, "playerId", void 0);
__decorate([
    (0, schema_1.type)("string")
], PlayerState.prototype, "playerName", void 0);
__decorate([
    (0, schema_1.type)("int8")
], PlayerState.prototype, "playerOrder", void 0);
__decorate([
    (0, schema_1.type)("int16")
], PlayerState.prototype, "chosenMark", void 0);
__decorate([
    (0, schema_1.type)("boolean")
], PlayerState.prototype, "useWXName", void 0);
class RoomState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.playerStates = new schema_1.MapSchema();
        this.tick = 0;
    }
}
exports.RoomState = RoomState;
__decorate([
    (0, schema_1.type)({ map: PlayerState })
], RoomState.prototype, "playerStates", void 0);
__decorate([
    (0, schema_1.type)("int32")
], RoomState.prototype, "tick", void 0);
