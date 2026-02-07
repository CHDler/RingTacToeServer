"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MyState = exports.PlayerState = void 0;
const schema_1 = require("@colyseus/schema");
// server/State.ts
class PlayerState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.playerID = 0;
    }
}
__decorate([
    schema_1.type("number")
], PlayerState.prototype, "playerID", void 0);
exports.PlayerState = PlayerState;
class MyState extends schema_1.Schema {
    constructor() {
        super(...arguments);
        this.players = new schema_1.MapSchema();
        this.tick = 0;
    }
}
__decorate([
    schema_1.type({ map: PlayerState })
], MyState.prototype, "players", void 0);
__decorate([
    schema_1.type("number")
], MyState.prototype, "tick", void 0);
exports.MyState = MyState;
