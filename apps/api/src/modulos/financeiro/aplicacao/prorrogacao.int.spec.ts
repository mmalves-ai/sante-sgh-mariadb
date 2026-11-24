// F3.8, 07-FIN linha 63: contrato de efeito da prorrogação do vencimento da parcela a pagar contra o MariaDB real
// (massa SINTÉTICA "L0207"). Prorrogar: a parcela passa a vencer na data nova, o vencimento original não muda, e o passo
// fica no histórico (prorrogacao_parcela: anterior, novo, motivo da lista, justificativa, quem e quando). Uma segunda
// prorrogação acrescenta outro passo e o original continua o mesmo. Cada recusa (para trás, longa demais, sem justificativa
// quando o motivo exige, motivo fora da lista) deixa a parcela e o histórico como estavam.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaFinanceiroPropria } from '../porta-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  SEM_BANCO,
  tituloDaMassa,
} from './massa-banco.spec-util.js';

const comChave = (c: ContextoNucleo) => ({ ...c, chaveIdempotencia: `t0207-pr-${randomUUID()}` });
const trilha = (id: number) => ({
  estabelecimento: null,
  usuario: null,
  acao: 'operacao' as const,
  entidade: 'parcela_pagar',
  entidadeId: id,
  correlacao: null,
});
const somaDias = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

