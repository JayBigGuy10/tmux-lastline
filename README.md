 glib-compile-schemas schemas/

 Start a new session: Simply type tmux in your terminal.

Start a named session: Use tmux new -s [session_name] to give your session a custom name for easier management.

Detach from a session: To leave a session running in the background, press the prefix Ctrl+B, then press D.

Reattach to a session: To resume a detached session, use tmux attach or tmux attach-session -t [session_name] if you named it. 

Ctrl-b then [ then you can use your normal navigation keys to scroll around (eg. Up Arrow or PgDn). Press q to quit scroll mode.