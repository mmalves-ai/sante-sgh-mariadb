// Porta PRÓPRIA do consignado (M46, etapa 4) sobre o MariaDB do cliente, pelo @sgh/nucleo (F2.2, lote 03-13).
// Leituras: remessa_consignada(+_item) e reposicao_consignada (os movimentos), consumo_opme (os consumos em sala do
// material consignado), saldo_consignado (o saldo do cadastro do estoque, para conferência), nota_entrada (+_item),
// insumo e empresa_fornecedora. Gravação: UMA operação do executor por pedido (trilha, outbox e idempotência na mesma
// transação), sempre filtrada pelo estabelecimento da sessão.
// Melhoria: a remessa vira cabeçalho por nota fiscal do fornecedor (a mesma nota soma itens, sem duplicar) e entra no
//   local de estoque de tipo consignado do estabelecimento; duas linhas iguais da mesma nota são duas entregas (a
//   repetição do pedido se reconhece só pela chave).
// Melhoria: o consumo é reposto e faturado uma vez pela chave única do banco (consumo_opme_id, tipo), não só por
//   conferência da aplicação; a violação vira a mesma recusa de negócio.
// Melhoria: o saldo da devolução é relido com leitura travada (FOR UPDATE) das remessas, reposições e consumos do par,
//   na mesma transação: a devolução simultânea do mesmo par espera e confere o saldo novo.
// Melhoria: a chave do pedido fica em idempotencia_operacao na MESMA transação (a chave única do banco impede a
//   segunda gravação no reenvio simultâneo); o reenvio confere o hash da ENTRADA do pedido (tipo, quantidades,
//   consumos, notas) e o estabelecimento: a chave reusada com outro conteúdo, de outra pessoa ou de outro
//   estabelecimento é recusada (idempotencia-divergente), nunca devolvida como repetição.
// Melhoria: o saldo que limita a devolução soma TODOS os consumos consignados do par (com ou sem agendamento
//   cirúrgico) e recusa quando a leitura passa do teto de proteção, em vez de somar sobre dados cortados.
// Melhoria: o faturamento só aceita nota de entrada confirmada (a digitação, a conferência, a estornada e a
//   cancelada ficam de fora da escolha e são recusadas com 'nota-nao-confirmada').
// Pendente (pedido em saida/03-13.json): esta porta não escreve saldo_consignado nem as quantidades consumida e
//   devolvida do item da remessa; a conferência saldo do cadastro × controle fica sem efeito até o razão do estoque
//   assumir essa escrita.
// Melhoria: o número de negócio da remessa e da reposição vem da sequência do estabelecimento (sequencia_negocio).
import {
  CLASSE_OPME,
  type ConsumoConsignado,
  type ItemBusca,
  type MovimentoConsignado,
  type NotaEntradaConsignado,
} from '@sgh/contratos';
import { saldoConsignado } from '@sgh/dominio-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  erroIdempotenciaDivergente,
  type Escritor,
  gravarIdempotencia,
  hashEntrada,
  lerIdempotencia,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  recusa,
  restricaoUnicaViolada,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import {
  type GravadorConsignado,
  type LinhaMovimentoConsignado,
  METODOS_PORTA_CONSIGNADO,
  type MovimentoConsignadoGravacao,
  type PortaConsignado,
  type SaldoConsignadoAgregado,
} from './consignado-porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoConsignado = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que a gravação do consignado escreve (o executor confere cada escrita contra esta lista). */
export const TABELAS_CONSIGNADO = [
  'remessa_consignada',
  'remessa_consignada_item',
  'reposicao_consignada',
  'sequencia_negocio',
  'idempotencia_operacao',
] as const;

/** Teto das listas da tela (a soma do saldo é no banco, sem teto). */
export const TETO_LISTA_CONSIGNADO = 500;
/** A classe do item que não é OPME (a regra da remessa só distingue OPME do resto). */
export const CLASSE_NAO_OPME = -1;
/** A operação sob a qual a chave do pedido (Idempotency-Key) de cada gravação fica guardada em idempotencia_operacao. */
export const OPERACAO_CHAVE_CONSIGNADO = 'consignado.movimento.gravar';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const txtOuNull = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
const q3 = (n: number) => Math.round(n * 1000) / 1000;
function dataIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function minuto(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  return String(v ?? '')
    .replace(' ', 'T')
    .slice(0, 16);
}

const SEM_EXECUTOR = 'O consignado não grava pelo executor do estoque: cada pedido é uma operação própria.';

// ── Leituras comuns (o leitor da sessão ou a transação; `travar` lê com FOR UPDATE) ───────────────────────────────

