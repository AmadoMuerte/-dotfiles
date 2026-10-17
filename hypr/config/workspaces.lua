-- Keep the named gaming workspace available for game window rules, but do not
-- make it the initial workspace. Named workspaces use negative internal IDs,
-- and marking this one as default made new sessions (and regular apps) start
-- on that internal workspace instead of workspace 1.
hl.workspace_rule({ workspace = "name:gaming", monitor = "DP-1" })
hl.workspace_rule({ workspace = "1", monitor = "DP-1", default = true, persistent = true })
hl.workspace_rule({ workspace = "2", monitor = "DP-2", default = true, persistent = true })
hl.workspace_rule({ workspace = "3", monitor = "DP-1", persistent = true })
