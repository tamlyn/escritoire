export type TerminalSize = { cols: number; rows: number }

/**
 * The terminal's screen and scrollback as escape sequences, to write into a
 * fresh xterm. `seq` is the last output chunk included; later `terminalOutput`
 * events carry higher numbers.
 */
export type TerminalSnapshot = { data: string; seq: number }

export type TerminalOutput = { terminalId: string; data: string; seq: number }
