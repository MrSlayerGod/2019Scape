import net from 'net';
import { parentPort } from 'worker_threads';

import Packet from '#jagex/bytepacking/Packet.js';

import ClientSocket from '#lostcity/network/ClientSocket.js';
import ConnectionState from '#lostcity/network/ConnectionState.js';
import LoginProt from '#jagex/network/protocol/LoginProt.js';
import CacheProvider from '#lostcity/server/CacheProvider.js';
import ClientProt from '#jagex/network/protocol/ClientProt.js';

import ClientMessage from '#jagex/network/ClientMessage.js';
import EnumType from '#jagex/config/enumtype/EnumType.js';
import StructType from '#jagex/config/structtype/StructType.js';
import CollisionManager from '#lostcity/engine/collision/CollisionManager.js';
import Player from '#lostcity/entity/Player.js';
import ServerScriptList from '#lostcity/script/ServerScriptList.js';
import Js5Archive from '#jagex/config/Js5Archive.js';
import ServerProt from '#jagex/network/protocol/ServerProt.js';
import {PlayerList} from '#lostcity/entity/EntityList.js';

class World {
    id: number = 1;

    tick: number = 0;
    server: net.Server = net.createServer();
    collision: CollisionManager = new CollisionManager();

    players: PlayerList = new PlayerList(2048);

    async loginDecode(client: ClientSocket, stream: Packet): Promise<void> {
        const opcode: number = stream.g1();
        const packetType: LoginProt | undefined = LoginProt.BY_ID[opcode];
        if (typeof packetType === 'undefined') {
            // console.log(`[WORLD]: Received unknown packet ${opcode}`);
            client.end();
            return;
        }

        let size: number = packetType.size;
        if (size === -1) {
            size = stream.g1();
        } else if (size === -2) {
            size = stream.g2();
        }

        // console.log(`[WORLD]: Received packet ${packetType.debugname} size=${size}`);

        const buf: Packet = stream.gPacket(size);
        switch (packetType) {
            case LoginProt.INIT_GAME_CONNECTION: {
                const reply: Packet = new Packet(new Uint8Array(9));
                reply.p1(0);
                reply.p4(Math.random() * 0xFFFFFFFF);
                reply.p4(Math.random() * 0xFFFFFFFF);
                client.write(reply);
                break;
            }
            case LoginProt.GAMELOGIN: {
                const reply: Packet = new Packet(new Uint8Array(1));
                reply.p1(2);
                client.write(reply);

                const varUpdate: Packet = Packet.alloc(0);
                varUpdate.p2(0);
                const varUpdateStart: number = varUpdate.pos;
                varUpdate.pbool(true); // no more vars
                varUpdate.psize2(varUpdate.pos - varUpdateStart);
                client.write(varUpdate);
                break;
            }
            case LoginProt.GAMELOGIN_CONTINUE: {
                client.state = ConnectionState.Game;

                const reply: Packet = Packet.alloc(1);
                reply.p1(2);
                reply.p1(0);
                const start: number = reply.pos;

                reply.pbool(false); // totp token
                reply.p1(2); // staffmodlevel
                reply.p1(0);
                reply.pbool(false);
                reply.pbool(false);
                reply.pbool(true);
                reply.pbool(false);
                reply.p2(1); // player index
                reply.pbool(true);
                reply.p3(0);
                reply.pbool(true);
                reply.p6(0n);

                reply.psize1(reply.pos - start);
                client.write(reply);

                const player: Player = new Player();
                client.player = player;
                player.client = client;
                player.pid = this.players.next();
                this.addPlayer(player.pid, player);
                player.login();
                break;
            }
        }
    }

    async gameDecode(client: ClientSocket, message: ClientMessage): Promise<void> {
        console.log(`[WORLD]: Received packet ${message.packetType.debugname} opcode=${message.packetType.opcode} size=${message.buf.length}`);
        if (!client || !client.player) {
            return;
        }

        const player: Player = client.player;
        switch (message.packetType) {
            case ClientProt.NO_TIMEOUT:
                break;
            case ClientProt.CLIENT_CHEAT: {
                const scripted: boolean = message.buf.g1() == 1;
                const suggest: boolean = message.buf.g1() == 1;
                const cheat: string[] = message.buf.gjstr().toLowerCase().split(' ');
                const command: string = cheat[0];
                const args: string[] = cheat.slice(1);

                switch (command) {
                    case 'js5_reload': {
                        ServerProt.JS5_RELOAD.send(client);
                        break;
                    }
                    case 'reboottimer': {
                        ServerProt.UPDATE_REBOOT_TIMER.send(client, 1200);
                        break;
                    }
                    case 'logout': {
                        ServerProt.LOGOUT.send(client);
                        break;
                    }
                    case 'tele': {
                        if (args.length < 2) {
                            return;
                        }

                        player.x = parseInt(args[0]);
                        player.z = parseInt(args[1]);
                        if (args.length > 2) {
                            player.level = parseInt(args[2]);
                        }
                        ServerProt.REBUILD_NORMAL.send(client, player, player.level, player.x, player.z, player.buildAreaSize);
                        break;
                    }
                    default: {
                        console.log(`Unknown command: ${command}`);
                        break;
                    }
                }

                break;
            }
            default:
                console.log(`[WORLD]: Unhandled packet ${message.packetType.debugname}`);
                break;
        }
    }

