import { PlayerState,RoomState} from "./Schema/ServerInfo"
import { Room, Client } from "colyseus";
export class Server extends Room<RoomState> {
    onCreate() {
        this.state = new RoomState();
        console.log("create room!");
        this.clock.setInterval(() => {
            this.state.tick++;
        }, 50);
        this.onMessage("move", (client, data: any)=>{
            this.onMove(client, data);
        })
    }
    onMove(client: Client, data: any) {
        if(!data) return;
        const ps = this.state.playerStates.get(client.sessionId);
        if(!ps) return;
        client
    }
    onJoin(client: Client) {
        this.state.playerStates.set(client.sessionId, new PlayerState());
    }

    onLeave(client: Client) {
        this.state.playerStates.delete(client.sessionId);
    }
}




