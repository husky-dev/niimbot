/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable no-console */
import {
  bytesToHex,
  bytesToInt,
  decodeNiimbotPackage,
  encodeNiimbotPackage,
  NiimbotInfoCode,
  NiimbotPackage,
  NiimbotPackageCode,
  streamAsyncIterable,
} from './utils';

const filters = [
  { usbProductId: 2, usbVendorId: 13587 }, // Niimbot B1
];

export interface NiimbotConnectOpts {
  baudRate: number;
  dataBits?: number | undefined;
  stopBits?: number | undefined;
  parity?: ParityType | undefined;
  bufferSize?: number | undefined;
  flowControl?: FlowControlType | undefined;
}

export interface NiimbotRfid {
  uuid: string;
  barcode: string;
  serial: string;
  usedLen: number;
  totalLen: number;
  type: number;
}

interface NiimbotPrintStatus {
  page: number;
  progress1: number; // 0: not finished, 1: finished
  progress2: number; // 0-100
}

interface NiimbotHeartbeat {
  closingState?: number;
  powerLevel?: number;
  paperState?: number;
  rfidReadState?: number;
}

interface PackageCallback {
  timeout: NodeJS.Timeout;
  expectedCode?: number;
  resolve: (data: NiimbotPackage) => void;
  reject: (reason?: unknown) => void;
}

const debug = false;

const log = {
  info: debug ? console.log : () => {},
  debug: debug ? console.log : () => {},
  err: debug ? console.error : () => {},
};

export class Niimbot extends EventTarget {
  public connected = false;
  public reading = false;

  public options?: NiimbotConnectOpts;

  private port?: SerialPort;
  private connectionInfo?: Partial<SerialPortInfo>;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private buffer: Uint8Array = new Uint8Array();
  private callbaks: PackageCallback[] = [];

  constructor() {
    super();
  }

  /**
   * Connection
   */

