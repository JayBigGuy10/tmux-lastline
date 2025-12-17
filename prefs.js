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
