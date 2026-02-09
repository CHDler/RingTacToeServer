import {PlayerState, RoomState, ServerBoardKey} from "./Schema/ServerInfo"
import {Room, Client} from "colyseus";
import {cli} from "@colyseus/loadtest";

type MoveMsg = {
    boardIndex: number;
    boardKeyIndex: number;
    rotateSteps: number[];
    rotateDirections: number[];
    rotateBoardIndices: number[];
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
        b.keys = Array.from({length: keyCount}, () => new ServerBoardKey());
        return b;
    }
}

export class ServerRoom extends Room<RoomState> {
    leftRoomPlayers: number[] = [];
    playernum = 0;
    turnPlayer = 0;
    hasStarted = false;
    BOARD_COUNT = 3;
    KEY_COUNT = 6; // 你按自己的棋盘格子数改
    serverBoards: Board[] = [];
    colors = ["Blue", "Red", "Green"]
    static readonly numberToStart: number = 3;
    public isFlowMode = false;

    onCreate() {
        this.maxClients = ServerRoom.numberToStart;
        this.state = new RoomState();
        console.log("start room lolol!");
        this.clock.setInterval(() => {
            this.state.tick++;
        }, 50);
        this.onMessage("confirmMove", (client, data: any) => {
            this.onMove(client, data);
        })
        this.serverBoards = Array.from({length: this.BOARD_COUNT}, (_, i) =>
            Board.create(this.KEY_COUNT, this.colors[i] ?? "")
        );
    }

    onJoin(client: Client) {
        this.state.playerStates.set(client.sessionId, new PlayerState());
        var s = this.state.playerStates.get(client.sessionId);
        s.playerId = this.playernum;
        this.playernum++;

        if (this.checkForStart()) {
            console.log("start game lolol");
            //assign order for all
            this.assignRandomOrderAndStart();
        }

    }

    onMove(client: Client, data: any) {
        if (!data) return false;
        const ps = this.state.playerStates.get(client.sessionId);
        if (!ps) return false;
        if (ps.playerOrder !== this.turnPlayer) {
            console.log("player order is wrong! with player " + ps.playerOrder + " but should be player " + this.turnPlayer);
            client.send("moveRejected", {reason: "player order is wrong! with player " + ps.playerOrder + " but should be player " + this.turnPlayer});

            return;
        }
        const msg = data as MoveMsg;
        const boardIndex = msg.boardIndex;
        const boardKeyIndex = msg.boardKeyIndex;
        const rotateSteps: number[] = Array.isArray(msg.rotateSteps) ? msg.rotateSteps : [];
        const rotateDirections: number[] = Array.isArray(msg.rotateDirections) ? msg.rotateDirections : [];
        const rotateBoardIndices: number[] = Array.isArray(msg.rotateBoardIndices) ? msg.rotateBoardIndices : [];

        if (boardIndex >= this.serverBoards.length || boardKeyIndex < 0) {
            console.log("no boards found for player " + boardKeyIndex);
            client.send("moveRejected", {reason: "no boards found for player " + boardKeyIndex});
            return;
        }
        const board = this.serverBoards[boardIndex];
        const keyLength = board.keys.length;
        if (boardKeyIndex < 0 || boardKeyIndex >= keyLength) {
            console.log("no boards keys found for player " + boardKeyIndex + " key length " + keyLength + " at board " + boardKeyIndex);
            client.send("moveRejected", {reason: "no boards keys found"});
            return;
        }
        const key = board.keys[boardKeyIndex];
        if (!key.isEmpty) {
            console.log("key is already placed by player " + key.playerId);
            client.send("moveRejected", {reason: "key is placed by player " + key.playerId});
            return;
        }
        const player = this.state.playerStates.get(client.sessionId);
        if (!player) {
            console.log("no players found");
            client.send("moveRejected", {reason: "no players found"});
            return;
        }
        key.isEmpty = false;
        key.playerId = player.playerId;
        const greenBoard = this.serverBoards[2];
        const redBoard = this.serverBoards[1];
        const blueBoard = this.serverBoards[0];


        if (this.isFlowMode) {
            switch (boardIndex) {
                case 0:
                    //蓝色转盘
                    console.log("Special key case blue");
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
                            redBoard.keys[1].isEmpty = blueBoard.keys[5].isEmpty
                            redBoard.keys[1].playerId = blueBoard.keys[5].playerId
                            break;

                    }
                    break;
                case 1 :
                    //红色转盘
                    console.log("Special key case red");
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
                    //绿色转盘
                    console.log("Special key case green");
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


            }

        }


