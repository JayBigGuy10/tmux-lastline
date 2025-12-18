import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Helper function to get settings with schema search path
function getSettings() {
    const extensionPath = import.meta.url.replace(/^file:\/\//, '').replace(/\/extension\.js$/, '');
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

const BasicPanelMenu = GObject.registerClass(
    class BasicPanelMenu extends PanelMenu.Button {
        constructor() {
            super(0.0, "Tmux Last Line", false);

            // Initialize settings
            this._settings = getSettings();

            // Add text label for selected session
            this._label = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER
            });
            this.add_child(this._label);

            // Track selected session
            this._selectedSession = null;
            this._userSelectedSession = null;

            // Initialize tmux pipe tracking
            this._tmuxProcess = null;
            this._fileMonitor = null;
            this._sessionCheckTimeout = null;

            // Initial population of sessions
            this._refreshSessions();

            // Set most recent session on startup
            this._selectedSession = this._getMostRecentSession();
            this._updateLabel();
            this._startTmuxPipe(this._selectedSession);

            // Start continuous session change monitor
            this._startSessionMonitor();

            // Connect to menu open signal to refresh sessions
            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    this._refreshSessions();
                }
            });

            // Connect to settings changes to apply them in real-time
            this._settings.connect('changed::max-length', () => {
                // Re-trigger file monitor to update with new max-length
                if (this._selectedSession) {
                    this._startTmuxPipe(this._selectedSession);
                }
            });

            this._settings.connect('changed::show-session-label', () => {
                // Trigger label update
                if (this._selectedSession) {
                    this._startTmuxPipe(this._selectedSession);
                }
            });

            this._settings.connect('changed::truncate-from-start', () => {
                // Trigger label update
                if (this._selectedSession) {
                    this._startTmuxPipe(this._selectedSession);
                }
            });
        }

        _updateLabel() {
            this._label.set_text(this._selectedSession ? `[${this._selectedSession}]` : '[tmux n/a]');
        }

        _startTmuxPipe(session) {
            if (!session) return;

            this._stopTmuxPipe();
            this._label.set_text(`[${session}] ---`);

            const logFile = `/tmp/tmux_last_line_${session}.log`;

            try {
                GLib.spawn_command_line_async(`touch ${logFile}`);
                GLib.spawn_command_line_async(`pkill -f "tmux pipe-pane -t ${session}" || true`);

                this._tmuxProcess = GLib.spawn_async(
                    null,
                    ['/usr/bin/tmux', 'pipe-pane', '-t', session, `cat >> ${logFile}`],
                    null,
                    GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null
                );

                // Monitor the log file for changes
                let file = Gio.File.new_for_path(logFile);
                this._fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
                
                this._fileMonitor.connect('changed', (monitor, file, otherFile, eventType) => {
                    if (eventType === Gio.FileMonitorEvent.CHANGED || eventType === Gio.FileMonitorEvent.CREATED) {
                        try {
                            const maxLength = this._settings.get_int('max-length') || 50;
                            let [success, contents] = GLib.file_get_contents(logFile);
                            if (success && contents.length > 0) {
                                let lines = new TextDecoder().decode(contents).trim().split('\n');
                                
                                // Collect last n lines until we have maxLength chars
                                let combinedText = '';
                                for (let i = lines.length - 1; i >= 0; i--) {
                                    let line = lines[i].trim();
                                    // Strip all ANSI escape sequences and control characters
                                    line = line.replace(/\x1b\[[^m]*m/g, '');  // Color codes
                                    line = line.replace(/\x1b\[?[0-9;]*[a-zA-Z]/g, '');  // CSI sequences
                                    line = line.replace(/\x1b[^\[]/g, '');  // Other escape sequences
                                    line = line.replace(/[\x00-\x1f\x7f]/g, '');  // Control characters
                                    if (line.length === 0) continue;
                                    
                                    if (combinedText.length === 0) {
                                        combinedText = line;
                                    } else {
                                        let potential = line + ' | ' + combinedText;
                                        // Also strip codes from potential before checking length
                                        let potentialClean = potential.replace(/\x1b\[[^m]*m/g, '').replace(/\x1b\[?[0-9;]*[a-zA-Z]/g, '').replace(/\x1b[^\[]/g, '').replace(/[\x00-\x1f\x7f]/g, '');
                                        if (maxLength > 0 && potentialClean.length > maxLength) break;
                                        combinedText = potentialClean;
                                    }
                                    
                                    if (maxLength > 0 && combinedText.length >= maxLength) break;
                                }
                                
                                if (combinedText.length > 0) {
                                    if (maxLength > 0 && combinedText.length > maxLength) {
                                        const truncateFromStart = this._settings.get_boolean('truncate-from-start');
                                        if (truncateFromStart) {
                                            combinedText = "…" + combinedText.substring(combinedText.length - maxLength);
                                        } else {
                                            combinedText = combinedText.substring(0, maxLength) + "…";
                                        }
                                    }
                                    const showSession = this._settings.get_boolean('show-session-label');
                                    const labelText = showSession ? `[${session}] ${combinedText}` : combinedText;
                                    this._label.set_text(labelText);
                                }
                            }
                        } catch (e) {
                            log("Error reading log file: " + e);
                        }
                    }
                });
            } catch (e) {
                this._label.set_text(`[${session} error ${e}]`);
                log("Error starting tmux pipe: " + e);
            }
        }

        _stopTmuxPipe() {
            if (this._fileMonitor) {
                this._fileMonitor.cancel();
                this._fileMonitor = null;
            }
            if (this._tmuxProcess) {
                try {
                    GLib.spawn_command_line_async("pkill -f 'tmux pipe-pane'");
                } catch (e) {
                    log("Error killing tmux pipe: " + e);
                }
                this._tmuxProcess = null;
            }
        }

        _startSessionMonitor() {
            // Clear any existing timeout
            if (this._sessionCheckTimeout) {
                GLib.source_remove(this._sessionCheckTimeout);
            }

            // Schedule next check
            this._sessionCheckTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._checkSessionChange();
                return true; // Keep timeout running
            });
        }

        _stopSessionMonitor() {
            if (this._sessionCheckTimeout) {
                GLib.source_remove(this._sessionCheckTimeout);
                this._sessionCheckTimeout = null;
            }
        }

        _checkSessionChange() {
            let sessions = this._getAllSessions();
            
            // If user selected a session, stick with it unless it no longer exists
            if (this._userSelectedSession) {
                if (sessions.includes(this._userSelectedSession)) {
                    // User's selected session still exists, keep it
                    if (this._selectedSession !== this._userSelectedSession) {
                        this._stopTmuxPipe();
                        this._selectedSession = this._userSelectedSession;
                        this._startTmuxPipe(this._selectedSession);
                    }
                    return;
                } else {
                    // User's selected session no longer exists
                    this._userSelectedSession = null;
                    this._stopTmuxPipe();
                    this._selectedSession = null;
                    
                    // Check if auto-switch is disabled
                    const autoSwitch = this._settings.get_boolean('auto-switch-on-session-exit');
                    if (!autoSwitch) {
                        this._updateLabel();
                        return;
                    }
                }
            }
            
            // Auto-select the first available session
            if (sessions.length > 0) {
                let newSession = sessions[0];
                if (newSession !== this._selectedSession) {
                    this._stopTmuxPipe();
                    this._selectedSession = newSession;
                    this._updateLabel();
                    this._startTmuxPipe(this._selectedSession);
                    this._refreshSessions();
                }
            } else {
                if (this._selectedSession !== null) {
                    this._stopTmuxPipe();
                    this._selectedSession = null;
                    this._updateLabel();
                }
            }
        }

        _getAllSessions() {
            try {
                let [res, out, err, status] = GLib.spawn_command_line_sync('tmux list-sessions -F "#S"');
                if (res && out) {
                    let text = new TextDecoder().decode(out);
                    let sessions = text.trim().split('\n').filter(s => s.length > 0);
                    return sessions;
                }
            } catch (e) {
                log("Error listing tmux sessions: " + e);
            }
            return [];
        }

        _getMostRecentSession() {
            try {
                let [res, out, err, status] = GLib.spawn_command_line_sync('tmux list-sessions -F "#S"');
                if (res && out) {
                    let text = new TextDecoder().decode(out);
                    let sessions = text.trim().split('\n').filter(s => s.length > 0);
                    return sessions.length > 0 ? sessions[0] : null; // pick first session
                }
            } catch (e) {
                log("Error listing tmux sessions: " + e);
            }
            return null;
        }

        _refreshSessions() {
            // Clear existing session items
            this.menu.removeAll();

            let sessions = this._getAllSessions();

            // Check if selected session still exists
            if (this._selectedSession && !sessions.includes(this._selectedSession)) {
                this._selectedSession = this._getMostRecentSession();
            }

            if (sessions.length === 0) {
                let noSessionItem = new PopupMenu.PopupMenuItem("No sessions");
                this.menu.addMenuItem(noSessionItem);
            } else {
                sessions.forEach(sessionName => {
                    let item = new PopupMenu.PopupMenuItem(sessionName);
                    
                    // Mark selected session with a dot
                    if (sessionName === this._selectedSession) {
                        item.setOrnament(PopupMenu.Ornament.DOT);
                    }
                    
                    item.connect('activate', () => {
                        this._selectedSession = sessionName;
                        this._userSelectedSession = sessionName;
                        console.log("Selected session: " + sessionName);
                        this._startTmuxPipe(sessionName);
                        this._refreshSessions();
                    });
                    this.menu.addMenuItem(item);
                });

                // Add separator
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

                // Add new session button
                let newItem = new PopupMenu.PopupMenuItem("New Session");
                newItem.connect('activate', () => {
                    GLib.spawn_command_line_async(`gnome-terminal -- tmux new-session`);
                    // Refresh after a short delay to show the new session
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        this._refreshSessions();
                        return false;
                    });
                });
                this.menu.addMenuItem(newItem);

                // Add attach button
                let attachItem = new PopupMenu.PopupMenuItem("Attach");
                attachItem.connect('activate', () => {
                    if (this._selectedSession) {
                        GLib.spawn_command_line_async(`gnome-terminal -- tmux attach-session -t ${this._selectedSession}`);
                    }
                });
                this.menu.addMenuItem(attachItem);

                // Add kill button
                let killItem = new PopupMenu.PopupMenuItem("Kill");
                killItem.connect('activate', () => {
                    if (this._selectedSession) {
                        GLib.spawn_command_line_async(`tmux kill-session -t ${this._selectedSession}`);
                        this._stopTmuxPipe();
                        this._selectedSession = this._getMostRecentSession();
                        this._updateLabel();
                        if (this._selectedSession) {
                            this._startTmuxPipe(this._selectedSession);
                        }
                        this._refreshSessions();
                    }
                });
                this.menu.addMenuItem(killItem);
            }
        }
    }
);

let menu;

export function init() {
    // Nothing to do here for now
}

export function enable() {
    menu = new BasicPanelMenu();
    
    // Get settings for panel position and index
    const settings = getSettings();
    const panelPosition = settings.get_string('panel-position');
    const panelIndex = settings.get_int('panel-index');
    
    // Map position to panel box
    let panelBox;
    switch (panelPosition) {
        case 'left':
            panelBox = Main.panel._leftBox;
            break;
        case 'right':
            panelBox = Main.panel._rightBox;
            break;
        case 'center':
        default:
            panelBox = Main.panel._centerBox;
    }
    
    // Add to status area with specified index
    Main.panel.addToStatusArea('tmux-lastline', menu, panelIndex, panelPosition);
}

export function disable() {
    if (menu) {
        menu._stopSessionMonitor();
        menu._stopTmuxPipe();
        menu.destroy();
        menu = null;
    }
}

export default class Extension {
    constructor() {}

    enable() {
        enable();
    }

    disable() {
        disable();
    }
}