interface Filtro {
  readonly fornecedor: number | null;
  readonly item?: number | null;
}

async function consulta(
  l: Leitor,
  travar: boolean,
  sql: string,
  p: unknown[],
  teto: number,
): Promise<Linha[]> {
  return travar ? (l as Escritor).consultarParaAtualizar(sql, p, { teto }) : l.consultar(sql, p, { teto });
}

/** As remessas (uma linha por item da remessa) e as reposições, faturamentos e devoluções, mais novos primeiro. */
async function lerMovimentos(
  l: Leitor,
  est: number,
  f: Filtro,
  travar: boolean,
  teto: number,
): Promise<{ itens: MovimentoConsignado[]; cortada: boolean }> {
  const pr: unknown[] = [est];
  let condR = '';
  if (f.fornecedor !== null) {
    condR += ' AND r.empresa_fornecedora_id = ?';
    pr.push(f.fornecedor);
  }
  if (f.item != null) {
    condR += ' AND i.insumo_id = ?';
    pr.push(f.item);
  }
  const remessas = await consulta(
    l,
    travar,
    `SELECT i.id, r.id AS grupo, r.empresa_fornecedora_id AS fornecedor, ef.razao_social AS fornecedor_nome,
            i.insumo_id AS item, ins.nome AS item_nome, i.quantidade, r.nota_numero, r.nota_serie, r.nota_emissao,
            i.lote, i.numero_serie, i.validade, u.login, r.recebida_em AS em
       FROM remessa_consignada r
       JOIN remessa_consignada_item i ON i.remessa_consignada_id = r.id AND i.excluido_em IS NULL
       JOIN empresa_fornecedora ef ON ef.id = r.empresa_fornecedora_id
       JOIN insumo ins ON ins.id = i.insumo_id
       LEFT JOIN usuario u ON u.id = i.criado_por
      WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.situacao <> 'cancelada'${condR}
      ORDER BY r.recebida_em DESC, i.id DESC
      LIMIT ${teto + 1}`,
    pr,
    teto + 1,
  );
  const pp: unknown[] = [est];
  let condP = '';
  if (f.fornecedor !== null) {
    condP += ' AND p.empresa_fornecedora_id = ?';
    pp.push(f.fornecedor);
  }
  if (f.item != null) {
    condP += ' AND p.insumo_id = ?';
    pp.push(f.item);
  }
  const reposicoes = await consulta(
    l,
    travar,
    `SELECT p.id, p.tipo, p.empresa_fornecedora_id AS fornecedor, ef.razao_social AS fornecedor_nome,
            p.insumo_id AS item, ins.nome AS item_nome, p.quantidade, p.consumo_opme_id, p.nota_numero, p.nota_serie,
            p.nota_emissao, p.nota_entrada_id, n.data_entrada, p.lote, p.numero_serie, p.motivo, u.login,
            p.ocorrido_em AS em, p.criado_por
       FROM reposicao_consignada p
       JOIN empresa_fornecedora ef ON ef.id = p.empresa_fornecedora_id
       JOIN insumo ins ON ins.id = p.insumo_id
       LEFT JOIN nota_entrada n ON n.id = p.nota_entrada_id
       LEFT JOIN usuario u ON u.id = p.criado_por
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao <> 'cancelada'${condP}
      ORDER BY p.ocorrido_em DESC, p.id DESC
      LIMIT ${teto + 1}`,
    pp,
    teto + 1,
  );
  // O grupo da reposição: as linhas do mesmo pedido (mesmo instante, tipo, par e usuário) ficam no menor id.
  const grupos = new Map<string, number>();
  const chaveGrupo = (x: Linha) =>
    `${minuto(x['em'])}|${String(x['em'])}|${String(x['tipo'])}|${num(x['fornecedor'])}|${num(x['item'])}|${num(x['criado_por'])}`;
  for (const x of reposicoes) {
    const k = chaveGrupo(x);
    const id = num(x['id']);
    grupos.set(k, Math.min(grupos.get(k) ?? id, id));
  }
  const itens: (MovimentoConsignado & { ordem: string })[] = [
    ...remessas.map((x) => ({
      id: num(x['id']),
      grupo: num(x['grupo']),
      tipo: 'remessa' as const,
      fornecedor: num(x['fornecedor']),
      fornecedorNome: txtOuNull(x['fornecedor_nome']),
      item: num(x['item']),
      itemNome: txtOuNull(x['item_nome']),
      quantidade: q3(num(x['quantidade'])),
      consumo: null,
      nfNumero: txtOuNull(x['nota_numero']),
      nfSerie: txtOuNull(x['nota_serie']),
      nfEmissao: dataIso(x['nota_emissao']),
      nfEntrada: null,
      lote: txtOuNull(x['lote']),
      serie: txtOuNull(x['numero_serie']),
      validade: dataIso(x['validade']),
      motivo: null,
      usuario: txtOuNull(x['login']) ?? '',
      em: minuto(x['em']),
      ordem: `${minuto(x['em'])}|${String(num(x['id'])).padStart(15, '0')}`,
    })),
    ...reposicoes.map((x) => {
      const ent = dataIso(x['data_entrada']);
      return {
        id: num(x['id']),
        grupo: grupos.get(chaveGrupo(x)) ?? num(x['id']),
        tipo: String(x['tipo']) as MovimentoConsignado['tipo'],
        fornecedor: num(x['fornecedor']),
        fornecedorNome: txtOuNull(x['fornecedor_nome']),
        item: num(x['item']),
        itemNome: txtOuNull(x['item_nome']),
        quantidade: q3(num(x['quantidade'])),
        consumo: x['consumo_opme_id'] === null ? null : num(x['consumo_opme_id']),
        nfNumero: txtOuNull(x['nota_numero']),
        nfSerie: txtOuNull(x['nota_serie']),
        nfEmissao: dataIso(x['nota_emissao']),
        nfEntrada:
          x['nota_entrada_id'] === null || !ent
            ? null
            : { ano: Number(ent.slice(0, 4)), mes: Number(ent.slice(5, 7)), doc: num(x['nota_entrada_id']) },
        lote: txtOuNull(x['lote']),
        serie: txtOuNull(x['numero_serie']),
        validade: null,
        motivo: txtOuNull(x['motivo']),
        usuario: txtOuNull(x['login']) ?? '',
        em: minuto(x['em']),
        ordem: `${minuto(x['em'])}|${String(num(x['id'])).padStart(15, '0')}`,
      };
    }),
  ];
  itens.sort((a, b) => b.ordem.localeCompare(a.ordem));
  const cortada = remessas.length > teto || reposicoes.length > teto || itens.length > teto;
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- o campo é descartado de propósito
    itens: itens.slice(0, teto).map(({ ordem: _o, ...m }) => m),
    cortada,
  };
}

