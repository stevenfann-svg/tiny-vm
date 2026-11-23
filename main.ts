import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// [imm_bytes, pops, pushes] per opcode byte; undefined = invalid
const META: Record<number, [number, number, number]> = {
  0x00:[0,0,0], 0x01:[1,0,1], 0x02:[4,0,1], 0x03:[0,1,0], 0x04:[0,1,2],
  0x05:[0,2,2], 0x06:[0,2,3], 0x07:[0,3,3],
  0x10:[0,2,1], 0x11:[0,2,1], 0x12:[0,2,1], 0x13:[0,2,1], 0x14:[0,2,1],
  0x15:[0,2,1], 0x16:[0,2,1], 0x17:[0,1,1], 0x18:[0,2,1], 0x19:[0,2,1],
  0x1a:[0,2,1], 0x1b:[0,1,1], 0x1c:[0,2,1], 0x1d:[0,2,1], 0x1e:[0,2,1],
  0x20:[0,2,1], 0x21:[0,2,1], 0x22:[0,2,1],
  0x30:[2,0,0], 0x31:[2,1,0], 0x32:[2,1,0], 0x33:[2,0,0], 0x34:[0,0,0],
  0x40:[0,1,1], 0x41:[0,2,0],
  0x50:[0,1,0], 0x51:[0,1,0], 0x52:[0,0,1], 0x53:[0,1,0],
};

const enc = new TextEncoder();

function run(prog: Uint8Array, inp: Uint8Array): { out: Uint8Array; exit: number } {
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let csp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let olen = 0;
  let inPos = 0;
  let ip = 0;
  let steps = 0;
  const n = prog.length;
  const tr = (c: number) => ({ out: out.slice(0, olen), exit: c });

  for (;;) {
    if (steps === 1_000_000) return tr(10);
    if (ip < 0 || ip >= n) return tr(9);
    const op = prog[ip];
    const m = META[op];
    if (!m) return tr(5);
    const [imm, pops, pushes] = m;
    if (imm > 0 && ip + imm >= n) return tr(9);
    steps++;
    const next = ip + 1 + imm;
    if (sp < pops) return tr(2);
    if (sp - pops + pushes > 256) return tr(3);
    ip = next;

    switch (op) {
      case 0x00: return { out: out.slice(0, olen), exit: 0 };
      case 0x01: D[sp++] = (prog[next-1] << 24) >> 24; break;
      case 0x02: D[sp++] = prog[next-4] | (prog[next-3]<<8) | (prog[next-2]<<16) | (prog[next-1]<<24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp-1]; sp++; break;
      case 0x05: { const t=D[sp-1]; D[sp-1]=D[sp-2]; D[sp-2]=t; break; }
      case 0x06: D[sp]=D[sp-2]; sp++; break;
      case 0x07: { const a=D[sp-3]; D[sp-3]=D[sp-2]; D[sp-2]=D[sp-1]; D[sp-1]=a; break; }
      case 0x10: { const b=D[--sp]; D[sp-1]=(D[sp-1]+b)|0; break; }
      case 0x11: { const b=D[--sp]; D[sp-1]=(D[sp-1]-b)|0; break; }
      case 0x12: { const b=D[--sp]; D[sp-1]=Math.imul(D[sp-1],b); break; }
      case 0x13: { const b=D[--sp]; if(b===0) return tr(4); const a=D[sp-1]; D[sp-1]=a===-2147483648&&b===-1?a:(a/b)|0; break; }
      case 0x14: { const b=D[--sp]; if(b===0) return tr(4); D[sp-1]=b===-1?0:D[sp-1]%b|0; break; }
      case 0x15: { const b=D[--sp]; if(b===0) return tr(4); D[sp-1]=Math.floor((D[sp-1]>>>0)/(b>>>0))|0; break; }
      case 0x16: { const b=D[--sp]; if(b===0) return tr(4); D[sp-1]=(D[sp-1]>>>0)%(b>>>0)|0; break; }
      case 0x17: D[sp-1]=-D[sp-1]|0; break;
      case 0x18: { const b=D[--sp]; D[sp-1]&=b; break; }
      case 0x19: { const b=D[--sp]; D[sp-1]|=b; break; }
      case 0x1a: { const b=D[--sp]; D[sp-1]^=b; break; }
      case 0x1b: D[sp-1]=~D[sp-1]; break;
      case 0x1c: { const b=D[--sp]; D[sp-1]<<=b&31; break; }
      case 0x1d: { const b=D[--sp]; D[sp-1]>>=b&31; break; }
      case 0x1e: { const b=D[--sp]; D[sp-1]=(D[sp-1]>>>(b&31))|0; break; }
      case 0x20: { const b=D[--sp]; D[sp-1]=D[sp-1]===b?1:0; break; }
      case 0x21: { const b=D[--sp]; D[sp-1]=D[sp-1]<b?1:0; break; }
      case 0x22: { const b=D[--sp]; D[sp-1]=(D[sp-1]>>>0)<(b>>>0)?1:0; break; }
      case 0x30: { const r=((prog[next-2]|(prog[next-1]<<8))<<16)>>16; ip=next+r; break; }
      case 0x31: { const r=((prog[next-2]|(prog[next-1]<<8))<<16)>>16; if(D[--sp]===0) ip=next+r; break; }
      case 0x32: { const r=((prog[next-2]|(prog[next-1]<<8))<<16)>>16; if(D[--sp]!==0) ip=next+r; break; }
      case 0x33: if(csp===64) return tr(7); C[csp++]=next; ip=prog[next-2]|(prog[next-1]<<8); break;
      case 0x34: if(csp===0) return tr(8); ip=C[--csp]; break;
      case 0x40: { const a=D[sp-1]; if(a<0||a>=256) return tr(6); D[sp-1]=M[a]; break; }
      case 0x41: { const a=D[sp-1]; if(a<0||a>=256) return tr(6); M[a]=D[sp-2]; sp-=2; break; }
      case 0x50: { const s=D[--sp]; const b=enc.encode(String(s)); if(olen+b.length>65536) return tr(11); out.set(b,olen); olen+=b.length; break; }
      case 0x51: if(olen+1>65536) return tr(11); out[olen++]=D[--sp]&255; break;
      case 0x52: D[sp++]=inPos<inp.length?inp[inPos++]:-1; break;
      case 0x53: return { out: out.slice(0, olen), exit: D[--sp]&255 };
    }
  }
}

for (const id of readdirSync(I).sort()) {
  const prog = readFileSync(join(I, id, 'program.bin'));
  const inp = readFileSync(join(I, id, 'input.bin'));
  const { out, exit } = run(prog, inp);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), out);
  writeFileSync(join(O, id, 'exit.txt'), String(exit) + '\n');
}
