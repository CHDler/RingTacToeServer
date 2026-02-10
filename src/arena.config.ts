import Arena from "@colyseus/tools";

import { monitor } from "@colyseus/monitor";

/**
 * Import your Room files
 */
import { ServerRoom} from "./Server/ServerRoom"


export default Arena({
    getId: () => "Your Colyseus App",

    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        gameServer.define('ringtactoe-replace', ServerRoom);
        gameServer.define('ringtactoe-flow', ServerRoom);


        console.log("BOOT:", new Date().toISOString());
    },

    initializeExpress: (app) => {
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
        app.use("/colyseus", monitor());
    },


    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});