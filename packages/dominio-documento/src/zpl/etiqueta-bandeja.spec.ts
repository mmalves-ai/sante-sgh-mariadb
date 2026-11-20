// Etiqueta de bandeja (ficha do M45, regra 12; seção 10, "mapa de dietas com jejum do bloco e etiqueta ZPL"): o ZPL é
// comparado como texto com a referência versionada (referencias/etiqueta-bandeja.zpl); a impressão física e a leitura
// pela copa são da validação humana. Dois identificadores (nome completo e nascimento), leito, dieta, restrições e a
// alergia alimentar em destaque; o código só com a internação e a refeição. Dados sintéticos.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErroZpl, zplEtiquetaBandeja } from './modelos.js';

const d = {
  nomeCompleto: 'Paciente Sintético da Silva',
  nascimento: '1950-03-07',
  prontuario: 70011,
  internacao: 500123,
  leito: '2A 201 B',
  refeicao: 'Almoço 11:45',
  data: '25/10/2026',
  dieta: 'Dieta oral',
  restricoes: 'Branda, Hipossódica',
  alergias: ['Leite', 'Amendoim'],
  acompanhante: true,
  codigoRefeicao: 2,
};

describe('etiqueta de bandeja (ZPL)', () => {
  it('igual à referência versionada', () => {
    const ref = readFileSync(new URL('./referencias/etiqueta-bandeja.zpl', import.meta.url), 'utf8');
    expect(zplEtiquetaBandeja(d)).toBe(ref);
  });
  it('dois identificadores e o código só com os IDs (nunca o nome)', () => {
    const z = zplEtiquetaBandeja(d);
    expect(z).toContain('PACIENTE SINTÉTICO DA SILVA');
    expect(z).toContain('NASC. 07/03/1950  PRONT. 70011');
    expect(z).toContain('^FDI500123R2^FS');
    expect(z).toContain('ALERGIA ALIMENTAR: LEITE, AMENDOIM');
  });
  it('jejum sem restrição, sem alergia e sem acompanhante: sem as linhas opcionais', () => {
    const z = zplEtiquetaBandeja({
      ...d,
      dieta: 'JEJUM (cirurgia 15:00)',
      restricoes: null,
      alergias: [' '],
      acompanhante: false,
    });
    expect(z).toContain('JEJUM (CIRURGIA 15:00)');
    expect(z).not.toContain('ALERGIA');
    expect(z).not.toContain('ACOMPANHANTE');
    expect(z).not.toContain('^GB');
  });
  it('recusa nascimento ausente, internação inválida, refeição inválida e caractere de comando cru', () => {
    expect(() => zplEtiquetaBandeja({ ...d, nascimento: '1899-12-30' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaBandeja({ ...d, internacao: 0 })).toThrow(/internacao/);
    expect(() => zplEtiquetaBandeja({ ...d, codigoRefeicao: -1 })).toThrow(/Refeição/);
    expect(zplEtiquetaBandeja({ ...d, dieta: 'A^B~C_D' })).toContain('A_5EB_7EC_5FD');
  });
});
