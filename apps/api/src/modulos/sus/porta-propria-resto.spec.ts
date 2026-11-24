// Unidade das regras puras de porta-propria-resto.ts: as folhas do BPA (boletim de produção ambulatorial) pela linha
// numerada, o tipo e o período da APAC (autorização de procedimento de alta complexidade) e as contagens da CIHA
// (comunicação de internação hospitalar) por modalidade.
import { describe, expect, it } from 'vitest';
import {
  atendimentoDaConta,
  contagemCiha,
  folhasDoBpa,
  periodoApac,
  tipoApacDoArquivo,
} from './porta-propria-resto.js';
import type { LinhaBpaParaGravar, RegistroCihaParaGravar } from './tipos.js';

const linha = (tipo: 'c' | 'i', folha: number, sequencia: number): LinhaBpaParaGravar => ({
  tipo,
  folha,
  sequencia,
  procedimento: '0301010072',
  cbo: '225125',
  idade: tipo === 'c' ? 40 : null,
  quantidade: 1,
  data: tipo === 'i' ? '2026-03-10' : null,
  conta: null,
  atendimento: null,
  registro: null,
});

describe('regras das linhas guardadas dos arquivos do SUS', () => {
  it('agrupa as linhas do BPA por tipo e folha, na ordem do arquivo', () => {
    const f = folhasDoBpa([linha('c', 1, 1), linha('c', 1, 2), linha('i', 1, 1), linha('c', 2, 1)]);
    expect(f.map((x) => [x.tipo, x.folha, x.linhas.length])).toEqual([
      ['c', 1, 2],
      ['i', 1, 1],
      ['c', 2, 1],
    ]);
  });

  it('dá o tipo da APAC pelo tipo no arquivo', () => {
    expect([tipoApacDoArquivo('1'), tipoApacDoArquivo('2'), tipoApacDoArquivo('3')]).toEqual([
      'inicial',
      'continuidade',
      'unica',
    ]);
  });

  it('corta o período da APAC pela validade da autorização dentro da competência', () => {
    expect(periodoApac('202602', { inicio: null, fim: null })).toEqual({
      inicio: '2026-02-01',
      fim: '2026-02-28',
    });
    expect(periodoApac('202603', { inicio: '2026-03-10', fim: '2026-06-09' })).toEqual({
      inicio: '2026-03-10',
      fim: '2026-03-31',
    });
    expect(periodoApac('202606', { inicio: '2026-03-10', fim: '2026-06-09' })).toEqual({
      inicio: '2026-06-01',
      fim: '2026-06-09',
    });
    // Validade que não alcança a competência: sem período (a gravação recusa, nunca cai na competência inteira).
    expect(periodoApac('202608', { inicio: '2026-03-10', fim: '2026-06-09' })).toBeNull();
    expect(periodoApac('202602', { inicio: '2026-03-10', fim: '2026-06-09' })).toBeNull();
  });

  it('aceita o atendimento informado só quando é o da conta', () => {
    expect(atendimentoDaConta(null, 7, 'da CIHA')).toBe(7);
    expect(atendimentoDaConta(undefined, null, 'do BPA')).toBeNull();
    expect(atendimentoDaConta(7, 7, 'da CIHA')).toBe(7);
    expect(() => atendimentoDaConta(8, 7, 'da CIHA')).toThrow(
      expect.objectContaining({ problema: expect.objectContaining({ codigo: 'atendimento-divergente' }) }),
    );
    expect(() => atendimentoDaConta(8, null, 'do BPA')).toThrow(
      expect.objectContaining({ problema: expect.objectContaining({ codigo: 'atendimento-divergente' }) }),
    );
  });

  it('conta os registros da CIHA por modalidade', () => {
    const r = (modalidade: 'internacao' | 'ambulatorial'): RegistroCihaParaGravar => ({
      modalidade,
      conta: 1,
      atendimento: 1,
      registro: 1,
      fonte: 'plano-privado',
      cidPrincipal: 'I10',
      procedimentoPrincipal: '0301010072',
      procedimentos: 1,
    });
    expect(contagemCiha([r('internacao'), r('ambulatorial'), r('ambulatorial')])).toEqual({
      quantidade_registro_internacao: 1,
      quantidade_registro_ambulatorial: 2,
    });
  });
});
