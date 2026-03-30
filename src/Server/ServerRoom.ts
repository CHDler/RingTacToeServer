import { PlayerState, RoomState, ServerBoardKey } from "./Schema/ServerInfo";
import { Room, Client } from "colyseus";

type MoveMsg = {
    boardIndex: number;
    boardKeyIndex: number;
    rotateStep: number;
    rotateDirection: number;
    rotateBoardIndex: number;
};

type EndGamePayload = {
    winnerID: number;
    tied: boolean;
    won: boolean;
};

type RoomMetadata = {
    playerNum: number;
    hasStarted: boolean;
    createdAt: number;
    inviteOnly: boolean;
};

export class Board {
    color: string;
    keys: ServerBoardKey[];

    constructor(init?: Partial<Board>) {
        Object.assign(this, init);
    }

    static create(keyCount: number, color = ""): Board {
        const b = new Board();
        b.color = color;
        b.keys = Array.from({ length: keyCount }, () => new ServerBoardKey());
        return b;
    }
}

/** 只注册一次全局异常捕获，防止漏掉 async 异常导致“服务器什么都没打印” */
function installGlobalCrashHooksOnce() {
    const g: any = globalThis as any;
    if (g.__SERVERROOM_CRASH_HOOKS_INSTALLED__) return;
    g.__SERVERROOM_CRASH_HOOKS_INSTALLED__ = true;

    process.on("unhandledRejection", (reason: any) => {
        console.error(
            `[GLOBAL][unhandledRejection]`,
            reason instanceof Error ? reason.stack : reason
        );
    });

    process.on("uncaughtException", (err: any) => {
        console.error(`[GLOBAL][uncaughtException]`, err?.stack ?? err);
    });
}

export class ServerRoom extends Room<RoomState> {
    private static readonly IDLE_STATE_TICK_INTERVAL_MS = 1000;

    seatReservationTimeout = 60;

    leftRoomPlayers: number[] = [];
    playernum = 0;
    turnPlayer = 0;
    playerToStart = 3;
    hasStarted = false;
    createdAt = 0;
    inviteOnly = false;

    BOARD_COUNT = 3;
    KEY_COUNT = 6;
    serverBoards: Board[] = [];
    colors = ["Blue", "Red", "Green"];
    private readonly aiNamePrefix = "AI玩家";
    private readonly aiTurnDelayMs = 450;
    private aiTurnScheduleToken = 0;
    private aiControlledSessionIds = new Set<string>();


    public isFlowMode = false;
    currentMove: MoveMsg | null = null;

    // ============ logging helpers ============
    private now() {
        return new Date().toISOString();
    }

    private ctx(client?: Client) {
        return {
            t: this.now(),
            roomId: this.roomId,
            roomName: this.roomName,
            clients: this.clients?.length ?? 0,
            sessionId: client?.sessionId,
        };
    }

    private errorId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    private logInfo(msg: string, extra?: any) {
        console.log(`[INFO] ${msg}`, { ...this.ctx(), ...extra });
    }

    private logWarn(msg: string, extra?: any) {
        console.warn(`[WARN] ${msg}`, { ...this.ctx(), ...extra });
    }

    private logError(where: string, err: any, extra?: any) {
        const id = this.errorId();
        console.error(
            `[ERROR] ${where}  errorId=${id}`,
            {
                ...this.ctx(extra?.client),
                ...extra,
                errorId: id,
                message: err?.message ?? String(err),
                stack: err?.stack,
            }
        );
        return id;
    }

    private reject(client: Client, reason: string, extra?: any) {
        this.logWarn(`moveRejected: ${reason}`, { client, ...extra });
        try {
            client.send("moveRejected", { reason });
        } catch (e) {
            this.logError("client.send(moveRejected)", e, { client, reason });
        }
    }

    private updateRoomMetadata() {
        const metadata: RoomMetadata = {
            playerNum: this.playerToStart,
            hasStarted: this.hasStarted,
            createdAt: this.createdAt,
            inviteOnly: this.inviteOnly,
        };

        void this.setMetadata(metadata).catch((err) => {
            this.logError("setMetadata", err, { metadata });
        });
    }

