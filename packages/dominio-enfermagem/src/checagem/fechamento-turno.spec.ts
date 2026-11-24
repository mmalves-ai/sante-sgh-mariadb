import { describe, expect, it } from 'vitest';
import {
  conferirFechamentoChecagem,
  conferirReabertura,
  justificativaDaLeitura,
  lerEtiqueta,
  resultadoLeituraLote,
  resumirFechamento,
} from './fechamento-turno.js';

const h = (id: number, letra: string, travado = false) => ({ id, letra, travado });

describe('fechamento da checagem do turno', () => {
  it('trava só os resolvidos; os pendentes seguem para o próximo turno', () => {
    const r = resumirFechamento([h(1, 'A'), h(2, 'N'), h(3, 'S'), h(4, 'P'), h(5, 'A', true), h(6, 'p')]);
    expect(r).toMatchObject({ total: 6, administrados: 3, naoAdministrados: 1, suspensos: 1, jaTravados: 1 });
    expect(r.aTravar).toEqual([1, 2, 3, 6]);
    expect(r.pendentes).toEqual([4]);
  });
  it('com pendência exige justificativa; sem pendência fecha sem ela', () => {
    const com = resumirFechamento([h(1, 'A'), h(2, 'P')]);
    expect(conferirFechamentoChecagem(com, null)?.codigo).toBe('pendencias-sem-justificativa');
    expect(conferirFechamentoChecagem(com, 'curta')?.codigo).toBe('pendencias-sem-justificativa');
    expect(conferirFechamentoChecagem(com, 'Paciente em exame externo, dose passada ao noturno')).toBeNull();
    expect(conferirFechamentoChecagem(resumirFechamento([h(1, 'A'), h(2, 'N')]), null)).toBeNull();
  });
  it('recusa turno vazio, já fechado ou só com pendentes', () => {
    expect(conferirFechamentoChecagem(resumirFechamento([]), null)?.codigo).toBe('turno-sem-horarios');
    expect(conferirFechamentoChecagem(resumirFechamento([h(1, 'A', true)]), null)?.codigo).toBe(
      'turno-ja-fechado',
    );
    expect(conferirFechamentoChecagem(resumirFechamento([h(1, 'P')]), 'justificativa longa')?.codigo).toBe(
      'turno-sem-horarios',
    );
  });
  it('reabre só o vigente e sempre com motivo', () => {
    expect(conferirReabertura('reaberto', 'motivo bem explicado')).toMatch(/já foi reaberto/);
    expect(conferirReabertura('fechado', ' ')).toMatch(/motivo/);
    expect(conferirReabertura('fechado', 'Checagem lançada no paciente errado')).toBeNull();
  });
});

describe('leitura do produto e do lote na administração', () => {
  const lote = { insumo: 7, validade: '2027-01-31', situacao: 'liberado' };
  const base = { insumoDoCodigo: 7, lote, validadeLida: null, dataAdministracao: '2026-11-24' };
  it('confere produto, situação e validade do lote', () => {
    expect(resultadoLeituraLote(base)).toBe('conforme');
    expect(resultadoLeituraLote({ ...base, insumoDoCodigo: 8 })).toBe('produto_divergente');
    expect(resultadoLeituraLote({ ...base, lote: { ...lote, situacao: 'bloqueado' } })).toBe(
      'lote_bloqueado',
    );
    expect(resultadoLeituraLote({ ...base, lote: { ...lote, validade: '2026-11-23' } })).toBe('lote_vencido');
    expect(resultadoLeituraLote({ ...base, lote: { ...lote, situacao: 'vencido' } })).toBe('lote_vencido');
    expect(resultadoLeituraLote({ ...base, insumoDoCodigo: null, lote: null })).toBe('nao_identificado');
    expect(resultadoLeituraLote({ ...base, lote: null, validadeLida: '2026-01-01' })).toBe('lote_vencido');
  });
  it('o que não confere só segue com a justificativa', () => {
    expect(justificativaDaLeitura('conforme', null)).toEqual({ justificativa: null });
    expect(justificativaDaLeitura('lote_vencido', null)).toHaveProperty('recusa');
    expect(justificativaDaLeitura('nao_identificado', 'Lote da farmácia satélite, sem cadastro')).toEqual({
      justificativa: 'Lote da farmácia satélite, sem cadastro',
    });
  });
});

describe('pendentes passados ao turno seguinte', () => {
  const a = (id: number, letra: string, extra: { travado?: boolean; passouPendente?: boolean } = {}) => ({
    id,
    letra,
    travado: extra.travado ?? false,
    anterior: true,
    passouPendente: extra.passouPendente ?? false,
  });
  it('o pendente do turno anterior volta ao fechamento seguinte; o resolvido depois é travado por ele', () => {
    const r = resumirFechamento([
      a(1, 'P'),
      a(2, 'A', { passouPendente: true }),
      a(3, 'A'),
      a(4, 'A', { travado: true }),
      h(5, 'A'),
    ]);
    expect(r.pendentes).toEqual([1]);
    expect(r.pendentesAnteriores).toEqual([1]);
    expect(r.aTravar).toEqual([2, 5]);
    expect(r.total).toBe(3);
    expect(conferirFechamentoChecagem(r, null)?.codigo).toBe('pendencias-sem-justificativa');
  });
});

describe('leitura da etiqueta', () => {
  const GS = String.fromCharCode(29);
  it('código linear: só o produto, por código de barras', () => {
    expect(lerEtiqueta(' 7891234567895 ')).toEqual({
      codigo: '7891234567895',
      lote: null,
      validade: null,
      meio: 'codigo_barras',
    });
  });
  it('GS1 com parênteses e com separador: GTIN, validade e lote, por DataMatrix', () => {
    const esperado = { codigo: '7891234567895', lote: 'AB12', validade: '2027-03-31', meio: 'datamatrix' };
    expect(lerEtiqueta('(01)07891234567895(17)270300(10)AB12')).toEqual(esperado);
    expect(lerEtiqueta(`]d2010789123456789517270331` + `10AB12${GS}21XYZ`)).toEqual(esperado);
    expect(lerEtiqueta(`0107891234567895${GS}10AB12${GS}17270331`)).toEqual(esperado);
  });
  it('validade GS1 inválida fica nula', () => {
    expect(lerEtiqueta('(01)07891234567895(17)271301').validade).toBeNull();
  });
});
