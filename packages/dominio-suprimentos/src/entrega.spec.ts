// Regras 5 e 6 (ficha do M29): "Entregue" só com o aceite da enfermagem (leitura ou tablet), com autor e hora, e a dose
// ainda em 7; a dose não administrada vira sugestão de devolução com o lote; a devolução até a quantidade dispensada.
import { describe, expect, it } from 'vitest';
import {
  codigoEtiquetaDose,
  conferirAceiteEntrega,
  conferirDevolucaoDose,
  etiquetasAceitas,
  sugestoesDevolucao,
} from '@sgh/contratos/regras-suprimentos';

const etq = codigoEtiquetaDose({ dose: 900, item: 7, barras: null, lote: 'L1', validade: '2027-01-31' });
const b = {
  situacao: 7,
  modo: 'tablet' as const,
  etiquetas: etiquetasAceitas(etq),
  autor: 'ENF.SINTETICA',
  dispensador: 'FARM.SINTETICA',
  podeAceitar: true,
};

describe('aceite da entrega (regra 5)', () => {
  it('no tablet, com autor da enfermagem: aceita', () => {
    expect(conferirAceiteEntrega(b)).toBeNull();
    expect(conferirAceiteEntrega({ ...b, dispensador: null })).toBeNull();
  });
  it('situação: estornada, já entregue, não dispensada', () => {
    expect(conferirAceiteEntrega({ ...b, situacao: 9 })?.codigo).toBe('dose-estornada');
    expect(conferirAceiteEntrega({ ...b, situacao: 8 })?.codigo).toBe('ja-entregue');
    expect(conferirAceiteEntrega({ ...b, situacao: null })?.codigo).toBe('nao-dispensada');
  });
  it('sem permissão, sem autor, o próprio dispensador', () => {
    expect(conferirAceiteEntrega({ ...b, podeAceitar: false })?.codigo).toBe('sem-permissao-aceite');
    expect(conferirAceiteEntrega({ ...b, autor: ' ' })?.codigo).toBe('sem-autor');
    expect(conferirAceiteEntrega({ ...b, autor: 'farm.sintetica' })?.codigo).toBe('aceite-pelo-dispensador');
  });
  it('por leitura: o dado do DataMatrix, o legível ou a série no fim; outra etiqueta é recusada', () => {
    const l = { ...b, modo: 'leitura' as const };
    expect(conferirAceiteEntrega({ ...l, leitura: etq.dado })).toBeNull();
    expect(conferirAceiteEntrega({ ...l, leitura: etq.legivel })).toBeNull();
    expect(conferirAceiteEntrega({ ...l, leitura: `]d2${etq.dado.split('\u001d').join('')}` })).toBeNull();
    expect(conferirAceiteEntrega({ ...l, leitura: '91IT710L121D901' })?.codigo).toBe('etiqueta-diferente');
    expect(conferirAceiteEntrega({ ...l, leitura: null })?.codigo).toBe('etiqueta-diferente');
    expect(conferirAceiteEntrega({ ...l, leitura: 'x', etiquetas: [''] })?.codigo).toBe('etiqueta-diferente');
  });
});

describe('sugestão de devolução (regra 6)', () => {
  const doses = [
    { dose: 1, horario: 11, item: 7, quantidade: 1, itemSaida: 70, lote: 'L1', validade: '2027-01-31' },
    { dose: 2, horario: 12, item: 7, quantidade: 1, itemSaida: 71, lote: null, validade: null },
    { dose: 3, horario: 13, item: 8, quantidade: 2, itemSaida: 72, lote: null, validade: null },
    { dose: 4, horario: null, item: 8, quantidade: 2, itemSaida: 73, lote: null, validade: null },
    { dose: 5, horario: 15, item: 8, quantidade: 2, itemSaida: 74, lote: null, validade: null },
    { dose: 6, horario: 16, item: 8, quantidade: 2, itemSaida: 75, lote: null, validade: null },
    { dose: 7, horario: 17, item: 8, quantidade: 2, itemSaida: 76, lote: null, validade: null },
  ];
  const situacoes = new Map([
    [11, { situacao: 'N', em: '2026-10-23T08:10' }],
    [12, { situacao: 'A', em: '2026-10-23T08:10' }],
    [13, { situacao: 'S', em: null }],
    [15, { situacao: 'X', em: null }],
    [16, { situacao: 'C', em: null }],
    [17, { situacao: 'n', em: null }],
  ]);
  it('não administrado (N, X) e suspenso (S, C), com o lote; administrado, pendente e sem horário não; a devolvida não volta', () => {
    const s = sugestoesDevolucao(doses, situacoes, new Set([16]));
    expect(s.map((x) => [x.dose, x.motivo])).toEqual([
      [1, 'nao-administrado'],
      [3, 'suspenso'],
      [5, 'nao-administrado'],
      [6, 'suspenso'],
    ]);
    expect(s[0]!.lote).toBe('L1');
    expect(sugestoesDevolucao(doses, situacoes, new Set([1, 3, 5, 6]))).toHaveLength(0);
  });
});

describe('devolução de dose', () => {
  const b = { quantidade: 1, dispensada: 2, jaDevolvida: 0, lote: 'L1', loteInformado: 'L1' };
  it('até a dispensada, o mesmo lote', () => {
    expect(conferirDevolucaoDose(b)).toBeNull();
    expect(conferirDevolucaoDose({ ...b, lote: null, loteInformado: null })).toBeNull();
    expect(conferirDevolucaoDose({ ...b, quantidade: 0 })?.codigo).toBe('quantidade-invalida');
    expect(conferirDevolucaoDose({ ...b, jaDevolvida: 1.5 })?.codigo).toBe('quantidade-maior-que-a-saida');
    expect(conferirDevolucaoDose({ ...b, loteInformado: 'L2' })?.codigo).toBe('lote-diferente');
    expect(conferirDevolucaoDose({ ...b, loteInformado: null })?.codigo).toBe('lote-diferente');
  });
});