    private lockStartedRoom() {
        if (this.locked) return;

        void this.lock().catch((err) => {
            this.logError("lock", err);
        });
    }

    /** 包一层，防止 onMessage handler throw 导致房间/进程异常，并且保证日志里有 stack */
    private getSeatEntries() {
        const seats: Array<{ sessionId: string; playerState: PlayerState }> = [];
        this.state.playerStates.forEach((playerState, sessionId) => {
            seats.push({ sessionId, playerState });
        });
        return seats;
    }

    private getSeatCount() {
        return this.getSeatEntries().length;
    }

    private getAiName(playerState: PlayerState) {
        const index = playerState.playerOrder >= 0 ? playerState.playerOrder : playerState.playerId;
        const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
        return `${this.aiNamePrefix}${safeIndex}`;
    }

    private refreshAiOrdersFromState() {
        const aiOrders: number[] = [];
        this.state.playerStates.forEach((playerState, sessionId) => {
            if (!this.aiControlledSessionIds.has(sessionId)) return;
            if (playerState.playerOrder < 0) return;
            aiOrders.push(playerState.playerOrder);
        });
        aiOrders.sort((left, right) => left - right);
        this.leftRoomPlayers = aiOrders;
    }

    private findSeatByOrder(order: number) {
        for (const seat of this.getSeatEntries()) {
            if (seat.playerState.playerOrder === order) {
                return seat;
            }
        }
        return null;
    }

    private findAiSeatByOrder(order: number) {
        const seat = this.findSeatByOrder(order);
        if (!seat) return null;
        if (!this.aiControlledSessionIds.has(seat.sessionId)) return null;
        return seat;
    }

    private promoteSeatToAi(sessionId: string, playerState: PlayerState) {
        this.aiControlledSessionIds.add(sessionId);
        playerState.useWXName = false;
        playerState.playerName = this.getAiName(playerState);
        this.refreshAiOrdersFromState();
        this.playernum = this.getSeatCount();
    }

