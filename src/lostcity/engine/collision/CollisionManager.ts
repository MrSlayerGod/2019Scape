import {Js5ArchiveType} from '#jagex/config/Js5Archive.js';
import Js5 from '#jagex/js5/Js5.js';
import Js5MapFile from '#jagex/js5/Js5MapFile.js';
import Packet from '#jagex/bytepacking/Packet.js';
import LocType from '#jagex/config/loctype/LocType.js';

import {
    allocateIfAbsent,
    changeFloor,
    changeLoc,
    changeNpc,
    changePlayer,
    changeRoof,
    changeWall, LocAngle, LocLayer,
    LocShape, locShapeLayer
} from '@2004scape/rsmod-pathfinder';

export default class CollisionManager {
    init = async (js5: Js5[]): Promise<void> => {
        console.time('Loading collision');

        const maps: Js5 = js5[Js5ArchiveType.Maps];
        const groups: Int32Array | null = maps.getGroupIds();
        if (groups === null) {
            throw new Error('[CollisionManager] Unable to find Js5 Maps group ids.');
        }
        for (let index: number = 0; index < groups.length; index++) {
            const groupId: number = groups[index];
            // land is required for anything else.
            if (!maps.isFileValid(groupId, Js5MapFile.LAND)) {
                continue;
            }

            const mapsquareX: number = (groupId & 0x7f) << 6;
            const mapsquareZ: number = (groupId >> 7) << 6;

            const lands: Int8Array = new Int8Array(4 * 64 * 64); // 4 * 64 * 64 size is guaranteed for lands
            const land: Uint8Array | null = await maps.readFile(groupId, Js5MapFile.LAND);
            if (land) {
                this.decodeLands(lands, new Packet(land), mapsquareX, mapsquareZ);
            }
            const loc: Uint8Array | null = await maps.readFile(groupId, Js5MapFile.LOC);
            if (loc) {
                await this.decodeLocs(js5, lands, new Packet(loc), mapsquareX, mapsquareZ);
            }
        }

        console.timeEnd('Loading collision');
    };

    changeLandCollision(x: number, z: number, level: number, add: boolean): void {
        changeFloor(x, z, level, add);
    }

    changeLocCollision(shape: LocShape, angle: number, blockrange: boolean, breakroutefinding: boolean, length: number, width: number, active: number, x: number, z: number, level: number, add: boolean): void {
        const locLayer: LocLayer = locShapeLayer(shape);
        if (locLayer === LocLayer.WALL) {
            changeWall(x, z, level, angle, shape, blockrange, breakroutefinding, add);
        } else if (locLayer === LocLayer.GROUND) {
            if (angle === LocAngle.NORTH || angle === LocAngle.SOUTH) {
                changeLoc(x, z, level, length, width, blockrange, breakroutefinding, add);
            } else {
                changeLoc(x, z, level, width, length, blockrange, breakroutefinding, add);
            }
        } else if (locLayer === LocLayer.GROUND_DECOR) {
            if (active === 1) {
                changeFloor(x, z, level, add);
            }
        }
    }

    changeNpcCollision(size: number, x: number, z: number, level: number, add: boolean): void {
        changeNpc(x, z, level, size, add);
    }

    changePlayerCollision(size: number, x: number, z: number, level: number, add: boolean): void {
        changePlayer(x, z, level, size, add);
    }

    changeRoofCollision(x: number, z: number, level: number, add: boolean): void {
        changeRoof(x, z, level, add);
    }

    private decodeLands(lands: Int8Array, buf: Packet, mapsquareX: number, mapsquareZ: number): void {
        for (let level: number = 0; level < 4; level++) {
            for (let x: number = 0; x < 64; x++) {
                for (let z: number = 0; z < 64; z++) {
                    const opcode: number = buf.g1();
                    if ((opcode & 0x1) !== 0) {
                        buf.pos++;
                        buf.gSmart1or2();
                    }
                    if ((opcode & 0x2) !== 0) {
                        lands[this.packCoord(x, z, level)] = buf.g1b();
                    }
                    if ((opcode & 0x4) !== 0) {
                        buf.gSmart1or2();
                    }
                    if ((opcode & 0x8) !== 0) {
                        buf.pos++;
                    }
                }
            }
        }
        this.applyLandCollision(mapsquareX, mapsquareZ, lands);
    }

