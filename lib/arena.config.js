"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tools_1 = __importDefault(require("@colyseus/tools"));
const monitor_1 = require("@colyseus/monitor");
const cors_1 = __importDefault(require("cors"));
/**
 * Import your Room files
 */
const ServerRoom_1 = require("./Server/ServerRoom");
exports.default = (0, tools_1.default)({
    getId: () => "Your Colyseus App",
    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        gameServer.define('ringtactoe-replace', ServerRoom_1.ServerRoom).filterBy(['playerNum', 'inviteOnly']).sortBy({ clients: -1 });
        gameServer.define('ringtactoe-flow', ServerRoom_1.ServerRoom).filterBy(['playerNum', 'inviteOnly']).sortBy({ clients: -1 });
        gameServer.define('ringtactoe-flow-2', ServerRoom_1.ServerRoom).filterBy(['playerNum', 'inviteOnly']).sortBy({ clients: -1 });
        console.log("BOOT:", new Date().toISOString());
    },
    initializeExpress: (app) => {
        const corsOptions = {
            origin: ["http://localhost:7456", "http://ringtactoe.com:7456", "http://ringtactoe.com"],
            credentials: true,
            methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
        };
        app.use((0, cors_1.default)(corsOptions));
        app.options("*", (0, cors_1.default)(corsOptions));
        /**
         * Bind your custom express routes here:
         */
        app.get("/", (req, res) => {
            res.send("initialize ring tac toe server!");
        });
        /**
         * Bind @colyseus/monitor
         * It is recommended to protect this route with a password.
         * Read more: https://docs.colyseus.io/tools/monitor/
         */
        app.use("/colyseus", (0, monitor_1.monitor)());
    },
    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});
