/** Terminals and process output are both screens: a pty's output drawn by xterm. */
export type ScreenSize = { cols: number; rows: number }

/**
 * The screen and scrollback as escape sequences, to write into a fresh xterm.
 * `seq` is the last output chunk included; later `screenOutput` events carry
 * higher numbers.
 */
export type ScreenSnapshot = { data: string; seq: number }

export type ScreenOutput = { screenId: string; data: string; seq: number }
