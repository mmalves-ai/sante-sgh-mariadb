// Etiqueta do lactário (ficha do M45, etapa 6): o ZPL comparado como texto com a referência versionada; os dois
// identificadores; a recusa sem data de nascimento e com ID inválido. Dados SINTÉTICOS.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zplEtiquetaLactario } from './lactario.js';
import { ErroZpl } from './modelos.js';

const d = {
  nomeCompleto: 'Lúcia Sintética Rocha',
  nascimento: '2026-09-30',
  prontuario: 70_005,
  internacao: 950_005,
  ordem: 12,
  leito: '2A 203 A',
  formula: 'Fórmula infantil de partida',
  volumeMl: 90,
  horario: '25/10 09:00',
  preparo: '25/10 08:00',
  validade: '26/10 08:00',
  lote: 'L-77',
  conferidoPor: 'SINT.LACTARIO2',
};

describe('etiqueta do lactário (ZPL)', () => {
  it('igual à referência versionada', () => {
    const ref = readFileSync(new URL('./referencias/etiqueta-lactario.zpl', import.meta.url), 'utf8');
    expect(zplEtiquetaLactario(d)).toBe(ref);
  });
  it('os dois identificadores legíveis e o código só com os IDs', () => {
    const z = zplEtiquetaLactario({ ...d, lote: null });
    expect(z).toContain('LÚCIA SINTÉTICA ROCHA');
    expect(z).toContain('NASC. 30/09/2026  PRONT. 70005');
    expect(z).toContain('^FDL950005|O12^FS');
    expect(z).toContain('LOTE -');
  });
  it('recusa sem data de nascimento e com ID inválido', () => {
    expect(() => zplEtiquetaLactario({ ...d, nascimento: '1899-12-30' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaLactario({ ...d, ordem: 0 })).toThrow(/ordem/);
  });
});
