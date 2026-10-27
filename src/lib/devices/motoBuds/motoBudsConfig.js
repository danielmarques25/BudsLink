'use strict';

export const MotoBudsUUID = 'fc9d9fe0-4899-11ee-be56-0242ac120002';
export const MotoBudsAltUUID = '1a2b0100-4899-11ee-be56-0242ac120002';

export const MotoBudsConfiguration = [
    {
        name: 'moto buds 2',
        modelCodes: ['XT2643-1', 'moto buds 2', 'guitar'],
        budsIcon: 'bbm-earbuds-flatstem-symbolic',
        leftBudIcon: 'bbm-earbuds-flatstem-left-symbolic',
        rightBudIcon: 'bbm-earbuds-flatstem-right-symbolic',
        caseIcon: 'bbm-case-oval-symbolic',
        ancModes: [0, 1, 2], // 0: Off, 1: ANC, 2: Transparency
        ancLabels: ['Off', 'ANC', 'Transparency'],
        inEarDetection: true,
        gameMode: true,
        hiRes: true,
        volumeBoost: true,
    },
    {
        name: 'moto buds',
        modelCodes: ['XT2443-1', 'moto buds'],
        budsIcon: 'bbm-earbuds-flatstem-symbolic',
        leftBudIcon: 'bbm-earbuds-flatstem-left-symbolic',
        rightBudIcon: 'bbm-earbuds-flatstem-right-symbolic',
        caseIcon: 'bbm-case-oval-symbolic',
        ancModes: [0, 1, 2],
        ancLabels: ['Off', 'ANC', 'Transparency'],
        inEarDetection: true,
        gameMode: true,
        hiRes: true,
        volumeBoost: true,
    },
    {
        name: 'moto buds+',
        modelCodes: ['XT2441-1', 'moto buds+'],
        budsIcon: 'bbm-earbuds-flatstem-symbolic',
        leftBudIcon: 'bbm-earbuds-flatstem-left-symbolic',
        rightBudIcon: 'bbm-earbuds-flatstem-right-symbolic',
        caseIcon: 'bbm-case-oval-symbolic',
        ancModes: [0, 1, 2],
        ancLabels: ['Off', 'ANC', 'Transparency'],
        inEarDetection: true,
        gameMode: true,
        hiRes: true,
        volumeBoost: true,
        spatialAudio: true,
    },
];

export const Opcode = {
    GET_PROFILE_VERSION: 0x0000,
    GET_FEATURES: 0x0001,
    GET_NAME: 0x0003,
    GET_HARDWARE_INFO: 0x0004,
    GET_BATTERY: 0x0005,
    BATTERY_CHANGED: 0x0009,
    GET_CONFIGS: 0x000B,
    GET_ANC: 0x0200,
    SET_ANC: 0x0201,
    ANC_CHANGED: 0x0204,
    GET_HI_RES: 0x030C,
    SET_HI_RES: 0x030D,
    HI_RES_CHANGED: 0x0311,
    GET_GAME_MODE: 0x030E,
    SET_GAME_MODE: 0x030F,
    GAME_MODE_CHANGED: 0x0312,
    GET_VOLUME_BOOST: 0x0313,
    SET_VOLUME_BOOST: 0x0314,
    VOLUME_BOOST_CHANGED: 0x0315,
    GET_IN_EAR: 0x0402,
    SET_IN_EAR: 0x0403,
    IN_EAR_STATUS_CHANGED: 0x0404,
    SET_FMD_STATE: 0x0405,
    IN_CASE_INDICATION: 0x040C,
};

export const AncMode = {
    OFF: 0,
    ANC: 1,
    TRANSPARENCY: 2,
};

export function crc32(buffer, length) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if ((crc & 1) !== 0) {
                crc = (crc >>> 1) ^ 0xEDB88320;
            } else {
                crc >>>= 1;
            }
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function buildPDU(opcode, type, seq, payload = []) {
    const payloadLen = payload.length;
    const bufferLen = 14 + payloadLen + 8;
    const buf = new Uint8Array(bufferLen);
    const dataView = new DataView(buf.buffer);

    // HEAD: 0x48 0x45 0x41 0x44 ("HEAD")
    buf[0] = 0x48;
    buf[1] = 0x45;
    buf[2] = 0x41;
    buf[3] = 0x44;

    // Total Length (Little-Endian): 8 + payloadLen
    dataView.setUint16(4, 8 + payloadLen, true);

    // Opcode (Big-Endian)
    dataView.setUint16(6, opcode, false);

    // Type
    buf[8] = type;

    // Result
    buf[9] = 0;

    // Payload Length (Little-Endian)
    dataView.setUint16(10, payloadLen, true);

    // Seq (Little-Endian)
    dataView.setUint16(12, seq, true);

    // Payload
    for (let i = 0; i < payloadLen; i++) {
        buf[14 + i] = payload[i];
    }

    // CRC32 over all preceding bytes from HEAD to end of payload
    const crcTarget = buf.subarray(0, 14 + payloadLen);
    const crc = crc32(crcTarget, crcTarget.length);
    dataView.setUint32(14 + payloadLen, crc, true);

    // TAIL: 0x54 0x41 0x49 0x4C ("TAIL")
    buf[14 + payloadLen + 4] = 0x54;
    buf[14 + payloadLen + 5] = 0x41;
    buf[14 + payloadLen + 6] = 0x49;
    buf[14 + payloadLen + 7] = 0x4C;

    return buf;
}

export function parsePDU(buffer) {
    if (buffer.length < 22) return null;
    if (buffer[0] !== 0x48 || buffer[1] !== 0x45 || buffer[2] !== 0x41 || buffer[3] !== 0x44) {
        return null;
    }

    const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const totalLen = dataView.getUint16(4, true);
    const opcode = dataView.getUint16(6, false);
    const type = buffer[8];
    const result = buffer[9];
    const payloadLen = dataView.getUint16(10, true);
    const seq = dataView.getUint16(12, true);

    const payload = [];
    for (let i = 0; i < payloadLen; i++) {
        payload.push(buffer[14 + i]);
    }

    return { opcode, type, result, seq, payload };
}
