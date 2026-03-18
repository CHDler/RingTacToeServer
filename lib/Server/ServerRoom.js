"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerRoom = exports.Board = void 0;
const ServerInfo_1 = require("./Schema/ServerInfo");
const colyseus_1 = require("colyseus");
class Board {
    constructor(init) {
        Object.assign(this, init);
    }
    static create(keyCount, color = "") {
        const b = new Board();
        b.color = color;
        b.keys = Array.from({ length: keyCount }, () => new ServerInfo_1.ServerBoardKey());
        return b;
    }
}
exports.Board = Board;
/** 只注册一次全局异常捕获，防止漏掉 async 异常导致“服务器什么都没打印” */
function installGlobalCrashHooksOnce() {
    const g = globalThis;
    if (g.__SERVERROOM_CRASH_HOOKS_INSTALLED__)
        return;
    g.__SERVERROOM_CRASH_HOOKS_INSTALLED__ = true;
    process.on("unhandledRejection", (reason) => {
        console.error(`[GLOBAL][unhandledRejection]`, reason instanceof Error ? reason.stack : reason);
    });
    process.on("uncaughtException", (err) => {
        var _a;
        console.error(`[GLOBAL][uncaughtException]`, (_a = err === null || err === void 0 ? void 0 : err.stack) !== null && _a !== void 0 ? _a : err);
    });
}
class ServerRoom extends colyseus_1.Room {
    constructor() {
        super(...arguments);
        this.seatReservationTimeout = 60;
        this.leftRoomPlayers = [];
        this.playernum = 0;
        this.turnPlayer = 0;
        this.playerToStart = 3;
        this.hasStarted = false;
        this.createdAt = 0;
        this.inviteOnly = false;
        this.BOARD_COUNT = 3;
        this.KEY_COUNT = 6;
        this.serverBoards = [];
        this.colors = ["Blue", "Red", "Green"];
        this.isFlowMode = false;
        this.currentMove = null;
    }
    // ============ logging helpers ============
    now() {
        return new Date().toISOString();
    }
    ctx(client) {
        var _a, _b;
        return {
            t: this.now(),
            roomId: this.roomId,
            roomName: this.roomName,
            clients: (_b = (_a = this.clients) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
            sessionId: client === null || client === void 0 ? void 0 : client.sessionId,
        };
    }
    errorId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    logInfo(msg, extra) {
        console.log(`[INFO] ${msg}`, Object.assign(Object.assign({}, this.ctx()), extra));
    }
    logWarn(msg, extra) {
        console.warn(`[WARN] ${msg}`, Object.assign(Object.assign({}, this.ctx()), extra));
    }
    logError(where, err, extra) {
        var _a;
        const id = this.errorId();
        console.error(`[ERROR] ${where}  errorId=${id}`, Object.assign(Object.assign(Object.assign({}, this.ctx(extra === null || extra === void 0 ? void 0 : extra.client)), extra), { errorId: id, message: (_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err), stack: err === null || err === void 0 ? void 0 : err.stack }));
        return id;
    }
    reject(client, reason, extra) {
        this.logWarn(`moveRejected: ${reason}`, Object.assign({ client }, extra));
        try {
            client.send("moveRejected", { reason });
        }
        catch (e) {
            this.logError("client.send(moveRejected)", e, { client, reason });
        }
    }
    updateRoomMetadata() {
        const metadata = {
            playerNum: this.playerToStart,
            hasStarted: this.hasStarted,
            createdAt: this.createdAt,
            inviteOnly: this.inviteOnly,
        };
        void this.setMetadata(metadata).catch((err) => {
            this.logError("setMetadata", err, { metadata });
        });
    }
    lockStartedRoom() {
        if (this.locked)
            return;
        void this.lock().catch((err) => {
            this.logError("lock", err);
        });
    }
    /** 包一层，防止 onMessage handler throw 导致房间/进程异常，并且保证日志里有 stack */
    safeMessageHandler(messageType, fn) {
        return (client, data) => {
            try {
                return fn.call(this, client, data);
            }
            catch (err) {
                const eid = this.logError(`onMessage(${messageType})`, err, { client, data });
                // 给客户端一个可对照的 errorId（方便你把客户端报错和服务端日志对上）
                try {
                    client.send("serverError", {
                        where: `onMessage(${messageType})`,
                        errorId: eid,
                    });
                }
                catch (_a) { }
            }
        };
    }
    // ============ lifecycle ============
    onCreate(options) {
        var _a;
        this.seatReservationTimeout = 60;
        this.playerToStart = (_a = options === null || options === void 0 ? void 0 : options.playerNum) !== null && _a !== void 0 ? _a : 3;
        this.createdAt = Date.now();
        this.inviteOnly = Boolean(options === null || options === void 0 ? void 0 : options.inviteOnly);
        console.log("this room is " + this.playerToStart + " players room");
        installGlobalCrashHooksOnce();
        try {
            this.maxClients = this.playerToStart;
            void this.setPrivate(this.inviteOnly).catch((err) => {
                this.logError("setPrivate", err, { inviteOnly: this.inviteOnly });
            });
            // 建议用 setState，避免一些内部 patch/初始化边界问题
            this.state = new ServerInfo_1.RoomState();
            this.logInfo("Room created", { options });
            this.clock.setInterval(() => {
                try {
                    this.state.tick++;
                }
                catch (e) {
                    this.logError("tickInterval", e);
                }
            }, 10);
            this.onMessage("confirmMove", this.safeMessageHandler("confirmMove", (client, data) => this.onMove(client, data)));
            this.serverBoards = Array.from({ length: this.BOARD_COUNT }, (_, i) => { var _a; return Board.create(this.KEY_COUNT, (_a = this.colors[i]) !== null && _a !== void 0 ? _a : ""); });
            this.isFlowMode = (this.roomName === "ringtactoe-flow") || (this.roomName === "ringtactoe-flow-2");
            this.currentMove = {
                boardIndex: -1,
                boardKeyIndex: -1,
                rotateStep: 0,
                rotateDirection: 0,
                rotateBoardIndex: -1,
            };
            this.updateRoomMetadata();
            this.logInfo("Room mode", { isFlowMode: this.isFlowMode, inviteOnly: this.inviteOnly });
        }
        catch (err) {
            this.logError("onCreate", err, { options });
            throw err; // 创建失败必须抛出，让 matchmaker 知道
        }
    }
    // 可选：你如果有鉴权/版本号校验，这里最好做，并且保证失败也能看到日志
    onAuth(client, options, request) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // 这里默认放行，只记录关键字段（别把整个 request 打出来，太大）
                this.logInfo("onAuth", {
                    client,
                    options: {
                        name: options === null || options === void 0 ? void 0 : options.name,
                        useWXInfo: options === null || options === void 0 ? void 0 : options.useWXInfo,
                        playerNum: options === null || options === void 0 ? void 0 : options.playerNum,
                        inviteOnly: options === null || options === void 0 ? void 0 : options.inviteOnly,
                    },
                    ip: (_d = (_b = (_a = request === null || request === void 0 ? void 0 : request.headers) === null || _a === void 0 ? void 0 : _a["x-forwarded-for"]) !== null && _b !== void 0 ? _b : (_c = request === null || request === void 0 ? void 0 : request.connection) === null || _c === void 0 ? void 0 : _c.remoteAddress) !== null && _d !== void 0 ? _d : undefined,
                });
                return true;
            }
            catch (err) {
                this.logError("onAuth", err, { client, options });
                return false;
            }
        });
    }
    onJoin(client, options) {
        var _a;
        console.log("onJoin111111111111111");
        try {
            if (this.hasStarted) {
                throw new Error("room already started");
            }
            this.logInfo("Client join", { client, options });
            this.state.playerStates.set(client.sessionId, new ServerInfo_1.PlayerState());
            const s = this.state.playerStates.get(client.sessionId);
            if (!s) {
                throw new Error("playerStates.set succeeded but get returned undefined");
            }
            s.playerId = this.playernum;
            this.playernum++;
            const rawName = (_a = options === null || options === void 0 ? void 0 : options.name) !== null && _a !== void 0 ? _a : "";
            const useWXInfo = Boolean(options === null || options === void 0 ? void 0 : options.useWXInfo);
            const name = rawName.toString().slice(0, 24);
            s.playerName = name; // ✅ 修复：之前写 rawName，截断没生效
            s.useWXName = useWXInfo;
            if (this.checkForStart()) {
                this.logInfo("Start game (enough players)");
                this.assignRandomOrderAndStart();
            }
            else {
                this.updateRoomMetadata();
            }
        }
        catch (err) {
            this.logError("onJoin", err, { client, options });
            // 抛出会让该玩家 join 失败（比半初始化状态更安全）
            throw err;
        }
    }
    onLeave(client, consented) {
        var _a;
        try {
            const playerState = this.state.playerStates.get(client.sessionId);
            const playerID = (_a = playerState === null || playerState === void 0 ? void 0 : playerState.playerId) !== null && _a !== void 0 ? _a : -1;
            this.logWarn("Client leave", { client, consented, playerID });
            if (playerID !== -1 && !this.leftRoomPlayers.includes(playerID)) {
                this.leftRoomPlayers.push(playerID);
            }
            this.state.playerStates.delete(client.sessionId);
            this.playernum = Math.max(0, this.playernum - 1);
            this.updateRoomMetadata();
        }
        catch (err) {
            this.logError("onLeave", err, { client, consented });
        }
    }
    onDispose() {
        try {
            this.logInfo("Room disposed");
        }
        catch (err) {
            this.logError("onDispose", err);
        }
    }
    // ============ game logic ============
    onMove(client, data) {
        // 这里不要 throw，尽量 reject + 打日志
        try {
            if (!data) {
                this.reject(client, "empty data");
                return;
            }
            const ps = this.state.playerStates.get(client.sessionId);
            if (!ps) {
                this.reject(client, "playerState missing");
                return;
            }
            if (ps.playerOrder !== this.turnPlayer) {
                this.reject(client, `player order wrong: ${ps.playerOrder} should be ${this.turnPlayer}`, {
                    turnPlayer: this.turnPlayer,
                    playerOrder: ps.playerOrder,
                });
                return;
            }
            this.currentMove = data;
            const boardIndex = this.currentMove.boardIndex;
            const boardKeyIndex = this.currentMove.boardKeyIndex;
            const rotateStep = this.currentMove.rotateStep;
            const rotateDirection = this.currentMove.rotateDirection;
            const rotateBoardIndex = this.currentMove.rotateBoardIndex;
            // ---- validation (更严格，避免数组越界导致 silent crash) ----
            if (boardIndex < 0 ||
                boardIndex >= this.serverBoards.length ||
                boardKeyIndex < 0) {
                this.reject(client, `invalid boardIndex/boardKeyIndex: b=${boardIndex}, k=${boardKeyIndex}`);
                return;
            }
            const board = this.serverBoards[boardIndex];
            const keyLength = board.keys.length;
            if (boardKeyIndex < 0 || boardKeyIndex >= keyLength) {
                this.reject(client, `invalid boardKeyIndex: ${boardKeyIndex}, keyLength=${keyLength}`);
                return;
            }
            const key = board.keys[boardKeyIndex];
            if (!key.isEmpty) {
                this.reject(client, `key already filled by player ${key.playerId}`);
                return;
            }
            const player = this.state.playerStates.get(client.sessionId);
            if (!player) {
                this.reject(client, "player missing (state mismatch)");
                return;
            }
            // ---- place ----
            key.isEmpty = false;
            key.playerId = player.playerId;
            const blueBoard = this.serverBoards[0];
            const redBoard = this.serverBoards[1];
            const greenBoard = this.serverBoards[2];
            // ---- flow overlap sync (落子后) ----
            if (this.isFlowMode) {
                try {
                    switch (boardIndex) {
                        case 0:
                            switch (boardKeyIndex) {
                                case 4:
                                    greenBoard.keys[0].isEmpty = blueBoard.keys[4].isEmpty;
                                    greenBoard.keys[0].playerId = blueBoard.keys[4].playerId;
                                    redBoard.keys[2].isEmpty = blueBoard.keys[4].isEmpty;
                                    redBoard.keys[2].playerId = blueBoard.keys[4].playerId;
                                    break;
                                case 3:
                                    greenBoard.keys[1].isEmpty = blueBoard.keys[3].isEmpty;
                                    greenBoard.keys[1].playerId = blueBoard.keys[3].playerId;
                                    break;
                                case 5:
                                    redBoard.keys[1].isEmpty = blueBoard.keys[5].isEmpty;
                                    redBoard.keys[1].playerId = blueBoard.keys[5].playerId;
                                    break;
                            }
                            break;
                        case 1:
                            switch (boardKeyIndex) {
                                case 3:
                                    greenBoard.keys[5].isEmpty = redBoard.keys[3].isEmpty;
                                    greenBoard.keys[5].playerId = redBoard.keys[3].playerId;
                                    break;
                                case 1:
                                    blueBoard.keys[5].isEmpty = redBoard.keys[1].isEmpty;
                                    blueBoard.keys[5].playerId = redBoard.keys[1].playerId;
                                    break;
                                case 2:
                                    greenBoard.keys[0].isEmpty = redBoard.keys[2].isEmpty;
                                    greenBoard.keys[0].playerId = redBoard.keys[2].playerId;
                                    blueBoard.keys[4].isEmpty = redBoard.keys[2].isEmpty;
                                    blueBoard.keys[4].playerId = redBoard.keys[2].playerId;
                                    break;
                            }
                            break;
                        case 2:
                            switch (boardKeyIndex) {
                                case 5:
                                    redBoard.keys[3].isEmpty = greenBoard.keys[5].isEmpty;
                                    redBoard.keys[3].playerId = greenBoard.keys[5].playerId;
                                    break;
                                case 1:
                                    blueBoard.keys[3].isEmpty = greenBoard.keys[1].isEmpty;
                                    blueBoard.keys[3].playerId = greenBoard.keys[1].playerId;
                                    break;
                                case 0:
                                    redBoard.keys[2].isEmpty = greenBoard.keys[0].isEmpty;
                                    redBoard.keys[2].playerId = greenBoard.keys[0].playerId;
                                    blueBoard.keys[4].isEmpty = greenBoard.keys[0].isEmpty;
                                    blueBoard.keys[4].playerId = greenBoard.keys[0].playerId;
                                    break;
                            }
                            break;
                    }
                }
                catch (e) {
                    this.logError("flowSyncAfterPlace", e, { client, boardIndex, boardKeyIndex });
                    // 不直接 return，避免玩家卡死；但日志一定要有
                }
            }
            this.logInfo("Placed", { client, boardIndex, boardKeyIndex, playerId: key.playerId });
            // ---- rotation ----
            {
                const mod = (a, n) => ((a % n) + n) % n;
                // rotateBoardIndex 允许 -1（不旋转），但不允许其它负数
                if (rotateBoardIndex < -1 || rotateBoardIndex >= this.serverBoards.length) {
                    this.reject(client, `invalid rotateBoardIndex: ${rotateBoardIndex}`);
                    return;
                }
                if (rotateBoardIndex !== -1) {
                    const rBoard = this.serverBoards[rotateBoardIndex];
                    const keys = rBoard.keys;
                    const n = keys.length;
                    if (n === 0) {
                        this.logError("rotation", new Error("rotate board has no keys"), {
                            client,
                            rotateBoardIndex,
                        });
                        this.reject(client, `rotate board ${rotateBoardIndex} has no keys`);
                        return;
                    }
                    const step = Number(rotateStep) || 0;
                    const dir = Number(rotateDirection) || 0; // 你约定 +1/-1，0 也能接受（等同不转）
                    const shift = mod(step * dir, n);
                    this.logInfo("Rotation", { client, rotateBoardIndex, step, dir, shift });
                    const old = keys.map((k) => ({ isEmpty: k.isEmpty, playerId: k.playerId }));
                    for (let i = 0; i < n; i++) {
                        const src = mod(i - shift, n);
                        keys[i].isEmpty = old[src].isEmpty;
                        keys[i].playerId = old[src].playerId;
                    }
                    // ---- flow overlap sync (旋转后) ----
                    if (this.isFlowMode) {
                        try {
                            switch (rotateBoardIndex) {
                                case 0:
                                    greenBoard.keys[0].isEmpty = blueBoard.keys[4].isEmpty;
                                    greenBoard.keys[0].playerId = blueBoard.keys[4].playerId;
                                    redBoard.keys[2].isEmpty = blueBoard.keys[4].isEmpty;
                                    redBoard.keys[2].playerId = blueBoard.keys[4].playerId;
                                    greenBoard.keys[1].isEmpty = blueBoard.keys[3].isEmpty;
                                    greenBoard.keys[1].playerId = blueBoard.keys[3].playerId;
                                    redBoard.keys[1].isEmpty = blueBoard.keys[5].isEmpty;
                                    redBoard.keys[1].playerId = blueBoard.keys[5].playerId;
                                    break;
                                case 1:
                                    greenBoard.keys[5].isEmpty = redBoard.keys[3].isEmpty;
                                    greenBoard.keys[5].playerId = redBoard.keys[3].playerId;
                                    blueBoard.keys[5].isEmpty = redBoard.keys[1].isEmpty;
                                    blueBoard.keys[5].playerId = redBoard.keys[1].playerId;
                                    greenBoard.keys[0].isEmpty = redBoard.keys[2].isEmpty;
                                    greenBoard.keys[0].playerId = redBoard.keys[2].playerId;
                                    blueBoard.keys[4].isEmpty = redBoard.keys[2].isEmpty;
                                    blueBoard.keys[4].playerId = redBoard.keys[2].playerId;
                                    break;
                                case 2:
                                    redBoard.keys[3].isEmpty = greenBoard.keys[5].isEmpty;
                                    redBoard.keys[3].playerId = greenBoard.keys[5].playerId;
                                    blueBoard.keys[3].isEmpty = greenBoard.keys[1].isEmpty;
                                    blueBoard.keys[3].playerId = greenBoard.keys[1].playerId;
                                    redBoard.keys[2].isEmpty = greenBoard.keys[0].isEmpty;
                                    redBoard.keys[2].playerId = greenBoard.keys[0].playerId;
                                    blueBoard.keys[4].isEmpty = greenBoard.keys[0].isEmpty;
                                    blueBoard.keys[4].playerId = greenBoard.keys[0].playerId;
                                    break;
                            }
                        }
                        catch (e) {
                            this.logError("flowSyncAfterRotate", e, { client, rotateBoardIndex });
                        }
                    }
                }
            }
            // ---- next turn ----
            this.turnPlayer = (this.turnPlayer + 1) % this.playerToStart;
            if (this.leftRoomPlayers.includes(this.turnPlayer)) {
                // TODO: AI move
                this.logInfo("Next turn belongs to left player (AI placeholder)", {
                    turnPlayer: this.turnPlayer,
                    leftRoomPlayers: this.leftRoomPlayers.slice(),
                });
            }
            const endGamePayload = this.checkForEnd();
            // ---- broadcast ----
            try {
                this.broadcast("moveAccepted", {
                    boards: this.serverBoards,
                    turnPlayer: this.turnPlayer,
                    moveMsg: this.currentMove,
                });
            }
            catch (e) {
                this.logError("broadcast(moveAccepted)", e, { client });
            }
            if (endGamePayload) {
                try {
                    this.broadcast("endGame", endGamePayload);
                }
                catch (e) {
                    this.logError("broadcast(endGame)", e, { client, endGamePayload });
                }
            }
        }
        catch (err) {
            // 最外层兜底：onMove 不允许异常漏出去
            const eid = this.logError("onMove", err, { client, data });
            try {
                client.send("serverError", { where: "onMove", errorId: eid });
            }
            catch (_a) { }
        }
    }
    assignRandomOrderAndStart() {
        const ids = this.clients.map((c) => c.sessionId);
        this.shuffleInPlace(ids);
        for (let i = 0; i < ids.length; i++) {
            const s = this.state.playerStates.get(ids[i]);
            if (s) {
                s.playerOrder = i;
                s.playerId = i;
                if (!s.useWXName) {
                    s.playerName = "玩家" + i.toString();
                }
            }
        }
        this.turnPlayer = 0;
        this.hasStarted = true;
        this.updateRoomMetadata();
        this.lockStartedRoom();
        this.notifyClientsToStart();
    }
    notifyClientsToStart() {
        var _a, _b;
        for (const client of this.clients) {
            const s = this.state.playerStates.get(client.sessionId);
            try {
                client.send("start_game", {
                    order: (_a = s === null || s === void 0 ? void 0 : s.playerOrder) !== null && _a !== void 0 ? _a : -1,
                    playerId: (_b = s === null || s === void 0 ? void 0 : s.playerId) !== null && _b !== void 0 ? _b : -1,
                    turnPlayer: this.turnPlayer,
                    players: this.clients.length,
                    name: s === null || s === void 0 ? void 0 : s.playerName,
                });
            }
            catch (e) {
                this.logError("client.send(start_game)", e, { client });
            }
        }
    }
    shuffleInPlace(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }
    checkForStart() {
        this.logInfo("checkForStart", { playernum: this.playernum, hasStarted: this.hasStarted });
        return !this.hasStarted && this.playernum === this.playerToStart;
    }
    checkForEnd() {
        try {
            let allFilled = true;
            const winners = [];
            let winner = -1;
            let hasWon = false;
            for (let i = 0; i < this.serverBoards.length; i++) {
                const keys = this.serverBoards[i].keys;
                for (let j = 0; j < keys.length; j++) {
                    const indexOne = j;
                    const indexTwo = (j + 1) % keys.length;
                    const indexThree = (j + 2) % keys.length;
                    const keyOne = keys[indexOne];
                    const keyTwo = keys[indexTwo];
                    const keyThree = keys[indexThree];
                    if (!keyOne.isEmpty && !keyTwo.isEmpty && !keyThree.isEmpty) {
                        if (keyOne.playerId === keyTwo.playerId && keyTwo.playerId === keyThree.playerId) {
                            if (!winners.includes(keyOne.playerId))
                                winners.push(keyOne.playerId);
                        }
                    }
                    else if (keyOne.isEmpty) {
                        allFilled = false;
                    }
                }
            }
            if (winners.length === 1) {
                winner = winners[0];
                hasWon = true;
            }
            const hasTied = (allFilled && winner === -1) || winners.length > 1;
            if (hasTied || hasWon) {
                return { winnerID: winner, tied: hasTied, won: hasWon };
            }
            return null;
        }
        catch (err) {
            this.logError("checkForEnd", err);
            return null;
        }
    }
    isMyTurn(client) {
        try {
            const s = this.state.playerStates.get(client.sessionId);
            if (!s) {
                this.logWarn("playerState not found", { client });
                return false;
            }
            const order = s.playerOrder;
            if (this.hasStarted && this.turnPlayer === order)
                return true;
            if (!this.hasStarted) {
                this.logWarn("room has not started", { client });
                return false;
            }
            this.logWarn("not your turn", { client, turnPlayer: this.turnPlayer, yourOrder: order });
            return false;
        }
        catch (err) {
            this.logError("isMyTurn", err, { client });
            return false;
        }
    }
}
exports.ServerRoom = ServerRoom;
