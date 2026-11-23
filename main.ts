// Tiny stack VM for make.fun's tiny stack ISA v1: runs every
// /input/<id>/ program and writes /output/<id>/stdout.bin + exit.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [popped, pushed, immediate bytes] per opcode; missing = unknown (trap 5).
const META = {
  0x00: [0, 0, 0], 0x01: [0, 1, 1], 0x02: [0, 1, 4], 0x03: [1, 0, 0],
  0x04: [1, 2, 0], 0x05: [2, 2, 0], 0x06: [2, 3, 0], 0x07: [3, 3, 0],
  0x10: [2, 1, 0], 0x11: [2, 1, 0], 0x12: [2, 1, 0], 0x13: [2, 1, 0],
  0x14: [2, 1, 0], 0x15: [2, 1, 0], 0x16: [2, 1, 0], 0x17: [1, 1, 0],
  0x18: [2, 1, 0], 0x19: [2, 1, 0], 0x1a: [2, 1, 0], 0x1b: [1, 1, 0],
  0x1c: [2, 1, 0], 0x1d: [2, 1, 0], 0x1e: [2, 1, 0],
  0x20: [2, 1, 0], 0x21: [2, 1, 0], 0x22: [2, 1, 0],
  0x30: [0, 0, 2], 0x31: [1, 0, 2], 0x32: [1, 0, 2], 0x33: [0, 0, 2],
  0x34: [0, 0, 0],
  0x40: [1, 1, 0], 0x41: [2, 0, 0],
  0x50: [1, 0, 0], 0x51: [1, 0, 0], 0x52: [0, 1, 0], 0x53: [1, 0, 0],
};

// Run one program -> [exit code, output]. Traps throw their code;
// HALT and EXIT return; output written before a trap is kept.
function run(prog, input) {
  const mem = new Int32Array(256);
  const st = new Int32Array(256);
  const cs = new Int32Array(64);
  const out = Buffer.allocUnsafe(65536);
  const n = prog.length;
  let sp = 0, cp = 0, pc = 0, ip = 0, ol = 0, steps = 0;
  const done = (code) => [code, out.subarray(0, ol)];
  try {
    for (;;) {
      if (steps === 1000000) throw 10; // step limit
      if (pc < 0 || pc >= n) throw 9; // pc outside the program
      const op = prog[pc];
      const m = META[op];
      if (m === undefined) throw 5; // unknown opcode
      if (pc + 1 + m[2] > n) throw 9; // immediate cut off
      if (sp < m[0]) throw 2; // stack underflow
      if (sp - m[0] + m[1] > 256) throw 3; // stack overflow
      const next = pc + 1 + m[2];
      let a, b, t;
      switch (op) {
        case 0x00: return done(0); // HALT
        case 0x01: st[sp++] = (prog[pc + 1] << 24) >> 24; break; // PUSH8, sign-extended
        case 0x02: st[sp++] = prog.readInt32LE(pc + 1); break; // PUSH32
        case 0x03: sp--; break; // POP
        case 0x04: st[sp] = st[sp - 1]; sp++; break; // DUP
        case 0x05: t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; break; // SWAP
        case 0x06: st[sp] = st[sp - 2]; sp++; break; // OVER
        case 0x07: // ROT (a b c -- b c a)
          t = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = t;
          break;
        case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
        case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
        case 0x20: case 0x21: case 0x22: // binary ops: b is the top
          b = st[--sp]; a = st[sp - 1];
          switch (op) {
            case 0x10: a = (a + b) | 0; break; // ADD, wraps
            case 0x11: a = (a - b) | 0; break; // SUB, wraps
            case 0x12: a = Math.imul(a, b); break; // MUL, low 32 bits
            case 0x13: if (b === 0) throw 4; a = (a / b) | 0; break; // DIV, toward zero
            case 0x14: if (b === 0) throw 4; a = (a % b) | 0; break; // MOD, sign of a
            case 0x15: if (b === 0) throw 4; a = ((a >>> 0) / (b >>> 0)) | 0; break; // DIVU
            case 0x16: if (b === 0) throw 4; a = ((a >>> 0) % (b >>> 0)) | 0; break; // MODU
            case 0x18: a = a & b; break; // AND
            case 0x19: a = a | b; break; // OR
            case 0x1a: a = a ^ b; break; // XOR
            case 0x1c: a = a << (b & 31); break; // SHL
            case 0x1d: a = a >> (b & 31); break; // SHR, arithmetic
            case 0x1e: a = (a >>> (b & 31)) | 0; break; // SHRU, logical
            case 0x20: a = a === b ? 1 : 0; break; // EQ
            case 0x21: a = a < b ? 1 : 0; break; // LT, signed
            case 0x22: a = (a >>> 0) < (b >>> 0) ? 1 : 0; break; // LTU, unsigned
          }
          st[sp - 1] = a;
          break;
        case 0x17: st[sp - 1] = (-st[sp - 1]) | 0; break; // NEG, wraps
        case 0x1b: st[sp - 1] = ~st[sp - 1]; break; // NOT
        case 0x30: pc = next + prog.readInt16LE(pc + 1); steps++; continue; // JMP
        case 0x31: pc = st[--sp] === 0 ? next + prog.readInt16LE(pc + 1) : next; steps++; continue; // JZ
        case 0x32: pc = st[--sp] !== 0 ? next + prog.readInt16LE(pc + 1) : next; steps++; continue; // JNZ
        case 0x33: // CALL: push the next address, jump to the unsigned immediate
          if (cp === 64) throw 7;
          cs[cp++] = next; pc = prog.readUInt16LE(pc + 1); steps++; continue;
        case 0x34: // RET
          if (cp === 0) throw 8;
          pc = cs[--cp]; steps++; continue;
        case 0x40: // LOAD
          a = st[sp - 1];
          if (a < 0 || a > 255) throw 6;
          st[sp - 1] = mem[a];
          break;
        case 0x41: // STORE (v addr --): the address is the top
          a = st[--sp]; b = st[--sp];
          if (a < 0 || a > 255) throw 6;
          mem[a] = b;
          break;
        case 0x50: { // PRINT: decimal ASCII; over the cap traps 11
          const s = String(st[--sp]);
          if (ol + s.length > 65536) throw 11;
          for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
          break;
        }
        case 0x51: // PUTC: one byte, v AND 255
          if (ol + 1 > 65536) throw 11;
          out[ol++] = st[--sp] & 255;
          break;
        case 0x52: st[sp++] = ip < input.length ? input[ip++] : -1; break; // IN
        case 0x53: return done(st[--sp] & 255); // EXIT with the low byte
      }
      pc = next;
      steps++;
    }
  } catch (e) {
    if (typeof e === 'number') return done(e);
    throw e;
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  let prog, input;
  try { prog = readFileSync(join(IN_DIR, id, 'program.bin')); } catch { prog = Buffer.alloc(0); }
  try { input = readFileSync(join(IN_DIR, id, 'input.bin')); } catch { input = Buffer.alloc(0); }
  const [code, out] = run(prog, input);
  const dir = join(OUT_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stdout.bin'), out);
  writeFileSync(join(dir, 'exit.txt'), code + '\n');
}
