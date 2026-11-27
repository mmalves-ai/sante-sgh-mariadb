// Contrato de efeito da rotina "destino confirmado -> aferição" (decisão 62): o que ela deixa no banco, sobre um
// dublê do Escritor que guarda as linhas gravadas por tabela (sem banco; valores inventados).
import type { Escritor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { extrairDestinoConfirmado } from './extracao-destino-propria.js';

type Linha = Record<string, unknown>;

function banco(destino: Linha | null) {
  const respostas: Linha[] = [
    { id: 1, valor_numero: 36.5, valor_texto: null, unidade: null },
    { id: 2, valor_numero: null, valor_texto: '39,1', unidade: '°C' },
    { id: 3, valor_numero: null, valor_texto: 'afebril', unidade: null },
    { id: 4, valor_numero: 365, valor_texto: null, unidade: null },
    { id: 5, valor_numero: 98.6, valor_texto: null, unidade: '°F' },
  ].map((r) => ({
    ...r,
    registro_id: 100 + Number(r.id),
    estabelecimento_id: 1,
    paciente_id: 50,
    atendimento_id: 60,
    setor_funcional_id: 3,
    autor_profissional_id: 8,
    data_hora_clinica: new Date(Date.UTC(2020, 0, Number(r.id))),
  }));
  const tabelas: Record<string, Linha[]> = { afericao: [], afericao_valor: [], destino_campo_extracao: [] };
  const colunas = (sql: string) =>
    /\(([^)]*)\)\s*VALUES/s
      .exec(sql)![1]!
      .split(',')
      .map((c) => c.trim());
  const valores = (sql: string, ps: readonly unknown[]) => {
    let i = 0;
    return /VALUES\s*\((.*)\)\s*$/s
      .exec(sql)![1]!
      .split(',')
      .map((v) => v.trim())
      .map((v) => (v === '?' ? ps[i++] : v === 'NULL' ? null : v === 'TRUE' ? true : v.replace(/'/g, '')));
  };
  const tx = {
    cliente: 'teste',
    uma: async () => destino,
    consultar: async (_sql: string, ps: readonly unknown[] = []) => {
      const tratadas = new Set(
        tabelas['destino_campo_extracao']!.map((x) => x['registro_assistencial_resposta_id']),
      );
      return respostas.filter((r) => !tratadas.has(r['id'])).slice(0, Number(ps[1]));
    },
    inserir: async (sql: string, ps: readonly unknown[] = []) => {
      const t = /INSERT INTO (\w+)/.exec(sql)![1]!;
      const cs = colunas(sql);
      const vs = valores(sql, ps);
      const id = tabelas[t]!.length + 1;
      tabelas[t]!.push(Object.fromEntries([['id', id], ...cs.map((c, k) => [c, vs[k]])]));
      return id;
    },
  } as unknown as Escritor;
  return { tx, tabelas };
}

const DESTINO = {
  ativo: 1,
  entidade_destino: 'afericao',
  parametro_vital_id: 7,
  modelo_campo_id: 9,
  tipo_resposta: 'numero',
  unidade: '°C',
  casas_decimais: 1,
  valor_minimo: '25.0000',
  valor_maximo: '45.0000',
  alerta_minimo: '35.0000',
  alerta_maximo: '37.8000',
};
const AGORA = new Date(Date.UTC(2026, 10, 27, 12));

describe('extrairDestinoConfirmado: contrato de efeito (decisão 62)', () => {
  it('gera aferição migrada com a data do registro, pendência para o recusado, e não duplica ao repetir', async () => {
    const { tx, tabelas } = banco(DESTINO);
    const r = await extrairDestinoConfirmado(tx, 4, AGORA, 77, 10);
    expect(r).toEqual({
      ok: true,
      restantes: false,
      gerados: 2,
      recusados: 3,
      porMotivo: { valor_nao_numerico: 1, fora_da_faixa: 1, unidade_divergente: 1 },
    });
    expect(
      tabelas['afericao']!.map((a) => [
        a['origem'],
        a['fonte'],
        a['aferido_em'],
        a['registro_assistencial_id'],
      ]),
    ).toEqual([
      ['migracao', 'modelo', new Date(Date.UTC(2020, 0, 1)), 101],
      ['migracao', 'modelo', new Date(Date.UTC(2020, 0, 2)), 102],
    ]);
    expect(
      tabelas['afericao_valor']!.map((v) => [
        v['parametro_vital_id'],
        v['valor_numerico'],
        v['nivel_alerta'],
        v['origem'],
      ]),
    ).toEqual([
      [7, 36.5, 'normal', 'migracao'],
      [7, 39.1, 'atencao', 'migracao'],
    ]);
    expect(
      tabelas['destino_campo_extracao']!.map((x) => [
        x['registro_assistencial_resposta_id'],
        x['situacao'],
        x['motivo'],
        x['afericao_id'],
      ]),
    ).toEqual([
      [1, 'gerada', null, 1],
      [2, 'gerada', null, 2],
      [3, 'pendente', 'valor_nao_numerico', null],
      [4, 'pendente', 'fora_da_faixa', null],
      [5, 'pendente', 'unidade_divergente', null],
    ]);
    const de_novo = await extrairDestinoConfirmado(tx, 4, AGORA, 77, 10);
    expect(de_novo).toEqual({ ok: true, restantes: false, gerados: 0, recusados: 0, porMotivo: {} });
    expect(tabelas['afericao']).toHaveLength(2);
  });

  it('lote: devolve restantes e a volta seguinte continua de onde parou', async () => {
    const { tx, tabelas } = banco(DESTINO);
    const a = await extrairDestinoConfirmado(tx, 4, AGORA, null, 2);
    expect(a).toMatchObject({ ok: true, restantes: true, gerados: 2, recusados: 0 });
    const b = await extrairDestinoConfirmado(tx, 4, AGORA, null, 2);
    expect(b).toMatchObject({ ok: true, restantes: true, gerados: 0, recusados: 2 });
    const c = await extrairDestinoConfirmado(tx, 4, AGORA, null, 2);
    expect(c).toMatchObject({ ok: true, restantes: false, gerados: 0, recusados: 1 });
    expect(tabelas['destino_campo_extracao']).toHaveLength(5);
  });

  it('destino não confirmado pelo hospital não grava nada', async () => {
    const { tx, tabelas } = banco({ ...DESTINO, ativo: 0, parametro_vital_id: null, tipo_resposta: null });
    expect(await extrairDestinoConfirmado(tx, 4, AGORA, 77)).toEqual({
      ok: false,
      recusa: 'destino-inativo',
    });
    expect(banco(null).tabelas['afericao']).toHaveLength(0);
    expect(await extrairDestinoConfirmado(banco(null).tx, 4, AGORA, 77)).toEqual({
      ok: false,
      recusa: 'destino-inexistente',
    });
    expect(tabelas['afericao']).toHaveLength(0);
  });
});
