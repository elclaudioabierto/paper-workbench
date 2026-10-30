!macro customInstall
  ${ifNot} ${Silent}
  ${andIfNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONINFORMATION "Paper Workbench also needs the Codex CLI, installed separately. If you already have it, choose No. Otherwise, choose Yes to open the Codex installation guide. You can also find setup steps in the app's Settings." IDNO codex_done
    ExecShell "open" "https://learn.chatgpt.com/docs/codex/cli"
    codex_done:
  ${endIf}
!macroend