/** Os consumos em sala do material consignado (os devolvidos e cancelados ficam de fora), com a reposição e o faturamento. */
async function lerConsumos(
  l: Leitor,
  est: number,
  f: { fornecedor: number | null; item?: number | null; ids?: readonly number[] },
  travar: boolean,
  teto: number,
): Promise<{ itens: ConsumoConsignado[]; cortada: boolean }> {
  const p: unknown[] = [est];
  let cond = '';
  if (f.fornecedor !== null) {
    cond += ' AND c.empresa_fornecedora_id = ?';
    p.push(f.fornecedor);
  }
  if (f.item != null) {
    cond += ' AND c.insumo_id = ?';
    p.push(f.item);
  }
  if (f.ids) {
    if (!f.ids.length) return { itens: [], cortada: false };
    cond += ` AND c.id IN (${f.ids.map(() => '?').join(', ')})`;
    p.push(...f.ids);
  }
  // Só o consumo de sala (com agendamento cirúrgico): o contrato da tela exige o agendamento.
  const xs = await consulta(
    l,
    travar,
    `SELECT c.id, c.agendamento_cirurgico_id, c.atendimento_id, c.empresa_fornecedora_id, c.insumo_id, ins.nome,
            c.quantidade, c.numero_lote, c.numero_serie, c.registrado_em
       FROM consumo_opme c
       JOIN insumo ins ON ins.id = c.insumo_id
      WHERE c.estabelecimento_id = ? AND c.consignado AND c.situacao = 'consumido' AND c.excluido_em IS NULL
        AND c.agendamento_cirurgico_id IS NOT NULL${cond}
      ORDER BY c.id DESC
      LIMIT ${teto + 1}`,
    p,
    teto + 1,
  );
  const ids = xs.slice(0, teto).map((x) => num(x['id']));
  const rep = new Map<string, Linha>();
  if (ids.length) {
    const rs = await consulta(
      l,
      travar,
      `SELECT p.id, p.tipo, p.consumo_opme_id, p.ocorrido_em, p.nota_entrada_id, n.data_entrada
         FROM reposicao_consignada p
         LEFT JOIN nota_entrada n ON n.id = p.nota_entrada_id
        WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao <> 'cancelada'
          AND p.consumo_opme_id IN (${ids.map(() => '?').join(', ')})`,
      [est, ...ids],
      ids.length * 3 + 1,
    );
    for (const r of rs) rep.set(`${String(r['tipo'])}:${num(r['consumo_opme_id'])}`, r);
  }
  const itens = xs.slice(0, teto).map((x): ConsumoConsignado => {
    const id = num(x['id']);
    const r = rep.get(`reposicao:${id}`);
    const fa = rep.get(`faturamento:${id}`);
    const ent = fa ? dataIso(fa['data_entrada']) : null;
    return {
      consumo: id,
      agendamento: num(x['agendamento_cirurgico_id']),
      atendimento: num(x['atendimento_id']),
      fornecedor: x['empresa_fornecedora_id'] === null ? null : num(x['empresa_fornecedora_id']),
      item: num(x['insumo_id']),
      itemNome: txtOuNull(x['nome']),
      quantidade: q3(num(x['quantidade'])),
      lote: txtOuNull(x['numero_lote']),
      serie: txtOuNull(x['numero_serie']),
      em: minuto(x['registrado_em']),
      reposicao: r ? { movimento: num(r['id']), em: minuto(r['ocorrido_em']) } : null,
      faturamento: fa
        ? {
            movimento: num(fa['id']),
            em: minuto(fa['ocorrido_em']),
            nf:
              fa['nota_entrada_id'] === null || !ent
                ? null
                : {
                    ano: Number(ent.slice(0, 4)),
                    mes: Number(ent.slice(5, 7)),
                    doc: num(fa['nota_entrada_id']),
                  },
          }
        : null,
    };
  });
  return { itens, cortada: xs.length > teto };
}

