'use strict';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import {gettext as _} from 'gettext';

import {createLogger, getDeviceIdentifier} from '../logger.js';
import {
    buds2to1BatteryLevel, validateProperties, launchConfigureWindow
} from '../deviceUtils.js';
import {BtDeviceState, DeviceManagementAction} from '../commonEmuns.js';
import {createConfig, createProperties, DataHandler} from '../../dataHandler.js';
import {MotoBudsSocket} from './motoBudsSocket.js';
import {
    MotoBudsUUID, MotoBudsAltUUID, MotoBudsConfiguration, AncMode
} from './motoBudsConfig.js';

export const DeviceTypeMotoBuds = 'motoBuds';

export function isMotoBuds(bluezDeviceProxy, uuids) {
    const bluezProps = [];
    const isSupported = uuids.includes(MotoBudsUUID) || uuids.includes(MotoBudsAltUUID);
    const supported = isSupported ? 'yes' : 'no';
    return {supported, bluezProps};
}

export const MotoBudsDevice = GObject.registerClass({
    GTypeName: 'BudsLink_MotoBudsDevice',
}, class MotoBudsDevice extends GObject.Object {
    _init(settings, devicePath, alias, extPath, profileManager, updateDeviceMapCb) {
        super._init();
        const identifier = getDeviceIdentifier(devicePath);
        const tag = `MotoBudsDevice-${identifier}`;
        this._log = createLogger(tag);
        this._log.info('------------------- MotoBudsDevice init -------------------');
        this._settings = settings;
        this._devicePath = devicePath;
        this._alias = alias;
        this._extPath = extPath;
        this.updateDeviceMapCb = updateDeviceMapCb;
        this._ignoreGsettingsChange = false;

        this._config = createConfig();
        this._props = createProperties();
        this._modelData = null;

        this._callbacks = {
            modelInitialized: this.modelInitialized.bind(this),
            updateBatteryProps: this.updateBatteryProps.bind(this),
            updateAncMode: this.updateAncMode.bind(this),
            updateInEarDetection: this.updateInEarDetection.bind(this),
            updateInEarStatus: this.updateInEarStatus.bind(this),
            updateGameMode: this.updateGameMode.bind(this),
            updateHiRes: this.updateHiRes.bind(this),
            updateVolumeBoost: this.updateVolumeBoost.bind(this),
            updateDeviceName: this.updateDeviceName.bind(this),
        };

        const profile = {type: DeviceTypeMotoBuds, uuid: MotoBudsUUID};

        this._socket = new MotoBudsSocket(
            this._devicePath,
            profileManager,
            profile,
            this._callbacks
        );
    }

    modelInitialized(modelData, hwInfo) {
        this._modelData = modelData;
        this._hwInfo = hwInfo;

        this._log.info(`Model Initialized: ${this._modelData.name}`);

        this._commonIcon = this._modelData.budsIcon;
        this._config.battery1ShowOnDisconnect = true;
        this._config.showSettingsButton = true;
        this._caseIcon = this._modelData.caseIcon;

        this._createDefaultSettings();

        const devicesList = this._settings.get_strv('moto-buds-list').map(JSON.parse);

        if (devicesList.length === 0 ||
                !devicesList.some(device => device.path === this._devicePath)) {
            this._addPropsToSettings(devicesList);
        } else {
            validateProperties(this._settings, 'moto-buds-list', devicesList,
                this._defaultsDeviceSettings, this._devicePath);
        }

        this._updateInitialValues();
        this._monitorMotoBudsListGsettings();
        this._updateIcons();
        this._updateAncConfig();
    }

    _createDefaultSettings() {
        this._defaultsDeviceSettings = {
            path: this._devicePath,
            modelId: this._modelData.name,
            alias: this._alias,
            'device-type': DeviceTypeMotoBuds,
            'anc-mode': AncMode.OFF,
            'in-ear-detection': true,
            'game-mode': false,
            'hi-res': false,
            'volume-boost': false,
            'buds-icon': this._modelData.budsIcon,
            'left-bud-icon': this._modelData.leftBudIcon,
            'right-bud-icon': this._modelData.rightBudIcon,
            'case-icon': this._modelData.caseIcon,
        };
    }

    _addPropsToSettings(devicesList) {
        devicesList.push(this._defaultsDeviceSettings);
        this._ignoreGsettingsChange = true;
        this._settings.set_strv('moto-buds-list', devicesList.map(JSON.stringify));
        this._ignoreGsettingsChange = false;
    }

    _updateInitialValues() {
        const devicesList = this._settings.get_strv('moto-buds-list').map(JSON.parse);
        this._settingsItems = devicesList.find(device => device.path === this._devicePath) ?? null;
        if (!this._settingsItems)
            return;

        this._props.radioSelected = this._settingsItems['anc-mode'];
    }

    _monitorMotoBudsListGsettings() {
        this._settingsHandlerId = this._settings.connect('changed::moto-buds-list', () => {
            if (this._ignoreGsettingsChange)
                return;

            const devicesList = this._settings.get_strv('moto-buds-list').map(JSON.parse);
            const items = devicesList.find(device => device.path === this._devicePath);
            if (!items)
                return;

            if (this._settingsItems['anc-mode'] !== items['anc-mode']) {
                this._settingsItems['anc-mode'] = items['anc-mode'];
                this._socket?.setAncMode(items['anc-mode']);
            }

            if (this._settingsItems['game-mode'] !== items['game-mode']) {
                this._settingsItems['game-mode'] = items['game-mode'];
                this._socket?.setGameMode(items['game-mode']);
            }

            if (this._settingsItems['hi-res'] !== items['hi-res']) {
                this._settingsItems['hi-res'] = items['hi-res'];
                this._socket?.setHiRes(items['hi-res']);
            }

            if (this._settingsItems['volume-boost'] !== items['volume-boost']) {
                this._settingsItems['volume-boost'] = items['volume-boost'];
                this._socket?.setVolumeBoost(items['volume-boost']);
            }

            if (this._settingsItems['in-ear-detection'] !== items['in-ear-detection']) {
                this._settingsItems['in-ear-detection'] = items['in-ear-detection'];
                this._socket?.setInEarDetection(items['in-ear-detection']);
            }

            this._settingsItems = items;
            this._updateIcons();
        });
    }

    _updateGsettings(key = null, value = null) {
        if (!this._settingsItems)
            return;

        if (key)
            this._settingsItems[key] = value;

        const devicesList = this._settings.get_strv('moto-buds-list').map(JSON.parse);
        const index = devicesList.findIndex(device => device.path === this._devicePath);
        if (index !== -1) {
            devicesList[index] = this._settingsItems;
            this._ignoreGsettingsChange = true;
            this._settings.set_strv('moto-buds-list', devicesList.map(JSON.stringify));
            this._ignoreGsettingsChange = false;
        }
    }

    _updateIcons() {
        if (!this._settingsItems)
            return;

        this._config.battery1Icon = this._settingsItems['left-bud-icon'] ?? this._modelData.leftBudIcon;
        this._config.battery2Icon = this._settingsItems['right-bud-icon'] ?? this._modelData.rightBudIcon;
        this._config.battery3Icon = this._settingsItems['case-icon'] ?? this._modelData.caseIcon;
        this._commonIcon = this._settingsItems['buds-icon'] ?? this._modelData.budsIcon;

        this.dataHandler?.updateConfig(this._config);
    }

    _updateAncConfig() {
        this._config.showRadioBin = true;
        this._config.radioItems = [
            {label: _('Off'), value: AncMode.OFF, icon: 'bbm-anc-off-symbolic'},
            {label: _('Noise Cancellation'), value: AncMode.ANC, icon: 'bbm-anc-on-symbolic'},
            {label: _('Transparency'), value: AncMode.TRANSPARENCY, icon: 'bbm-transperancy-symbolic'},
        ];

        this.dataHandler?.updateConfig(this._config);
    }

    updateBatteryProps(props) {
        Object.assign(this._props, props);

        if (!this._battInfoRecieved) {
            this._battInfoRecieved = true;
            this._initDataHandler();
        } else {
            this.dataHandler?.updateProps(this._props);
        }
    }

    updateAncMode(mode) {
        this._props.radioSelected = mode;
        if (this._settingsItems && this._settingsItems['anc-mode'] !== mode) {
            this._settingsItems['anc-mode'] = mode;
            this._updateGsettings();
        }
        this.dataHandler?.updateProps(this._props);
    }

    updateInEarDetection(enabled) {
        if (this._settingsItems && this._settingsItems['in-ear-detection'] !== enabled) {
            this._settingsItems['in-ear-detection'] = enabled;
            this._updateGsettings();
        }
    }

    updateInEarStatus(status) {
        this._props.inEarL = status.left;
        this._props.inEarR = status.right;
        this.dataHandler?.updateProps(this._props);
    }

    updateGameMode(enabled) {
        if (this._settingsItems && this._settingsItems['game-mode'] !== enabled) {
            this._settingsItems['game-mode'] = enabled;
            this._updateGsettings();
        }
    }

    updateHiRes(enabled) {
        if (this._settingsItems && this._settingsItems['hi-res'] !== enabled) {
            this._settingsItems['hi-res'] = enabled;
            this._updateGsettings();
        }
    }

    updateVolumeBoost(enabled) {
        if (this._settingsItems && this._settingsItems['volume-boost'] !== enabled) {
            this._settingsItems['volume-boost'] = enabled;
            this._updateGsettings();
        }
    }

    updateDeviceName(name) {
        if (name && name !== this._alias) {
            this._alias = name;
            if (this._settingsItems) {
                this._settingsItems.alias = name;
                this._updateGsettings();
            }
        }
    }

    _initDataHandler() {
        this.dataHandler = new DataHandler(
            this._config,
            this._props,
            this._alias,
            this._commonIcon,
            this._caseIcon
        );

        this._dataHandlerId = this.dataHandler.connect('action', (_emitter, action, value) => {
            if (action === DeviceManagementAction.RADIO) {
                this._socket?.setAncMode(value);
                this._props.radioSelected = value;
                this._updateGsettings('anc-mode', value);
                this.dataHandler?.updateProps(this._props);
            } else if (action === DeviceManagementAction.SETTINGS) {
                launchConfigureWindow(this._devicePath, DeviceTypeMotoBuds);
            }
        });

        this.updateDeviceMapCb(this._devicePath, this.dataHandler);
    }

    destroy() {
        this._socket?.destroy();
        this._socket = null;

        if (this._dataHandlerId) {
            this.dataHandler?.disconnect(this._dataHandlerId);
            this._dataHandlerId = null;
        }

        this.dataHandler = null;

        if (this._settingsHandlerId) {
            this._settings?.disconnect(this._settingsHandlerId);
            this._settingsHandlerId = null;
        }

        this._settings = null;
        this._battInfoRecieved = false;
    }
});
