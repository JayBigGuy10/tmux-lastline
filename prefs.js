import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

// Helper function to get settings with schema search path
function getSettings() {
    const extensionPath = import.meta.url.replace(/^file:\/\//, '').replace(/\/prefs\.js$/, '');
    const schemasDir = Gio.File.new_for_path(`${extensionPath}/schemas`);
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        schemasDir.get_path(),
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = schemaSource.lookup('org.gnome.shell.extensions.tmux-lastline', false);
    
    if (!schema) {
        throw new Error('Cannot find schema org.gnome.shell.extensions.tmux-lastline');
    }
    
    return new Gio.Settings({
        settings_schema: schema,
    });
}

function getPanelIndex(position) {
    const positions = ['left', 'center', 'right'];
    const idx = positions.indexOf(position);
    return idx >= 0 ? idx : 1; // default to center
}

function buildPreferencesUI(window) {
    const settings = getSettings();

    const page = new Adw.PreferencesPage();
    window.add(page);

    // Panel position group
    const positionGroup = new Adw.PreferencesGroup({
        title: 'Panel Position',
        description: 'Configure where the indicator appears in the top panel',
    });
    page.add(positionGroup);

    // Panel position combo
    const panelRow = new Adw.ComboRow({
        title: 'Panel Position',
        subtitle: 'Choose left, center, or right',
    });
    const panelModel = new Gtk.StringList();
    panelModel.append('left');
    panelModel.append('center');
    panelModel.append('right');
    panelRow.set_model(panelModel);
    panelRow.set_selected(getPanelIndex(settings.get_string('panel-position')));
    panelRow.connect('notify::selected', () => {
        const positions = ['left', 'center', 'right'];
        settings.set_string('panel-position', positions[panelRow.get_selected()]);
    });
    positionGroup.add(panelRow);

    // Panel index spinner
    const indexRow = new Adw.SpinRow({
        title: 'Panel Index',
        subtitle: 'Position within the panel (0 = first)',
        adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 1,
        }),
    });
    indexRow.set_value(settings.get_int('panel-index'));
    indexRow.connect('notify::value', () => {
        settings.set_int('panel-index', Math.floor(indexRow.get_value()));
    });
    positionGroup.add(indexRow);

    // Max length group
    const maxLengthGroup = new Adw.PreferencesGroup({
        title: 'Display Settings',
        description: 'Configure how the tmux output is displayed',
    });
    page.add(maxLengthGroup);

    // Max length spinner
    const maxLengthRow = new Adw.SpinRow({
        title: 'Maximum Label Length',
        subtitle: 'Characters to display (0 = unlimited)',
        adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 500,
            step_increment: 5,
        }),
    });
    maxLengthRow.set_value(settings.get_int('max-length'));
    maxLengthRow.connect('notify::value', () => {
        settings.set_int('max-length', Math.floor(maxLengthRow.get_value()));
    });
    maxLengthGroup.add(maxLengthRow);

    // Show session label toggle
    const sessionLabelRow = new Adw.SwitchRow({
        title: 'Show Session Name',
        subtitle: 'Display [session] prefix in the label',
    });
    sessionLabelRow.set_active(settings.get_boolean('show-session-label'));
    sessionLabelRow.connect('notify::active', () => {
        settings.set_boolean('show-session-label', sessionLabelRow.get_active());
    });
    maxLengthGroup.add(sessionLabelRow);

    // Truncate from start toggle
    const truncateFromStartRow = new Adw.SwitchRow({
        title: 'Show End of String',
        subtitle: 'When truncating, show the end instead of the beginning',
    });
    truncateFromStartRow.set_active(settings.get_boolean('truncate-from-start'));
    truncateFromStartRow.connect('notify::active', () => {
        settings.set_boolean('truncate-from-start', truncateFromStartRow.get_active());
    });
    maxLengthGroup.add(truncateFromStartRow);

    // Auto-switch on session exit toggle
    const autoSwitchRow = new Adw.SwitchRow({
        title: 'Auto-Switch on Exit',
        subtitle: 'Switch to another session when current one exits',
    });
    autoSwitchRow.set_active(settings.get_boolean('auto-switch-on-session-exit'));
    autoSwitchRow.connect('notify::active', () => {
        settings.set_boolean('auto-switch-on-session-exit', autoSwitchRow.get_active());
    });
    maxLengthGroup.add(autoSwitchRow);
}

// GNOME 42+ API
export function fillPreferencesWindow(window) {
    buildPreferencesUI(window);
}

// Fallback for older GNOME Shell versions
export default GObject.registerClass(
    class TmuxPreferences extends Adw.PreferencesWindow {
        constructor() {
            super({
                title: 'Tmux Last Line Preferences',
                search_enabled: false,
            });
            buildPreferencesUI(this);
        }

        fillPreferencesWindow(window) {
            buildPreferencesUI(window);
        }
    }
);
