// Contrato de efeito da importação das respostas do mapa de cotação (C3-008, 05-SUP linha 19), no MariaDB de teste:
// o arquivo devolvido grava o preço e a marca de cada proposta, deixa o fornecedor 'respondida' e liga o pedido ao
// portal de troca por arquivo; reimportar atualiza a mesma ligação; uma linha recusada barra o arquivo inteiro (nada
// gravado). Massa sintética (massa-propria.spec-util).
import { COLUNAS_MAPA_COTACAO, montarArquivoCotacao } from '@sgh/contratos/regras-suprimentos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
let k = 0;

describe.skipIf(SEM_BANCO)(
  'importação do mapa de cotação devolvido (MariaDB, cliente de teste do lote)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSuprimentosPropria;
    let m: MassaSuprimentos;
    let c: ContextoSuprimentos;
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-mapa' }, (l) => l.consultar<T>(sql, p));
    const op = (nome: string, entrada: unknown) =>
      porta.executar(c, `suprimentos.${nome}`, entrada, { ...c, chaveIdempotencia: `mapa-${RODADA}-${++k}` });

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo);
      porta = new PortaSuprimentosPropria(nucleo);
      c = { ...contexto(m, m.estA, 'mapa') } as ContextoSuprimentos;
    });
    afterAll(async () => {
      await limparMassa(nucleo, m);
    });

    it('o arquivo devolvido grava preço e marca, responde o fornecedor e liga o pedido ao portal; reimportar atualiza', async () => {
      const r = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor, m.fornecedor2],
        itens: [{ item: m.insumo, quantidade: 4 }],
      });
      const pedido = { ano: Number(r.resultado['ano']), doc: Number(r.resultado['doc']) };
      const det = (await porta.pedido(c, pedido.ano, pedido.doc))!;
      expect(det.portal).toEqual([]);
      // O mapa baixado pela tela, preenchido pelo fornecedor: só um preço (o outro fornecedor não cotou).
      const arquivo = montarArquivoCotacao(
        det.itensDetalhe.map((i) => ({ item: i.item, seq: i.seq, nome: i.nome })),
        det.propostas,
      );
      const p1 = det.propostas.find((x) => x.fornecedor === m.fornecedor)!;
      const p2 = det.propostas.find((x) => x.fornecedor === m.fornecedor2)!;
      const preenchido = arquivo
        .split('\r\n')
        .map((l) => (l.startsWith(`${p1.id};`) ? l.replace(/;[^;]*;[^;]*$/, ';12,3456;Marca T') : l))
        .join('\r\n');
      const imp = await op('importarRespostasCotacao', {
        pedido,
        arquivo: 'mapa-fornecedor.csv',
        conteudo: preenchido,
      });
      expect(imp.resultado).toMatchObject({ respostas: 1, semPreco: 1 });

      const [cri] = await ler<{
        valor_unitario: string;
        valor_total: string;
        marca: string;
        situacao: string;
      }>(
        `SELECT cri.valor_unitario, cri.valor_total, cri.marca, cf.situacao
         FROM cotacao_resposta_item cri JOIN cotacao_fornecedor cf ON cf.id = cri.cotacao_fornecedor_id
        WHERE cri.id = ?`,
        [p1.id],
      );
      expect(Number(cri!.valor_unitario)).toBeCloseTo(12.3456, 4);
      expect(Number(cri!.valor_total)).toBeCloseTo(49.38, 2);
      expect(cri!.marca).toBe('Marca T');
      expect(cri!.situacao).toBe('respondida');
      const [outro] = await ler<{ valor_unitario: string; situacao: string }>(
        `SELECT cri.valor_unitario, cf.situacao FROM cotacao_resposta_item cri
         JOIN cotacao_fornecedor cf ON cf.id = cri.cotacao_fornecedor_id WHERE cri.id = ?`,
        [p2.id],
      );
      expect(Number(outro!.valor_unitario)).toBe(0);
      expect(outro!.situacao).not.toBe('respondida');

      const vinc = () =>
        ler<{ id: number; situacao: string; codigo_cotacao_portal: string; codigo: string; versao: number }>(
          `SELECT v.id, v.situacao, v.codigo_cotacao_portal, pc.codigo, v.versao
           FROM vinculo_pedido_compra_portal v JOIN portal_cotacao pc ON pc.id = v.portal_cotacao_id
           JOIN pedido_compra p ON p.id = v.pedido_compra_id
          WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.numero = ?`,
          [m.estA, pedido.ano, pedido.doc],
        );
      const [v1] = await vinc();
      expect(v1).toMatchObject({
        situacao: 'cotado',
        codigo: 'arquivo',
        codigo_cotacao_portal: `${pedido.ano}-${pedido.doc}`,
      });
      expect(Number(imp.resultado['id'])).toBe(Number(v1!.id));
      const lido = (await porta.pedido(c, pedido.ano, pedido.doc))!;
      expect(lido.portal).toHaveLength(1);
      expect(lido.portal[0]!.portal).toBe('Troca do mapa por arquivo (cotado)');

      // Reimportar com o outro preço: a mesma ligação, versão nova.
      const segundo = `${COLUNAS_MAPA_COTACAO.join(';')}\n${p2.id};;;;;${m.fornecedor2};;7,5;\n`;
      await op('importarRespostasCotacao', { pedido, arquivo: 'mapa-2.csv', conteudo: segundo });
      const v2 = await vinc();
      expect(v2).toHaveLength(1);
      expect(Number(v2[0]!.versao)).toBe(Number(v1!.versao) + 1);
      const [p2Depois] = await ler<{ valor_unitario: string }>(
        'SELECT valor_unitario FROM cotacao_resposta_item WHERE id = ?',
        [p2.id],
      );
      expect(Number(p2Depois!.valor_unitario)).toBe(7.5);
    });

    it('uma linha recusada barra o arquivo inteiro: nada gravado e nenhuma ligação', async () => {
      const r = await op('criarPedido', {
        centroCusto: m.centroCusto,
        fornecedores: [m.fornecedor, m.fornecedor2],
        itens: [{ item: m.insumo, quantidade: 2 }],
      });
      const pedido = { ano: Number(r.resultado['ano']), doc: Number(r.resultado['doc']) };
      const det = (await porta.pedido(c, pedido.ano, pedido.doc))!;
      const [a, b] = det.propostas;
      const conteudo = `${COLUNAS_MAPA_COTACAO.join(';')}\n${a!.id};;;;;;;3;\n${b!.id};;;;;;;-1;\n`;
      expect(await codigoDe(op('importarRespostasCotacao', { pedido, arquivo: 'x.csv', conteudo }))).toBe(
        'valor-invalido',
      );
      const [x] = await ler<{ valor_unitario: string }>(
        'SELECT valor_unitario FROM cotacao_resposta_item WHERE id = ?',
        [a!.id],
      );
      expect(Number(x!.valor_unitario)).toBe(0);
      expect((await porta.pedido(c, pedido.ano, pedido.doc))!.portal).toEqual([]);
    });
  },
);