    async ifOpenSubRedirect(
        client: ClientSocket, enumId: number, enumKey: number, structParam: number,
        toplevel: number, child: number
    ): Promise<void> {
        const enumLookup: EnumType = await EnumType.list(enumId, CacheProvider.js5);
        const structLookup: StructType = await StructType.list(enumLookup.valuesMap.get(enumKey) as number, CacheProvider.js5);
        const componentId: string | number | undefined = structLookup.params.get(structParam);

        if (typeof componentId !== 'undefined') {
            ServerProt.IF_OPENSUB.send(client, toplevel, (componentId as number) & 0xFFF, child, 1);
        }
    }

    async ifSetEventsRedirect(
        client: ClientSocket, enumId: number, enumKey: number, structParam: number,
        interfaceId: number, fromSlot: number, toSlot: number, settingsHash: number
    ): Promise<void> {
        const enumLookup: EnumType = await EnumType.list(enumId, CacheProvider.js5);
        const structLookup: StructType = await StructType.list(enumLookup.valuesMap.get(enumKey) as number, CacheProvider.js5);
        const componentId: string | number | undefined = structLookup.params.get(structParam);

        if (typeof componentId !== 'undefined') {
            ServerProt.IF_SETEVENTS.send(client, interfaceId, (componentId as number) & 0xFFF, fromSlot, toSlot, settingsHash);
        }
    }

    constructor() {
        this.server.on('listening', (): void => {
            console.log(`[WORLD]: Listening on port ${43594 + this.id}`);
        });

        this.server.on('connection', (socket: net.Socket): void => {
            console.log(`[WORLD]: Client connected from ${socket.remoteAddress}`);

            socket.setNoDelay(true);
            socket.setKeepAlive(true, 5000);
            socket.setTimeout(15000);

            const client: ClientSocket = new ClientSocket(socket);
            socket.on('data', async (data: Buffer): Promise<void> => {
                const stream: Packet = Packet.wrap(data, false);

                try {
                    while (stream.available > 0) {
                        switch (client.state) {
                            case ConnectionState.Login: {
                                await this.loginDecode(client, stream);
                                break;
                            }
                            case ConnectionState.Game: {
                                const opcode: number = stream.g1();
                                const packetType: ClientProt | undefined = ClientProt.values()[opcode];
                                if (typeof packetType === 'undefined') {
                                    console.log(`[WORLD]: Unknown packet ${opcode}`);
                                    client.end();
                                    return;
                                }

                                let size: number = packetType.size;
                                if (size === -1) {
                                    size = stream.g1();
                                } else if (size === -2) {
                                    size = stream.g2();
                                }

                                client.netInQueue.push(new ClientMessage(packetType, stream.gPacket(size)));
                                break;
                            }
                        }
                    }
                } catch (err) {
                    console.error(err);
                    socket.end();
                }

                client.lastResponse = this.tick;
            });

            socket.on('end', (): void => {
                console.log('[LOBBY]: Client disconnected');
                this.removeClient(client);
            });

            socket.on('timeout', (): void => {
                socket.destroy();
            });

            socket.on('error', (): void => {
                socket.destroy();
            });
        });
    }

    async start(): Promise<void> {
        await CacheProvider.load('data/pack');
        await this.collision.init(CacheProvider.js5);
        await ServerScriptList.load(CacheProvider.serverJs5[Js5Archive.ServerScripts.id]);
        CacheProvider.watch('data/pack');

        this.server.listen(43594 + this.id, '0.0.0.0');
        setImmediate(this.cycle.bind(this));
    }

    async cycle(): Promise<void> {
        // console.log(`[WORLD]: Tick ${this.tick}`);

        if (CacheProvider.reload && this.tick % 8 === 0) {
            await CacheProvider.load('data/pack', true);
            await ServerScriptList.load(CacheProvider.serverJs5[Js5Archive.ServerScripts.id]);
            console.log('[WORLD]: Cache reloaded');
        }

        // process incoming packets
        for (const player of this.players) {
            if (!player.client) {
                continue;
            }

            const client: ClientSocket = player.client;
            for (let j: number = 0; j < client.netInQueue.length; j++) {
                await this.gameDecode(client, client.netInQueue[j]);
            }

            client.netInQueue = [];
        }

        for (const player of this.players) {
            player.cycle();
        }

        for (const player of this.players) {
            player.updatePlayers();
        }

        // process outgoing packets
        for (const player of this.players) {
            if (!player.client) {
                continue;
            }

            const client: ClientSocket = player.client;

            ServerProt.SERVER_TICK_END.send(client);

            // logout after 15 of the socket being idle (15000ms / 600 tick = 25 ticks)
            if (this.tick - client.lastResponse > 25) {
                this.removeClient(client);
                continue;
            }

            for (let j: number = 0; j < client.netOutQueue.length; j++) {
                client.send(client.netOutQueue[j]);
            }
        }

        this.tick++;
        setTimeout(this.cycle.bind(this), 600);
    }

    addPlayer(pid: number, player: Player): void {
        this.players.set(pid, player);
    }

    removeClient(client: ClientSocket): void {
        client.end();
        const player: Player | null = client.player;
        if (player) {
            player.save();
            this.players.remove(player.pid);
        }
    }
}

if (!parentPort) {
    console.error('World.ts must be run as a worker thread');
    process.exit(1);
}

const world: World = new World();

parentPort.on('message', async (...args: unknown[]): Promise<void> => {
    if (args[0] === 'start') {
        await world.start();
    }
});
