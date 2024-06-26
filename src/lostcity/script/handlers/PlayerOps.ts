import ServerProt from '#jagex/network/protocol/ServerProt.js';
import ServerScriptCommand from '../ServerScriptCommands.js';
import ServerScriptState from '../ServerScriptState.js';

ServerScriptCommand.IF_OPENTOP.handler = (state: ServerScriptState): void => {
    const ifId: number = state.popInt();
    ServerProt.IF_OPENTOP.send(state._activePlayer!.client!, ifId);
};

ServerScriptCommand.IF_OPENSUB.handler = (state: ServerScriptState): void => {
    const [ifCom, child, type] = state.popInts(3);
    const ifId: number = ifCom >> 16;
    const comId: number = ifCom & 0xFFFF;
    ServerProt.IF_OPENSUB.send(state._activePlayer!.client!, ifId, comId, child, type);
};
