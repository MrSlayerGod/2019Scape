import fs from 'fs';

import Js5 from '#jagex/js5/Js5.js';
import Js5Archive, { Js5ArchiveType } from '#jagex/config/Js5Archive.js';
import Js5Index from '#jagex/js5/index/Js5Index.js';

import Packet from '#jagex/bytepacking/Packet.js';

import Whirlpool from '#jagex/encryption/Whirlpool.js';

export default class Cache {
    js5: Js5[] = [];
    serverJs5: Js5[] = [];

    prefetches: number[] = [];
    masterIndexIndex: Uint8Array | null = null;

    reload: boolean = false;
    reloadClient: boolean = true;
    reloadServer: boolean = true;

    watch(dir: string): void {
        fs.watch(dir, { }, (event: string, filename: string | Buffer | null): void => {
            if (typeof filename === 'string' && filename.endsWith('.js5')) {
                this.reload = true;

                if (filename.startsWith('client')) {
                    this.reloadClient = true;
                } else if (filename.startsWith('server')) {
                    this.reloadServer = true;
                }
            }
        });
    }

    async load(dir: string, patch: boolean = true): Promise<void> {
        if (!this.reload && this.masterIndexIndex !== null) {
            return;
        }

        this.reload = false;

        if (this.reloadClient) {
            this.reloadClient = false;

            for (let archive: number = 0; archive < Js5Archive.getMaxId(); archive++) {
                const type: Js5Archive | null = Js5Archive.forId(archive);

                if (type !== null) {
                    this.js5[type.id] = await Js5.load(`${dir}/client.${type.name}.js5`, patch);
                }
            }

            await this.generateMasterIndexIndex();
            this.generatePrefetches();
        }

        if (this.reloadServer) {
            this.reloadServer = false;

            this.serverJs5[Js5Archive.ServerScripts.id] = await Js5.load(`${dir}/server.scripts.js5`, false, false);
        }
    }

    async getGroup(archive: number, group: number, raw: boolean = false): Promise<Uint8Array | null> {
        if (archive === Js5ArchiveType.ArchiveSet && group === Js5ArchiveType.ArchiveSet) {
            return this.masterIndexIndex;
        } else if (archive === Js5ArchiveType.ArchiveSet) {
            if (typeof this.js5[group] !== 'undefined') {
                return this.js5[group].masterIndex;
            }
        } else {
            if (raw) {
                return this.js5[archive].readRaw(group);
            } else {
                return await this.js5[archive].readGroup(group);
            }
        }

        return null;
    }

    async generateMasterIndexIndex(format: number = 7): Promise<void> {
        const buf: Packet = Packet.alloc(1);
        if (format >= 7) {
            buf.p1(Js5Archive.getMaxId());
        }

        for (let i: number = 0; i < Js5Archive.getMaxId(); i++) {
            const masterIndexData: Uint8Array | null = await this.getGroup(255, i);
            if (!masterIndexData) {
                buf.p4(0);
                if (format >= 6) {
                    buf.p4(0);
                }
                if (format >= 7) {
                    buf.p4(0);
                    buf.p4(0);
                    buf.pdata(new Uint8Array(64), 0, 64);
                }
                continue;
            }

            const index: Js5Index = this.js5[i].index;
            const e: Uint8Array = index.encodeForMasterIndex();
            buf.pdata(e, 0, e.length);
        }

        if (format >= 7) {
            const hashBuf: Packet = new Packet(new Uint8Array(64 + 1));
            hashBuf.p1(0);
            const whirlpool: Uint8Array = await Whirlpool.compute(buf.data.slice(0, buf.pos));
            hashBuf.pdata(whirlpool, 0, whirlpool.length);
            // todo: encrypt here
            buf.pdata(hashBuf.data, 0, hashBuf.pos);
        }

        const js5Buf: Packet = new Packet(new Uint8Array(buf.pos + 5));
        js5Buf.p1(0);
        js5Buf.p4(buf.pos);
        js5Buf.pdata(buf.data, 0, buf.pos);
        buf.release();

        this.masterIndexIndex = js5Buf.data;
    }

    generatePrefetches(): void {
        this.prefetches.push(this.js5[Js5ArchiveType.Defaults].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.Dlls].getPrefetchGroup('windows/x86/jaclib.dll'));
        this.prefetches.push(this.js5[Js5ArchiveType.Dlls].getPrefetchGroup('windows/x86/jaggl.dll'));
        this.prefetches.push(this.js5[Js5ArchiveType.Dlls].getPrefetchGroup('windows/x86/jagdx.dll'));
        this.prefetches.push(this.js5[Js5ArchiveType.Dlls].getPrefetchGroup('windows/x86/sw3d.dll'));
        this.prefetches.push(this.js5[Js5ArchiveType.Dlls].getPrefetchGroup('RuneScape-Setup.exe'));
        this.prefetches.push(this.js5[Js5ArchiveType.Dlls].getPrefetchGroup('windows/x86/hw3d.dll'));
        this.prefetches.push(this.js5[Js5ArchiveType.Shaders].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.Materials].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.Config].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigLoc].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigEnum].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigNpc].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigObj].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigSeq].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigSpot].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigStruct].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.DbTableIndex].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.QuickChat].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.QuickChatGlobal].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigParticle].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ConfigBillboard].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.Binary].getPrefetchGroup('huffman'));
        this.prefetches.push(this.js5[Js5ArchiveType.Interfaces].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.ClientScripts].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.FontMetrics].getPrefetchArchive());
        this.prefetches.push(this.js5[Js5ArchiveType.WorldMapData].getPrefetchGroup(0));
    }
}
