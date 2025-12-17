import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

export default class TmuxLastLineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._tmuxLabel = null;
        this._button = null;
        this._menu = null;
        this._fileMonitor = null;
        this._tmuxProcess = null;
        this._sessionWatcherId = null;
        this._currentSession = null;
        this._settings = null;
        this._settingsHandlers = [];
    }

    _getMostRecentSession() {
        try {
            let [res, out, err, status] = GLib.spawn_command_line_sync('tmux list-sessions -F "#S"');
            if (res && out) {
                let sessions = out.toString().trim().split('\n').filter(s => s.length > 0);
                return sessions.length > 0 ? sessions[0] : null; // pick first session
            }
        } catch (e) {
            log("Error listing tmux sessions: " + e);
        }
        return null;
    }

    _getAllSessions() {
        try {
            let [res, out, err, status] = GLib.spawn_command_line_sync('tmux list-sessions -F "#S"');
            if (res && out) {
                let sessions = out.toString().trim().split('\n').filter(s => s.length > 0);
                return sessions;
            }
        } catch (e) {
            log("Error listing tmux sessions: " + e);
        }
        return [];
    }

    _startTmuxPipe(session) {

        this._tmuxLabel.set_text(`[${session}] ---`);

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
                        const maxLength = this._settings.get_int('max-label-length');
                        let [success, contents] = GLib.file_get_contents(logFile);
                        if (success && contents.length > 0) {
                            let lines = new TextDecoder().decode(contents).trim().split('\n');
                            
                            // Collect last n lines until we have MAX_LABEL_LENGTH chars
                            let combinedText = '';
                            for (let i = lines.length - 1; i >= 0; i--) {
                                let line = lines[i].trim();
                                // Strip ANSI color codes
                                line = line.replace(/\x1b\[[0-9;]*m/g, '');
                                if (line.length === 0) continue;
                                
                                if (combinedText.length === 0) {
                                    combinedText = line;
                                } else {
                                    let potential = line + ' | ' + combinedText;
                                    // Also strip colors from potential before checking length
                                    let potentialClean = potential.replace(/\x1b\[[0-9;]*m/g, '');
                                    if (potentialClean.length > maxLength) break;
                                    combinedText = potentialClean;
                                }
                                
                                if (combinedText.length >= maxLength) break;
                            }
                            
                            if (combinedText.length > 0) {
                                if (combinedText.length > maxLength)
                                    combinedText = combinedText.substring(0, maxLength) + "…";
                                this._tmuxLabel.set_text(`[${session}] ${combinedText}`);
                            }
                        }
                    } catch (e) {
                        log("Error reading log file: " + e);
                    }
                }
            });
        } catch (e) {
            this._tmuxLabel.set_text(`[${session} error ${e}]`);
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

    _checkSessionChange() {
        let newSession = this._getMostRecentSession();
        if (newSession !== this._currentSession) {
            this._stopTmuxPipe();
            this._currentSession = newSession;
            if (this._currentSession) {
                this._startTmuxPipe(this._currentSession);
            } else {
                this._tmuxLabel.set_text("[tmux n/a]");
            }
        }
        return true;
    }

    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.tmux-lastline');
        
        this._tmuxLabel = new St.Label({ 
            text: "[tmux n/a]", 
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-button'
        });
        
        // Create a button wrapper to make it clickable
        let button = new St.Button({
            child: this._tmuxLabel,
            style_class: 'panel-button'
        });
        
        // Create popup menu
        this._menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._menu.actor);
        
        button.connect('clicked', () => {
            this._updateMenuItems();
            this._menu.toggle();
        });
        
        // Add menu items
        this._joinItem = new PopupMenu.PopupMenuItem('Join session');
        this._joinItem.connect('activate', () => {
            if (this._currentSession) {
                try {
                    Util.spawn(['/usr/bin/gnome-terminal', '--', '/usr/bin/tmux', 'attach', '-t', this._currentSession]);
                } catch (e) {
                    log("Error spawning terminal: " + e);
                }
            }
            this._menu.close();
        });
        this._menu.addMenuItem(this._joinItem);
        
        this._sessionsSubmenu = new PopupMenu.PopupSubMenuMenuItem('Select session');
        this._menu.addMenuItem(this._sessionsSubmenu);
        
        this._newItem = new PopupMenu.PopupMenuItem('Create new session');
        this._newItem.connect('activate', () => {
            try {
                Util.spawn(['/usr/bin/gnome-terminal', '--', '/usr/bin/tmux']);
            } catch (e) {
                log("Error creating session: " + e);
            }
            this._menu.close();
        });
        this._menu.addMenuItem(this._newItem);
        
        this._killItem = new PopupMenu.PopupMenuItem('Kill session');
        this._killItem.connect('activate', () => {
            if (this._currentSession) {
                try {
                    GLib.spawn_command_line_async(`/usr/bin/tmux kill-session -t ${this._currentSession}`);
                } catch (e) {
                    log("Error killing session: " + e);
                }
            }
            this._menu.close();
        });
        this._menu.addMenuItem(this._killItem);
        
        // Add separator
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Add help item
        this._helpItem = new PopupMenu.PopupMenuItem('Detach: Ctrl+b d');
        this._helpItem.setSensitive(false);
        this._menu.addMenuItem(this._helpItem);
        
        // Listen for settings changes
        let positionHandler = this._settings.connect('changed::position-index', () => {
            this._updateLabelPosition();
        });
        this._settingsHandlers.push(positionHandler);
        
        let maxLengthHandler = this._settings.connect('changed::max-label-length', () => {
            // Trigger a refresh by checking session change
            this._checkSessionChange();
        });
        this._settingsHandlers.push(maxLengthHandler);
        
        const positionIndex = this._settings.get_int('position-index');
        this._button = button;
        Main.panel._centerBox.insert_child_at_index(button, positionIndex);

        this._currentSession = this._getMostRecentSession();
        if (this._currentSession) {
            this._startTmuxPipe(this._currentSession);
        } else {
            this._tmuxLabel.set_text("[tmux n/a]");
        }

        this._sessionWatcherId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => this._checkSessionChange());
    }

    _updateLabelPosition() {
        if (!this._button) return;
        
        // Remove from current position
        Main.panel._centerBox.remove_child(this._button);
        
        // Add at new position
        const positionIndex = this._settings.get_int('position-index');
        Main.panel._centerBox.insert_child_at_index(this._button, positionIndex);
    }

    _updateMenuItems() {
        // Show/hide join item based on whether there's a current session
        if (this._joinItem) {
            this._joinItem.visible = this._currentSession !== null;
        }
        
        // Update sessions submenu
        this._sessionsSubmenu.menu.removeAll();
        let sessions = this._getAllSessions();
        
        if (sessions.length > 0) {
            for (let session of sessions) {
                let item = new PopupMenu.PopupMenuItem(session);
                if (session === this._currentSession) {
                    item.setOrnament(PopupMenu.Ornament.DOT);
                }
                item.connect('activate', () => {
                    this._currentSession = session;
                    this._stopTmuxPipe();
                    this._startTmuxPipe(session);
                    this._menu.close();
                });
                this._sessionsSubmenu.menu.addMenuItem(item);
            }
            this._sessionsSubmenu.visible = true;
        } else {
            this._sessionsSubmenu.visible = false;
        }
    }

    disable() {
        this._stopTmuxPipe();

        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }

        if (this._button) {
            Main.panel._centerBox.remove_child(this._button);
            this._button.destroy();
            this._button = null;
        }

        if (this._tmuxLabel) {
            this._tmuxLabel = null;
        }

        if (this._sessionWatcherId) {
            GLib.source_remove(this._sessionWatcherId);
            this._sessionWatcherId = null;
        }
        
        // Disconnect all settings signal handlers
        if (this._settings) {
            this._settingsHandlers.forEach(handler => {
                this._settings.disconnect(handler);
            });
            this._settingsHandlers = [];
            this._settings = null;
        }
    }
}