/** Um consumo consignado para a soma do saldo (com ou sem agendamento cirúrgico). */
interface ConsumoParaSaldo {
  readonly fornecedor: number | null;
  readonly item: number;
  readonly quantidade: number;
  readonly reposto: boolean;
  readonly faturado: boolean;
}

/**
 * TODOS os consumos consignados do filtro para a soma do saldo: aqui não vale o filtro de agendamento da lista da tela
 * (o consumo sem agendamento também tira o material do fornecedor do saldo).
 */
async function lerConsumosParaSaldo(
  l: Leitor,
  est: number,
  f: Filtro,
  travar: boolean,
  teto: number,
): Promise<{ itens: ConsumoParaSaldo[]; cortada: boolean }> {
  const p: unknown[] = [est];
  let cond = '';
  if (f.fornecedor !== null) {
    cond += ' AND c.empresa_fornecedora_id = ?';
    p.push(f.fornecedor);
  }
  if (f.item != null) {
    cond += ' AND c.insumo_id = ?';
    p.push(f.item);
  }
  const xs = await consulta(
    l,
    travar,
    `SELECT c.empresa_fornecedora_id, c.insumo_id, c.quantidade,
            EXISTS (SELECT 1 FROM reposicao_consignada r
                     WHERE r.consumo_opme_id = c.id AND r.tipo = 'reposicao' AND r.excluido_em IS NULL
                       AND r.situacao <> 'cancelada') AS reposto,
            EXISTS (SELECT 1 FROM reposicao_consignada r
                     WHERE r.consumo_opme_id = c.id AND r.tipo = 'faturamento' AND r.excluido_em IS NULL
                       AND r.situacao <> 'cancelada') AS faturado
       FROM consumo_opme c
      WHERE c.estabelecimento_id = ? AND c.consignado AND c.situacao = 'consumido' AND c.excluido_em IS NULL${cond}
      ORDER BY c.id DESC
      LIMIT ${teto + 1}`,
    p,
    teto + 1,
  );
  return {
    itens: xs.slice(0, teto).map((x) => ({
      fornecedor: x['empresa_fornecedora_id'] === null ? null : num(x['empresa_fornecedora_id']),
      item: num(x['insumo_id']),
      quantidade: q3(num(x['quantidade'])),
      reposto: Boolean(num(x['reposto'])),
      faturado: Boolean(num(x['faturado'])),
    })),
    cortada: xs.length > teto,
  };
}

function somarSaldos(
  ms: readonly MovimentoConsignado[],
  cs: readonly ConsumoParaSaldo[],
): SaldoConsignadoAgregado[] {
  return saldoConsignado(ms, cs);
}

/** Teto de proteção da soma do saldo (passar dele recusa a devolução e marca a lista cortada). */
const TETO_SOMA_SALDO = 100_000;

// ── O gravador (dentro da operação do executor) ──────────────────────────────────────────────────────────────────

