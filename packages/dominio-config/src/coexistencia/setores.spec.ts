// Setores da migração: catálogo com o gravado por cima, transições e a ordem da DP-4.
import { SETORES_PRONTIDAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  aguardandoPrimeiro,
  colunaDaSituacao,
  montarSetores,
  type SetorGravado,
  transicaoPermitida,
} from './setores.js';

const gravado = (codigo: string, extra: Partial<SetorGravado> = {}): SetorGravado => ({
  codigo,
  nome: 'Nome gravado',
  onda: 1,
  situacao: 'liberado',
  chaveLiberacao: null,
  conducao: false,
  aceiteCoordenador: false,
  datas: {
    homologacao: null,
    treinamento: null,
    liberado: '2026-11-10',
    acompanhamento: null,
    migrado: null,
  },
  composicao: [],
  ...extra,
});

describe('setores da migração', () => {
  it('o catálogo inteiro aparece; o gravado vale por cima; a chave própria entra nas chaves do lote', () => {
    const r = montarSetores(
      [
        gravado('agendamento', { chaveLiberacao: 'agenda.marcarConsulta' }),
        gravado('setor-novo', { onda: 5, chaveLiberacao: 'x.y' }),
      ],
      (c) => c === 'x.y',
    );
    expect(r).toHaveLength(SETORES_PRONTIDAO.length + 1);
    const ag = r.find((s) => s.codigo === 'agendamento')!;
    expect(ag.gravado).toBe(true);
    expect(ag.situacao).toBe('liberado');
    expect(ag.chaves).toEqual([
      { tipo: 'recurso', chave: 'agenda.consulta' },
      { tipo: 'operacao', chave: 'agenda.marcarConsulta' },
    ]);
    const novo = r.find((s) => s.codigo === 'setor-novo')!;
    expect(novo.definicao).toBeNull();
    expect(novo.chaves).toEqual([{ tipo: 'recurso', chave: 'x.y' }]);
    const naoGravado = r.find((s) => s.codigo === 'faturamento-convenio')!;
    // Não gravado: no outro sistema, com as chaves do catálogo (os recursos do setor da onda 4, M42).
    expect(naoGravado).toMatchObject({ situacao: 'legado', gravado: false });
    expect(naoGravado.chaves.every((c) => c.tipo === 'recurso')).toBe(true);
    // Ordem: onda, depois nome.
    expect(r[0]?.onda).toBe(0);
  });

  it('a chave própria igual a uma do catálogo não repete', () => {
    const r = montarSetores([gravado('agendamento', { chaveLiberacao: 'agenda.consulta' })], () => true);
    expect(r.find((s) => s.codigo === 'agendamento')?.chaves).toEqual([
      { tipo: 'recurso', chave: 'agenda.consulta' },
    ]);
  });

  it('transições: avança um passo, recua para qualquer anterior; data por situação', () => {
    expect(transicaoPermitida('legado', 'homologacao')).toBe(true);
    expect(transicaoPermitida('legado', 'liberado')).toBe(false);
    expect(transicaoPermitida('migrado', 'legado')).toBe(true);
    expect(colunaDaSituacao('legado')).toBeNull();
    expect(colunaDaSituacao('liberado')).toBe('liberado');
  });

  it('DP-4: o ProntoCardio não espera; o Serrano espera até tudo liberado no ProntoCardio', () => {
    expect(aguardandoPrimeiro('pc', null)).toEqual({ aguardando: false, motivo: null });
    expect(aguardandoPrimeiro('hs', null).aguardando).toBe(true);
    expect(aguardandoPrimeiro('hs', [{ situacao: 'liberado' }, { situacao: 'legado' }]).motivo).toContain(
      '1 setor',
    );
    expect(aguardandoPrimeiro('hs', [{ situacao: 'migrado' }, { situacao: 'acompanhamento' }])).toEqual({
      aguardando: false,
      motivo: null,
    });
  });
});
