export enum NiimbotPackageCode {
  NOT_IMPLEMENTED = 0,
  START_PRINT = 1, // 0x01
  START_PAGE_PRINT = 3, // 0x03
  SET_DIMENSION = 19, // 0x13
  SET_QUANTITY = 21, // 0x15
  GET_RFID = 26, // 0x1A
  ALLOW_PRINT_CLEAR = 32, // 0x20
  SET_LABEL_DENSITY = 33, // 0x21
  SET_LABEL_TYPE = 35, // 0x23
  GET_INFO = 64, // 0x40
  GET_PRINT_STATUS = 163, // 0xA3
  VALUE_ERROR = 219, // 0xDB
  HEARTBEAT = 220, // 0xDC
  END_PAGE_PRINT = 227, // 0xE3
  END_PRINT = 243, // 0xF3
  IMG_LINE = 0x85, // 0x85
}

export enum NiimbotInfoCode {
  DENSITY = 1,
  PRINTSPEED = 2,
  LABELTYPE = 3,
  LANGUAGETYPE = 6,
  AUTOSHUTDOWNTIME = 7,
  DEVICETYPE = 8,
  SOFTVERSION = 9,
  BATTERY = 10,
  DEVICESERIAL = 11,
  HARDVERSION = 12,
}

export interface NiimbotPackage {
  code: number;
  data: Uint8Array;
}

export async function* streamAsyncIterable(reader: ReadableStreamDefaultReader<Uint8Array>, keepReadingFlag: () => boolean) {
  try {
    while (keepReadingFlag()) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export const encodeNiimbotPackage = ({ code, data }: NiimbotPackage): Uint8Array => {
  let checksum = code ^ data.length;
  data.forEach(i => {
    checksum ^= i;
  });
  return new Uint8Array([0x55, 0x55, code, data.length, ...data, checksum, 0xaa, 0xaa]);
};

export const decodeNiimbotPackage = (pkg: Uint8Array): NiimbotPackage => {
  if (pkg[0] !== 0x55 || pkg[1] !== 0x55 || pkg[pkg.length - 2] !== 0xaa || pkg[pkg.length - 1] !== 0xaa) {
    throw new Error('Package format error');
  }
  const code = pkg[2];
  const len = pkg[3];
  const data = pkg.slice(4, 4 + len);

  let checksum = code ^ len;
  data.forEach(i => {
    checksum ^= i;
  });

  if (checksum !== pkg[pkg.length - 3]) {
    throw new Error('Checksum error');
  }

  return { code, data };
};

export const bytesToInt = (x: Uint8Array): number => {
  return x.reduce((acc, val) => acc * 256 + val, 0);
};

export const bytesToHex = (bytes: Uint8Array): string => {
  return bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
};