    private buildRandomAiMove(): MoveMsg | null {
        const candidates: Array<{ boardIndex: number; boardKeyIndex: number }> = [];

        for (let boardIndex = 0; boardIndex < this.serverBoards.length; boardIndex++) {
            const board = this.serverBoards[boardIndex];
            for (let boardKeyIndex = 0; boardKeyIndex < board.keys.length; boardKeyIndex++) {
                if (!board.keys[boardKeyIndex].isEmpty) continue;
                candidates.push({ boardIndex, boardKeyIndex });
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        const choice = candidates[Math.floor(Math.random() * candidates.length)];
        return {
            boardIndex: choice.boardIndex,
            boardKeyIndex: choice.boardKeyIndex,
            rotateStep: 0,
            rotateDirection: 0,
            rotateBoardIndex: -1,
        };
    }

    private scheduleAiTurnIfNeeded(reason: string) {
        if (!this.hasStarted) return;

        const aiSeat = this.findAiSeatByOrder(this.turnPlayer);
        if (!aiSeat) return;

        const token = ++this.aiTurnScheduleToken;
        this.logInfo("Schedule AI turn", {
            reason,
            turnPlayer: this.turnPlayer,
            playerId: aiSeat.playerState.playerId,
        });

        this.clock.setTimeout(() => {
            if (token !== this.aiTurnScheduleToken) return;
            if (!this.hasStarted) return;

            const currentAiSeat = this.findAiSeatByOrder(this.turnPlayer);
            if (!currentAiSeat) return;

            const aiMove = this.buildRandomAiMove();
            if (!aiMove) {
                this.logWarn("AI found no valid move", {
                    turnPlayer: this.turnPlayer,
                    reason,
                });
                return;
            }

            try {
                this.processMove(currentAiSeat.playerState, aiMove, {
                    actorLabel: "AI",
                    broadcastMoveMsg: null,
                });
            } catch (err) {
                this.logError("runAiTurn", err, {
                    turnPlayer: this.turnPlayer,
                    aiMove,
                });
            }
        }, this.aiTurnDelayMs);
    }

    private safeMessageHandler<T>(
        messageType: string,
        fn: (client: Client, data: T) => any
    ) {
        return (client: Client, data: T) => {
            try {
                return fn.call(this, client, data);
            } catch (err) {
                const eid = this.logError(`onMessage(${messageType})`, err, { client, data });
                // 给客户端一个可对照的 errorId（方便你把客户端报错和服务端日志对上）
                try {
                    client.send("serverError", {
                        where: `onMessage(${messageType})`,
                        errorId: eid,
                    });
                } catch { }
            }
        };
    }

    // ============ lifecycle ============
    onCreate(options: any) {
        this.seatReservationTimeout = 60;
        this.playerToStart = options?.playerNum ?? 3;
        this.createdAt = Date.now();
        this.inviteOnly = Boolean(options?.inviteOnly);
        console.log("this room is " + this.playerToStart + " players room")
        installGlobalCrashHooksOnce();
        try {
            this.maxClients = this.playerToStart;
            void this.setPrivate(this.inviteOnly).catch((err) => {
                this.logError("setPrivate", err, { inviteOnly: this.inviteOnly });
            });

            // 建议用 setState，避免一些内部 patch/初始化边界问题
            this.state = new RoomState();

            this.logInfo("Room created", { options });

            this.clock.setInterval(() => {
                try {
                    this.state.tick++;
                } catch (e) {
                    this.logError("tickInterval", e);
                }
            }, ServerRoom.IDLE_STATE_TICK_INTERVAL_MS);

            this.onMessage(
                "confirmMove",
                this.safeMessageHandler<any>("confirmMove", (client, data) => this.onMove(client, data))
            );

            this.serverBoards = Array.from({ length: this.BOARD_COUNT }, (_, i) =>
                Board.create(this.KEY_COUNT, this.colors[i] ?? "")
            );

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
        } catch (err) {
            this.logError("onCreate", err, { options });
            throw err; // 创建失败必须抛出，让 matchmaker 知道
        }
    }

    // 可选：你如果有鉴权/版本号校验，这里最好做，并且保证失败也能看到日志
    async onAuth(client: Client, options: any, request?: any) {
        try {
            // 这里默认放行，只记录关键字段（别把整个 request 打出来，太大）
            this.logInfo("onAuth", {
                client,
                options: {
                    name: options?.name,
                    useWXInfo: options?.useWXInfo,
                    playerNum: options?.playerNum,
                    inviteOnly: options?.inviteOnly,
                },
                ip:
                    request?.headers?.["x-forwarded-for"] ??
                    request?.connection?.remoteAddress ??
                    undefined,
            });
            return true;
        } catch (err) {
            this.logError("onAuth", err, { client, options });
            return false;
        }
    }

    onJoin(client: Client, options: any) {

        console.log("onJoin111111111111111")
        try {
            if (this.hasStarted) {
                throw new Error("room already started");
            }

            const joinInviteOnly = Boolean(options?.inviteOnly);
            if (joinInviteOnly !== this.inviteOnly) {
                throw new Error(`room mode mismatch: room inviteOnly=${this.inviteOnly}, join inviteOnly=${joinInviteOnly}`);
            }

            this.logInfo("Client join", { client, options });

            this.state.playerStates.set(client.sessionId, new PlayerState());
            const s = this.state.playerStates.get(client.sessionId);
            if (!s) {
                throw new Error("playerStates.set succeeded but get returned undefined");
            }

            this.playernum = this.getSeatCount();
            s.playerId = Math.max(0, this.playernum - 1);

            const rawName = options?.name ?? "";
            const useWXInfo = Boolean(options?.useWXInfo);
            const rawChosenMark = Number(options?.chosenMark);
            const name = rawName.toString().slice(0, 24);
            const chosenMark = Number.isFinite(rawChosenMark) && rawChosenMark >= 0
                ? Math.floor(rawChosenMark)
                : 0;

            s.playerName = name;        // ✅ 修复：之前写 rawName，截断没生效
            s.chosenMark = chosenMark;
            s.useWXName = useWXInfo;

            if (this.checkForStart()) {
                this.logInfo("Start game (enough players)");
                this.assignRandomOrderAndStart();
            } else {
                this.updateRoomMetadata();
            }
        } catch (err) {
            this.logError("onJoin", err, { client, options });
            // 抛出会让该玩家 join 失败（比半初始化状态更安全）
            throw err;
        }
    }

    onLeave(client: Client, consented?: boolean) {
        try {
            const playerState = this.state.playerStates.get(client.sessionId);
            const playerID = playerState?.playerId ?? -1;
            const playerOrder = playerState?.playerOrder ?? -1;

            this.logWarn("Client leave", { client, consented, playerID, playerOrder });

            if (!playerState) {
                this.playernum = this.getSeatCount();
                this.updateRoomMetadata();
                return;
            }

            const gameAlreadyEnded = this.hasStarted && this.checkForEnd() !== null;
            if (gameAlreadyEnded) {
                this.logInfo("Skip AI promotion because game already ended", {
                    client,
                    playerID,
                    playerOrder,
                });
                this.playernum = this.getSeatCount();
                this.updateRoomMetadata();
                return;
            }

            this.promoteSeatToAi(client.sessionId, playerState);
            this.updateRoomMetadata();

            if (this.checkForStart()) {
                this.logInfo("Start game (AI backfill after leave)");
                this.assignRandomOrderAndStart();
                return;
            }

            if (this.hasStarted && playerOrder === this.turnPlayer) {
                this.scheduleAiTurnIfNeeded("player left on active turn");
            }
        } catch (err) {
            this.logError("onLeave", err, { client, consented });
        }
    }

    onDispose() {
        try {
            this.aiTurnScheduleToken++;
            this.logInfo("Room disposed");
        } catch (err) {
            this.logError("onDispose", err);
        }
    }

    // ============ game logic ============
    onMove(client: Client, data: any) {
        // 这里不要 throw，尽量 reject + 打日志
        try {
            const activePlayerState = this.state.playerStates.get(client.sessionId);
            this.processMove(activePlayerState, data as MoveMsg, {
                client,
                actorLabel: "player",
                broadcastMoveMsg: data as MoveMsg,
            });
            return;

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

            this.currentMove = data as MoveMsg;

            const boardIndex = this.currentMove.boardIndex;
            const boardKeyIndex = this.currentMove.boardKeyIndex;
            const rotateStep = this.currentMove.rotateStep;
            const rotateDirection = this.currentMove.rotateDirection;
            const rotateBoardIndex = this.currentMove.rotateBoardIndex;

            // ---- validation (更严格，避免数组越界导致 silent crash) ----
            if (
                boardIndex < 0 ||
                boardIndex >= this.serverBoards.length ||
                boardKeyIndex < 0
            ) {
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
                } catch (e) {
                    this.logError("flowSyncAfterPlace", e, { client, boardIndex, boardKeyIndex });
                    // 不直接 return，避免玩家卡死；但日志一定要有
                }
            }

            this.logInfo("Placed", { client, boardIndex, boardKeyIndex, playerId: key.playerId });

            // ---- rotation ----
            {
                const mod = (a: number, n: number) => ((a % n) + n) % n;

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
                        } catch (e) {
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
            } catch (e) {
                this.logError("broadcast(moveAccepted)", e, { client });
            }

            if (endGamePayload) {
                try {
                    this.broadcast("endGame", endGamePayload);
                } catch (e) {
                    this.logError("broadcast(endGame)", e, { client, endGamePayload });
                }
            }
        } catch (err) {
            // 最外层兜底：onMove 不允许异常漏出去
            const eid = this.logError("onMove", err, { client, data });
            try {
                client.send("serverError", { where: "onMove", errorId: eid });
            } catch { }
        }
    }

    private processMove(
        player: PlayerState | undefined,
        data: MoveMsg | null | undefined,
        options: {
            client?: Client;
            actorLabel: string;
            broadcastMoveMsg?: MoveMsg | null;
        }
    ) {
        const rejectMove = (reason: string, extra?: any) => {
            if (options.client) {
                this.reject(options.client, reason, extra);
            } else {
                this.logWarn(`${options.actorLabel} move rejected: ${reason}`, extra);
            }
        };

        if (!data) {
            rejectMove("empty data");
            return false;
        }

        if (!player) {
            rejectMove("playerState missing");
            return false;
        }

        if (player.playerOrder !== this.turnPlayer) {
            rejectMove(`player order wrong: ${player.playerOrder} should be ${this.turnPlayer}`, {
                turnPlayer: this.turnPlayer,
                playerOrder: player.playerOrder,
                playerId: player.playerId,
            });
            return false;
        }

        this.currentMove = data as MoveMsg;

        const boardIndex = this.currentMove.boardIndex;
        const boardKeyIndex = this.currentMove.boardKeyIndex;
        const rotateStep = this.currentMove.rotateStep;
        const rotateDirection = this.currentMove.rotateDirection;
        const rotateBoardIndex = this.currentMove.rotateBoardIndex;

        if (
            boardIndex < 0 ||
            boardIndex >= this.serverBoards.length ||
            boardKeyIndex < 0
        ) {
            rejectMove(`invalid boardIndex/boardKeyIndex: b=${boardIndex}, k=${boardKeyIndex}`);
            return false;
        }

        const board = this.serverBoards[boardIndex];
        const keyLength = board.keys.length;

        if (boardKeyIndex < 0 || boardKeyIndex >= keyLength) {
            rejectMove(`invalid boardKeyIndex: ${boardKeyIndex}, keyLength=${keyLength}`);
            return false;
        }

        const key = board.keys[boardKeyIndex];
        if (!key.isEmpty) {
            rejectMove(`key already filled by player ${key.playerId}`);
            return false;
        }

        key.isEmpty = false;
        key.playerId = player.playerId;

        const blueBoard = this.serverBoards[0];
        const redBoard = this.serverBoards[1];
        const greenBoard = this.serverBoards[2];

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
            } catch (e) {
                this.logError("flowSyncAfterPlace", e, {
                    client: options.client,
                    actorLabel: options.actorLabel,
                    boardIndex,
                    boardKeyIndex,
                    playerId: player.playerId,
                });
            }
        }