  public async requestPort(): Promise<SerialPort | undefined> {
    try {
      return await navigator.serial.requestPort({ filters });
      // return await navigator.serial.requestPort();
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.indexOf('No port selected') !== -1) {
          return undefined;
        }
      }
    }
  }

  public async connect(port: SerialPort, opt: NiimbotConnectOpts = { baudRate: 115200 }) {
    log.info('connect', { ...opt });
    this.port = port;

    log.debug('open port');
    await this.port.open(opt);
    this.options = opt;

    this.connectionInfo = this.port.getInfo();
    log.debug('connection info', { ...this.connectionInfo });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();

    this.connected = true;
    this.dispatchEvent(new CustomEvent('connect', { detail: this.connectionInfo }));
    this.addEventListener('disconnect', this.handleDisconnect);
    this.reading = true;
    for await (const value of streamAsyncIterable(this.reader, () => this.reading)) {
      this.handleReceive(value);
    }
  }

  public async disconnect() {
    this.connected = false;
    this.reading = false;

    const doCleanup = async () => {
      if (this.reader) {
        this.reader.releaseLock();
        this.reader = undefined;
      }
      if (this.writer) {
        await this.writer.releaseLock();
        this.writer = undefined;
      }
      if (this.port) {
        await this.port.close();
        this.port = undefined;
      }
    };

    try {
      await doCleanup();
      log.info('connection closed');
      this.options = undefined;
    } catch (error: unknown) {
      log.err('failed to close connection ', { err: error });
    }
  }

  /**
   * Events
   */

  private handleDisconnect(e: Event) {
    e.stopPropagation();
    log.info('disconnected');
    this.dispatchEvent(new CustomEvent('disconnect'));
  }

  private handleReceive(data: Uint8Array) {
    this.buffer = new Uint8Array([...this.buffer, ...data]);
    while (this.buffer.length > 4) {
      const pktLen = this.buffer[3] + 7;
      if (this.buffer.length >= pktLen) {
        const data = this.buffer.slice(0, pktLen);
        const pckg = decodeNiimbotPackage(data);
        log.debug('receive', pckg.code, [...pckg.data]);
        this.buffer = this.buffer.slice(pktLen);
        this.handlePackage(pckg);
      }
    }
  }

  private handlePackage(pckg: { code: number; data: Uint8Array }) {
    this.dispatchEvent(new CustomEvent('package', { detail: pckg }));
    // Looking for a callback with expected code
    const exCallback = this.callbaks.find(cb => cb.expectedCode === pckg.code);
    if (exCallback) {
      clearTimeout(exCallback.timeout);
      this.callbaks = this.callbaks.filter(cb => cb !== exCallback);
      return exCallback.resolve(pckg);
    }
    // Looking for a callback without expected code
    const noexCallback = this.callbaks.find(cb => cb.expectedCode === undefined);
    if (noexCallback) {
      clearTimeout(noexCallback.timeout);
      this.callbaks = this.callbaks.filter(cb => cb !== noexCallback);
      return noexCallback.resolve(pckg);
    }
  }

  /**
   * Commands
   */

  public async getDensity() {
    const data = await this.getInfo(NiimbotInfoCode.DENSITY);
    if (data === undefined) return undefined;
    return data.length > 0 ? data[0] : 0;
  }

  public async getPrintSpeed() {
    const data = await this.getInfo(NiimbotInfoCode.PRINTSPEED);
    if (data === undefined) return undefined;
    return data.length > 0 ? data[0] : 0;
  }

  public async getLabelType() {
    const data = await this.getInfo(NiimbotInfoCode.LABELTYPE);
    if (data === undefined) return undefined;
    return data.length > 0 ? data[0] : 0;
  }

  public async getLanguageType() {
    const data = await this.getInfo(NiimbotInfoCode.LANGUAGETYPE);
    if (data === undefined) return undefined;
    // TODO: Not sure about data format
    return undefined;
  }

  public async getAutoShutdownTime() {
    const data = await this.getInfo(NiimbotInfoCode.AUTOSHUTDOWNTIME);
    if (data === undefined) return undefined;
    return data.length > 0 ? data[0] : 0;
  }

  public async getDeviceType() {
    const data = await this.getInfo(NiimbotInfoCode.DEVICETYPE);
    if (data === undefined) return undefined;
    // TODO: Returns two bytes, don't klnow what it means
    return undefined;
  }

  public async getSoftVersion() {
    const data = await this.getInfo(NiimbotInfoCode.SOFTVERSION);
    if (data === undefined) return undefined;
    if (data.length !== 2) {
      throw new Error('Invalid data format');
    }
    const val = bytesToInt(data);
    const major = Math.floor(val / 100);
    const minor = val % 100;
    return `${major}.${minor}`;
  }

  public async getHardVersion() {
    const data = await this.getInfo(NiimbotInfoCode.HARDVERSION);
    if (data === undefined) return undefined;
    if (data.length !== 2) {
      throw new Error('Invalid data format');
    }
    const val = bytesToInt(data);
    const major = Math.floor(val / 100);
    const minor = val % 100;
    return `${major}.${minor}`;
  }

  public async getBattery() {
    const data = await this.getInfo(NiimbotInfoCode.BATTERY);
    if (data === undefined) return undefined;
    return data.length > 0 ? data[0] : 0;
  }

  public async getDeviceSerial() {
    const data = await this.getInfo(NiimbotInfoCode.DEVICESERIAL);
    if (data === undefined) return undefined;
    return bytesToHex(data);
  }

  public async getInfo(key: NiimbotInfoCode) {
    try {
      return await this.sendPackage(NiimbotPackageCode.GET_INFO, [key], key);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.indexOf('Command not implemented') !== -1) {
        return undefined;
      }
      throw err;
    }
  }

  public async getRfid(): Promise<NiimbotRfid | undefined> {
    try {
      const data = await this.sendPackage(NiimbotPackageCode.GET_RFID, [0x01]);
      if (data[0] === 0) {
        return undefined;
      }

      const uuid = bytesToHex(data.slice(0, 8));
      let idx = 8;

      const barcodeLen = data[idx];
      idx += 1;
      const barcode = new TextDecoder().decode(data.slice(idx, idx + barcodeLen));
      idx += barcodeLen;

      const serialLen = data[idx];
      idx += 1;
      const serial = new TextDecoder().decode(data.slice(idx, idx + serialLen));
      idx += serialLen;

      const totalLen = (data[idx] << 8) | data[idx + 1];
      const usedLen = (data[idx + 2] << 8) | data[idx + 3];
      const type = data[idx + 4];

      return {
        uuid: uuid,
        barcode: barcode,
        serial: serial,
        usedLen: usedLen,
        totalLen: totalLen,
        type: type,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.indexOf('Command not implemented') !== -1) {
        return undefined;
      }
      throw err;
    }
  }

  public async getHeartbeat(): Promise<NiimbotHeartbeat> {
    const data = await this.sendPackage(NiimbotPackageCode.HEARTBEAT, [0x01]);
    let closingState: number | undefined = undefined;
    let powerLevel: number | undefined = undefined;
    let paperState: number | undefined = undefined;
    let rfidReadState: number | undefined = undefined;

    switch (data.length) {
      case 20:
        paperState = data[18];
        rfidReadState = data[19];
        break;
      case 19:
        closingState = data[15];
        powerLevel = data[16];
        paperState = data[17];
        rfidReadState = data[18];
        break;
      case 13:
        closingState = data[9];
        powerLevel = data[10];
        paperState = data[11];
        rfidReadState = data[12];
        break;
      case 10:
        closingState = data[8];
        powerLevel = data[9];
        // Assuming this is a typo in the original Python
        // as it assigns two different values to rfidReadState and powerLevel
        // for the same case
        // rfidReadState = data[8];
        break;
      case 9:
        closingState = data[8];
        break;
    }

    return {
      closingState,
      powerLevel,
      paperState,
      rfidReadState,
    };
  }

  public async setLabelType(n: number): Promise<boolean> {
    if (n < 1 || n > 3) {
      throw new Error('Invalid label type');
    }
    const data = await this.sendPackage(NiimbotPackageCode.SET_LABEL_TYPE, [n], 16);
    return Boolean(data[0]);
  }

  public async setLabelDensity(n: number): Promise<boolean> {
    if (n < 1 || n > 5) {
      throw new Error('Invalid label density');
    }
    const data = await this.sendPackage(NiimbotPackageCode.SET_LABEL_DENSITY, [n], 16);
    return Boolean(data[0]);
  }

  public async startPrint(): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.START_PRINT, [0x01]);
    return Boolean(data[0]);
  }

  public async endPrint(): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.END_PRINT, [0x01]);
    return Boolean(data[0]);
  }

  public async startPagePrint(): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.START_PAGE_PRINT, [0x01]);
    return Boolean(data[0]);
  }

  public async endPagePrint(): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.END_PAGE_PRINT, [0x01]);
    return Boolean(data[0]);
  }

  public async allowPrintClear(): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.ALLOW_PRINT_CLEAR, [0x01], 16);
    return Boolean(data[0]);
  }

  public async setDimension({ w, h }: { w: number; h: number }): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.SET_DIMENSION, [h >> 8, h & 0xff, w >> 8, w & 0xff]);
    return Boolean(data[0]);
  }

  public async setQuantity(n: number): Promise<boolean> {
    const data = await this.sendPackage(NiimbotPackageCode.SET_QUANTITY, [n >> 8, n & 0xff]);
    return Boolean(data[0]);
  }

  public async getPrintStatus(): Promise<NiimbotPrintStatus> {
    const data = await this.sendPackage(NiimbotPackageCode.GET_PRINT_STATUS, [0x01], 16);
    return { page: data[0], progress1: data[1], progress2: data[2] };
  }

  public async getDeviceStatus() {
    const denisty = await this.getDensity();
    const printSpeed = await this.getPrintSpeed();
    const labelType = await this.getLabelType();
    const language = await this.getLanguageType();
    const autoShutdownTime = await this.getAutoShutdownTime();
    const deviceType = await this.getDeviceType();
    const softVersion = await this.getSoftVersion();
    const hardVersion = await this.getHardVersion();
    const battery = await this.getBattery();
    const serial = await this.getDeviceSerial();
    const rfid = await this.getRfid();
    const heartbeat = await this.getHeartbeat();
    const printStaus = await this.getPrintStatus();
    return {
      denisty,
      printSpeed,
      labelType,
      language,
      autoShutdownTime,
      deviceType,
      softVersion,
      hardVersion,
      battery,
      serial,
      rfid,
      heartbeat,
      printStaus,
    };
  }

  public async printImage(ctx: CanvasRenderingContext2D, width: number, height: number, density: number = 5) {
    const densityRes = await this.setLabelDensity(density);
    if (!densityRes) throw new Error('Failed to set density');

    const labelTypeRes = await this.setLabelType(1);
    if (!labelTypeRes) throw new Error('Failed to set label type');

    const startPrintRes = await this.startPrint();
    if (!startPrintRes) throw new Error('Failed to start print');

    this.dispatchEvent(new CustomEvent('printStart'));

    const allowPrintClearRes = await this.allowPrintClear(); // Something unsupported in protocol decoding (B21)
    if (!allowPrintClearRes) throw new Error('Failed to allow print clear');

    const startPagePrintRes = await this.startPagePrint();
    if (!startPagePrintRes) throw new Error('Failed to start page print');

    const setDimensionRes = await this.setDimension({ w: width, h: height });
    if (!setDimensionRes) throw new Error('Failed to set dimension');

    const setQuantityRes = await this.setQuantity(1); // Same thing (B21)
    if (!setQuantityRes) throw new Error('Failed to set quantity');

    const imgData = ctx.getImageData(0, 0, width, height);

    for (const pkt of this.encodeImage(imgData)) {
      await this.send(encodeNiimbotPackage({ code: NiimbotPackageCode.IMG_LINE, data: new Uint8Array(pkt) }));
    }

    const endPagePrintRes = await this.endPagePrint();
    if (!endPagePrintRes) throw new Error('Failed to end page print');

    // Wait page print finish

    let pagePrintEnded = false;
    while (!pagePrintEnded) {
      const status = await this.getPrintStatus();
      pagePrintEnded = status.progress1 === 1;
      if (!pagePrintEnded) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Wait print page end

    while (!(await this.endPrint())) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.dispatchEvent(new CustomEvent('printEnd'));
  }

  private *encodeImage(imgData: ImageData): IterableIterator<number[]> {
    const width = imgData.width;
    const height = imgData.height;
    const data = imgData.data;

    for (let y = 0; y < height; y++) {
      let bits = '';
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4; // Get index in image data array
        const r = data[i]; // Get red value
        const g = data[i + 1]; // Get green value
        const b = data[i + 2]; // Get blue value
        const a = data[i + 3]; // Get alpha value
        // bits += '1'; // Print black
        if (a > 0) {
          // If pixel is not transparent
          const grayscale = 0.21 * r + 0.72 * g + 0.07 * b;
          bits += grayscale > 128 ? '0' : '1'; // Convert to binary string
        } else {
          // If pixel is transparent
          bits += '0';
        }
      }

      // Convert binary string to bytes

      const bytes: number[] = [];
      while (bits.length > 0) {
        const byte = bits.substring(0, 8);
        bits = bits.substring(8);
        bytes.push(parseInt(byte.padEnd(8, '0'), 2));
      }

      const header = [
        y >> 8,
        y & 0xff, // Convert y to two bytes (big-endian)
        ...[0, 0, 0], // It seems like you can always send zeros
        1, // Additional byte (as in Python code)
      ];
      yield [...header, ...bytes];
    }
  }

  /**
   * Packages
   */

  public async sendPackage(code: NiimbotPackageCode, data: number[], respCmdOffset: number = 1): Promise<Uint8Array> {
    const expectedRespCode = code + respCmdOffset;
    log.debug('send', code, data);
    await this.send(encodeNiimbotPackage({ code, data: new Uint8Array(data) }));
    log.debug('send done', code);
    const pckg = await this.waitForPackage({ timeout: 5000, expectedCode: expectedRespCode });
    log.debug('got package', pckg.code, pckg.data);
    if (pckg.code === NiimbotPackageCode.NOT_IMPLEMENTED) {
      throw new Error('Command not implemented');
    }
    if (pckg.code === NiimbotPackageCode.VALUE_ERROR) {
      throw new Error('Value error');
    }
    if (pckg.code !== expectedRespCode) {
      throw new Error('Unexpected response');
    } else {
      return pckg.data;
    }
  }

  private async waitForPackage({ timeout, expectedCode }: { timeout?: number; expectedCode?: number } = { timeout: 5000 }) {
    return new Promise<NiimbotPackage>((resolve, reject) => {
      log.debug('wait for package', { expectedCode, timeout });
      const timeoutHandler = setTimeout(() => {
        log.debug('timeout', expectedCode);
        reject(new Error('Getting package timeout'));
      }, timeout);
      log.debug('callbacks', this.callbaks);
      this.callbaks.push({ timeout: timeoutHandler, expectedCode, resolve, reject });
    });
  }

  private async send(data: Uint8Array) {
    if (this.writer) {
      await this.writer.write(data);
    } else {
      throw new Error('Failded to send data: connection not open');
    }
  }

  /**
   * Static
   */

  static available(): boolean {
    return 'serial' in navigator;
  }

  static async getPorts(): Promise<SerialPort[]> {
    if (!Niimbot.available()) {
      throw new Error('Niimbot not available');
    }
    return navigator.serial.getPorts();
  }
}

export * from './utils';
