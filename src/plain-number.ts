/** Decimal numbers only: `Number("")` is 0 and `Number("0x10")` is 16, so text is checked against this before it is converted. */
export const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
