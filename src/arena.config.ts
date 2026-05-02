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
        gameServer.define('ringtactoe-replace', ServerRoom).filterBy(['playerNum', 'inviteOnly']).sortBy({ clients: -1 });
        gameServer.define('ringtactoe-flow', ServerRoom).filterBy(['playerNum', 'inviteOnly']).sortBy({ clients: -1 });
        gameServer.define('ringtactoe-flow-2', ServerRoom).filterBy(['playerNum', 'inviteOnly']).sortBy({ clients: -1 });


        console.log("BOOT:", new Date().toISOString());
    },

    initializeExpress: (app) => {
        const allowedOrigins = ["http://localhost:7456", "http://ringtactoe.com:7456", "http://ringtactoe.com"];
        const corsOptions = {
            origin: allowedOrigins,
            credentials: true,
            methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        };

        app.use((req, res, next) => {
            const origin = req.headers.origin as string;
            if (origin && allowedOrigins.includes(origin)) {
                res.header("Access-Control-Allow-Origin", origin);
            }
            res.header("Access-Control-Allow-Credentials", "true");
            res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
            res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
            if (req.method === "OPTIONS") {
                return res.sendStatus(204);
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
