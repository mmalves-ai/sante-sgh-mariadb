// Contrato de efeito da ata de registro de preços e da nota de empenho (C2-030, 05-SUP linha 26) contra o MariaDB real
// (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a ata assinada fica vigente com quem a
// fechou, os itens com o saldo cheio; a repetição pela mesma chave não grava de novo; número repetido, vigência acima de
// 1 ano e processo não homologado são recusados sem gravar nada; o empenho grava o credor, a fonte, o total pelas
// parcelas, os itens ligados ao item da ata e consome o saldo (o item esgota); acima do saldo é recusado; a anulação
// registra o motivo, quem e quando, cancela os itens e devolve o saldo à ata (nada apagado); anular de novo é recusado.
// Outro estabelecimento não vê a ata. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { type EntradaAta, type EntradaEmpenho, PortaAtaEmpenhoPropria } from './ata-empenho.js';
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

const k = () => `t-arp-${randomUUID()}`;
const MARCA = Date.now().toString(36).toUpperCase();
type L = Record<string, unknown>;

describe.skipIf(SEM_BANCO)('ata de registro de preços e empenho (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtaEmpenhoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let processo = 0;
  let homologado = 0;
  let hoje = '';
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2030' }, (l) => l.uma<L>(sql, p));
  const contar = async (tabela: 'ata_registro_preco' | 'empenho') =>
    Number((await um(`SELECT COUNT(*) AS n FROM ${tabela} WHERE estabelecimento_id = ?`, [m.estA]))?.['n']);
  const ata = (x: Partial<EntradaAta> = {}): EntradaAta => ({
    numero: `ARP${MARCA}`,
    objeto: 'Material médico sintético',
    vigenciaInicio: '2026-01-02',
    vigenciaFim: '2027-01-01',
    processo: null,
    observacao: null,
    itens: [
      { insumo: m.insumo, fornecedor: m.fornecedor, quantidade: 100, valorUnitario: 2.5, marca: 'Sintetica' },
    ],
    ...x,
  });
  const empenho = (ataItem: number, quantidade: number, numero: string): EntradaEmpenho => ({
    numero,
    emitidoEm: hoje,
    validoAte: null,
    fonteRecurso: '1.500.1002',
    naturezaDespesa: '3.3.90.30',
    observacao: null,
    itens: [{ ataItem, quantidade }],
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaAtaEmpenhoPropria(nucleo);
    c = contexto(m, m.estA, 't-c2030') as ContextoPortaM18;
    hoje = new Date().toISOString().slice(0, 10);
    processo = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2030-proc' }, (e) =>
      inserirMinimo(
        e,
        'processo_licitatorio',
        {
          estabelecimento_id: m.estA,
          numero: `PL${MARCA}`.slice(0, 20),
          regime: 'lei_14133',
          modalidade: 'pregao_eletronico',
          criterio_julgamento: 'menor_preco',
          natureza_objeto: 'bens',
          etapa: 'julgado',
        },
        'c2030',
      ),
    );
    homologado = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2030-proc' }, (e) =>
      inserirMinimo(
        e,
        'processo_licitatorio',
        {
          estabelecimento_id: m.estA,
          numero: `PH${MARCA}`.slice(0, 20),
          regime: 'lei_14133',
          modalidade: 'pregao_eletronico',
          criterio_julgamento: 'menor_preco',
          natureza_objeto: 'bens',
          etapa: 'homologado',
          homologado_por_usuario_id: m.usuario,
          homologado_em: new Date(),
        },
        'c2030',
      ),
    );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2030-limpa' }, async (e) => {
        await e.executar(
          'DELETE ei FROM empenho_item ei JOIN empenho x ON x.id = ei.empenho_id WHERE x.estabelecimento_id IN (?, ?)',
          [m.estA, m.estB],
        );
        await e.executar('DELETE FROM empenho WHERE estabelecimento_id IN (?, ?)', [m.estA, m.estB]);
        await e.executar(
          'DELETE i FROM ata_registro_preco_item i JOIN ata_registro_preco a ON a.id = i.ata_registro_preco_id WHERE a.estabelecimento_id IN (?, ?)',
          [m.estA, m.estB],
        );
        await e.executar('DELETE FROM ata_registro_preco WHERE estabelecimento_id IN (?, ?)', [
          m.estA,
          m.estB,
        ]);
        await e.executar('DELETE FROM processo_licitatorio WHERE id IN (?, ?)', [processo, homologado]);
        await limparTrilhaDaMassa(e, { ids: [m.estA, m.estB] });
      });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  it('a ata, o empenho que consome o saldo e a anulação que o devolve ficam no banco', async () => {
    // Recusas antes de qualquer gravação: vigência acima de 1 ano e processo não homologado.
    expect(await codigoDe(porta.registrarAta(c, ata({ vigenciaFim: '2027-01-02' }), k()))).toBe(
      'ata-vigencia-acima-do-prazo',
    );
    expect(await codigoDe(porta.registrarAta(c, ata({ processo }), k()))).toBe('processo-nao-homologado');
    // Homologado, mas o item não foi adjudicado a este fornecedor no processo.
    expect(await codigoDe(porta.registrarAta(c, ata({ processo: homologado }), k()))).toBe(
      'ata-item-nao-adjudicado',
    );
    expect((await porta.processosHomologados(c)).find((p) => p.id === homologado)).toMatchObject({
      itens: [],
    });
    expect(await contar('ata_registro_preco')).toBe(0);

    const chave = k();
    const r = await porta.registrarAta(c, ata(), chave);
    expect(r).toMatchObject({ itens: 1, valorTotal: 250 });
    expect((await porta.registrarAta(c, ata(), chave)).id).toBe(r.id);
    expect(await codigoDe(porta.registrarAta(c, ata(), k()))).toBe('ata-numero-repetido');
    expect(await contar('ata_registro_preco')).toBe(1);
    const linhaAta = await um(
      'SELECT situacao, fechado_por_usuario_id, fechado_em, vigencia_fim, criado_por FROM ata_registro_preco WHERE id = ?',
      [r.id],
    );
    expect(linhaAta?.['situacao']).toBe('vigente');
    expect(Number(linhaAta?.['fechado_por_usuario_id'])).toBe(m.usuario);
    expect(linhaAta?.['fechado_em']).not.toBeNull();
    const item = await um(
      'SELECT id, quantidade_registrada, quantidade_utilizada, valor_unitario, situacao, empresa_fornecedora_id FROM ata_registro_preco_item WHERE ata_registro_preco_id = ?',
      [r.id],
    );
    const ataItem = Number(item?.['id']);
    expect(Number(item?.['quantidade_registrada'])).toBe(100);
    expect(Number(item?.['quantidade_utilizada'])).toBe(0);
    expect(item?.['situacao']).toBe('ativo');

    // Outro estabelecimento não vê a ata nem empenha o item dela.
    const cB = contexto(m, m.estB, 't-c2030-b') as ContextoPortaM18;
    expect((await porta.atas(cB)).map((a) => a.id)).not.toContain(r.id);
    expect(await codigoDe(porta.emitirEmpenho(cB, empenho(ataItem, 1, `NB${MARCA}`), k()))).toBe(
      'ata-item-inexistente',
    );

    // Empenho de 60: total pelas parcelas, credor e fonte, item ligado; o saldo cai para 40.
    const e1 = await porta.emitirEmpenho(c, empenho(ataItem, 60, `NE1${MARCA}`), k());
    expect(e1.valorTotal).toBe(150);
    const linhaEmp = await um(
      'SELECT empresa_fornecedora_id, ata_registro_preco_id, fonte_recurso, valor_total, valor_liquidado, situacao FROM empenho WHERE id = ?',
      [e1.id],
    );
    expect(Number(linhaEmp?.['empresa_fornecedora_id'])).toBe(m.fornecedor);
    expect(Number(linhaEmp?.['ata_registro_preco_id'])).toBe(r.id);
    expect(linhaEmp?.['fonte_recurso']).toBe('1.500.1002');
    expect(Number(linhaEmp?.['valor_total'])).toBe(150);
    expect(linhaEmp?.['situacao']).toBe('emitido');
    const linhaItemEmp = await um(
      'SELECT ata_registro_preco_item_id, insumo_id, quantidade_empenhada, valor_unitario, valor_total, situacao FROM empenho_item WHERE empenho_id = ?',
      [e1.id],
    );
    expect(Number(linhaItemEmp?.['ata_registro_preco_item_id'])).toBe(ataItem);
    expect(Number(linhaItemEmp?.['insumo_id'])).toBe(m.insumo);
    expect(Number(linhaItemEmp?.['quantidade_empenhada'])).toBe(60);
    expect(Number(linhaItemEmp?.['valor_total'])).toBe(150);
    const saldo = async () =>
      um('SELECT quantidade_utilizada, situacao FROM ata_registro_preco_item WHERE id = ?', [ataItem]);
    expect(Number((await saldo())?.['quantidade_utilizada'])).toBe(60);

    // Acima do saldo: recusado sem gravar. O resto (40) esgota o item.
    expect(await codigoDe(porta.emitirEmpenho(c, empenho(ataItem, 40.5, `NE2${MARCA}`), k()))).toBe(
      'empenho-acima-do-saldo',
    );
    const e2 = await porta.emitirEmpenho(c, empenho(ataItem, 40, `NE2${MARCA}`), k());
    expect(await saldo()).toMatchObject({ situacao: 'esgotado' });
    expect(await codigoDe(porta.emitirEmpenho(c, empenho(ataItem, 1, `NE3${MARCA}`), k()))).toBe(
      'ata-item-indisponivel',
    );
    expect(await contar('empenho')).toBe(2);

    // Anulação do segundo: motivo, quem e quando; item cancelado; o saldo volta e o item fica ativo.
    const visto = (await porta.empenhos(c)).find((x) => x.id === e2.id)!;
    expect(
      await codigoDe(porta.anularEmpenho(c, e2.id, { motivo: 'curto', versao: visto.versao }, k())),
    ).toBe('empenho-sem-motivo');
    await porta.anularEmpenho(
      c,
      e2.id,
      { motivo: 'Dotação remanejada no orçamento', versao: visto.versao },
      k(),
    );
    const anulado = await um(
      'SELECT situacao, motivo_anulacao, anulado_por_usuario_id, cancelado_em FROM empenho WHERE id = ?',
      [e2.id],
    );
    expect(anulado?.['situacao']).toBe('anulado');
    expect(anulado?.['motivo_anulacao']).toBe('Dotação remanejada no orçamento');
    expect(Number(anulado?.['anulado_por_usuario_id'])).toBe(m.usuario);
    expect(anulado?.['cancelado_em']).not.toBeNull();
    expect((await um('SELECT situacao FROM empenho_item WHERE empenho_id = ?', [e2.id]))?.['situacao']).toBe(
      'cancelado',
    );
    expect(Number((await saldo())?.['quantidade_utilizada'])).toBe(60);
    expect((await saldo())?.['situacao']).toBe('ativo');
    expect(await contar('empenho')).toBe(2);
    const v2 = (await porta.empenhos(c)).find((x) => x.id === e2.id)!;
    expect(v2).toMatchObject({ situacao: 'anulado', ata: `ARP${MARCA}` });
    expect(
      await codigoDe(
        porta.anularEmpenho(c, e2.id, { motivo: 'Dotação remanejada de novo', versao: v2.versao }, k()),
      ),
    ).toBe('empenho-nao-anulavel');

    // A visão da ata traz o saldo do item.
    const visao = (await porta.atas(c)).find((a) => a.id === r.id)!;
    expect(visao.itens[0]).toMatchObject({ registrada: 100, utilizada: 60, saldo: 40, situacao: 'ativo' });
  }, 120_000);
});
