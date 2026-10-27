'use strict';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {createLogger, getDeviceIdentifier, hexBytes} from '../logger.js';
import {SocketHandler} from '../socketByProfile.js';
import {
    Opcode, buildPDU, parsePDU, AncMode, MotoBudsConfiguration
} from './motoBudsConfig.js';

const TX_INTERVAL_MS = 200;

export const MotoBudsSocket = GObject.registerClass({
    GTypeName: 'BudsLink_MotoBudsSocket',
}, class MotoBudsSocket extends SocketHandler {
    _init(devicePath, profileManager, profile, callbacks) {
        super._init(devicePath, profileManager, profile);
        const identifier = getDeviceIdentifier(devicePath);
        this._log = createLogger(`MotoBudsSocket-${identifier}`);
        this._log.info('MotoBudsSocket init');

        this._callbacks = callbacks;
        this._rxBuffer = [];
        this._txQueue = [];
        this._txTimeoutId = null;
        this._seq = 1;

        this.startSocket();
    }

    postConnectInitialization() {
        this.requestDeviceIdentification();
        this.requestBattery();
        this.requestAnc();
        this.requestInEar();
    }

    _send(opcode, payload = [], tag = null) {
        const seq = this._seq++;
        const packet = buildPDU(opcode, 0x80, seq, payload);

        const queued = tag ? this._txQueue.findIndex(item => item.tag === tag) : -1;
        if (queued !== -1)
            this._txQueue[queued] = {packet, tag};
        else
            this._txQueue.push({packet, tag});

        this._pumpTx();
    }

    _pumpTx() {
        if (this._txTimeoutId || this._txQueue.length === 0)
            return;

        const item = this._txQueue.shift();
        this.sendMessage(item.packet);

        this._txTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TX_INTERVAL_MS, () => {
            this._txTimeoutId = null;
            this._pumpTx();
            return GLib.SOURCE_REMOVE;
        });
    }

    requestDeviceIdentification() {
        this._send(Opcode.GET_NAME, [], 'get-name');
        this._send(Opcode.GET_HARDWARE_INFO, [], 'get-hw-info');
    }

    requestBattery() {
        this._send(Opcode.GET_BATTERY, [], 'get-battery');
    }

    requestAnc() {
        this._send(Opcode.GET_ANC, [], 'get-anc');
    }

    requestInEar() {
        this._send(Opcode.GET_IN_EAR, [], 'get-in-ear');
    }

    setAncMode(mode, subMode = 0) {
        this._send(Opcode.SET_ANC, [mode, subMode], 'set-anc');
    }

    setGameMode(enabled) {
        this._send(Opcode.SET_GAME_MODE, [enabled ? 1 : 0], 'set-game-mode');
    }

    setHiRes(enabled) {
        this._send(Opcode.SET_HI_RES, [enabled ? 1 : 0], 'set-hi-res');
    }

    setVolumeBoost(enabled) {
        this._send(Opcode.SET_VOLUME_BOOST, [enabled ? 1 : 0], 'set-vol-boost');
    }

    setInEarDetection(enabled) {
        this._send(Opcode.SET_IN_EAR, [enabled ? 1 : 0], 'set-in-ear');
    }

    processData(bytes) {
        for (let i = 0; i < bytes.length; i++)
            this._rxBuffer.push(bytes[i]);

        while (this._rxBuffer.length >= 22) {
            const start = this._rxBuffer.findIndex((b, idx) =>
                b === 0x48 &&
                this._rxBuffer[idx + 1] === 0x45 &&
                this._rxBuffer[idx + 2] === 0x41 &&
                this._rxBuffer[idx + 3] === 0x44);

            if (start === -1) {
                this._rxBuffer = [];
                return;
            }

            if (start > 0)
                this._rxBuffer.splice(0, start);

            if (this._rxBuffer.length < 22)
                return;

            const dataView = new DataView(new Uint8Array(this._rxBuffer).buffer);
            const totalLen = dataView.getUint16(4, true); // 8 + payloadLen
            const fullFrameLen = 14 + (totalLen - 8) + 8;

            if (this._rxBuffer.length < fullFrameLen)
                return;

            const frame = new Uint8Array(this._rxBuffer.splice(0, fullFrameLen));
            const pdu = parsePDU(frame);

            if (pdu) {
                try {
                    this._handlePdu(pdu);
                } catch (e) {
                    this._log.error(e, `Error handling PDU: ${pdu.opcode}`);
                }
            }
        }
    }

    _handlePdu(pdu) {
        switch (pdu.opcode) {
            case Opcode.GET_NAME:
                this._handleName(pdu.payload);
                break;
            case Opcode.GET_HARDWARE_INFO:
                this._handleHardwareInfo(pdu.payload);
                break;
            case Opcode.GET_BATTERY:
            case Opcode.BATTERY_CHANGED:
                this._handleBattery(pdu.payload);
                break;
            case Opcode.GET_ANC:
            case Opcode.ANC_CHANGED:
                this._handleAnc(pdu.payload);
                break;
            case Opcode.GET_IN_EAR:
                if (pdu.payload.length >= 1)
                    this._callbacks.updateInEarDetection?.(pdu.payload[0] === 1);
                break;
            case Opcode.IN_EAR_STATUS_CHANGED:
                if (pdu.payload.length >= 2) {
                    this._callbacks.updateInEarStatus?.({
                        left: pdu.payload[0] === 1,
                        right: pdu.payload[1] === 1,
                    });
                }
                break;
            case Opcode.GET_GAME_MODE:
            case Opcode.GAME_MODE_CHANGED:
                if (pdu.payload.length >= 1)
                    this._callbacks.updateGameMode?.(pdu.payload[0] === 1);
                break;
            case Opcode.GET_HI_RES:
            case Opcode.HI_RES_CHANGED:
                if (pdu.payload.length >= 1)
                    this._callbacks.updateHiRes?.(pdu.payload[0] === 1);
                break;
            case Opcode.GET_VOLUME_BOOST:
            case Opcode.VOLUME_BOOST_CHANGED:
                if (pdu.payload.length >= 1)
                    this._callbacks.updateVolumeBoost?.(pdu.payload[0] === 1);
                break;
            default:
                break;
        }
    }

    _handleName(payload) {
        const text = String.fromCharCode(...payload.filter(c => c > 0 && c < 128)).trim();
        if (text) {
            this._log.info(`Device name reported: ${text}`);
            this._callbacks.updateDeviceName?.(text);
        }
    }

    _handleHardwareInfo(payload) {
        const text = String.fromCharCode(...payload.filter(c => c >= 32 && c <= 126)).trim();
        this._log.info(`Hardware info: ${text}`);

        // Try to match model code, e.g. XT2643-1, XT2443-1, XT2441-1
        let matchedConfig = null;
        for (const config of MotoBudsConfiguration) {
            if (config.modelCodes.some(code => text.includes(code))) {
                matchedConfig = config;
                break;
            }
        }

        if (!matchedConfig)
            matchedConfig = MotoBudsConfiguration[0]; // Fallback to moto buds 2

        this._callbacks.modelInitialized?.(matchedConfig, text);
    }

    _handleBattery(payload) {
        if (payload.length < 3)
            return;

        const rawL = payload[0];
        const rawR = payload[1];
        const rawCase = payload[2];

        const leftLevel = (rawL & 0x7F) > 100 ? null : (rawL & 0x7F);
        const rightLevel = (rawR & 0x7F) > 100 ? null : (rawR & 0x7F);
        const caseLevel = (rawCase & 0x7F) > 100 ? null : (rawCase & 0x7F);

        const leftCharging = (rawL & 0x80) > 0;
        const rightCharging = (rawR & 0x80) > 0;
        const caseCharging = (rawCase & 0x80) > 0;

        this._callbacks.updateBatteryProps?.({
            battery1Level: leftLevel,
            battery1Status: leftCharging ? 'charging' : 'discharging',
            battery2Level: rightLevel,
            battery2Status: rightCharging ? 'charging' : 'discharging',
            battery3Level: caseLevel,
            battery3Status: caseCharging ? 'charging' : 'discharging',
        });
    }

    _handleAnc(payload) {
        if (payload.length < 1)
            return;

        const mode = payload[0]; // 0: Off, 1: ANC, 2: Transparency
        this._callbacks.updateAncMode?.(mode);
    }

    destroy() {
        if (this._txTimeoutId) {
            GLib.source_remove(this._txTimeoutId);
            this._txTimeoutId = null;
        }
        this._txQueue = [];
        this._rxBuffer = [];
        super.destroy();
    }
});