describe.skipIf(SEM_BANCO)('prorrogação do vencimento da parcela a pagar (MariaDB)', () => {
  let m: MassaFinanceiro;
  let porta: PortaFinanceiroPropria;
  let motivoLivre = 0;
  let motivoJustificado = 0;
  const uma = (sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'pr-02-07' }, (l) => l.uma(sql, p));
  const parcelaLida = async (id: number) => {
    const r = await uma('SELECT vencimento, vencimento_original, versao FROM parcela_pagar WHERE id = ?', [
      id,
    ]);
    return {
      vencimento: iso(r?.['vencimento']),
      original: iso(r?.['vencimento_original']),
      versao: Number(r?.['versao']),
    };
  };
  const passos = async (id: number) =>
    Number(
      (await uma('SELECT COUNT(*) AS n FROM prorrogacao_parcela WHERE parcela_pagar_id = ?', [id]))?.['n'] ??
        0,
    );
  const titulo = async (documento: number, valor: number) => {
    const c = m.ctx(m.lanca);
    const t = await porta.executar(c, 'financeiro.criarTituloPagar', tituloDaMassa(m, documento, valor), {
      ...c,
      chaveIdempotencia: `t0207-pr-${randomUUID()}`,
    });
    return Number(t.resultado['titulo']);
  };
  const prorrogar = (
    parcela: number,
    vencimento: string,
    motivo: number,
    justificativa = '',
    versao: string | null = null,
  ) =>
    porta.gravarSgh(comChave(m.ctx(m.lanca)), trilha(parcela), (g) =>
      g.prorrogarVencimento({ parcela, versao, vencimento, motivo, justificativa, usuario: 'x' }),
    );

  beforeAll(async () => {
    m = await montarMassa();
    porta = new PortaFinanceiroPropria(m.nucleo);
    // Os motivos da semente padrão (db/sementes/14_financeiro.json), garantidos no cliente de teste.
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'pr-02-07-motivos' }, async (e) => {
      for (const [codigo, descricao, exige] of [
        ['acordo_credor', 'Acordo com o credor', false],
        ['outro', 'Outro motivo', true],
      ] as const) {
        const r = await e.uma<{ id: number }>('SELECT id FROM motivo_prorrogacao WHERE codigo = ?', [codigo]);
        const id = r
          ? Number(r.id)
          : await e.inserir(
              `INSERT INTO motivo_prorrogacao (codigo, descricao, aplica_pagar, aplica_receber, exige_justificativa, criado_em)
               VALUES (?, ?, TRUE, TRUE, ?, NOW(3))`,
              [codigo, descricao, exige],
            );
        if (exige) motivoJustificado = id;
        else motivoLivre = id;
      }
    });
  });

  afterAll(async () => {
    if (m) {
      await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-pr-02-07' }, (e) =>
        e.executar(
          `DELETE pp FROM prorrogacao_parcela pp JOIN parcela_pagar p ON p.id = pp.parcela_pagar_id
             JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.estabelecimento_id IN (?, ?)`,
          [m.est, m.outroEst],
        ),
      );
      await limparMassa(m.nucleo, [m.est, m.outroEst]);
      await m.nucleo.encerrar();
    }
  });

  it('prorroga: a parcela vence na data nova, o original fica e o passo vai ao histórico', async () => {
    const p = await titulo(963001, 500);
    const antes = await parcelaLida(p);
    const novo = somaDias(antes.vencimento, 15);
    const r = await prorrogar(p, novo, motivoLivre);
    expect(r).toMatchObject({
      vencimentoAnterior: antes.vencimento,
      vencimento: novo,
      vencimentoOriginal: antes.original,
    });
    const depois = await parcelaLida(p);
    expect(depois).toEqual({ vencimento: novo, original: antes.original, versao: antes.versao + 1 });
    const h = await uma(
      `SELECT vencimento_anterior, vencimento_novo, motivo_prorrogacao_id, operacao, usuario_id, observacao
         FROM prorrogacao_parcela WHERE id = ?`,
      [r.id],
    );
    expect({
      anterior: iso(h?.['vencimento_anterior']),
      novo: iso(h?.['vencimento_novo']),
      motivo: Number(h?.['motivo_prorrogacao_id']),
      operacao: h?.['operacao'],
      usuario: Number(h?.['usuario_id']),
      observacao: h?.['observacao'],
    }).toEqual({
      anterior: antes.vencimento,
      novo,
      motivo: motivoLivre,
      operacao: 'alteracao',
      usuario: m.lanca,
      observacao: null,
    });

    // Segunda prorrogação: outro passo, o original continua o mesmo; a leitura do histórico vem do mais recente.
    const novo2 = somaDias(novo, 10);
    await prorrogar(p, novo2, motivoJustificado, 'Nota com CNPJ divergente');
    expect(await parcelaLida(p)).toMatchObject({ vencimento: novo2, original: antes.original });
    expect(await passos(p)).toBe(2);
    const lidos = await porta.prorrogacoes(m.ctx(m.lanca), p);
    expect(lidos.map((x) => [x.vencimentoAnterior, x.vencimentoNovo, x.justificativa])).toEqual([
      [novo, novo2, 'Nota com CNPJ divergente'],
      [antes.vencimento, novo, ''],
    ]);
  });

  it('recusas não mudam a parcela nem o histórico', async () => {
    const p = await titulo(963002, 300);
    const antes = await parcelaLida(p);
    const recusada = async (g: Promise<unknown>) => {
      const codigo = await codigoDaGravacao(g);
      expect(await parcelaLida(p)).toEqual(antes);
      expect(await passos(p)).toBe(0);
      return codigo;
    };
    expect(await recusada(prorrogar(p, antes.vencimento, motivoLivre))).toBe('prorrogacao-para-tras');
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, -1), motivoLivre))).toBe(
      'prorrogacao-para-tras',
    );
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, 400), motivoLivre))).toBe(
      'prorrogacao-longa',
    );
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, 5), motivoJustificado, 'ok'))).toBe(
      'justificativa-obrigatoria',
    );
    expect(await recusada(prorrogar(p, somaDias(antes.vencimento, 5), 999_999_999))).toBe(
      'motivo-obrigatorio',
    );
  });

  it('a parcela de outro estabelecimento não é encontrada', async () => {
    const p = await titulo(963003, 200);
    const outra = porta.gravarSgh(comChave(m.ctx(m.lanca, m.outroEst)), trilha(p), (g) =>
      g.prorrogarVencimento({
        parcela: p,
        versao: null,
        vencimento: '2099-01-01',
        motivo: motivoLivre,
        justificativa: '',
        usuario: 'x',
      }),
    );
    expect(await codigoDaGravacao(outra)).toBe('titulo-inexistente');
    expect(await passos(p)).toBe(0);
  });
});
