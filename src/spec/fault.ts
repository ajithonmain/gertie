/**
 * Deliberate faults for the mutation check in `docs/08-testing.md`. Each one reproduces a mistake that
 * the design documents warn about. With a fault switched on, the parity test must fail.
 * Test-only: no command line option exposes these.
 */
export type Fault = "lottie-no-reverse" | "lottie-ease-shift" | "lottie-no-pivot" | "svg-reverse-order" | "svg-ease-shift" | "svg-no-pivot";

export const FAULTS: readonly Fault[] = ["lottie-no-reverse", "lottie-ease-shift", "lottie-no-pivot", "svg-reverse-order", "svg-ease-shift", "svg-no-pivot"];
