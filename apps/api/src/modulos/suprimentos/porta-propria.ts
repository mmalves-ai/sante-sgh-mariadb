// Porta do estoque (M28) sobre o banco do cliente, pelo @sgh/nucleo: leituras somente leitura nas tabelas do estoque
// (local_estoque, insumo, saldo_estoque, saldo_lote, lote_insumo, centro_custo, fechamento_estoque e inventario_estoque*)
// e gravações diretas pelo Executor, com a trilha, o outbox, a idempotência e a trava de versão na mesma transação.
// Toda leitura filtra o estabelecimento da sessão e os excluídos; o cadastro do insumo é da rede inteira (sem
// estabelecimento), o saldo é do estabelecimento.
// Melhoria: o inventário aberto guarda o saldo do sistema e o custo médio lidos do banco no momento da abertura (o
// saldo mandado pela tela é ignorado); o geral pega todo o saldo do local, o cíclico os itens ou a curva escolhidos;
// recusa local de outro estabelecimento, item repetido, inativo ou inexistente e segundo inventário aberto no local.
// Melhoria: a contagem segue a regra do domínio (divergência acima do limite pede recontagem por outra pessoa, que abre
// a rodada seguinte; duas contagens iguais confirmam a divergência), só conta na rodada aberta e respeita o número
// máximo de rodadas (na última, a divergência fica confirmada); a rodada sem item pendente fecha sozinha.
// Melhoria: a decisão do inventário (aprovar ou cancelar, com justificativa no cancelamento) fecha as rodadas, e o
// inventário aberto nunca prende o local: o cancelamento o libera.
// Melhoria: a gravação direta tem nome de operação pelo método (suprimentos.abrir_inventario...), a entrada que vai ao
// hash da idempotência é a chamada inteira (método e dados) e a chave é a Idempotency-Key da tela: o reenvio devolve o
// resultado gravado e a mesma chave com outro conteúdo é recusada (idempotencia-divergente).
// Melhoria: o número do inventário é número de negócio (sequencia_negocio 'inventario_estoque'), não o id.
// Pendências (pedido do lote 03-14; a tela recebe o motivo, nada em silêncio): as operações do executor
// (OPERACOES_SUPRIMENTOS_PENDENTES) e as leituras e gravações em LEITURAS_SUPRIMENTOS_PENDENTES e
// GRAVACOES_SUPRIMENTOS_PENDENTES respondem 409 modelo-pendente. As tabelas existem: falta a porta (trabalho de lote).
import {
  avaliarItem,
  conferirAprovacao,
  conferirRecontagem,
  diasParaVencer,
  divergenciaPct,
  type ItemContado,
  type RecusaSuprimentos,
  validadeSuspeita,
  vencido,
} from '@sgh/dominio-suprimentos';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SaldoItem } from '@sgh/contratos';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import {
  chaveDaTela,
  contextoNucleo,
  modeloPendente,
  OPERACOES_SUPRIMENTOS_PENDENTES,
  resultadoDe,
  valorDe,
} from './operacoes.js';
import {
  type ContextoSuprimentos,
  type GravadorSghSuprimentos,
  type ItemCadastroEstoque,
  METODOS_PORTA_SUPRIMENTOS,
  type PortaSuprimentos,
} from './porta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSuprimentos = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TABELAS_GRAVACAO_SUPRIMENTOS = [
  'inventario_estoque',
  'inventario_estoque_contagem',
  'inventario_estoque_item',
] as const;

/**
 * Leituras que a porta ainda não atende, com o que falta (pedido do lote 03-14). As tabelas existem no modelo
 * (11_SUP); o que falta é a porta com os tipos de negócio por id (trabalho de lote, não DDL).
 */
export const LEITURAS_SUPRIMENTOS_PENDENTES: Readonly<Record<string, string>> = {
  buscarItens: 'a busca de itens do estoque',
  posicaoMensal: 'a posição mensal do item (saldo_estoque_mensal)',
  fichaItem: 'a ficha do item',
  documentos: 'a lista de documentos do estoque (documento_estoque)',
  documento: 'o documento do estoque (documento_estoque e itens)',
  requisicoes: 'as requisições pendentes (requisicao_material)',
  rastreio: 'o rastreio do lote (movimento_estoque por lote_insumo)',
  lotesDoPaciente: 'os lotes usados no paciente',
  consumo: 'o consumo do mês por centro de custo',
  consumoMensalPorItem: 'o consumo mensal por item (sugestão de compra)',
  emPedidoPorItem: 'a quantidade em pedido por item (pedido_compra)',
  pedidos: 'os pedidos de compra (pedido_compra)',
  pedido: 'o pedido de compra (pedido_compra e itens)',
  historicoCompras: 'o histórico de compras do item',
  fechamentos: 'o painel de fechamentos do estoque (fechamento_estoque e saldo_estoque_mensal)',
  recalculos: 'os recálculos de saldo',
  parametros: 'os parâmetros do estoque do usuário',
  escopo: 'o escopo do usuário nos locais de estoque (local_estoque_usuario por id de usuário)',
  usuarios: 'os usuários do estoque (local_estoque_usuario)',
  fornecedores: 'a busca de fornecedores (empresa_fornecedora)',
  terceiros: 'a busca de terceiros',
  prestadores: 'a busca de prestadores',
  kits: 'os kits rastreáveis (kit_rastreavel)',
  kit: 'o kit rastreável (kit_rastreavel)',
  kitsPadrao: 'os kits padrão',
  estoqueInicial: 'os documentos de estoque inicial',
  transferencias: 'as transferências enviadas (documento_estoque de transferência)',
  envio: 'o envio da transferência',
  pontosPedido: 'os pontos de pedido definidos (saldo_estoque.ponto_pedido)',
};

