// Contrato de efeito dos lances da disputa aberta (C2-030, 05-SUP linha 26; Lei 14.133, art. 56 e 57) contra o MariaDB
// real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: cada lance fica em
// lance_licitacao com o item, o licitante, a proposta, a hora, quem registrou e a ordem do licitante (rodada); o último
// lance vira a oferta da proposta (valor_ultimo_lance); a repetição pela mesma chave não grava de novo; lance que não
// melhora a oferta, fora do intervalo mínimo, de proposta desclassificada, de quem não tem proposta e de processo fora da
// sessão são recusados sem gravar nada; a disputa devolve a classificação parcial. Outro estabelecimento não vê o
// processo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaLancePregaoPropria } from './lance-pregao.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';

const k = () => `t-lance-${randomUUID()}`;
const MARCA = Date.now().toString(36).toUpperCase();
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('lances do pregão (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaLancePregaoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  const processos: number[] = [];
  let pregao = 0;
  let julgado = 0;
  let item = 0;
  let item2 = 0;
  let fornecedor3 = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2030l' }, (l) => l.uma<L>(sql, p));
  const lancesDoItem = async (i: number) =>
    Number(
      (await um('SELECT COUNT(*) AS n FROM lance_licitacao WHERE processo_licitatorio_item_id = ?', [i]))?.[
        'n'
      ],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaLancePregaoPropria(nucleo);
    c = contexto(m, m.estA, 't-c2030l') as ContextoPortaM18;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2030l-massa' }, async (e) => {
      const proc = (etapa: string, sufixo: string) =>
        inserirMinimo(
          e,
          'processo_licitatorio',
          {
            estabelecimento_id: m.estA,
            numero: `PG${sufixo}${MARCA}`.slice(0, 20),
            regime: 'lei_14133',
            modalidade: 'pregao_eletronico',
            criterio_julgamento: 'menor_preco',
            natureza_objeto: 'bens',
            objeto: 'Material médico sintético',
            etapa,
          },
          'c2030l',
        );
      pregao = await proc('sessao', 'S');
      julgado = await proc('julgado', 'J');
      processos.push(pregao, julgado);
      const novoItem = (processo: number, seq: number) =>
        inserirMinimo(
          e,
          'processo_licitatorio_item',
          {
            processo_licitatorio_id: processo,
            sequencia: seq,
            insumo_id: m.insumo,
            descricao: 'Item sintético',
            quantidade: 100,
          },
          'c2030l',
        );
      item = await novoItem(pregao, 1);
      item2 = await novoItem(pregao, 2);
      const itemJ = await novoItem(julgado, 1);
      const cabecalhos = new Map<string, number>();
      const seqs = new Map<number, number>();
      const proposta = async (
        processo: number,
        fornecedor: number,
        it: number,
        valor: number,
        resultado: string,
      ) => {
        const chaveCab = `${processo}:${fornecedor}`;
        const cab =
          cabecalhos.get(chaveCab) ??
          (await inserirMinimo(
            e,
            'proposta_licitacao',
            {
              processo_licitatorio_id: processo,
              empresa_fornecedora_id: fornecedor,
              apresentada_em: new Date(),
              situacao: 'valida',
              habilitacao: 'pendente',
            },
            'c2030l',
          ));
        cabecalhos.set(chaveCab, cab);
        await inserirMinimo(
          e,
          'proposta_licitacao_item',
          {
            proposta_licitacao_id: cab,
            sequencia: (seqs.get(cab) ?? 0) + 1,
            processo_licitatorio_item_id: it,
            quantidade_cotada: 100,
            valor_unitario: valor,
            resultado,
            motivo_resultado: resultado === 'desclassificado' ? 'Fora da especificação do termo' : null,
          },
          'c2030l',
        );
        seqs.set(cab, (seqs.get(cab) ?? 0) + 1);
      };
      await proposta(pregao, m.fornecedor, item, 10, 'em_disputa');
      await proposta(pregao, m.fornecedor2, item, 9.8, 'em_disputa');
      await proposta(julgado, m.fornecedor, itemJ, 10, 'em_disputa');
      // O terceiro licitante só tem proposta desclassificada no item 2.
      fornecedor3 = m.fornecedor2;
      await proposta(pregao, fornecedor3, item2, 5, 'desclassificado');
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m && processos.length)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2030l-limpa' }, async (e) => {
        const em = processos.map(() => '?').join(', ');
        await e.executar(
          `DELETE l FROM lance_licitacao l JOIN processo_licitatorio_item i ON i.id = l.processo_licitatorio_item_id
            WHERE i.processo_licitatorio_id IN (${em})`,
          processos,
        );
        await e.executar(
          `DELETE pi FROM proposta_licitacao_item pi JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
            WHERE pl.processo_licitatorio_id IN (${em})`,
          processos,
        );
        await e.executar(
          `DELETE FROM proposta_licitacao WHERE processo_licitatorio_id IN (${em})`,
          processos,
        );
        await e.executar(
          `DELETE FROM processo_licitatorio_item WHERE processo_licitatorio_id IN (${em})`,
          processos,
        );
        await e.executar(`DELETE FROM processo_licitatorio WHERE id IN (${em})`, processos);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('cada lance fica gravado, a oferta da proposta segue o último e as recusas não gravam nada', async () => {
    expect((await porta.processos(c)).map((p) => p.id)).toContain(pregao);
    expect((await porta.processos(c)).map((p) => p.id)).not.toContain(julgado);

    // Recusas sem gravar: não melhora a proposta (10), quem não tem proposta, desclassificada, fora da sessão.
    expect(
      await codigoDe(porta.registrar(c, pregao, { item, fornecedor: m.fornecedor, valor: 10 }, k())),
    ).toBe('lance-nao-melhora');
    expect(
      await codigoDe(porta.registrar(c, pregao, { item: item2, fornecedor: m.fornecedor, valor: 4 }, k())),
    ).toBe('lance-sem-proposta');
    expect(
      await codigoDe(porta.registrar(c, pregao, { item: item2, fornecedor: fornecedor3, valor: 4 }, k())),
    ).toBe('lance-proposta-desclassificada');
    const itemJ = Number(
      (await um('SELECT id FROM processo_licitatorio_item WHERE processo_licitatorio_id = ?', [julgado]))?.[
        'id'
      ],
    );
    expect(
      await codigoDe(porta.registrar(c, julgado, { item: itemJ, fornecedor: m.fornecedor, valor: 9 }, k())),
    ).toBe('lance-etapa-invalida');
    expect(
      await codigoDe(
        porta.registrar(
          c,
          pregao,
          { item, fornecedor: m.fornecedor, valor: 9.95, intervaloMinimoPercentual: 1 },
          k(),
        ),
      ),
    ).toBe('lance-intervalo-minimo');
    expect(await lancesDoItem(item)).toBe(0);

    // Primeiro lance do licitante 1: 9,50 (abaixo da proposta de 10); a repetição pela chave não grava de novo.
    const chave = k();
    const r1 = await porta.registrar(c, pregao, { item, fornecedor: m.fornecedor, valor: 9.5 }, chave);
    expect(r1).toMatchObject({ rodada: 1, valor: 9.5, posicao: 1 });
    expect((await porta.registrar(c, pregao, { item, fornecedor: m.fornecedor, valor: 9.5 }, chave)).id).toBe(
      r1.id,
    );
    expect(await lancesDoItem(item)).toBe(1);
    const linha = await um(
      `SELECT processo_licitatorio_item_id, empresa_fornecedora_id, proposta_licitacao_id, rodada, valor_unitario,
              usuario_id, ocorrido_em, operacao, vencedor, desclassificado, criado_por
         FROM lance_licitacao WHERE id = ?`,
      [r1.id],
    );
    expect(Number(linha?.['processo_licitatorio_item_id'])).toBe(item);
    expect(Number(linha?.['empresa_fornecedora_id'])).toBe(m.fornecedor);
    expect(linha?.['proposta_licitacao_id']).not.toBeNull();
    expect(Number(linha?.['rodada'])).toBe(1);
    expect(Number(linha?.['valor_unitario'])).toBe(9.5);
    expect(Number(linha?.['usuario_id'])).toBe(m.usuario);
    expect(linha?.['ocorrido_em']).not.toBeNull();
    expect(linha?.['operacao']).toBe('inclusao');
    expect(Number(linha?.['vencedor'])).toBe(0);
    const ofertaDe = async (fornecedor: number) =>
      Number(
        (
          await um(
            `SELECT pi.valor_ultimo_lance FROM proposta_licitacao_item pi
               JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
              WHERE pi.processo_licitatorio_item_id = ? AND pl.empresa_fornecedora_id = ?`,
            [item, fornecedor],
          )
        )?.['valor_ultimo_lance'],
      );
    expect(await ofertaDe(m.fornecedor)).toBe(9.5);

    // O licitante 2 cobre com 9,40; o licitante 1 não pode repetir o próprio valor e cobre com 9,00 (rodada 2).
    const r2 = await porta.registrar(c, pregao, { item, fornecedor: m.fornecedor2, valor: 9.4 }, k());
    expect(r2).toMatchObject({ rodada: 1, posicao: 1 });
    expect(
      await codigoDe(porta.registrar(c, pregao, { item, fornecedor: m.fornecedor, valor: 9.5 }, k())),
    ).toBe('lance-nao-melhora');
    const r3 = await porta.registrar(c, pregao, { item, fornecedor: m.fornecedor, valor: 9 }, k());
    expect(r3).toMatchObject({ rodada: 2, posicao: 1 });
    expect(await lancesDoItem(item)).toBe(3);
    expect(await ofertaDe(m.fornecedor)).toBe(9);
    expect(await ofertaDe(m.fornecedor2)).toBe(9.4);

    // A disputa: os três lances na ordem e a classificação parcial.
    const d = await porta.disputa(c, pregao);
    expect(d).toMatchObject({ etapa: 'sessao', sentido: 'menor', modalidade: 'pregao-eletronico' });
    const it1 = d.itens.find((i) => i.id === item)!;
    expect(it1.lances.map((l) => l.valor)).toEqual([9.5, 9.4, 9]);
    expect(it1.classificacao.map((x) => [x.fornecedor, x.valor, x.posicao])).toEqual([
      [m.fornecedor, 9, 1],
      [m.fornecedor2, 9.4, 2],
    ]);
    expect(d.itens.find((i) => i.id === item2)!.propostas[0]?.apta).toBe(false);

    // A trilha do lance na mesma transação.
    const trilha = await um(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'lance_licitacao' AND entidade_id = ?",
      [r1.id],
    );
    expect(Number(trilha?.['n'])).toBe(1);

    // Outro estabelecimento não vê o processo.
    const cB = contexto(m, m.estB, 't-c2030l-b') as ContextoPortaM18;
    expect(await codigoDe(porta.disputa(cB, pregao))).toBe('licitacao-inexistente');
    expect(
      await codigoDe(porta.registrar(cB, pregao, { item, fornecedor: m.fornecedor, valor: 8 }, k())),
    ).toBe('licitacao-inexistente');
  }, 120_000);
});