    private applyLandCollision(mapsquareX: number, mapsquareZ: number, lands: Int8Array): void {
        for (let level: number = 0; level < 4; level++) {
            for (let x: number = 0; x < 64; x++) {
                const absoluteX: number = x + mapsquareX;

                for (let z: number = 0; z < 64; z++) {
                    const absoluteZ: number = z + mapsquareZ;

                    if (x % 7 === 0 && z % 7 === 0) { // allocate per zone
                        allocateIfAbsent(absoluteX, absoluteZ, level);
                    }

                    const land: number = lands[this.packCoord(x, z, level)];
                    if ((land & 0x4) !== 0) {
                        this.changeRoofCollision(absoluteX, absoluteZ, level, true);
                    }
                    if ((land & 0x1) !== 1) {
                        continue;
                    }

                    const bridged: boolean = (level === 1 ? land & 0x2 : lands[this.packCoord(x, z, 1)] & 0x2) === 2;
                    const actualLevel: number = bridged ? level - 1 : level;
                    if (actualLevel < 0) {
                        continue;
                    }

                    this.changeLandCollision(absoluteX, absoluteZ, actualLevel, true);
                }
            }
        }
    }

    private async decodeLocs(js5: Js5[], lands: Int8Array, buf: Packet, mapsquareX: number, mapsquareZ: number): Promise<void> {
        let locId: number = -1;
        let locIdOffset: number = buf.gExtended1or2();

        while (locIdOffset !== 0) {
            locId += locIdOffset;

            let coord: number = 0;
            let coordOffset: number = buf.gSmart1or2();

            while (coordOffset !== 0) {
                const {x, z, level} = this.unpackCoord(coord += coordOffset - 1);

                const info: number = buf.g1();
                if ((info & 0x80) !== 0) {
                    const scalerottrans: number = buf.g1();
                    if ((scalerottrans & 0x1) !== 0) {
                        buf.pos += 8;
                    }
                    if ((scalerottrans & 0x2) !== 0) {
                        buf.pos += 2;
                    }
                    if ((scalerottrans & 0x4) !== 0) {
                        buf.pos += 2;
                    }
                    if ((scalerottrans & 0x8) !== 0) {
                        buf.pos += 2;
                    }
                    if ((scalerottrans & 0x10) === 0) {
                        if ((scalerottrans & 0x20) !== 0) {
                            buf.pos += 2;
                        }
                        if ((scalerottrans & 0x40) !== 0) {
                            buf.pos += 2;
                        }
                        if ((scalerottrans & 0x80) !== 0) {
                            buf.pos += 2;
                        }
                    } else {
                        buf.pos += 2;
                    }
                }

                coordOffset = buf.gSmart1or2();

                const bridged: boolean = (level === 1 ? lands[coord] & 0x2 : lands[this.packCoord(x, z, 1)] & 0x2) === 2;
                const actualLevel: number = bridged ? level - 1 : level;
                if (actualLevel < 0) {
                    continue;
                }

                const type: LocType = await LocType.list(locId, js5);
                const width: number = type.width;
                const length: number = type.length;
                const shape: number = info >> 2 & 0x1f;
                const angle: number = info & 0x3;

                const absoluteX: number = x + mapsquareX;
                const absoluteZ: number = z + mapsquareZ;

                if (type.blockwalk === 1) {
                    this.changeLocCollision(shape, angle, type.blockrange, type.breakroutefinding, length, width, type.active, absoluteX, absoluteZ, actualLevel, true);
                }
            }
            locIdOffset = buf.gExtended1or2();
        }
    }

    private packCoord(x: number, z: number, level: number): number {
        return (z & 0x3f) | ((x & 0x3f) << 6) | ((level & 0x3) << 12);
    }

    private unpackCoord(packed: number): { level: number; x: number; z: number } {
        const z: number = packed & 0x3f;
        const x: number = (packed >> 6) & 0x3f;
        const level: number = (packed >> 12) & 0x3;
        return { x, z, level };
    }
}