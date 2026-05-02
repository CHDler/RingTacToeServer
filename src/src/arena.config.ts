import Arena from "@colyseus/tools";

import { monitor } from "@colyseus/monitor";
import cors from "cors";

/**
 * Import your Room files
 */
import { ServerRoom } from "./Server/ServerRoom"


export default Arena({
    getId: () => "Your Colyseus App",

    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        gameServer.define('ringtactoe-replace', ServerRoom).filterBy(['playerNum']).sortBy({ clients: -1 });
        gameServer.define('ringtactoe-flow', ServerRoom).filterBy(['playerNum']).sortBy({ clients: -1 });
        gameServer.define('ringtactoe-flow-2', ServerRoom).filterBy(['playerNum']).sortBy({ clients: -1 });


        console.log("BOOT:", new Date().toISOString());
    },

    initializeExpress: (app) => {
        const corsOptions = {
            origin: true,
            credentials: true,
        };

        app.use((req, res, next) => {
            const requestOrigin = req.headers.origin;
            if (requestOrigin) {
                res.header("Access-Control-Allow-Origin", requestOrigin);
                res.header("Vary", "Origin");
            } else {
                res.header("Access-Control-Allow-Origin", "*");
            }
            res.header("Access-Control-Allow-Credentials", "true");
            res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
            res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
            if (req.method === "OPTIONS") {
                res.sendStatus(204);
                return;
            }
            next();
        });
        app.use(cors(corsOptions));
        app.options("*", cors(corsOptions));

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
