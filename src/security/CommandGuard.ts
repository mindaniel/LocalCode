export interface GuardResult {
  safe: boolean
  reason?: string
  requiresConfirmation?: boolean
}

interface BlockRule {
  pattern: RegExp
  reason: string
}

const BLOCK_RULES: BlockRule[] = [
  // Unix / Linux
  { pattern: /rm\s+-[rf]{1,3}\s+[/~]/i,              reason: 'Recursive deletion of system or home paths' },
  { pattern: /rm\s+--recursive.*--force/i,             reason: 'Force-recursive file deletion' },
  { pattern: /sudo\s+rm/i,                             reason: 'Privileged file deletion via sudo' },
  { pattern: /:\(\)\s*\{.*\|.*\}/,                     reason: 'Fork bomb — infinite process spawn' },
  { pattern: /\bshutdown\b/i,                          reason: 'System shutdown command' },
  { pattern: /\breboot\b/i,                            reason: 'System reboot command' },
  { pattern: /\bhalt\b/i,                              reason: 'System halt command' },
  { pattern: /\bmkfs\b/i,                              reason: 'Disk formatting command' },
  { pattern: /dd\s+if=.*of=\/dev/i,                   reason: 'Direct disk write via dd' },
  // Git
  { pattern: /git\s+push\s+.*--force/i,                reason: 'Force-push overwrites remote history' },
  { pattern: /git\s+reset\s+--hard\s+HEAD~\d+/i,      reason: 'Hard reset discards committed history' },
  // SQL
  { pattern: /DROP\s+(TABLE|DATABASE)/i,               reason: 'Destructive SQL operation (DROP)' },
  { pattern: /TRUNCATE\s+TABLE/i,                      reason: 'Destructive SQL operation (TRUNCATE)' },
  // Windows cmd.exe
  { pattern: /rd\s+\/s\s+\/q/i,                       reason: 'Recursive directory deletion (cmd.exe)' },
  { pattern: /rmdir\s+\/s/i,                           reason: 'Recursive directory deletion (cmd.exe)' },
  { pattern: /del\s+.*\/[fFsS].*\/[qQ]/i,              reason: 'Force-delete all files (cmd.exe)' },
  { pattern: /format\s+[A-Za-z]:/i,                    reason: 'Disk format command (Windows)' },
  // PowerShell
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force/i,  reason: 'Force-recursive deletion (PowerShell)' },
  { pattern: /Remove-Item\s+.*-Force\s+.*-Recurse/i,  reason: 'Force-recursive deletion (PowerShell)' },
  { pattern: /Clear-Disk\b/i,                          reason: 'Disk wipe command (PowerShell)' },
  { pattern: /Reset-ComputerMachinePassword\b/i,       reason: 'System credential reset (PowerShell)' },
]

const CONFIRM_PATTERNS: RegExp[] = [
  /git\s+push(?!\s+--dry-run)/i,
  /git\s+reset/i,
  /npm\s+publish/i,
  /docker\s+rm/i,
  /kubectl\s+delete/i,
  /terraform\s+destroy/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bcp\b/i,
  /\bmv\b/i,
  /\brename\b/i,
  /\brm\b/i,
  /\brmdir\b/i,
]

export class CommandGuard {
  static check(command: string): GuardResult {
    const cmd = command.trim()

    for (const { pattern, reason } of BLOCK_RULES) {
      if (pattern.test(cmd)) {
        return { safe: false, reason }
      }
    }

    for (const pattern of CONFIRM_PATTERNS) {
      if (pattern.test(cmd)) {
        return { safe: true, requiresConfirmation: true, reason: 'This command may have irreversible effects' }
      }
    }

    return { safe: true }
  }
}
