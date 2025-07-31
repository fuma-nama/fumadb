export function bigintToUint8Array(bigint: bigint) {
  let hex = bigint.toString(16);
  if (hex.length % 2) {
    hex = `0${hex}`; // even length
  }
  return Buffer.from(hex, "hex");
}

export function uint8ArrayToBigInt(arr: Uint8Array) {
  // Convert Uint8Array to hex string
  const hex = Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return BigInt(`0x${hex}`);
}

export function stringToUint8Array(str: string) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

export function uint8ArrayToString(arr: Uint8Array) {
  const decoder = new TextDecoder();
  return decoder.decode(arr);
}

export function booleanToUint8Array(bool: boolean) {
  return new Uint8Array([bool ? 1 : 0]);
}

export function uint8ArrayToBoolean(arr: Uint8Array) {
  return arr[0] !== 0;
}

export function numberToUint8Array(num: number) {
  // allocate 8 bytes for 64-bit number
  const buf = Buffer.alloc(8);
  // js numbers are 64-bit double precision floating-point values
  buf.writeDoubleBE(num);
  return new Uint8Array(buf);
}

export function uint8ArrayToNumber(arr: Uint8Array) {
  const buf = Buffer.from(arr);
  return buf.readDoubleBE(0);
}
