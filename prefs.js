import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TmuxLastLinePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.tmux-lastline');
        
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Display Settings',
            description: 'Configure how tmux output appears in the top bar',
        });
        page.add(group);

        // Max Label Length
        const maxLengthRow = new Adw.SpinRow({
            title: 'Maximum Label Length',
            subtitle: 'Maximum number of characters to display',
            adjustment: new Gtk.Adjustment({
                lower: 20,
                upper: 200,
                step_increment: 10,
            }),
        });
        settings.bind('max-label-length', maxLengthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(maxLengthRow);

        // Position Index
        const positionRow = new Adw.SpinRow({
            title: 'Position Index',
            subtitle: 'Position in center box (0 = leftmost)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 10,
                step_increment: 1,
            }),
        });
        settings.bind('position-index', positionRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(positionRow);

        window.add(page);
    }
}
