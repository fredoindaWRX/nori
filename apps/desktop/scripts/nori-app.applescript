on run
	set launcher to "/Users/user/Desktop/Development-Charlie-2/Charlieautomates/apps/nori/scripts/nori-app-launch.sh"
	display notification "Booting the brain and the face…" with title "N.O.R.I."
	-- Backgrounded with & and detached stdio so osascript returns at once and
	-- never holds (or reaps) the servers the launcher starts.
	do shell script "/bin/zsh -lic " & quoted form of launcher & " >/dev/null 2>&1 &"
end run