interface Guardado {
  readonly hash: string;
  readonly grupo: number;
  readonly movimentos: number[];
  readonly fornecedor: number;
  readonly item: number;
  readonly tipo: string;
}

/** O hash da entrada do pedido (o corpo normalizado), que o reenvio com a mesma chave tem de repetir. */
const hashDoPedido = (pedido: unknown) => hashEntrada(OPERACAO_CHAVE_CONSIGNADO, pedido);

async function lerGuardado(
  tx: TxOperacao,
  chave: string,
  usuario: number | null,
  est: number,
  pedido: unknown,
): Promise<Guardado | null> {
  const r = await lerIdempotencia(tx, OPERACAO_CHAVE_CONSIGNADO, chave);
  if (!r) return null;
  const x = r.resultado;
  // A chave é do usuário, do estabelecimento e do conteúdo do pedido: qualquer diferença é outro pedido.
  if (r.usuario !== usuario || num(x['estabelecimento']) !== est || r.hashEntrada !== hashDoPedido(pedido))
    throw erroIdempotenciaDivergente();
  return {
    hash: r.hashEntrada,
    grupo: num(x['grupo']),
    movimentos: String(x['movimentos'] ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number),
    fornecedor: num(x['fornecedor']),
    item: num(x['item']),
    tipo: String(x['tipo'] ?? ''),
  };
}