        console.log("key " + boardKeyIndex + " at board " + boardIndex + " is placed by player " + key.playerId);
        //notify players and update board info

        console.log("player " + this.turnPlayer + " to move");

        // read rotation:

        {
            console.log("this time we have " + rotateDirections.length + " rotation ")
            if (rotateDirections.length !== rotateSteps.length || rotateDirections.length !== rotateBoardIndices.length) {
                client.send("moveRejected", {reason: "rotations are not matched! " + rotateBoardIndices.length + " " + rotateDirections.length + " " + rotateBoardIndices.length});
                return;
            }
            const mod = (a: number, n: number) => ((a % n) + n) % n;

            for (let r = 0; r < rotateSteps.length; r++) {
                const step = Number(rotateSteps[r]) || 0;
                const dir = Number(rotateDirections[r]) || 0;   // 建议约定：dir = +1 / -1
                const bIdx = Number(rotateBoardIndices[r]);
                console.log("rotation step " + step + " with dir " + dir + " at board " + bIdx)
                if (bIdx < 0 || bIdx >= this.serverBoards.length) {
                    client.send("moveRejected", {reason: `invalid rotateBoardIndex: ${bIdx}`});
                    return;
                }


                const board = this.serverBoards[bIdx];
                const keys = board.keys;
                const n = keys.length;
                if (n === 0) continue;

                const old = keys.map(k => ({isEmpty: k.isEmpty, playerId: k.playerId}));
                const shift = mod(step * dir, n);
                console.log("rotate boardIndex", bIdx, "dir", dir, "step", step);

                for (let i = 0; i < n; i++) {
                    const src = mod(i - shift, n);
                    keys[i].isEmpty = old[src].isEmpty;
                    keys[i].playerId = old[src].playerId;
                }
                

                //全色 红盘 2 绿盘 0 蓝盘 4
                //绿蓝 绿盘 1 蓝盘 3
                //红蓝 红盘 1 蓝盘 5
                //红绿 红盘 3 绿盘 5
                if (this.isFlowMode) {
                    switch (bIdx) {
                        case 0:
                            //蓝色转盘
                            console.log("Special casse blue");
                            greenBoard.keys[0].isEmpty = blueBoard.keys[4].isEmpty;
                            greenBoard.keys[0].playerId = blueBoard.keys[4].playerId;
                            redBoard.keys[2].isEmpty = blueBoard.keys[4].isEmpty;
                            redBoard.keys[2].playerId = blueBoard.keys[4].playerId;
                            greenBoard.keys[1].isEmpty = blueBoard.keys[3].isEmpty;
                            greenBoard.keys[1].playerId = blueBoard.keys[3].playerId;
                            redBoard.keys[1].isEmpty = blueBoard.keys[5].isEmpty
                            redBoard.keys[1].playerId = blueBoard.keys[5].playerId
                            break;
                        case 1 :
                            //红色转盘
                            console.log("Special casse red");

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
                            //绿色转盘
                            console.log("Special casse green");
                            redBoard.keys[3].isEmpty = greenBoard.keys[5].isEmpty;
                            redBoard.keys[3].playerId = greenBoard.keys[5].playerId;
                            blueBoard.keys[3].isEmpty = greenBoard.keys[1].isEmpty;
                            blueBoard.keys[3].playerId = greenBoard.keys[1].playerId;
                            redBoard.keys[2].isEmpty = greenBoard.keys[0].isEmpty;
                            redBoard.keys[2].playerId = greenBoard.keys[0].playerId;
                            blueBoard.keys[4].isEmpty = greenBoard.keys[0].isEmpty;
                            blueBoard.keys[4].playerId = greenBoard.keys[0].playerId;
                    }

                }
            }


        }
        this.turnPlayer++;
        this.turnPlayer = this.turnPlayer % ServerRoom.numberToStart;

