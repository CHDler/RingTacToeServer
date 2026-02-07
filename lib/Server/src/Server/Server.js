"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const ServerInfo_1 = require("../../../Schema/ServerInfo");
const colyseus_1 = require("colyseus");
class Server extends colyseus_1.Room {
    onCreate() {
        this.setState(new ServerInfo_1.MyState());
        console.log("start server lolol!");
        this.clock.setInterval(() => {
            this.state.tick++;
        }, 50);
    }
    onJoin(client) {
        this.state.players.set(client.sessionId, new ServerInfo_1.PlayerState());
    }
    onLeave(client) {
        this.state.players.delete(client.sessionId);
    }
}
exports.Server = Server;