function gravadorSobre(tx: TxOperacao, est: number, agora: Date): GravadorConsignado {
  const usuario = tx.contexto.usuario ?? null;
  const guardar = async (
    chave: string,
    m: MovimentoConsignadoGravacao,
    r: { grupo: number; movimentos: number[] },
  ) => {
    const resultado = {
      grupo: r.grupo,
      movimentos: r.movimentos.join(','),
      fornecedor: m.fornecedor,
      item: m.item,
      tipo: m.linhas[0]?.tipo ?? '',
      estabelecimento: est,
    };
    await gravarIdempotencia(tx, {
      operacao: OPERACAO_CHAVE_CONSIGNADO,
      chave,
      estabelecimento: est,
      usuario,
      hashEntrada: hashDoPedido(m.pedido),
      resultado,
      trilha: null,
      agora,
    });
  };
  const travadoPar = async (fornecedor: number, item: number) => {
    // Teto do saldo: TODAS as linhas do par (sem o teto da tela), em leitura travada; passar do teto de proteção
    // recusa em vez de somar sobre dados cortados.
    const ms = await lerMovimentos(tx, est, { fornecedor, item }, true, TETO_SOMA_SALDO);
    const cs = await lerConsumosParaSaldo(tx, est, { fornecedor, item }, true, TETO_SOMA_SALDO);
    if (ms.cortada || cs.cortada)
      throw recusa(
        'saldo-sem-conferencia',
        'O par fornecedor e item tem movimentos demais para conferir o saldo nesta gravação: procure o suporte.',
      );
    return (
      somarSaldos(ms.itens, cs.itens).find((x) => x.fornecedor === fornecedor && x.item === item)?.saldo ?? 0
    );
  };

  async function localConsignado(): Promise<number> {
    const l = await tx.uma(
      `SELECT id FROM local_estoque
        WHERE estabelecimento_id = ? AND tipo = 'consignado' AND ativo AND excluido_em IS NULL
        ORDER BY id LIMIT 1`,
      [est],
    );
    if (!l)
      throw recusa(
        'sem-local-consignado',
        'O estabelecimento não tem local de estoque do tipo consignado ativo: cadastre-o antes de receber a remessa.',
      );
    return num(l['id']);
  }

  async function gravarRemessa(m: MovimentoConsignadoGravacao, x: LinhaMovimentoConsignado) {
    if (!x.nfNumero || !x.nfEmissao)
      throw recusa('nota-remessa-obrigatoria', 'Informe o número e a emissão da nota de remessa.', {
        campos: ['nfNumero'],
      });
    const ins = await tx.uma(
      'SELECT estoque_unidade_medida_id FROM insumo WHERE id = ? AND excluido_em IS NULL',
      [m.item],
    );
    if (!ins) throw recusa('item-inexistente', 'O item não está no cadastro.', { campos: ['item'] });
    const [cab] = await tx.consultarParaAtualizar(
      `SELECT id, situacao FROM remessa_consignada
        WHERE estabelecimento_id = ? AND empresa_fornecedora_id = ? AND nota_numero = ? AND nota_serie <=> ?
          AND excluido_em IS NULL`,
      [est, m.fornecedor, x.nfNumero, x.nfSerie],
      { teto: 1 },
    );
    let remessa: number;
    if (cab) {
      remessa = num(cab['id']);
      if (String(cab['situacao']) !== 'aberta')
        throw recusa(
          'remessa-fechada',
          'A nota de remessa já foi conferida ou encerrada: não recebe item novo.',
          {
            campos: ['nfNumero'],
          },
        );
    } else {
      const local = await localConsignado();
      const numero = await tx.proximoNumero('remessa_consignada');
      remessa = await tx.incluir('remessa_consignada', {
        estabelecimento_id: est,
        numero: numero.valor,
        empresa_fornecedora_id: m.fornecedor,
        local_estoque_id: local,
        nota_numero: x.nfNumero,
        nota_serie: x.nfSerie,
        nota_emissao: x.nfEmissao,
        recebida_em: agora,
        recebedor_usuario_id: usuario,
        situacao: 'aberta',
      });
    }
    const seq = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) + 1 AS proxima FROM remessa_consignada_item WHERE remessa_consignada_id = ?',
      [remessa],
    );
    const item = await tx.incluir('remessa_consignada_item', {
      remessa_consignada_id: remessa,
      sequencia: num(seq?.['proxima']),
      insumo_id: m.item,
      unidade_medida_id: num(ins['estoque_unidade_medida_id']),
      lote: x.lote,
      numero_serie: x.serie,
      validade: x.validade,
      quantidade: x.quantidade,
    });
    return { grupo: remessa, movimentos: [item], repetido: false };
  }

  async function notaDaEntrada(x: LinhaMovimentoConsignado): Promise<number | null> {
    if (!x.nfEntrada) return null;
    const n = await tx.uma(
      `SELECT id, situacao FROM nota_entrada
        WHERE id = ? AND estabelecimento_id = ? AND YEAR(data_entrada) = ? AND MONTH(data_entrada) = ?
          AND excluido_em IS NULL`,
      [x.nfEntrada.doc, est, x.nfEntrada.ano, x.nfEntrada.mes],
    );
    if (!n)
      throw recusa('nota-inexistente', 'A nota da entrada do estoque não existe neste estabelecimento.', {
        campos: ['nfEntrada'],
      });
    if (String(n['situacao']) !== 'confirmada')
      throw recusa(
        'nota-nao-confirmada',
        'A nota da entrada do estoque não está confirmada (em digitação, em conferência, estornada ou cancelada): fature com a nota confirmada.',
        { campos: ['nfEntrada'] },
      );
    return num(n['id']);
  }

  return {
    movimentosPelaChave: async (chave, pedido) => {
      const g = await lerGuardado(tx, chave, usuario, est, pedido);
      if (!g) return null;
      const ms = await lerMovimentos(tx, est, { fornecedor: g.fornecedor, item: g.item }, false, 100_000);
      const ids = new Set(g.movimentos);
      const doTipo = (t: string) => (g.tipo === 'remessa' ? t === 'remessa' : t !== 'remessa');
      return ms.itens.filter((x) => ids.has(x.id) && doTipo(x.tipo));
    },
    consumos: async (ids) =>
      (await lerConsumos(tx, est, { fornecedor: null, ids }, true, ids.length + 1)).itens,
    saldoTravado: (fornecedor, item) => travadoPar(fornecedor, item),
    gravar: async (m) => {
      const ja = await lerGuardado(tx, m.chave, usuario, est, m.pedido);
      if (ja) {
        return { grupo: ja.grupo, movimentos: ja.movimentos, repetido: true };
      }
      if (!m.linhas.length) throw recusa('sem-movimento', 'Nada a gravar: informe ao menos um movimento.');
      const [x0] = m.linhas;
      if (x0!.tipo === 'remessa') {
        if (m.linhas.length !== 1) throw new Error('A remessa grava uma linha por pedido.');
        const r = await gravarRemessa(m, x0!);
        await guardar(m.chave, m, r);
        return r;
      }
      const ids: number[] = [];
      for (const x of m.linhas) {
        if (x.tipo === 'remessa') throw new Error('A remessa não se mistura com reposições.');
        const numero = await tx.proximoNumero('reposicao_consignada');
        try {
          ids.push(
            await tx.incluir('reposicao_consignada', {
              estabelecimento_id: est,
              numero: numero.valor,
              tipo: x.tipo,
              empresa_fornecedora_id: m.fornecedor,
              insumo_id: m.item,
              consumo_opme_id: x.consumo,
              quantidade: x.quantidade,
              lote: x.lote,
              numero_serie: x.serie,
              nota_entrada_id: x.tipo === 'faturamento' ? await notaDaEntrada(x) : null,
              nota_numero: x.nfNumero,
              nota_serie: x.nfSerie,
              nota_emissao: x.nfEmissao,
              ocorrido_em: agora,
              motivo: x.motivo,
              situacao: x.tipo === 'faturamento' ? 'faturada' : 'registrada',
            }),
          );
        } catch (erro) {
          if (restricaoUnicaViolada(erro) === 'uq_reposicao_consignada_consumo_opme_id_tipo')
            throw recusa(
              x.tipo === 'faturamento' ? 'consumo-ja-faturado' : 'consumo-ja-reposto',
              x.tipo === 'faturamento'
                ? 'Um dos consumos já foi faturado em outra tela.'
                : 'Um dos consumos já foi reposto em outra tela.',
              { campos: ['consumos'] },
            );
          throw erro;
        }
      }
      const r = { grupo: ids[0]!, movimentos: ids };
      await guardar(m.chave, m, r);
      return { ...r, repetido: false };
    },
  };
}

