/* eslint-disable @typescript-eslint/no-explicit-any */

import fastify from 'fastify';

import CacheProvider from '#lostcity/server/CacheProvider.js';

const app: fastify.FastifyInstance = fastify({ logger: true });
app.get('/clienterror.ws', (req: any, res: any): void => {
    const { c: client, cs: clientSub, u: user, v1: version1, v2: version2, e: error } = req.query;

    console.error(`${client}.${clientSub} - ${user} - ${version1} ${version2}: ${error}`);
    res.send('');
});

app.get('/ms', async (req: any, res: any): Promise<void> => {
    const { m, a: archive, g: group, cb, c: checksum, v: version } = req.query;

    const data: Uint8Array | null = await CacheProvider.getGroup(parseInt(archive), parseInt(group), true);
    if (!data) {
        res.status(404);
        return;
    }

    res.header('Content-Type', 'application/octet-stream');
    res.header('Content-Disposition', `attachment; filename=${archive}_${group}.dat`);
    res.send(data);
});

export default function startWeb(): void {
    app.listen({
        port: 80,
        host: '0.0.0.0'
    });
}