        if(this.leftRoomPlayers.includes(this.turnPlayer)){
            // move by ai!

        }
        this.broadcast("moveAccepted", {boards: this.serverBoards, turnPlayer: this.turnPlayer});
        this.checkForEnd();
        return;
    }

    assignRandomOrderAndStart() {
        const ids = this.clients.map(c => c.sessionId); // 当前在线玩家（最稳）
        this.shuffleInPlace(ids);

        for (let i = 0; i < ids.length; i++) {
            const s = this.state.playerStates.get(ids[i]);
            if (s) {
                s.playerOrder = i; // 0=先手, 1=后手...
                s.playerId = i; // 让玩家游戏内id 跟玩家order一致，更加直观
                s.playerName = i.toString(); //TODO: 使用玩家名称
            }
        }
        this.turnPlayer = 0;      // 轮到 order=0 的玩家
        this.hasStarted = true;   // 你自己状态里如果有这个字段
        this.notifyClientsToStart();
    }

    notifyClientsToStart() {
        for (const client of this.clients) {
            const s = this.state.playerStates.get(client.sessionId);

            client.send("start_game", {
                order: s?.playerOrder ?? -1,
                playerId: s?.playerId ?? -1,
                turnPlayer: this.turnPlayer,
                players: this.clients.length,
                name: s?.playerName,
            });
        }
    }

    private shuffleInPlace<T>(arr: T[]) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    checkForStart() {
        console.log("check for starting and current player num " + this.playernum);
        if (!this.hasStarted && this.playernum === ServerRoom.numberToStart) {
            this.hasStarted = true;
            return true;
        } else {
            return false;
        }
    }

    checkForEnd() {
        let allFilled = true;
        const winners: number[] = [];
        let hasTied = false;
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
                const boardIndex = i;

                if (!keyOne.isEmpty && !keyTwo.isEmpty && !keyThree.isEmpty) {
                    if (keyOne.playerId === keyTwo.playerId && keyTwo.playerId === keyThree.playerId) {
                            console.log("this player has won " + keyOne.playerId);
                            if (!winners.includes(keyOne.playerId)) {
                                winners.push(keyOne.playerId);
                            }
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
        hasTied = (allFilled && winner === -1) || (winners.length > 1);
        if (hasTied || hasWon) {
            this.broadcast("endGame", {winnerID: winner, tied: hasTied, won: hasWon})
        }
    }


    onLeave(client: Client) {
        const playerState = this.state.playerStates.get(client.sessionId);
        const playerID = playerState.playerId;
        if(!this.leftRoomPlayers.includes(playerID)) {
            console.warn("Player " + playerID + " left room")
            this.leftRoomPlayers.push(playerID);
        }else{
            console.warn("Player " + playerID + " has already left room")
        }
        this.state.playerStates.delete(client.sessionId);
        this.playernum--;
    }

    /*  function* endGameCoroutine(){
          yield  1;
      }*/

    isMyTurn(client: Client) {
        const s = this.state.playerStates.get(client.sessionId);
        if (!s) {
            console.log("playerState not found for", client.sessionId);
            return false;
        }
        const order = s.playerOrder;
        if (this.hasStarted && this.turnPlayer === order) {
            return true;
        } else if (!this.hasStarted) {
            console.log("the room game has not started");
            return false;
        } else if (this.hasStarted && this.turnPlayer !== order) {
            console.log("is not player " + this.playernum + " turn");
            return false;
        }
    }
}