// ── A porta ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class PortaConsignadoPropria implements PortaConsignado {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoConsignado,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18, est: number): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: c.correlacao || 'consignado',
    };
  }

  /** O estabelecimento da sessão; sem ele nada é lido nem gravado. */
  private est(c: ContextoPortaM18): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private ler<T>(c: ContextoPortaM18, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.contexto(c, est), (l) => fn(l, est));
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(): Promise<never> {
    return Promise.reject(new ErroProblema('operacao-bloqueada', 409, 'Operação indisponível', SEM_EXECUTOR));
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorConsignado) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const op = definirOperacao({
      nome: 'consignado.gravacao',
      tabelas: [...TABELAS_CONSIGNADO],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est, new Date())) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'reposicao_consignada', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `consignado:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação do consignado sem resultado.');
    return (saida as { valor: T }).valor;
  }

  movimentos(c: ContextoPortaM18, fornecedor: number | null) {
    return this.ler(c, (l, est) => lerMovimentos(l, est, { fornecedor }, false, TETO_LISTA_CONSIGNADO));
  }

  consumos(c: ContextoPortaM18, fornecedor: number | null) {
    return this.ler(c, (l, est) => lerConsumos(l, est, { fornecedor }, false, TETO_LISTA_CONSIGNADO));
  }

  saldos(c: ContextoPortaM18, fornecedor: number | null) {
    // A soma é sobre TODAS as linhas (regra 10): o teto aqui é só de proteção, e passar dele marca a lista cortada.
    return this.ler(c, async (l, est) => {
      const ms = await lerMovimentos(l, est, { fornecedor }, false, TETO_SOMA_SALDO);
      const cs = await lerConsumosParaSaldo(l, est, { fornecedor }, false, TETO_SOMA_SALDO);
      return { itens: somarSaldos(ms.itens, cs.itens), cortada: ms.cortada || cs.cortada };
    });
  }

  saldoCadastro(c: ContextoPortaM18) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT empresa_fornecedora_id, insumo_id, SUM(quantidade_saldo) AS quantidade
             FROM saldo_consignado
            WHERE estabelecimento_id = ? AND excluido_em IS NULL
            GROUP BY empresa_fornecedora_id, insumo_id
           HAVING SUM(quantidade_saldo) <> 0`,
          [est],
          { teto: 20_000 },
        )
      ).map((x) => ({
        fornecedor: num(x['empresa_fornecedora_id']),
        item: num(x['insumo_id']),
        quantidade: q3(num(x['quantidade'])),
      })),
    );
  }

  nomes(c: ContextoPortaM18, fs: readonly number[], is: readonly number[]) {
    // Cadastros da rede inteira (fornecedor e insumo não têm estabelecimento).
    return this.ler(c, async (l) => {
      const fornecedores = new Map<number, string>();
      const itens = new Map<number, string>();
      const f = [...new Set(fs)].slice(0, 1000);
      const i = [...new Set(is)].slice(0, 1000);
      if (f.length)
        for (const x of await l.consultar(
          `SELECT id, razao_social FROM empresa_fornecedora WHERE id IN (${f.map(() => '?').join(', ')})`,
          f,
          { teto: f.length },
        ))
          fornecedores.set(num(x['id']), String(x['razao_social']));
      if (i.length)
        for (const x of await l.consultar(
          `SELECT id, nome FROM insumo WHERE id IN (${i.map(() => '?').join(', ')})`,
          i,
          { teto: i.length },
        ))
          itens.set(num(x['id']), String(x['nome']));
      return { fornecedores, itens };
    });
  }

  notaEntrada(c: ContextoPortaM18, nf: { ano: number; mes: number; doc: number }, item: number) {
    return this.ler(c, async (l, est) => {
      const n = await l.uma(
        `SELECT n.empresa_fornecedora_id,
                EXISTS (SELECT 1 FROM nota_entrada_item i
                         WHERE i.nota_entrada_id = n.id AND i.insumo_id = ? AND i.excluido_em IS NULL) AS tem_item
           FROM nota_entrada n
          WHERE n.id = ? AND n.estabelecimento_id = ? AND YEAR(n.data_entrada) = ? AND MONTH(n.data_entrada) = ?
            AND n.excluido_em IS NULL AND n.situacao = 'confirmada'`,
        [item, nf.doc, est, nf.ano, nf.mes],
      );
      return n
        ? { fornecedor: num(n['empresa_fornecedora_id']), temItem: Boolean(num(n['tem_item'])) }
        : null;
    });
  }

  notasEntrada(c: ContextoPortaM18, fornecedor: number, item: number): Promise<NotaEntradaConsignado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT n.id, n.data_entrada, n.numero_documento, n.serie, n.data_emissao
             FROM nota_entrada n
            WHERE n.estabelecimento_id = ? AND n.empresa_fornecedora_id = ? AND n.excluido_em IS NULL
              AND n.situacao = 'confirmada'
              AND EXISTS (SELECT 1 FROM nota_entrada_item i
                           WHERE i.nota_entrada_id = n.id AND i.insumo_id = ? AND i.excluido_em IS NULL)
            ORDER BY n.data_entrada DESC, n.id DESC
            LIMIT 100`,
          [est, fornecedor, item],
          { teto: 100 },
        )
      ).map((x) => {
        const ent = dataIso(x['data_entrada']) ?? '';
        return {
          ano: Number(ent.slice(0, 4)),
          mes: Number(ent.slice(5, 7)),
          doc: num(x['id']),
          numero: txtOuNull(x['numero_documento']),
          serie: txtOuNull(x['serie']),
          emissao: dataIso(x['data_emissao']),
        };
      }),
    );
  }

  fornecedorExiste(c: ContextoPortaM18, fornecedor: number) {
    return this.ler(c, async (l) =>
      Boolean(
        await l.uma(
          "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo'",
          [fornecedor],
        ),
      ),
    );
  }

  classeDoItem(c: ContextoPortaM18, item: number) {
    return this.ler(c, async (l) => {
      const x = await l.uma(
        "SELECT opme OR tipo = 'opme' AS opme FROM insumo WHERE id = ? AND excluido_em IS NULL",
        [item],
      );
      return x ? (num(x['opme']) ? CLASSE_OPME : CLASSE_NAO_OPME) : null;
    });
  }

  referenciaConsignada(c: ContextoPortaM18, item: number) {
    return this.ler(c, async (l) =>
      Boolean(
        num(
          (await l.uma('SELECT consignado FROM insumo WHERE id = ? AND excluido_em IS NULL', [item]))?.[
            'consignado'
          ],
        ),
      ),
    );
  }

  buscarItens(c: ContextoPortaM18, termo: string): Promise<ItemBusca[]> {
    const t = termo.trim();
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT i.id, i.nome, um.sigla, i.controla_lote, i.controlado, i.antimicrobiano, i.consignado, i.situacao
             FROM insumo i
             LEFT JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id
            WHERE i.excluido_em IS NULL AND (i.codigo = ? OR i.nome LIKE ?)
            ORDER BY i.nome, i.id
            LIMIT 50`,
          [t, `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`],
          { teto: 50 },
        )
      ).map((x) => ({
        codigo: num(x['id']),
        nome: String(x['nome']),
        unidade: txtOuNull(x['sigla']) ?? '',
        rastreavel: Boolean(num(x['controla_lote'])),
        controlado: Boolean(num(x['controlado'])),
        antimicrobiano: Boolean(num(x['antimicrobiano'])),
        consignado: Boolean(num(x['consignado'])),
        ativo: String(x['situacao']) === 'ativo',
      })),
    );
  }
}

/** A porta própria sobre o núcleo do cliente. */
export function portaConsignadoPropria(nucleo: NucleoConsignado): PortaConsignado {
  return new PortaConsignadoPropria(nucleo);
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaConsignadoIndisponivel(): PortaConsignado {
  return portaIndisponivel<PortaConsignado>(METODOS_PORTA_CONSIGNADO);
}