        this.logInfo("Placed", {
            client: options.client,
            actorLabel: options.actorLabel,
            boardIndex,
            boardKeyIndex,
            playerId: key.playerId,
        });

        {
            const mod = (a: number, n: number) => ((a % n) + n) % n;

            if (rotateBoardIndex < -1 || rotateBoardIndex >= this.serverBoards.length) {
                rejectMove(`invalid rotateBoardIndex: ${rotateBoardIndex}`);
                return false;
            }

            if (rotateBoardIndex !== -1) {
                const rBoard = this.serverBoards[rotateBoardIndex];
                const keys = rBoard.keys;
                const n = keys.length;

                if (n === 0) {
                    this.logError("rotation", new Error("rotate board has no keys"), {
                        client: options.client,
                        rotateBoardIndex,
                        actorLabel: options.actorLabel,
                    });
                    rejectMove(`rotate board ${rotateBoardIndex} has no keys`);
                    return false;
                }

                const step = Number(rotateStep) || 0;
                const dir = Number(rotateDirection) || 0;
                const shift = mod(step * dir, n);

                this.logInfo("Rotation", {
                    client: options.client,
                    actorLabel: options.actorLabel,
                    rotateBoardIndex,
                    step,
                    dir,
                    shift,
                });

                const old = keys.map((k) => ({ isEmpty: k.isEmpty, playerId: k.playerId }));
                for (let i = 0; i < n; i++) {
                    const src = mod(i - shift, n);
                    keys[i].isEmpty = old[src].isEmpty;
                    keys[i].playerId = old[src].playerId;
                }

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
                    } catch (e) {
                        this.logError("flowSyncAfterRotate", e, {
                            client: options.client,
                            actorLabel: options.actorLabel,
                            rotateBoardIndex,
                        });
                    }
                }
            }
        }

        this.turnPlayer = (this.turnPlayer + 1) % this.playerToStart;

        const endGamePayload = this.checkForEnd();
        const moveMsgToBroadcast = options.broadcastMoveMsg === undefined
            ? this.currentMove
            : options.broadcastMoveMsg;

        try {
            const payload: any = {
                boards: this.serverBoards,
                turnPlayer: this.turnPlayer,
            };

            if (moveMsgToBroadcast != null) {
                payload.moveMsg = moveMsgToBroadcast;
            }

            this.broadcast("moveAccepted", payload);
        } catch (e) {
            this.logError("broadcast(moveAccepted)", e, {
                client: options.client,
                actorLabel: options.actorLabel,
                playerId: player.playerId,
            });
        }

        if (endGamePayload) {
            try {
                this.broadcast("endGame", endGamePayload);
            } catch (e) {
                this.logError("broadcast(endGame)", e, {
                    client: options.client,
                    actorLabel: options.actorLabel,
                    endGamePayload,
                });
            }
            return true;
        }

        this.scheduleAiTurnIfNeeded(`${options.actorLabel} move`);
        return true;
    }

    assignRandomOrderAndStart() {
        const ids = this.getSeatEntries().map((seat) => seat.sessionId);
        this.shuffleInPlace(ids);

        for (let i = 0; i < ids.length; i++) {
            const s = this.state.playerStates.get(ids[i]);
            if (s) {
                s.playerOrder = i;
                s.playerId = i;
                if (this.aiControlledSessionIds.has(ids[i])) {
                    s.useWXName = false;
                    s.playerName = this.getAiName(s);
                    continue;
                }
                if (!s.useWXName) {
                    s.playerName = "玩家" + i.toString();
                }
            }
        }

        this.playernum = this.getSeatCount();
        this.turnPlayer = 0;
        this.hasStarted = true;
        this.refreshAiOrdersFromState();
        this.updateRoomMetadata();
        this.lockStartedRoom();
        this.notifyClientsToStart();
        this.scheduleAiTurnIfNeeded("game start");
    }

    notifyClientsToStart() {
        const playerInfos = this.getSeatEntries()
            .map((seat) => {
                const playerState = seat.playerState;
                return {
                    order: playerState?.playerOrder ?? -1,
                    playerId: playerState?.playerId ?? -1,
                    name: playerState?.playerName ?? "",
                    chosenMark: playerState?.chosenMark ?? 0,
                    useWXName: playerState?.useWXName ?? false,
                };
            })
            .filter((player) => player.order >= 0)
            .sort((left, right) => left.order - right.order);
        const playerMarks = playerInfos.map((player) => player.chosenMark ?? 0);

        for (const client of this.clients) {
            const s = this.state.playerStates.get(client.sessionId);
            try {
                client.send("start_game", {
                    order: s?.playerOrder ?? -1,
                    playerId: s?.playerId ?? -1,
                    turnPlayer: this.turnPlayer,
                    players: playerInfos.length,
                    name: s?.playerName,
                    useWXName: s?.useWXName ?? false,
                    playerInfos,
                    playerMarks,
                });
            } catch (e) {
                this.logError("client.send(start_game)", e, { client });
            }
        }
    }

    private shuffleInPlace<T>(arr: T[]) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    checkForStart() {
        const occupiedSeats = this.getSeatCount();
        this.playernum = occupiedSeats;
        this.logInfo("checkForStart", {
            playernum: this.playernum,
            hasStarted: this.hasStarted,
            connectedClients: this.clients.length,
        });

        return !this.hasStarted && occupiedSeats === this.playerToStart && this.clients.length > 0;
    }

    checkForEnd(): EndGamePayload | null {
        try {
            let allFilled = true;
            const winners: number[] = [];
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
                            if (!winners.includes(keyOne.playerId)) winners.push(keyOne.playerId);
                        }
                    } else if (keyOne.isEmpty) {
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
        } catch (err) {
            this.logError("checkForEnd", err);
            return null;
        }
    }

    isMyTurn(client: Client) {
        try {
            const s = this.state.playerStates.get(client.sessionId);
            if (!s) {
                this.logWarn("playerState not found", { client });
                return false;
            }

            const order = s.playerOrder;
            if (this.hasStarted && this.turnPlayer === order) return true;

            if (!this.hasStarted) {
                this.logWarn("room has not started", { client });
                return false;
            }

            this.logWarn("not your turn", { client, turnPlayer: this.turnPlayer, yourOrder: order });
            return false;
        } catch (err) {
            this.logError("isMyTurn", err, { client });
            return false;
        }
    }
}
