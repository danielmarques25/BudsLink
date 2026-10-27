'use strict';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import {gettext as _} from 'gettext';

import {
    supportedAudioSingleIcons, supportedCaseIcons
} from '../../../lib/widgets/iconGroups.js';
import {IconSelectorWidget} from './../../widgets/iconSelectorWidget.js';
import {DropDownRowWidget} from './../../widgets/dropDownRowWidget.js';
import {
    MotoBudsConfiguration, AncMode
} from '../../../lib/devices/motoBuds/motoBudsConfig.js';

const SettingsKey = 'moto-buds-list';

export const ConfigureWindow = GObject.registerClass({
    GTypeName: 'BudsLink_MotoBudsConfigureWindow',
}, class ConfigureWindow extends Adw.Window {
    _init(settings, mac, devicePath, parentWindow, modal = false) {
        super._init({
            default_width: 650,
            default_height: 700,
            width_request: 320,
            height_request: 100,
            modal,
            transient_for: parentWindow ?? null,
        });

        this._settings = settings;
        this._devicePath = devicePath;
        this._switches = {};
        this._dropdowns = {};

        this._settingsItems = this._readSettingsItems();
        if (!this._settingsItems)
            return;

        this._modelData = MotoBudsConfiguration.find(m =>
            m.name === this._settingsItems.modelId) ?? MotoBudsConfiguration[0];

        this.title = this._settingsItems.alias ?? 'Moto Buds';

        const stack = new Adw.ViewStack();
        const toolViewBar = new Adw.ToolbarView();
        const headerBar = new Adw.HeaderBar();
        const switcherTitle = new Adw.WindowTitle({title: this.title, subtitle: ''});
        headerBar.set_title_widget(switcherTitle);
        const switcherBar = new Adw.ViewSwitcherBar({stack, reveal: true});

        toolViewBar.add_top_bar(headerBar);
        toolViewBar.add_bottom_bar(switcherBar);
        toolViewBar.set_content(stack);
        this.set_content(toolViewBar);
        this._switcherTitle = switcherTitle;

        const soundPage = new Adw.PreferencesPage();
        const devicePage = new Adw.PreferencesPage();
        stack.add_titled_with_icon(soundPage, 'sound', _('Sound & Features'), 'bbm-eq-symbolic');
        stack.add_titled_with_icon(devicePage, 'device', _('Device & Appearance'), 'bbm-settings-symbolic');

        this._addSoundPage(soundPage);
        this._addDevicePage(devicePage, mac);

        this._settingsSignalId = this._settings.connect(`changed::${SettingsKey}`, () => {
            this._settingsItems = this._readSettingsItems();
            if (!this._settingsItems)
                return;

            this.title = this._settingsItems.alias;
            this._switcherTitle.title = this._settingsItems.alias;

            for (const [key, row] of Object.entries(this._switches))
                row.active = this._settingsItems[key];

            for (const [key, row] of Object.entries(this._dropdowns))
                row.selected_item = this._settingsItems[key];
        });
    }

    _addSoundPage(page) {
        const ancGroup = new Adw.PreferencesGroup({
            title: _('Noise Control'),
            description: _('Active Noise Cancellation and transparency modes'),
        });
        page.add(ancGroup);

        this._addDropdown(
            ancGroup,
            'anc-mode',
            _('Noise Control Mode'),
            '',
            [_('Off'), _('Noise Cancellation'), _('Transparency')],
            [AncMode.OFF, AncMode.ANC, AncMode.TRANSPARENCY]
        );

        const featuresGroup = new Adw.PreferencesGroup({
            title: _('Smart Features'),
            description: _('Audio enhancements and device behaviors'),
        });
        page.add(featuresGroup);

        if (this._modelData.inEarDetection) {
            this._addSwitch(
                featuresGroup,
                'in-ear-detection',
                _('In-Ear Detection'),
                _('Automatically pause/resume playback when removing or inserting earbuds')
            );
        }

        if (this._modelData.gameMode) {
            this._addSwitch(
                featuresGroup,
                'game-mode',
                _('Game Mode (Low Latency)'),
                _('Reduces audio latency during gaming and media streaming')
            );
        }

        if (this._modelData.hiRes) {
            this._addSwitch(
                featuresGroup,
                'hi-res',
                _('Hi-Res Audio (LDAC)'),
                _('High fidelity Bluetooth audio streaming')
            );
        }

        if (this._modelData.volumeBoost) {
            this._addSwitch(
                featuresGroup,
                'volume-boost',
                _('Volume Boost'),
                _('Amplifies the maximum output volume')
            );
        }
    }

    _addDevicePage(page, mac) {
        const infoGroup = new Adw.PreferencesGroup({title: _('Information')});
        page.add(infoGroup);

        const macRow = new Adw.ActionRow({title: _('MAC Address'), subtitle: mac});
        infoGroup.add(macRow);

        const modelRow = new Adw.ActionRow({title: _('Model'), subtitle: this._modelData.name});
        infoGroup.add(modelRow);

        const iconGroup = new Adw.PreferencesGroup({
            title: _('Icons'),
            description: _('Customize panel and tray icons for your earbuds'),
        });
        page.add(iconGroup);

        this._addIconSelector(iconGroup, 'buds-icon', _('Earbuds Icon'),
            supportedAudioSingleIcons, this._modelData.budsIcon);
        this._addIconSelector(iconGroup, 'case-icon', _('Case Icon'),
            supportedCaseIcons, this._modelData.caseIcon);
    }

    _addSwitch(group, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle});
        row.active = this._settingsItems[key] ?? false;
        row.connect('notify::active', () => {
            if (this._settingsItems[key] !== row.active)
                this._updateGsettings(key, row.active);
        });
        this._switches[key] = row;
        group.add(row);
    }

    _addDropdown(group, key, title, subtitle, labels, values) {
        const row = new DropDownRowWidget({
            rowTitle: title,
            rowSubtitle: subtitle,
            items: labels,
            values,
            initialValue: this._settingsItems[key] ?? values[0],
        });
        row.connect('notify::selected-item', () => {
            if (this._settingsItems[key] !== row.selected_item)
                this._updateGsettings(key, row.selected_item);
        });
        this._dropdowns[key] = row;
        group.add(row);
    }

    _addIconSelector(group, key, title, icons, fallback) {
        const row = new IconSelectorWidget(
            title,
            icons,
            this._settingsItems[key] ?? fallback,
            () => {
                this._updateGsettings(key, fallback);
                row.selected_item = fallback;
            }
        );
        row.connect('notify::selected-item', () => {
            this._updateGsettings(key, row.selected_item);
        });
        group.add(row);
    }

    _readSettingsItems() {
        const list = this._settings.get_strv(SettingsKey).map(JSON.parse);
        return list.find(info => info.path === this._devicePath);
    }

    _updateGsettings(key, value) {
        const pairedDevice = this._settings.get_strv(SettingsKey);
        const existingPathIndex =
            pairedDevice.findIndex(item => JSON.parse(item).path === this._devicePath);
        if (existingPathIndex !== -1) {
            const existingItem = JSON.parse(pairedDevice[existingPathIndex]);
            existingItem[key] = value;
            pairedDevice[existingPathIndex] = JSON.stringify(existingItem);
            this._settings.set_strv(SettingsKey, pairedDevice);
        }
    }
});
