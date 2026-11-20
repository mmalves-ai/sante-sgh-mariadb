// TPB da transação de escrita montado à mão (driver-nativo.ts): os bytes que o Firebird recebe.
import { describe, expect, it } from 'vitest';
import { tpbEscrita } from './driver-nativo.js';

describe('tpbEscrita', () => {
  it('READ COMMITTED RECORD_VERSION, WRITE, WAIT e LOCK TIMEOUT em 4 bytes little-endian', () => {
    // isc_tpb_version1=1, write=9, wait=6, read_committed=15, rec_version=17, lock_timeout=21
    expect([...tpbEscrita(5)]).toEqual([1, 9, 6, 15, 17, 21, 4, 5, 0, 0, 0]);
    expect([...tpbEscrita(60)].slice(7)).toEqual([60, 0, 0, 0]);
  });

  it('SNAPSHOT (concurrency=2) para a captura desfeita do M03', () => {
    expect([...tpbEscrita(5, true)]).toEqual([1, 9, 6, 2, 21, 4, 5, 0, 0, 0]);
  });

  it('M19: NO WAIT (fila concorrente) sem LOCK TIMEOUT: a trava ocupada falha na hora', () => {
    // isc_tpb_nowait=7
    expect([...tpbEscrita(5, false, true)]).toEqual([1, 9, 7, 15, 17]);
  });

  it.each([0, 61, 1.5, -1])('LOCK TIMEOUT %s é recusado', (s) => {
    expect(() => tpbEscrita(s)).toThrow(/LOCK TIMEOUT/);
  });
});