/** Gravações diretas que a porta ainda não atende (pedido do lote 03-14; as tabelas existem). */
export const GRAVACOES_SUPRIMENTOS_PENDENTES: Readonly<Record<string, string>> = {
  aprovarPedido: 'a aprovação do pedido de compra por alçada (pedido_compra)',
  enviarTransferencia: 'o envio da transferência (documento_estoque de transferência)',
  cancelarTransferencia: 'o cancelamento da transferência',
  registrarDivergencia: 'a divergência da transferência',
  conferirCarrinho: 'a conferência do carrinho (kit_rastreavel)',
  definirPontoPedido: 'o ponto de pedido por item e local (saldo_estoque)',
  autorizarRequisicao: 'a autorização da requisição (requisicao_material)',
};

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const dataIso = (v: unknown): string => instante(v).slice(0, 10);
const SITUACOES_ABERTAS = ['aberto', 'contagem', 'recontagem'];
const LIMITE_SALDOS = 500;

const faltaLeitura = (m: string): Promise<never> =>
  Promise.reject(modeloPendente(LEITURAS_SUPRIMENTOS_PENDENTES[m] ?? m));
const faltaGravacao = (m: string): Promise<never> =>
  Promise.reject(modeloPendente(GRAVACOES_SUPRIMENTOS_PENDENTES[m] ?? m));

/** A recusa de negócio do domínio vira o erro da operação (nada gravado). */
function recusar(r: RecusaSuprimentos | null): void {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: [...r.campos] } : {});
}

/** A situação do item no banco a partir da avaliação do domínio. */
const situacaoNoBanco = (s: string): string => (s === 'divergente-confirmado' ? 'divergente_confirmado' : s);
const situacaoNaTela = (s: string) =>
  (s === 'divergente_confirmado' ? 'divergente-confirmado' : s) as
    'pendente' | 'ok' | 'recontar' | 'divergente-confirmado';

/** O alerta do lote (validade com dígitos trocados, vencido, vence na antecedência ou nenhum). */
function loteLido(r: Linha, hoje: string, alertaDias: number): SaldoItem['lotes'][number] {
  const validade = dataIso(r['validade']);
  const dias = diasParaVencer(validade, hoje);
  return {
    id: n(r['lote_id']),
    lote: String(r['numero_lote']),
    validade,
    quantidade: n(r['quantidade']),
    diasParaVencer: dias,
    alerta: validadeSuspeita(validade)
      ? 'suspeita'
      : vencido(validade, hoje)
        ? 'vencido'
        : dias <= alertaDias
          ? 'vence'
          : 'nenhum',
  };
}

const SQL_LOTES = `SELECT sl.local_estoque_id, li.insumo_id, li.id AS lote_id, li.numero_lote, li.validade, sl.quantidade
     FROM saldo_lote sl
     JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
    WHERE sl.estabelecimento_id = ? AND sl.excluido_em IS NULL AND sl.quantidade > 0`;

/** As contagens de um item do inventário em ordem de rodada (o contador pelo id do usuário). */
function itemContado(item: number, linhas: readonly Linha[]): ItemContado {
  return {
    item,
    saldoSistema: n(linhas[0]?.['saldo_sistema']),
    contagens: linhas
      .filter((r) => r['quantidade_contada'] !== null && r['quantidade_contada'] !== undefined)
      .map((r) => ({
        quantidade: n(r['quantidade_contada']),
        contador: String(r['contagem_usuario_id'] ?? ''),
      })),
  };
}

