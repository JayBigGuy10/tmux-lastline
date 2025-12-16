import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TmuxLastLineExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._tmuxLabel = null;
        this._fileMonitor = null;
        this._tmuxProcess = null;
        this._sessionWatcherId = null;
        this._currentSession = null;
        this._settings = null;
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

    _startTmuxPipe(session) {

        this._tmuxLabel.set_text(`[${session}] ---`);

        const logFile = `/tmp/tmux_last_line_${session}.log`;
        const maxLength = this._settings.get_int('max-label-length');

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
        
        const positionIndex = this._settings.get_int('position-index');
        Main.panel._centerBox.insert_child_at_index(this._tmuxLabel, positionIndex);

        this._currentSession = this._getMostRecentSession();
        if (this._currentSession) {
            this._startTmuxPipe(this._currentSession);
        } else {
            this._tmuxLabel.set_text("[tmux n/a]");
        }

        this._sessionWatcherId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => this._checkSessionChange());
    }

    disable() {
        this._stopTmuxPipe();

        if (this._tmuxLabel) {
            Main.panel._centerBox.remove_child(this._tmuxLabel);
            this._tmuxLabel = null;
        }

        if (this._sessionWatcherId) {
            GLib.source_remove(this._sessionWatcherId);
            this._sessionWatcherId = null;
        }
        
        if (this._settings) {
            this._settings = null;
        }
    }
}