/** As linhas de item do inventário agrupadas por insumo, na ordem das rodadas. */
function porInsumo(linhas: readonly Linha[]): Map<number, Linha[]> {
  const m = new Map<number, Linha[]>();
  for (const r of linhas) {
    const k = n(r['insumo_id']);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

/** As gravações diretas sobre a transação da operação (o estabelecimento da sessão). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorSghSuprimentos {
  const usuarioDaOperacao = (): number => {
    const u = tx.contexto.usuario;
    if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    return u;
  };
  const inventarioTravado = async (id: number) => {
    const [inv] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, situacao, versao, limite_divergencia_pct, rodadas_maximas FROM inventario_estoque
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!inv) throw recusa('inventario-inexistente', 'O inventário não existe neste estabelecimento.');
    if (!SITUACOES_ABERTAS.includes(String(inv['situacao'])))
      throw recusa('inventario-encerrado', 'O inventário já foi encerrado: nada muda mais nele.');
    return inv;
  };
  const linhasDoInventario = (id: number, insumo?: number) =>
    tx.consultarParaAtualizar<Linha>(
      `SELECT it.id, it.versao, it.sequencia, it.insumo_id, it.unidade_medida_id, it.saldo_sistema, it.custo_medio_unitario,
              it.quantidade_contada, it.contagem_usuario_id, it.situacao, it.inventario_estoque_contagem_id,
              ct.sequencia AS rodada, ct.situacao AS situacao_rodada
         FROM inventario_estoque_item it
         JOIN inventario_estoque_contagem ct ON ct.id = it.inventario_estoque_contagem_id AND ct.excluido_em IS NULL
        WHERE it.inventario_estoque_id = ? AND it.excluido_em IS NULL ${insumo === undefined ? '' : 'AND it.insumo_id = ?'}
        ORDER BY it.insumo_id, ct.sequencia, it.id`,
      insumo === undefined ? [id] : [id, insumo],
    );
  const fecharRodadas = async (
    id: number,
    situacao: 'fechada' | 'aprovada' | 'cancelada',
    soSemPendente: boolean,
  ) => {
    const rodadas = await tx.consultarParaAtualizar<Linha>(
      `SELECT ct.id, ct.versao, ct.fechada_em,
              (SELECT COUNT(*) FROM inventario_estoque_item it WHERE it.inventario_estoque_contagem_id = ct.id
                  AND it.excluido_em IS NULL AND it.quantidade_contada IS NULL) AS pendentes
         FROM inventario_estoque_contagem ct
        WHERE ct.inventario_estoque_id = ? AND ct.excluido_em IS NULL
          AND ct.situacao IN ('aberta', ${situacao === 'aprovada' ? "'fechada'" : "'aberta'"})`,
      [id],
    );
    const agora = new Date();
    for (const r of rodadas)
      if (!soSemPendente || n(r['pendentes']) === 0)
        await tx.alterar('inventario_estoque_contagem', n(r['id']), n(r['versao']), {
          situacao,
          ...(r['fechada_em'] ? {} : { fechada_em: agora }),
          ...(situacao === 'aprovada'
            ? { aprovacao_usuario_id: tx.contexto.usuario, aprovada_em: agora }
            : {}),
        });
  };

  return {
    aprovarPedido: () => faltaGravacao('aprovarPedido'),
    enviarTransferencia: () => faltaGravacao('enviarTransferencia'),
    cancelarTransferencia: () => faltaGravacao('cancelarTransferencia'),
    registrarDivergencia: () => faltaGravacao('registrarDivergencia'),
    conferirCarrinho: () => faltaGravacao('conferirCarrinho'),
    definirPontoPedido: () => faltaGravacao('definirPontoPedido'),
    autorizarRequisicao: () => faltaGravacao('autorizarRequisicao'),

    async abrirInventario(i) {
      const usuario = usuarioDaOperacao();
      if (!(i.limitePct >= 0 && i.limitePct <= 100))
        throw recusa('limite-invalido', 'O limite de divergência vai de 0 a 100%.', {
          campos: ['limitePct'],
        });
      const ids = [...new Set(i.itens.map((x) => x.item))];
      if (ids.length !== i.itens.length)
        throw recusa('item-repetido', 'O mesmo item aparece duas vezes no inventário.');
      if (!ids.length && i.tipo === 'ciclico' && !i.curva)
        throw recusa('inventario-sem-itens', 'No inventário cíclico, escolha a curva ou os itens a contar.', {
          campos: ['itens'],
        });
      const local = await tx.uma(
        'SELECT id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
        [i.local, est],
      );
      if (!local) throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.');
      const aberto = await tx.consultarParaAtualizar(
        `SELECT id FROM inventario_estoque WHERE local_estoque_id = ? AND excluido_em IS NULL
            AND situacao IN (${lista(SITUACOES_ABERTAS.length)}) LIMIT 1`,
        [i.local, ...SITUACOES_ABERTAS],
      );
      if (aberto.length) throw recusa('inventario-em-aberto', 'Já há um inventário em aberto neste local.');
      // O saldo do sistema e o custo médio são os do banco agora (o da tela pode estar velho).
      let insumos: Linha[];
      if (ids.length) {
        insumos = await tx.consultar<Linha>(
          `SELECT i.id, i.estoque_unidade_medida_id, i.controla_lote, i.situacao, s.quantidade, s.custo_medio
             FROM insumo i
             LEFT JOIN saldo_estoque s ON s.insumo_id = i.id AND s.local_estoque_id = ? AND s.estabelecimento_id = ?
                  AND s.excluido_em IS NULL
            WHERE i.id IN (${lista(ids.length)}) AND i.excluido_em IS NULL`,
          [i.local, est, ...ids],
        );
        if (insumos.length !== ids.length)
          throw recusa('item-inexistente', 'Um dos itens não existe no cadastro.');
        if (insumos.some((r) => r['situacao'] !== 'ativo'))
          throw recusa('item-inativo', 'Um dos itens está inativo no cadastro: tire-o do inventário.', {
            campos: ['itens'],
          });
        const ordem = new Map(ids.map((x, k) => [x, k]));
        insumos.sort((a, b) => (ordem.get(n(a['id'])) ?? 0) - (ordem.get(n(b['id'])) ?? 0));
      } else {
        insumos = await tx.consultar<Linha>(
          `SELECT i.id, i.estoque_unidade_medida_id, i.controla_lote, i.situacao, s.quantidade, s.custo_medio
             FROM saldo_estoque s
             JOIN insumo i ON i.id = s.insumo_id AND i.excluido_em IS NULL AND i.situacao = 'ativo'
            WHERE s.local_estoque_id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL
                  ${i.curva ? 'AND s.curva_abc = ?' : ''}
            ORDER BY i.nome, i.id`,
          i.curva ? [i.local, est, i.curva] : [i.local, est],
        );
        if (!insumos.length)
          throw recusa('inventario-sem-itens', 'Não há item com saldo neste local para inventariar.');
      }
      const agora = new Date();
      const numero = await tx.proximoNumero('inventario_estoque');
      const id = await tx.incluir('inventario_estoque', {
        estabelecimento_id: est,
        numero: numero.formatado,
        local_estoque_id: i.local,
        tipo: i.tipo,
        curva_abc: i.curva ?? null,
        data_corte: agora,
        situacao: 'aberto',
        contagem_cega: true,
        rodadas_maximas: 3,
        limite_divergencia_pct: i.limitePct,
        controla_lote: insumos.some((r) => verdadeiro(r['controla_lote'])),
        abertura_usuario_id: usuario,
        aberto_em: agora,
      });
      const contagem = await tx.incluir('inventario_estoque_contagem', {
        inventario_estoque_id: id,
        sequencia: 1,
        tipo: 'contagem',
        aberta_em: agora,
        situacao: 'aberta',
      });
      for (const [k, r] of insumos.entries())
        await tx.incluir('inventario_estoque_item', {
          inventario_estoque_id: id,
          sequencia: k + 1,
          inventario_estoque_contagem_id: contagem,
          insumo_id: n(r['id']),
          unidade_medida_id: n(r['estoque_unidade_medida_id']),
          saldo_sistema: n(r['quantidade']),
          custo_medio_unitario:
            r['custo_medio'] === null || r['custo_medio'] === undefined ? null : n(r['custo_medio']),
          situacao: 'pendente',
        });
      return id;
    },

    async registrarContagem(cg) {
      const usuario = usuarioDaOperacao();
      if (!(cg.quantidade >= 0))
        throw recusa('quantidade-invalida', 'A quantidade contada não pode ser negativa.', {
          campos: ['quantidade'],
        });
      const inv = await inventarioTravado(cg.inventario);
      const linhas = await linhasDoInventario(cg.inventario, cg.item);
      if (!linhas.length) throw recusa('item-fora-do-inventario', 'O item não está neste inventário.');
      // A linha a contar: a pendente numa rodada aberta.
      const atual = linhas.find(
        (r) =>
          (r['quantidade_contada'] === null || r['quantidade_contada'] === undefined) &&
          r['situacao_rodada'] === 'aberta',
      );
      if (!atual) throw recusa('item-resolvido', 'O item não está a contar em nenhuma rodada aberta.');
      const antes = itemContado(cg.item, linhas);
      if (antes.contagens.length) recusar(conferirRecontagem(antes, String(usuario)));
      const limite = n(inv['limite_divergencia_pct']);
      const depois = avaliarItem(
        {
          ...antes,
          contagens: [...antes.contagens, { quantidade: cg.quantidade, contador: String(usuario) }],
        },
        limite,
      );
      const rodada = n(atual['rodada']);
      const ultimaRodada = rodada >= n(inv['rodadas_maximas']);
      const situacao =
        depois.situacao === 'recontar' && ultimaRodada
          ? 'divergente_confirmado'
          : situacaoNoBanco(depois.situacao);
      const agora = new Date();
      await tx.alterar('inventario_estoque_item', n(atual['id']), n(atual['versao']), {
        quantidade_contada: cg.quantidade,
        contagem_usuario_id: usuario,
        contado_em: agora,
        situacao,
      });
      if (situacao === 'recontar') {
        // A recontagem vai à rodada seguinte (aberta na primeira divergência dela).
        const proxima = await tx.uma<Linha>(
          `SELECT id FROM inventario_estoque_contagem WHERE inventario_estoque_id = ? AND sequencia = ? AND excluido_em IS NULL`,
          [cg.inventario, rodada + 1],
        );
        const idProxima =
          proxima !== null && proxima !== undefined
            ? n(proxima['id'])
            : await tx.incluir('inventario_estoque_contagem', {
                inventario_estoque_id: cg.inventario,
                sequencia: rodada + 1,
                tipo: 'recontagem',
                aberta_em: agora,
                situacao: 'aberta',
              });
        const ultima = await tx.uma<Linha>(
          'SELECT MAX(sequencia) AS s FROM inventario_estoque_item WHERE inventario_estoque_id = ?',
          [cg.inventario],
        );
        await tx.incluir('inventario_estoque_item', {
          inventario_estoque_id: cg.inventario,
          sequencia: n(ultima?.['s']) + 1,
          inventario_estoque_contagem_id: idProxima,
          insumo_id: cg.item,
          unidade_medida_id: n(atual['unidade_medida_id']),
          saldo_sistema: n(atual['saldo_sistema']),
          custo_medio_unitario: atual['custo_medio_unitario'] ?? null,
          situacao: 'pendente',
        });
      }
      await fecharRodadas(cg.inventario, 'fechada', true);
      const nova =
        situacao === 'recontar' ? 'recontagem' : String(inv['situacao']) === 'aberto' ? 'contagem' : null;
      if (nova && nova !== inv['situacao'])
        await tx.alterar('inventario_estoque', cg.inventario, n(inv['versao']), { situacao: nova });
      return { ordem: antes.contagens.length + 1 };
    },

    async decidirInventario(d) {
      const usuario = usuarioDaOperacao();
      const inv = await inventarioTravado(d.inventario);
      const porItem = porInsumo(await linhasDoInventario(d.inventario));
      const itens = [...porItem].map(([item, ls]) => itemContado(item, ls));
      recusar(conferirAprovacao(itens, String(usuario), d.podeAprovar));
      const justificativa = d.justificativa.trim();
      const agora = new Date();
      if (d.decisao === 'cancelado') {
        if (!justificativa)
          throw recusa('sem-justificativa', 'Diga por que o inventário é cancelado.', {
            campos: ['justificativa'],
          });
        await fecharRodadas(d.inventario, 'cancelada', false);
        await tx.alterar('inventario_estoque', d.inventario, n(inv['versao']), {
          situacao: 'cancelado',
          fechamento_usuario_id: usuario,
          fechado_em: agora,
          justificativa,
        });
        return;
      }
      // Aprovar: todo item resolvido (a última linha de cada um ok ou com a divergência confirmada).
      const abertos = [...porItem.values()].filter((ls) =>
        ['pendente', 'recontar'].includes(String(ls[ls.length - 1]?.['situacao'])),
      );
      if (abertos.length)
        throw recusa(
          'inventario-incompleto',
          `Há ${abertos.length} item(ns) sem contagem ou a recontar: o inventário só é aprovado com todos resolvidos.`,
        );
      await fecharRodadas(d.inventario, 'aprovada', false);
      await tx.alterar('inventario_estoque', d.inventario, n(inv['versao']), {
        situacao: 'aprovado',
        aprovacao_usuario_id: usuario,
        aprovado_em: agora,
        fechamento_usuario_id: usuario,
        fechado_em: agora,
        justificativa: justificativa || null,
      });
    },
  };
}

/** Marca da captura da chamada ao gravador (antes da transação). */
const CAPTURA = Symbol('captura-gravador');

/** O método e os dados que a tela manda ao gravador, sem gravar nada (vão ao nome e ao hash da operação). */
async function capturarChamada<T>(
  fn: (g: GravadorSghSuprimentos) => Promise<T>,
): Promise<{ metodo: string; dados: unknown }> {
  const chamadas: { metodo: string; dados: unknown }[] = [];
  const espiao = new Proxy({} as GravadorSghSuprimentos, {
    get: (_t, p) => (dados: unknown) => {
      chamadas.push({ metodo: String(p), dados });
      return Promise.reject(CAPTURA);
    },
  });
  try {
    await fn(espiao);
  } catch (e) {
    if (e !== CAPTURA) throw e;
  }
  const c = chamadas[0];
  if (!c) throw recusa('gravacao-vazia', 'A gravação não chamou nenhuma operação do estoque.');
  return c;
}

/** A chave de idempotência da gravação: a da tela (Idempotency-Key + ordem), ou única quando a tela não a manda. */
function chaveDaGravacao(c: ContextoSuprimentos): string {
  const da = chaveDaTela(c);
  if (!da) return `sup:${randomUUID()}`;
  return `sup:${da}`.length <= 80
    ? `sup:${da}`
    : `sup:${createHash('sha256').update(da).digest('hex').slice(0, 64)}`;
}

export class PortaSuprimentosPropria implements PortaSuprimentos {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSuprimentos,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoSuprimentos, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoNucleo(c, 'suprimentos'), (l) => fn(l, est));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoSuprimentos, op: string): Promise<LiberacaoGravacao> {
    const motivo = OPERACOES_SUPRIMENTOS_PENDENTES[op];
    if (motivo)
      return {
        pode: false,
        codigo: 'operacao-nao-liberada',
        motivo: `Operação desligada no banco: ${motivo}.`,
      };
    return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida no estoque.' };
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- assinatura da porta; a operação aguarda o modelo */
  async executar(
    _c: ContextoSuprimentos,
    op: string,
    _entrada: unknown,
    _ctx: ContextoOperacao,
  ): Promise<never> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
    const motivo = OPERACOES_SUPRIMENTOS_PENDENTES[op];
    throw motivo
      ? modeloPendente(motivo)
      : recusa('operacao-desconhecida', 'Operação desconhecida no estoque.');
  }

  async gravarSgh<T>(
    c: ContextoSuprimentos,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghSuprimentos) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const chamada = await capturarChamada(fn);
    const nome = `suprimentos.${chamada.metodo.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const alvo = () => {
      const l = linha();
      return { tabela: l?.entidade ?? 'inventario_estoque', id: l?.entidadeId ?? null };
    };
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_GRAVACAO_SUPRIMENTOS,
      // A chamada inteira vai ao hash: a mesma chave com outro conteúdo é recusada (idempotencia-divergente).
      entrada: z.object({ metodo: z.string(), dados: z.unknown() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return resultadoDe(saida.valor);
      },
      alvo,
      eventos: () => {
        const a = alvo();
        return [{ tipo: nome, carga: { tabela: a.tabela, id: a.id === null ? null : String(a.id) } }];
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const r = await this.executor.executar(op, c.cliente, chamada, {
      ...contextoNucleo(c, 'suprimentos'),
      chaveIdempotencia: chaveDaGravacao(c),
    });
    // A mesma chave com a mesma entrada: o resultado da primeira execução, sem gravar de novo.
    if (!saida) return valorDe<T>(r.resultado);
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      const { hoje } = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
      return { hoje, ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
    });
  }

  locais(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT id, nome FROM local_estoque
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome, id`,
          [est],
        )
      ).map((r) => ({ codigo: n(r['id']), nome: String(r['nome']) })),
    );
  }

  /**
   * Os centros de custo analíticos ativos e vigentes do estabelecimento que têm local de estoque de consumo (o menor
   * id ligado a ele); "técnico" é o centro produtivo ou auxiliar da classificação de custos.
   */
  centrosCusto(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT cc.id, cc.nome, MIN(le.id) AS local_consumo, MAX(cl.classe IN ('produtivo', 'auxiliar')) AS tecnico
             FROM centro_custo cc
             JOIN local_estoque le ON le.centro_custo_id = cc.id AND le.estabelecimento_id = cc.estabelecimento_id
                  AND le.ativo = TRUE AND le.excluido_em IS NULL
             LEFT JOIN classificacao_centro_custo cl ON cl.id = cc.classificacao_centro_custo_id
            WHERE cc.estabelecimento_id = ? AND cc.ativo = TRUE AND cc.analitico = TRUE AND cc.excluido_em IS NULL
              AND cc.vigencia_inicio <= CURRENT_DATE AND (cc.vigencia_fim IS NULL OR cc.vigencia_fim >= CURRENT_DATE)
            GROUP BY cc.id, cc.nome
            ORDER BY cc.nome, cc.id`,
          [est],
        )
      ).map((r) => ({
        codigo: n(r['id']),
        nome: String(r['nome']),
        localConsumo: n(r['local_consumo']),
        tecnico: verdadeiro(r['tecnico']),
      })),
    );
  }

  mesesFechados(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT competencia, exportado_contabilidade FROM fechamento_estoque
            WHERE estabelecimento_id = ? AND situacao = 'fechado' AND excluido_em IS NULL ORDER BY competencia DESC`,
          [est],
        )
      ).map((r) => {
        const d = instante(r['competencia']);
        return {
          ano: Number(d.slice(0, 4)),
          mes: Number(d.slice(5, 7)),
          exportado: verdadeiro(r['exportado_contabilidade']),
        };
      }),
    );
  }

  itens(c: ContextoSuprimentos, codigos: readonly number[]) {
    return this.ler(c, async (l, est) => {
      const r = new Map<number, ItemCadastroEstoque>();
      const ids = [...new Set(codigos.filter((x) => Number.isInteger(x) && x > 0))];
      if (!ids.length) return r;
      // O cadastro do insumo é da rede; o saldo e o valor, do estabelecimento da sessão.
      const linhas = await l.consultar<Linha>(
        `SELECT i.id, i.nome, i.controla_lote, i.controlado, i.consignado,
                COALESCE(SUM(s.quantidade), 0) AS estoque, COALESCE(SUM(s.quantidade * s.custo_medio), 0) AS total
           FROM insumo i
           LEFT JOIN saldo_estoque s ON s.insumo_id = i.id AND s.estabelecimento_id = ? AND s.excluido_em IS NULL
          WHERE i.id IN (${lista(ids.length)}) AND i.excluido_em IS NULL
          GROUP BY i.id, i.nome, i.controla_lote, i.controlado, i.consignado`,
        [est, ...ids],
      );
      for (const x of linhas) {
        const estoque = n(x['estoque']);
        const total = Math.round(n(x['total']) * 100) / 100;
        r.set(n(x['id']), {
          codigo: n(x['id']),
          nome: String(x['nome']),
          rastreavel: verdadeiro(x['controla_lote']),
          controlado: verdadeiro(x['controlado']),
          consignado: verdadeiro(x['consignado']),
          estoque,
          total,
          custoMedio: estoque > 0 ? Math.round((total / estoque) * 10_000) / 10_000 : 0,
        });
      }
      return r;
    });
  }

  /** A posição de saldo por item e local (com os lotes), até 500 linhas; o total da empresa é do estabelecimento. */
  saldos(
    c: ContextoSuprimentos,
    f: {
      item?: number;
      local?: number;
      termo?: string;
      comSaldo?: boolean;
      hoje: string;
      alertaDias: number;
    },
  ) {
    return this.ler(c, async (l, est) => {
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.item) {
        filtros.push('AND s.insumo_id = ?');
        p.push(f.item);
      }
      if (f.local) {
        filtros.push('AND s.local_estoque_id = ?');
        p.push(f.local);
      }
      if (f.termo) {
        filtros.push('AND i.nome LIKE ?');
        p.push(`%${f.termo.replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
      }
      if (f.comSaldo ?? true) filtros.push('AND s.quantidade > 0');
      const linhas = await l.consultar<Linha>(
        `SELECT s.insumo_id, i.nome, um.sigla, s.local_estoque_id, le.nome AS local_nome, s.quantidade, s.custo_medio,
                s.estoque_minimo, s.estoque_maximo, i.controla_lote, i.controlado,
                (SELECT COALESCE(SUM(t.quantidade), 0) FROM saldo_estoque t
                  WHERE t.insumo_id = s.insumo_id AND t.estabelecimento_id = s.estabelecimento_id AND t.excluido_em IS NULL) AS estoque_empresa,
                (SELECT COALESCE(SUM(t.quantidade * t.custo_medio), 0) FROM saldo_estoque t
                  WHERE t.insumo_id = s.insumo_id AND t.estabelecimento_id = s.estabelecimento_id AND t.excluido_em IS NULL) AS valor_empresa
           FROM saldo_estoque s
           JOIN insumo i ON i.id = s.insumo_id AND i.excluido_em IS NULL
           JOIN local_estoque le ON le.id = s.local_estoque_id AND le.excluido_em IS NULL
           JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL ${filtros.join(' ')}
          ORDER BY i.nome, s.local_estoque_id
          LIMIT ${LIMITE_SALDOS + 1}`,
        p,
      );
      const cortada = linhas.length > LIMITE_SALDOS;
      const usadas = linhas.slice(0, LIMITE_SALDOS);
      const lotes = new Map<string, SaldoItem['lotes'][number][]>();
      const insumos = [...new Set(usadas.map((r) => n(r['insumo_id'])))];
      if (insumos.length)
        for (const r of await l.consultar<Linha>(
          `${SQL_LOTES} AND li.insumo_id IN (${lista(insumos.length)}) ORDER BY li.validade, li.id`,
          [est, ...insumos],
        )) {
          const k = `${n(r['insumo_id'])}:${n(r['local_estoque_id'])}`;
          lotes.set(k, [...(lotes.get(k) ?? []), loteLido(r, f.hoje, f.alertaDias)]);
        }
      const hoje = f.hoje;
      const itens: SaldoItem[] = usadas.map((r) => {
        const quantidade = n(r['quantidade']);
        const custo = n(r['custo_medio']);
        const estoqueEmpresa = n(r['estoque_empresa']);
        const valorEmpresa = Math.round(n(r['valor_empresa']) * 100) / 100;
        return {
          item: n(r['insumo_id']),
          nome: String(r['nome']),
          unidade: String(r['sigla']),
          local: n(r['local_estoque_id']),
          localNome: String(r['local_nome']),
          quantidade,
          valor: Math.round(quantidade * custo * 100) / 100,
          estoqueEmpresa,
          valorEmpresa,
          custoMedio: estoqueEmpresa > 0 ? Math.round((valorEmpresa / estoqueEmpresa) * 10_000) / 10_000 : 0,
          minimo:
            r['estoque_minimo'] === null || r['estoque_minimo'] === undefined ? null : n(r['estoque_minimo']),
          maximo:
            r['estoque_maximo'] === null || r['estoque_maximo'] === undefined ? null : n(r['estoque_maximo']),
          rastreavel: verdadeiro(r['controla_lote']),
          controlado: verdadeiro(r['controlado']),
          lotes: lotes.get(`${n(r['insumo_id'])}:${n(r['local_estoque_id'])}`) ?? [],
        };
      });
      return {
        competencia: { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) },
        itens,
        cortada,
      };
    });
  }

  lotesDoLocal(c: ContextoSuprimentos, item: number, local: number, hoje: string, alertaDias: number) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `${SQL_LOTES} AND li.insumo_id = ? AND sl.local_estoque_id = ? ORDER BY li.validade, li.id`,
          [est, item, local],
        )
      ).map((r) => loteLido(r, hoje, alertaDias)),
    );
  }

  inventarios(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT id, local_estoque_id, tipo, situacao, aberto_em FROM inventario_estoque
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN (${lista(SITUACOES_ABERTAS.length)})
            ORDER BY id DESC`,
          [est, ...SITUACOES_ABERTAS],
        )
      ).map((r) => ({
        id: n(r['id']),
        local: n(r['local_estoque_id']),
        tipo: String(r['tipo']),
        situacao: String(r['situacao']),
        abertoEm: instante(r['aberto_em']),
      })),
    );
  }

  /** O inventário com as contagens: na contagem cega, sem o saldo do sistema nem a divergência. */
  inventario(c: ContextoSuprimentos, id: number, cego: boolean) {
    return this.ler(c, async (l, est) => {
      const inv = await l.uma<Linha>(
        `SELECT inv.id, inv.local_estoque_id, le.nome AS local_nome, inv.tipo, inv.situacao, u.login, inv.aberto_em,
                inv.limite_divergencia_pct, d.numero AS doc_numero, d.movimentado_em AS doc_em
           FROM inventario_estoque inv
           JOIN local_estoque le ON le.id = inv.local_estoque_id
           LEFT JOIN usuario u ON u.id = inv.abertura_usuario_id
           LEFT JOIN documento_estoque d ON d.id = inv.documento_estoque_id AND d.excluido_em IS NULL
          WHERE inv.id = ? AND inv.estabelecimento_id = ? AND inv.excluido_em IS NULL`,
        [id, est],
      );
      if (!inv) return null;
      const linhas = await l.consultar<Linha>(
        `SELECT it.insumo_id, i.nome, it.saldo_sistema, it.quantidade_contada, it.contagem_usuario_id, it.situacao
           FROM inventario_estoque_item it
           JOIN insumo i ON i.id = it.insumo_id
           JOIN inventario_estoque_contagem ct ON ct.id = it.inventario_estoque_contagem_id
          WHERE it.inventario_estoque_id = ? AND it.excluido_em IS NULL
          ORDER BY it.insumo_id, ct.sequencia, it.id`,
        [id],
      );
      const itens = [...porInsumo(linhas)].map(([item, ls]) => {
        const ic = itemContado(item, ls);
        const ultima = ic.contagens[ic.contagens.length - 1];
        const contado = ultima ? ultima.quantidade : null;
        const visivel = !cego && contado !== null;
        return {
          item,
          nome: String(ls[0]?.['nome'] ?? ''),
          contagens: ic.contagens.length,
          saldo: cego ? null : ic.saldoSistema,
          contado,
          diferenca: visivel ? Math.round((contado - ic.saldoSistema) * 1000) / 1000 : null,
          divergenciaPct: visivel ? divergenciaPct(ic.saldoSistema, contado) : null,
          // A situação da última contagem (a linha pendente da rodada seguinte é a recontagem pedida).
          situacao: situacaoNaTela(
            String(
              [...ls]
                .reverse()
                .find((r) => r['quantidade_contada'] !== null && r['quantidade_contada'] !== undefined)?.[
                'situacao'
              ] ?? 'pendente',
            ),
          ),
        };
      });
      const doc =
        inv['doc_numero'] === null || inv['doc_numero'] === undefined ? null : instante(inv['doc_em']);
      return {
        id: n(inv['id']),
        local: n(inv['local_estoque_id']),
        localNome: String(inv['local_nome']),
        tipo: inv['tipo'] === 'ciclico' ? ('ciclico' as const) : ('geral' as const),
        situacao: String(inv['situacao']) as 'aberto' | 'contagem' | 'recontagem' | 'aprovado' | 'cancelado',
        abertoPor: String(inv['login'] ?? ''),
        abertoEm: instante(inv['aberto_em']),
        limitePct: n(inv['limite_divergencia_pct']),
        itens,
        balanco: doc
          ? { ano: Number(doc.slice(0, 4)), mes: Number(doc.slice(5, 7)), doc: n(inv['doc_numero']) }
          : null,
      };
    });
  }

  // Pendentes: 409 modelo-pendente com o motivo (LEITURAS_SUPRIMENTOS_PENDENTES).
  buscarItens(): Promise<never> {
    return faltaLeitura('buscarItens');
  }
  posicaoMensal(): Promise<never> {
    return faltaLeitura('posicaoMensal');
  }
  fichaItem(): Promise<never> {
    return faltaLeitura('fichaItem');
  }
  documentos(): Promise<never> {
    return faltaLeitura('documentos');
  }
  documento(): Promise<never> {
    return faltaLeitura('documento');
  }
  requisicoes(): Promise<never> {
    return faltaLeitura('requisicoes');
  }
  rastreio(): Promise<never> {
    return faltaLeitura('rastreio');
  }
  lotesDoPaciente(): Promise<never> {
    return faltaLeitura('lotesDoPaciente');
  }
  consumo(): Promise<never> {
    return faltaLeitura('consumo');
  }
  consumoMensalPorItem(): Promise<never> {
    return faltaLeitura('consumoMensalPorItem');
  }
  emPedidoPorItem(): Promise<never> {
    return faltaLeitura('emPedidoPorItem');
  }
  pedidos(): Promise<never> {
    return faltaLeitura('pedidos');
  }
  pedido(): Promise<never> {
    return faltaLeitura('pedido');
  }
  historicoCompras(): Promise<never> {
    return faltaLeitura('historicoCompras');
  }
  fechamentos(): Promise<never> {
    return faltaLeitura('fechamentos');
  }
  recalculos(): Promise<never> {
    return faltaLeitura('recalculos');
  }
  parametros(): Promise<never> {
    return faltaLeitura('parametros');
  }
  escopo(): Promise<never> {
    return faltaLeitura('escopo');
  }
  usuarios(): Promise<never> {
    return faltaLeitura('usuarios');
  }
  fornecedores(): Promise<never> {
    return faltaLeitura('fornecedores');
  }
  terceiros(): Promise<never> {
    return faltaLeitura('terceiros');
  }
  prestadores(): Promise<never> {
    return faltaLeitura('prestadores');
  }
  kits(): Promise<never> {
    return faltaLeitura('kits');
  }
  kit(): Promise<never> {
    return faltaLeitura('kit');
  }
  kitsPadrao(): Promise<never> {
    return faltaLeitura('kitsPadrao');
  }
  estoqueInicial(): Promise<never> {
    return faltaLeitura('estoqueInicial');
  }
  transferencias(): Promise<never> {
    return faltaLeitura('transferencias');
  }
  envio(): Promise<never> {
    return faltaLeitura('envio');
  }
  pontosPedido(): Promise<never> {
    return faltaLeitura('pontosPedido');
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSuprimentosIndisponivel(): PortaSuprimentos {
  return portaIndisponivel<PortaSuprimentos>(METODOS_PORTA_SUPRIMENTOS);
}
