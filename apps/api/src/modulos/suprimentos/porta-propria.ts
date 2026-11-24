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
// Leituras do estoque: busca e ficha do item, posição mensal, documentos (saída, devolução, transferência e balanço em
// documento_estoque; nota em nota_entrada; requisição em requisicao_material) pela chave de negócio (número no
// estabelecimento e mês do movimento), rastreio do lote, consumo, pedidos e cotação, fechamentos, escopo do usuário,
// fornecedores, kits, envios e pontos de pedido, sempre restritas ao estabelecimento da sessão.
// Gravações: as operações do executor (saída, devolução, requisição, transferência, nota, pedido e cotação, movimento
// direto, balanço, fechamento e reabertura do mês, reposição do kit, desconsolidação e saneamento da validade) e as
// gravações diretas (aprovação do pedido, envio, cancelamento e divergência da transferência, conferência do carrinho,
// ponto de pedido e autorização da requisição), todas pelo Executor do núcleo com a trilha na mesma transação.
// Melhoria: todo movimento passa pelo mesmo motor (saldo do item com custo médio, saldo do lote, movimento com o saldo
// e o custo depois e os lotes); a saída nunca deixa saldo negativo e, sem lote escolhido no item rastreável, usa o que
// vence primeiro (nunca vencido nem bloqueado); a devolução volta pelo custo e pelos lotes da saída e aponta o
// movimento que desfaz.
// Ainda fora (recusa com o motivo): o consumo e a devolução de OPME na saída, a baixa do insumo da manipulação e o
// vínculo do pedido ao contrato do fornecedor.
import {
  ajusteDoInventario,
  avaliarItem,
  chavePonto,
  conferirAprovacao,
  conferirAprovacaoPedido,
  conferirCabecalhoNota,
  conferirCabecalhoSaida,
  conferirCentroCusto,
  conferirCompetencia,
  conferirCorrecaoValidade,
  conferirItensPedido,
  conferirLocal,
  conferirLoteEntrada,
  conferirLotesSaida,
  conferirNota,
  conferirReabertura,
  conferirTransferencia,
  type EscopoEstoque,
  exigeJustificativa,
  faixaDoValor,
  planejarVencedor,
  podeConsolidarNota,
  type PropostaCotacao,
  proximoAFechar,
  type TipoMovimento,
  valorPelosVencedores,
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
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  cnpjValido,
  cpfValido,
  type CorrigirValidadeEntrada,
  type CriarPedidoEntrada,
  type DefinirVencedorEntrada,
  type DesconsolidarEntrada,
  type DocumentoDetalhe,
  type DocumentoEstoque,
  type EscopoUsuarioEstoque,
  type FecharMesEntrada,
  type FechamentosEstoque,
  type FichaItem,
  type FornecedorLido,
  type HistoricoCompra,
  type ItemBusca,
  type KitRastreavel,
  type LotesDoPaciente,
  type MovimentoDiretoEntrada,
  type ParametrosEstoque,
  type PedidoDetalhe,
  type PedidoResumo,
  type PosicaoMensal,
  type PrestadorLido,
  type PropostaLida,
  type RastreioLote,
  type ReabrirMesEntrada,
  type RecalculosEstoque,
  type RegistrarBalancoEntrada,
  type RegistrarDevolucaoEntrada,
  type RegistrarEntradaNFEntrada,
  type RegistrarPropostaEntrada,
  type RegistrarSaidaEntrada,
  type ReporKitEntrada,
  type RequisicaoPendente,
  type RequisitarMaterialEntrada,
  type SaldoItem,
  type TerceiroLido,
  type TipoDocumentoEstoque,
  TIPOS_MOVIMENTO_LOCAL,
  type TransferenciaEnviada,
  type TransferirEntrada,
  type PreviaRecalculo,
  type RecalcularSaldosEntrada,
} from '@sgh/contratos';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { lancadorContaEstoque, TABELAS_CONTA_ESTOQUE } from './conta-estoque.js';
import {
  chaveDaTela,
  contextoNucleo,
  ENTRADAS_SUPRIMENTOS,
  modeloPendente,
  operacaoSuprimentos,
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
import {
  buscarProcedimentosKit,
  gravarKitPadrao,
  lerKitsPadraoCadastro,
  OPERACAO_KIT_PADRAO,
  TABELAS_KIT_PADRAO,
} from './kit-padrao.js';
import {
  acompanharPedido,
  baixarEntregasRecebidas,
  cancelarCompra,
  gravarMotivoCancelamentoCompra,
  lerGestaoPedido,
  OPERACAO_ACOMPANHAR_PEDIDO,
  OPERACAO_CANCELAR_COMPRA,
  OPERACAO_MOTIVO_CANCELAMENTO,
  OPERACAO_PROGRAMAR_ENTREGAS,
  programarEntregasPedido,
  TABELAS_GESTAO_PEDIDO,
} from './pedido-gestao.js';
import {
  apurarRecalculo,
  OPERACAO_RECALCULO_SALDO,
  recalcularSaldos,
  TABELAS_RECALCULO_SALDO,
} from './recalculo-saldo.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSuprimentos = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TABELAS_GRAVACAO_SUPRIMENTOS = [
  'inventario_estoque',
  'inventario_estoque_contagem',
  'inventario_estoque_item',
  'documento_estoque',
  'documento_estoque_item',
  'pedido_compra',
  'conferencia_kit_rastreavel',
  'kit_rastreavel',
  'parametro_reposicao',
  'requisicao_material',
] as const;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const dataIso = (v: unknown): string => instante(v).slice(0, 10);
const SITUACOES_ABERTAS = ['aberto', 'contagem', 'recontagem'];
const LIMITE_SALDOS = 500;

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
    async aprovarPedido(a) {
      const usuario = usuarioDaOperacao();
      const pedido = await pedidoTravado(tx, est, a.ano, a.doc);
      const escopo = await escopoDoUsuario(tx, est, usuario);
      const valor = await valorDoPedido(tx, n(pedido['id']), numeroOuNulo(pedido['cotacao_id']));
      recusar(
        conferirAprovacaoPedido({
          valor: valor.total,
          faixas: a.faixas,
          aprovador: { podeAutorizar: escopo.flags.autorizarPedido, nivel: a.nivel, login: String(usuario) },
          solicitante: String(pedido['comprador_usuario_id'] ?? pedido['criado_por'] ?? ''),
          decisao: a.decisao,
          justificativa: a.justificativa,
          jaDecidido:
            pedido['aprovado_em'] !== null ||
            ['aprovado', 'reprovado', 'cancelado'].includes(String(pedido['situacao'])),
        }),
      );
      if (valor.parcelas.length === 0 && a.decisao === 'aprovado')
        throw recusa('sem-vencedor', 'O pedido ainda não tem vencedor escolhido na cotação.');
      const nivel = faixaDoValor(valor.total, a.faixas).nivel;
      const agora = new Date();
      await tx.alterar('pedido_compra', n(pedido['id']), n(pedido['versao']), {
        situacao: a.decisao,
        aprovado_por_usuario_id: usuario,
        aprovado_em: agora,
        justificativa_aprovacao: a.justificativa.trim() || null,
        valor_total: valor.total,
      });
      return { id: n(pedido['id']), valor: valor.total, nivel };
    },

    async enviarTransferencia(t) {
      const hoje = await hojeNoEstabelecimento(tx, est);
      await localDoEstabelecimento(tx, est, t.origem, 'origem');
      await localDoEstabelecimento(tx, est, t.destino, 'destino');
      recusar(conferirTransferencia(await escopoDaOperacao(tx, est), t.origem, t.destino)[0] ?? null);
      const doc = await novoDocumento(tx, est, {
        tipo: 'transferencia',
        tipoMovimento: await tipoMovimentoId(tx, TIPO_MOVIMENTO.envio),
        origem: t.origem,
        destino: t.destino,
        observacao: t.observacao,
        situacao: 'aberto',
      });
      let seq = 0;
      for (const it of t.itens) {
        const insumo = await insumoAtivo(tx, it.item);
        const s = await tx.uma<Linha>(
          'SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [t.origem, it.item, est],
        );
        if (qtd(n(s?.['quantidade'])) < qtd(it.quantidade))
          throw recusa(
            'saldo-insuficiente',
            `Saldo insuficiente na origem para o item ${String(insumo['nome'])}.`,
            { campos: ['itens'] },
          );
        // O envio reserva os lotes escolhidos (conferidos agora); o saldo só sai da origem no recebimento.
        const lotes = await lotesDaSaida(tx, est, t.origem, insumo, it.quantidade, it.lotes, hoje);
        if (!lotes.length) await itemDoDocumento(tx, doc.id, ++seq, insumo, it.quantidade);
        for (const l of lotes) {
          const li = await tx.uma<Linha>('SELECT validade FROM lote_insumo WHERE id = ?', [l.id]);
          await itemDoDocumento(tx, doc.id, ++seq, insumo, l.quantidade, {
            lote_insumo_id: l.id,
            data_validade: li?.['validade'] ?? null,
          });
        }
      }
      return doc.id;
    },

    async cancelarTransferencia(r) {
      const usuario = usuarioDaOperacao();
      const d = await envioTravado(tx, est, r.id);
      if (n(d['criado_por']) !== usuario)
        recusar(
          conferirLocal(
            await escopoDoUsuario(tx, est, usuario),
            n(d['origem_local_estoque_id']),
            'transferenciaOrigem',
            'origem',
          ),
        );
      await tx.alterar('documento_estoque', r.id, n(d['versao']), {
        situacao: 'cancelado',
        consolidado: false,
        observacao: juntar(d['observacao'], `Cancelado: ${r.motivo.trim()}`),
      });
    },

    async registrarDivergencia(r) {
      const [d] = await tx.consultarParaAtualizar<Linha>(
        "SELECT id, versao, observacao FROM documento_estoque WHERE id = ? AND estabelecimento_id = ? AND tipo = 'transferencia' AND excluido_em IS NULL",
        [r.id, est],
      );
      if (!d) throw recusa('envio-inexistente', 'O envio não existe neste estabelecimento.');
      await tx.alterar('documento_estoque', r.id, n(d['versao']), {
        observacao: juntar(d['observacao'], `Divergência: ${r.motivo.trim()}`),
      });
    },

    async conferirCarrinho(k) {
      const usuario = usuarioDaOperacao();
      const [kit] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, lacre_atual, situacao FROM kit_rastreavel WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [k.kit, est],
      );
      if (!kit) throw recusa('kit-inexistente', 'O carrinho não existe.');
      const itens = await tx.consultar<Linha>(
        `SELECT ki.id, (SELECT MIN(li.validade) FROM kit_rastreavel_lote kl JOIN lote_insumo li ON li.id = kl.lote_insumo_id
                         WHERE kl.kit_rastreavel_item_id = ki.id AND kl.excluido_em IS NULL AND kl.quantidade > 0) AS validade
           FROM kit_rastreavel_item ki WHERE ki.kit_rastreavel_id = ? AND ki.excluido_em IS NULL`,
        [k.kit],
      );
      const ids = new Set(itens.map((r) => n(r['id'])));
      if (k.conferidos.some((x) => !ids.has(x)))
        throw recusa('item-de-outro-kit', 'Há item conferido que não é deste carrinho.');
      const completa = new Set(k.conferidos).size === ids.size;
      const pendencias = (k.pendencias ?? '').trim();
      if (!completa && !pendencias)
        throw recusa('sem-pendencia', 'Faltam itens no checklist: descreva a pendência.', {
          campos: ['pendencias'],
        });
      const hoje = await hojeNoEstabelecimento(tx, est);
      const validades = itens.every((r) => !r['validade'] || !vencido(dataIso(r['validade']), hoje));
      const agora = new Date();
      const id = await tx.incluir('conferencia_kit_rastreavel', {
        ocorrido_em: agora,
        usuario_id: usuario,
        kit_rastreavel_id: k.kit,
        tipo: 'periodica',
        lacre_anterior: kit['lacre_atual'] ?? null,
        lacre_novo: k.lacre,
        lacre_integro: true,
        itens_conformes: completa,
        validades_conformes: validades,
        resultado: completa && validades ? 'conforme' : 'com_pendencia',
        pendencias: pendencias || (validades ? null : 'Há lote vencido no carrinho.'),
      });
      await tx.alterar('kit_rastreavel', k.kit, n(kit['versao']), {
        lacre_atual: k.lacre,
        ultima_conferencia_em: agora,
        ...(completa && validades ? { situacao: 'lacrado', responsavel_usuario_id: usuario } : {}),
      });
      return id;
    },

    async definirPontoPedido(p) {
      await localDoEstabelecimento(tx, est, p.local);
      await insumoAtivo(tx, p.item);
      const [x] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao FROM parametro_reposicao WHERE insumo_id = ? AND local_estoque_id = ?',
        [p.item, p.local],
      );
      const v = { prazo_reposicao_dias: p.prazoDias, estoque_seguranca: p.estoqueSeguranca, ativo: true };
      if (x) await tx.alterar('parametro_reposicao', n(x['id']), n(x['versao']), v);
      else
        await tx.incluir('parametro_reposicao', {
          estabelecimento_id: est,
          insumo_id: p.item,
          local_estoque_id: p.local,
          ...v,
        });
    },

    async autorizarRequisicao(a) {
      const usuario = usuarioDaOperacao();
      const [r] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, situacao, atendente_local_estoque_id FROM requisicao_material
          WHERE estabelecimento_id = ? AND numero = ? AND YEAR(solicitado_em) = ? AND MONTH(solicitado_em) = ? AND excluido_em IS NULL`,
        [est, a.doc, a.ano, a.mes],
      );
      if (!r || !['solicitada', 'autorizada'].includes(String(r['situacao'])))
        throw recusa('requisicao-atendida', 'A requisição já foi atendida ou não existe mais.');
      if (r['situacao'] === 'autorizada')
        throw recusa('requisicao-autorizada', 'A requisição já foi autorizada.');
      const escopo = await escopoDoUsuario(tx, est, usuario);
      if (!escopo.locais.get(n(r['atendente_local_estoque_id']))?.has('saida'))
        throw recusa(
          'sem-autorizacao-requisicao',
          'Seu usuário do estoque não atende o local desta requisição.',
        );
      await tx.alterar('requisicao_material', n(r['id']), n(r['versao']), {
        situacao: 'autorizada',
        autorizador_usuario_id: usuario,
        autorizado_em: new Date(),
      });
    },

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

type Chave = { ano: number; mes: number; doc: number };
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : n(v));
const hora = (v: unknown): string => instante(v).slice(11, 16);
const reais2 = (x: number): number => Math.round(x * 100) / 100;
const qtd = (x: number): number => Math.round(x * 10_000) / 10_000;
const parecido = (t: string): string => `%${t.trim().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
/** A chave de negócio do documento: o número no estabelecimento e o mês do movimento. */
const chaveLida = (numero: unknown, em: unknown): Chave => {
  const d = instante(em);
  return { ano: Number(d.slice(0, 4)), mes: Number(d.slice(5, 7)), doc: n(numero) };
};
/** O primeiro dia do mês (competência) de AAAA-MM. */
const competenciaDe = (ano: number, mes: number): string => `${ano}-${String(mes).padStart(2, '0')}-01`;
const POR_PAGINA = 50;
const LIMITE_LISTA = 200;

/** Os tipos do documento do estoque no banco para cada tipo da tela. */
const TIPOS_SAIDA = ['saida_setor', 'saida_paciente', 'saida_terceiro', 'baixa', 'doacao', 'venda'] as const;
const TIPOS_NO_BANCO: Readonly<
  Record<'saida' | 'devolucao' | 'transferencia' | 'balanco', readonly string[]>
> = {
  saida: TIPOS_SAIDA,
  devolucao: ['devolucao_interna'],
  transferencia: ['transferencia'],
  balanco: ['acerto_entrada', 'acerto_saida'],
};
/** O destino da saída na tela (1 paciente, 2 setor, 5 terceiro) pelo tipo do documento. */
const destinoDoTipo = (tipo: string): number | null =>
  tipo === 'saida_paciente'
    ? 1
    : tipo === 'saida_setor'
      ? 2
      : ['saida_terceiro', 'doacao', 'venda'].includes(tipo)
        ? 5
        : null;

/** Situação do pedido de compra na tela (a lista numerada do contrato) pela situação do banco. */
const SITUACAO_PEDIDO_NA_TELA: Readonly<Record<string, number>> = {
  rascunho: 1,
  aguardando_aprovacao: 2,
  em_cotacao: 3,
  aprovado: 5,
  enviado: 7,
  parcialmente_recebido: 8,
  recebido: 9,
  encerrado: 9,
  reprovado: 10,
  cancelado: 10,
};
const ROTULO_SITUACAO_PEDIDO: Readonly<Record<number, string>> = {
  1: 'Aberto',
  2: 'Em andamento',
  3: 'Aguardando cotação',
  4: 'Autorizado parcialmente',
  5: 'Autorizado',
  6: 'Comprado parcialmente',
  7: 'Comprado',
  8: 'Entregue parcialmente',
  9: 'Finalizado',
  10: 'Cancelado',
};
const SITUACOES_PEDIDO_ABERTAS = [
  'rascunho',
  'em_cotacao',
  'aguardando_aprovacao',
  'aprovado',
  'enviado',
  'parcialmente_recebido',
];
const TIPO_COMPRA_NA_TELA: Readonly<Record<string, string>> = { programada: 'P', emergencial: 'E' };
/** O estado do item do pedido na tela pelas quantidades. */
function estadoItemPedido(r: Linha, emCotacao: boolean): string {
  const q = n(r['quantidade']);
  const rec = n(r['quantidade_recebida']);
  if (r['cancelado_em']) return 'E';
  if (rec >= q && q > 0) return 'C';
  if (rec > 0) return 'I';
  return emCotacao ? 'O' : 'P';
}
const ROTULO_ESTADO_ITEM: Readonly<Record<string, string>> = {
  O: 'Em cotação',
  P: 'Pendente',
  I: 'Entregue em parte',
  C: 'Entregue',
  N: 'Não comprado',
  E: 'Excluído da compra',
};

/** Os tipos de movimento do usuário no local pelas permissões do cadastro (local_estoque_usuario). */
const TIPOS_DO_USUARIO: readonly (readonly [string, TipoMovimento, string])[] = [
  ['pode_atender', 'saida', 'S'],
  ['pode_receber_nota', 'entrada', 'E'],
  ['pode_devolver', 'devolucao', 'D'],
  ['pode_transferir', 'transferenciaOrigem', 'TO'],
  ['pode_transferir', 'transferenciaDestino', 'TD'],
  ['pode_inventariar', 'inventario', 'I'],
  ['pode_requisitar', 'requisicao', 'R'],
  ['pode_ajustar', 'venda', 'V'],
];

const SQL_PERMISSOES_LOCAL = `SELECT lu.local_estoque_id, le.nome AS local_nome, lu.pode_requisitar, lu.pode_atender, lu.pode_receber_nota,
        lu.pode_transferir, lu.pode_devolver, lu.pode_ajustar, lu.pode_inventariar, lu.pode_autorizar_pedido,
        lu.pode_desbloquear_fechamento, lu.pode_movimentar_controlado
   FROM local_estoque_usuario lu
   JOIN local_estoque le ON le.id = lu.local_estoque_id AND le.estabelecimento_id = ? AND le.excluido_em IS NULL AND le.ativo = TRUE
  WHERE lu.usuario_id = ? AND lu.excluido_em IS NULL
  ORDER BY le.nome, le.id`;
const SQL_CENTROS_USUARIO = `SELECT cc.id, cc.nome FROM usuario_estoque_centro_custo uc
   JOIN centro_custo cc ON cc.id = uc.centro_custo_id AND cc.excluido_em IS NULL
  WHERE uc.estabelecimento_id = ? AND uc.usuario_id = ? AND uc.excluido_em IS NULL
    AND uc.vigencia_inicio <= CURRENT_DATE AND (uc.vigencia_fim IS NULL OR uc.vigencia_fim >= CURRENT_DATE)
  ORDER BY cc.nome, cc.id`;

/**
 * O escopo do usuário no estoque do estabelecimento, pelo cadastro: os tipos de movimento por local, os centros de
 * custo (sem nenhum cadastrado: todos) e as alçadas. Autorizar requisição é de quem atende algum local (a requisição
 * é autorizada por quem a atende).
 */
async function escopoDoUsuario(l: Leitor, est: number, usuario: number): Promise<EscopoEstoque> {
  const linhas = await l.consultar<Linha>(SQL_PERMISSOES_LOCAL, [est, usuario]);
  const centros = await l.consultar<Linha>(SQL_CENTROS_USUARIO, [est, usuario]);
  const locais = new Map<number, Set<TipoMovimento>>();
  for (const r of linhas) {
    const s = new Set<TipoMovimento>();
    for (const [coluna, tipo] of TIPOS_DO_USUARIO) if (verdadeiro(r[coluna])) s.add(tipo);
    locais.set(n(r['local_estoque_id']), s);
  }
  return {
    locais,
    centrosCusto: new Set(centros.map((r) => n(r['id']))),
    todosCentros: centros.length === 0,
    flags: {
      autorizarRequisicao: linhas.some((r) => verdadeiro(r['pode_atender'])),
      autorizarPedido: linhas.some((r) => verdadeiro(r['pode_autorizar_pedido'])),
      desbloquearFechamento: linhas.some((r) => verdadeiro(r['pode_desbloquear_fechamento'])),
    },
  };
}

/** O nome do paciente do atendimento (nome social quando a pessoa o usa). */
const SQL_PACIENTE = `LEFT JOIN atendimento a ON a.id = d.atendimento_id
       LEFT JOIN paciente p ON p.id = a.paciente_id
       LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id`;
const NOME_PACIENTE = `CASE WHEN pf.usa_nome_social AND pf.nome_social IS NOT NULL THEN pf.nome_social ELSE pf.nome END`;
const pacienteLido = (r: Linha) =>
  r['atendimento_id'] === null || r['atendimento_id'] === undefined
    ? null
    : { atendimento: n(r['atendimento_id']), nome: texto(r['paciente_nome']) };

/** Valida o dígito do CNPJ ou do CPF guardado (só dígitos). */
const documentoValido = (cnpj: unknown, cpf: unknown): boolean =>
  cnpj ? cnpjValido(String(cnpj)) : cpf ? cpfValido(String(cpf)) : false;

/** Os códigos do tipo de movimento do estoque (catálogo tipo_movimento_estoque) que a porta usa em cada gravação. */
export const TIPO_MOVIMENTO = {
  saidaSetor: 'saida_setor',
  saidaPaciente: 'saida_paciente',
  saidaTerceiro: 'saida_terceiro',
  devolucao: 'devolucao_interna',
  transferenciaSaida: 'transferencia_saida',
  transferenciaEntrada: 'transferencia_entrada',
  envio: 'transferencia_envio',
  entradaNota: 'entrada_nota',
  acertoEntrada: 'acerto_entrada',
  acertoSaida: 'acerto_saida',
  estoqueInicial: 'estoque_inicial',
} as const;

type DocumentoLido = DocumentoEstoque & { readonly observacao: string };

/** O cabeçalho dos documentos por tipo da tela (período ou chave de negócio), do estabelecimento. */
async function consultarDocumentos(
  l: Leitor,
  est: number,
  tipo: TipoDocumentoEstoque,
  o: { local?: number; inicio?: string; fim?: string; chave?: Chave; limite: number; desloca: number },
): Promise<DocumentoLido[]> {
  const filtro = (data: string, local: string, numero: string): { sql: string; p: unknown[] } => {
    const sql: string[] = [];
    const p: unknown[] = [];
    if (o.inicio) {
      sql.push(`AND ${data} >= ?`);
      p.push(o.inicio);
    }
    if (o.fim) {
      sql.push(`AND ${data} < DATE_ADD(?, INTERVAL 1 DAY)`);
      p.push(o.fim);
    }
    if (o.local) {
      sql.push(`AND ${local} = ?`);
      p.push(o.local);
    }
    if (o.chave) {
      sql.push(`AND ${numero} = ? AND YEAR(${data}) = ? AND MONTH(${data}) = ?`);
      p.push(o.chave.doc, o.chave.ano, o.chave.mes);
    }
    return { sql: sql.join(' '), p };
  };
  const pagina = `LIMIT ${o.limite} OFFSET ${o.desloca}`;
  if (tipo === 'nota') {
    const f = filtro('d.data_entrada', 'd.local_estoque_id', 'd.numero');
    return (
      await l.consultar<Linha>(
        `SELECT d.id, d.numero, d.data_entrada, d.recebido_em, d.local_estoque_id, le.nome AS local_nome, d.situacao,
                d.valor_total, d.empresa_fornecedora_id, fo.razao_social, d.numero_documento, d.serie, d.observacao,
                u.login, (SELECT COUNT(*) FROM nota_entrada_item i WHERE i.nota_entrada_id = d.id AND i.excluido_em IS NULL) AS itens
           FROM nota_entrada d
           JOIN local_estoque le ON le.id = d.local_estoque_id
           JOIN empresa_fornecedora fo ON fo.id = d.empresa_fornecedora_id
           LEFT JOIN usuario u ON u.id = COALESCE(d.recebido_por_usuario_id, d.criado_por)
          WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao IN ('conferencia', 'confirmada') ${f.sql}
          ORDER BY d.data_entrada DESC, d.id DESC ${pagina}`,
        [est, ...f.p],
      )
    ).map((r) => ({
      tipo,
      id: n(r['id']),
      chave: chaveLida(r['numero'], r['data_entrada']),
      data: dataIso(r['data_entrada']),
      hora: hora(r['recebido_em']),
      local: n(r['local_estoque_id']),
      localNome: String(r['local_nome']),
      localDestino: null,
      destino: null,
      centroCusto: null,
      consolidado: r['situacao'] === 'confirmada',
      usuario: texto(r['login']),
      itens: n(r['itens']),
      valor: reais2(n(r['valor_total'])),
      paciente: null,
      nota: {
        fornecedor: n(r['empresa_fornecedora_id']),
        fornecedorNome: String(r['razao_social']),
        numero: Number(String(r['numero_documento']).replace(/\D/g, '')) || 0,
        serie: texto(r['serie']),
      },
      observacao: texto(r['observacao']),
    }));
  }
  if (tipo === 'requisicao') {
    const f = filtro('d.solicitado_em', 'd.atendente_local_estoque_id', 'd.numero');
    return (
      await l.consultar<Linha>(
        `SELECT d.id, d.numero, d.solicitado_em, d.atendente_local_estoque_id, le.nome AS local_nome, d.tipo,
                d.centro_custo_id, d.situacao, d.observacao, u.login, d.atendimento_id, ${NOME_PACIENTE} AS paciente_nome,
                (SELECT COUNT(*) FROM requisicao_material_item i WHERE i.requisicao_material_id = d.id AND i.excluido_em IS NULL) AS itens
           FROM requisicao_material d
           JOIN local_estoque le ON le.id = d.atendente_local_estoque_id
           LEFT JOIN usuario u ON u.id = d.solicitante_usuario_id
           ${SQL_PACIENTE}
          WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'rascunho' ${f.sql}
          ORDER BY d.solicitado_em DESC, d.id DESC ${pagina}`,
        [est, ...f.p],
      )
    ).map((r) => ({
      tipo,
      id: n(r['id']),
      chave: chaveLida(r['numero'], r['solicitado_em']),
      data: dataIso(r['solicitado_em']),
      hora: hora(r['solicitado_em']),
      local: n(r['atendente_local_estoque_id']),
      localNome: String(r['local_nome']),
      localDestino: null,
      destino: r['tipo'] === 'paciente' ? 1 : 2,
      centroCusto: numeroOuNulo(r['centro_custo_id']),
      consolidado: ['atendida', 'recebida'].includes(String(r['situacao'])),
      usuario: texto(r['login']),
      itens: n(r['itens']),
      valor: 0,
      paciente: pacienteLido(r),
      nota: null,
      observacao: texto(r['observacao']),
    }));
  }
  const tipos = TIPOS_NO_BANCO[tipo];
  const f = filtro('d.movimentado_em', 'd.origem_local_estoque_id', 'd.numero');
  return (
    await l.consultar<Linha>(
      `SELECT d.id, d.numero, d.tipo, d.movimentado_em, d.origem_local_estoque_id, le.nome AS local_nome,
              d.destino_local_estoque_id, d.centro_custo_id, d.consolidado, d.valor_total, d.observacao, u.login,
              d.atendimento_id, ${NOME_PACIENTE} AS paciente_nome,
              (SELECT COUNT(*) FROM documento_estoque_item i WHERE i.documento_estoque_id = d.id AND i.excluido_em IS NULL) AS itens
         FROM documento_estoque d
         JOIN local_estoque le ON le.id = d.origem_local_estoque_id
         LEFT JOIN usuario u ON u.id = COALESCE(d.concluido_usuario_id, d.criado_por)
         ${SQL_PACIENTE}
        WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao = 'concluido'
          AND d.tipo IN (${lista(tipos.length)}) ${f.sql}
        ORDER BY d.movimentado_em DESC, d.id DESC ${pagina}`,
      [est, ...tipos, ...f.p],
    )
  ).map((r) => ({
    tipo,
    id: n(r['id']),
    chave: chaveLida(r['numero'], r['movimentado_em']),
    data: dataIso(r['movimentado_em']),
    hora: hora(r['movimentado_em']),
    local: n(r['origem_local_estoque_id']),
    localNome: String(r['local_nome']),
    localDestino: numeroOuNulo(r['destino_local_estoque_id']),
    destino: destinoDoTipo(String(r['tipo'])),
    centroCusto: numeroOuNulo(r['centro_custo_id']),
    consolidado: verdadeiro(r['consolidado']),
    usuario: texto(r['login']),
    itens: n(r['itens']),
    valor: reais2(n(r['valor_total'])),
    paciente: pacienteLido(r),
    nota: null,
    observacao: texto(r['observacao']),
  }));
}

/** As propostas da cotação (a resposta de cada fornecedor por item). */
const SQL_PROPOSTAS = `SELECT cri.id, ci.insumo_id, ci.sequencia, cf.empresa_fornecedora_id, f.razao_social, cri.valor_unitario,
        cri.quantidade_ofertada, cri.marca, cri.vencedor, ci.situacao AS situacao_item, cri.quantidade_adjudicada
   FROM cotacao_resposta_item cri
   JOIN cotacao_fornecedor cf ON cf.id = cri.cotacao_fornecedor_id AND cf.excluido_em IS NULL
   JOIN cotacao_item ci ON ci.id = cri.cotacao_item_id AND ci.excluido_em IS NULL
   JOIN empresa_fornecedora f ON f.id = cf.empresa_fornecedora_id
  WHERE cf.cotacao_id = ? AND cri.excluido_em IS NULL
  ORDER BY ci.sequencia, cf.sequencia`;
/** Vencedor na regra da cotação: 'T' escolhida, 'F' preterida (item adjudicado), '' ainda sem escolha. */
const vencedorDe = (r: Linha): string =>
  verdadeiro(r['vencedor']) ? 'T' : r['situacao_item'] === 'adjudicado' ? 'F' : '';
const propostaLida = (r: Linha): PropostaLida => ({
  id: n(r['id']),
  item: n(r['insumo_id']),
  seq: n(r['sequencia']),
  fornecedor: n(r['empresa_fornecedora_id']),
  fornecedorNome: String(r['razao_social']),
  valorUnitario: n(r['valor_unitario']),
  quantidade: n(r['quantidade_ofertada']),
  marca: texto(r['marca']),
  vencedor: vencedorDe(r),
  comprada: verdadeiro(r['vencedor']) ? n(r['quantidade_adjudicada']) : 0,
});
const propostaCotacao = (p: PropostaLida): PropostaCotacao => ({
  id: p.id,
  item: p.item,
  seq: p.seq,
  fornecedor: p.fornecedor,
  valorUnitario: p.valorUnitario,
  quantidade: p.quantidade,
  vencedor: p.vencedor,
});

/** Os pedidos de compra (resumo) do estabelecimento: pelo ano, situação, termo ou número. */
async function consultarPedidos(
  l: Leitor,
  est: number,
  o: { ano: number; numero?: number; situacoes: readonly string[]; termo?: string; limite: number },
): Promise<PedidoResumo[]> {
  const p: unknown[] = [est, o.ano];
  let filtro = '';
  if (o.numero !== undefined) {
    filtro += ' AND p.numero = ?';
    p.push(o.numero);
  }
  if (o.situacoes.length) {
    filtro += ` AND p.situacao IN (${lista(o.situacoes.length)})`;
    p.push(...o.situacoes);
  }
  if (o.termo) {
    filtro += ` AND EXISTS (SELECT 1 FROM pedido_compra_item x JOIN insumo i ON i.id = x.insumo_id
                 WHERE x.pedido_compra_id = p.id AND x.excluido_em IS NULL AND i.nome LIKE ?)`;
    p.push(parecido(o.termo));
  }
  const linhas = await l.consultar<Linha>(
    `SELECT p.id, p.ano, p.numero, p.data_pedido, p.situacao, p.centro_custo_id, cc.nome AS centro_nome, p.tipo_compra,
            u.login, p.cotacao_id, p.aprovado_em, ua.login AS aprovador,
            (SELECT COUNT(*) FROM pedido_compra_item x WHERE x.pedido_compra_id = p.id AND x.excluido_em IS NULL) AS itens,
            (SELECT COUNT(*) FROM cotacao_fornecedor cf WHERE cf.cotacao_id = p.cotacao_id AND cf.excluido_em IS NULL) AS fornecedores
       FROM pedido_compra p
       JOIN centro_custo cc ON cc.id = p.centro_custo_id
       LEFT JOIN usuario u ON u.id = COALESCE(p.comprador_usuario_id, p.criado_por)
       LEFT JOIN usuario ua ON ua.id = p.aprovado_por_usuario_id
      WHERE p.estabelecimento_id = ? AND p.ano = ? AND p.excluido_em IS NULL ${filtro}
      ORDER BY p.numero DESC LIMIT ${o.limite}`,
    p,
  );
  const r: PedidoResumo[] = [];
  for (const x of linhas) {
    const valor = await valorDoPedido(l, n(x['id']), numeroOuNulo(x['cotacao_id']));
    const situacao = SITUACAO_PEDIDO_NA_TELA[String(x['situacao'])] ?? null;
    const decidido = x['situacao'] === 'reprovado' || x['aprovado_em'];
    r.push({
      id: n(x['id']),
      ano: n(x['ano']),
      doc: n(x['numero']),
      data: dataIso(x['data_pedido']),
      situacao,
      situacaoRotulo: situacao === null ? String(x['situacao']) : (ROTULO_SITUACAO_PEDIDO[situacao] ?? ''),
      centroCusto: n(x['centro_custo_id']),
      centroCustoNome: String(x['centro_nome']),
      tipoCompra: TIPO_COMPRA_NA_TELA[String(x['tipo_compra'])] ?? 'N',
      usuario: texto(x['login']),
      itens: n(x['itens']),
      fornecedores: n(x['fornecedores']),
      valor,
      aprovacao: decidido
        ? {
            decisao: x['situacao'] === 'reprovado' ? 'reprovado' : 'aprovado',
            aprovador: texto(x['aprovador']),
            em: instante(x['aprovado_em']),
            nivel: faixaDoValor(valor.total).nivel,
          }
        : null,
    });
  }
  return r;
}

/** O valor do pedido: pelas propostas vencedoras da cotação; sem cotação, pelos itens do próprio pedido. */
async function valorDoPedido(
  l: Leitor,
  pedido: number,
  cotacao: number | null,
): Promise<{ total: number; parcelas: number[] }> {
  if (cotacao !== null) {
    const v = valorPelosVencedores(
      (await l.consultar<Linha>(SQL_PROPOSTAS, [cotacao])).map((r) => propostaCotacao(propostaLida(r))),
    );
    if (v.parcelas.length) return v;
  }
  const parcelas = (
    await l.consultar<Linha>(
      'SELECT valor_total FROM pedido_compra_item WHERE pedido_compra_id = ? AND excluido_em IS NULL AND cancelado_em IS NULL AND valor_total > 0 ORDER BY sequencia',
      [pedido],
    )
  ).map((r) => reais2(n(r['valor_total'])));
  return { total: reais2(parcelas.reduce((s, v) => s + v, 0)), parcelas };
}

/** Fornecedores ativos (ou só os prestadores de serviço) pela razão social, fantasia ou documento. */
function consultarFornecedores(l: Leitor, termo: string, prestador: boolean): Promise<Linha[]> {
  const so = termo.replace(/\D/g, '');
  return l.consultar<Linha>(
    `SELECT f.id, f.razao_social, f.nome_fantasia, f.tipo_pessoa, f.cnpj, f.cpf, f.situacao, m.nome AS cidade, uf.sigla AS uf
       FROM empresa_fornecedora f
       LEFT JOIN municipio_ibge m ON m.id = f.municipio_ibge_id
       LEFT JOIN unidade_federativa uf ON uf.id = m.unidade_federativa_id
      WHERE f.excluido_em IS NULL AND f.situacao = 'ativo' ${prestador ? 'AND f.prestador_servico = TRUE' : ''}
        AND (f.razao_social LIKE ? OR f.nome_fantasia LIKE ? OR (? <> '' AND (f.cnpj = ? OR f.cpf = ?)))
      ORDER BY f.razao_social, f.id LIMIT 51`,
    [parecido(termo), parecido(termo), so, so, so],
  );
}

/** Os kits rastreáveis (carrinhos) do estabelecimento com itens, lotes e a última conferência. */
async function lerKits(
  l: Leitor,
  est: number,
  id: number | null,
  hoje: string,
  alertaDias: number,
): Promise<KitRastreavel[]> {
  const kits = await l.consultar<Linha>(
    `SELECT k.id, k.nome, k.local_estoque_id, le.nome AS local_nome, k.emergencial
       FROM kit_rastreavel k JOIN local_estoque le ON le.id = k.local_estoque_id
      WHERE k.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.situacao <> 'inativo' ${id === null ? '' : 'AND k.id = ?'}
      ORDER BY k.nome, k.id`,
    id === null ? [est] : [est, id],
  );
  const ids = kits.map((r) => n(r['id']));
  if (!ids.length) return [];
  const itens = await l.consultar<Linha>(
    `SELECT ki.id, ki.kit_rastreavel_id, ki.insumo_id, i.nome, ki.quantidade_padrao, ki.saldo_atual, ki.obrigatorio,
            (SELECT li.numero_lote FROM kit_rastreavel_lote kl JOIN lote_insumo li ON li.id = kl.lote_insumo_id
              WHERE kl.kit_rastreavel_item_id = ki.id AND kl.excluido_em IS NULL AND kl.quantidade > 0 ORDER BY li.validade LIMIT 1) AS lote,
            (SELECT MIN(li.validade) FROM kit_rastreavel_lote kl JOIN lote_insumo li ON li.id = kl.lote_insumo_id
              WHERE kl.kit_rastreavel_item_id = ki.id AND kl.excluido_em IS NULL AND kl.quantidade > 0) AS validade
       FROM kit_rastreavel_item ki JOIN insumo i ON i.id = ki.insumo_id
      WHERE ki.kit_rastreavel_id IN (${lista(ids.length)}) AND ki.excluido_em IS NULL
      ORDER BY ki.sequencia`,
    ids,
  );
  const conf = await l.consultar<Linha>(
    `SELECT c.kit_rastreavel_id, c.lacre_novo, u.login, c.ocorrido_em, c.pendencias, c.resultado
       FROM conferencia_kit_rastreavel c LEFT JOIN usuario u ON u.id = c.usuario_id
      WHERE c.kit_rastreavel_id IN (${lista(ids.length)})
      ORDER BY c.ocorrido_em DESC, c.id DESC`,
    ids,
  );
  return kits.map((k) => {
    const kid = n(k['id']);
    const doKit = itens
      .filter((r) => n(r['kit_rastreavel_id']) === kid)
      .map((r) => ({
        id: n(r['id']),
        item: n(r['insumo_id']),
        nome: String(r['nome']),
        lote: r['lote'] ? String(r['lote']) : null,
        validade: r['validade'] ? dataIso(r['validade']) : null,
        quantidade: n(r['quantidade_padrao']),
        saldo: n(r['saldo_atual']),
        obrigatorio: verdadeiro(r['obrigatorio']),
      }));
    const c = conf.find((r) => n(r['kit_rastreavel_id']) === kid);
    return {
      id: kid,
      nome: String(k['nome']),
      local: n(k['local_estoque_id']),
      localNome: String(k['local_nome']),
      emergencial: verdadeiro(k['emergencial']),
      itens: doKit,
      conferencia: c
        ? {
            lacre: texto(c['lacre_novo']),
            conferente: texto(c['login']),
            em: instante(c['ocorrido_em']),
            pendencias: texto(c['pendencias']),
            completa: c['resultado'] === 'conforme',
          }
        : null,
      vencendo: doKit.filter((x) => x.validade !== null && diasParaVencer(x.validade, hoje) <= alertaDias)
        .length,
    };
  });
}

/** Os envios de transferência (documento de transferência com o tipo de movimento do envio). */
async function lerEnvios(
  l: Leitor,
  est: number,
  o: { local?: number; id?: number },
): Promise<TransferenciaEnviada[]> {
  const p: unknown[] = [TIPO_MOVIMENTO.envio, est];
  let filtro = '';
  if (o.local) {
    filtro += ' AND (d.origem_local_estoque_id = ? OR d.destino_local_estoque_id = ?)';
    p.push(o.local, o.local);
  }
  if (o.id) {
    filtro += ' AND d.id = ?';
    p.push(o.id);
  }
  const docs = await l.consultar<Linha>(
    `SELECT d.id, d.numero, d.movimentado_em, d.criado_em, d.situacao, d.origem_local_estoque_id, lo.nome AS origem_nome,
            d.destino_local_estoque_id, ld.nome AS destino_nome, u.login
       FROM documento_estoque d
       JOIN tipo_movimento_estoque t ON t.id = d.tipo_movimento_estoque_id AND t.codigo = ?
       JOIN local_estoque lo ON lo.id = d.origem_local_estoque_id
       JOIN local_estoque ld ON ld.id = d.destino_local_estoque_id
       LEFT JOIN usuario u ON u.id = d.criado_por
      WHERE d.estabelecimento_id = ? AND d.tipo = 'transferencia' AND d.excluido_em IS NULL ${filtro}
      ORDER BY d.criado_em DESC, d.id DESC LIMIT ${LIMITE_LISTA}`,
    p,
  );
  const ids = docs.map((r) => n(r['id']));
  const itens = ids.length
    ? await l.consultar<Linha>(
        `SELECT di.documento_estoque_id, di.insumo_id, i.nome, SUM(di.quantidade) AS q, SUM(di.quantidade_atendida) AS rec
           FROM documento_estoque_item di JOIN insumo i ON i.id = di.insumo_id
          WHERE di.documento_estoque_id IN (${lista(ids.length)}) AND di.excluido_em IS NULL
          GROUP BY di.documento_estoque_id, di.insumo_id, i.nome ORDER BY MIN(di.sequencia)`,
        ids,
      )
    : [];
  return docs.map((d) => {
    const id = n(d['id']);
    const doEnvio = itens.filter((r) => n(r['documento_estoque_id']) === id);
    const situacao = String(d['situacao']);
    const recebido = situacao === 'concluido';
    const divergente = recebido && doEnvio.some((r) => qtd(n(r['rec'])) !== qtd(n(r['q'])));
    return {
      id,
      origem: n(d['origem_local_estoque_id']),
      origemNome: String(d['origem_nome']),
      destino: n(d['destino_local_estoque_id']),
      destinoNome: String(d['destino_nome']),
      etapa:
        situacao === 'cancelado'
          ? 'cancelada'
          : !recebido
            ? 'enviada'
            : divergente
              ? 'divergente'
              : 'recebida',
      enviadaPor: texto(d['login']),
      enviadaEm: instante(d['criado_em']),
      itens: doEnvio.map((r) => ({
        item: n(r['insumo_id']),
        nome: String(r['nome']),
        quantidade: n(r['q']),
        recebida: recebido ? n(r['rec']) : null,
      })),
      documento: recebido ? chaveLida(d['numero'], d['movimentado_em']) : null,
    };
  });
}

// ── Movimento do estoque (o motor comum das gravações) ─────────────────────────────────────────────────────────

type LoteMandado = { readonly lote: string; readonly validade: string; readonly quantidade: number };
type LoteUsado = { readonly id: number; readonly quantidade: number };

/** O id do tipo de movimento pelo código do catálogo; fora do catálogo: recusa (configuração do cliente). */
async function tipoMovimentoId(tx: TxOperacao, codigo: string): Promise<number> {
  const r = await tx.uma<Linha>('SELECT id FROM tipo_movimento_estoque WHERE codigo = ? AND ativo = TRUE', [
    codigo,
  ]);
  if (!r)
    throw recusa(
      'tipo-movimento-nao-configurado',
      `O tipo de movimento "${codigo}" não está no catálogo do estoque deste cliente: configure-o antes de gravar.`,
    );
  return n(r['id']);
}

/** O mês do movimento tem de estar aberto no estoque do estabelecimento. */
async function exigirMesAberto(tx: TxOperacao, est: number, hoje: string): Promise<void> {
  const fechados = (
    await tx.consultar<Linha>(
      "SELECT competencia FROM fechamento_estoque WHERE estabelecimento_id = ? AND situacao = 'fechado' AND excluido_em IS NULL",
      [est],
    )
  ).map((r) => {
    const d = dataIso(r['competencia']);
    return { ano: Number(d.slice(0, 4)), mes: Number(d.slice(5, 7)) };
  });
  recusar(conferirCompetencia({ ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) }, fechados));
}

/** O local de estoque ativo do estabelecimento (outro estabelecimento: inexistente). */
async function localDoEstabelecimento(
  tx: TxOperacao,
  est: number,
  local: number,
  campo = 'local',
): Promise<Linha> {
  const r = await tx.uma<Linha>(
    'SELECT id, nome, centro_custo_id FROM local_estoque WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
    [local, est],
  );
  if (!r)
    throw recusa('local-inexistente', 'O local de estoque não existe neste estabelecimento.', {
      campos: [campo],
    });
  return r;
}

/** O insumo ativo do cadastro (rede inteira). */
async function insumoAtivo(tx: TxOperacao, insumo: number): Promise<Linha> {
  const r = await tx.uma<Linha>(
    `SELECT id, nome, estoque_unidade_medida_id, controla_lote, controla_validade, consignado, situacao
       FROM insumo WHERE id = ? AND excluido_em IS NULL`,
    [insumo],
  );
  if (!r) throw recusa('item-inexistente', `O item ${insumo} não existe no cadastro.`, { campos: ['itens'] });
  if (r['situacao'] !== 'ativo')
    throw recusa('item-inativo', `O item ${String(r['nome'])} está inativo no cadastro.`, {
      campos: ['itens'],
    });
  return r;
}

/** O centro de custo ativo e analítico do estabelecimento. */
async function centroDoEstabelecimento(tx: TxOperacao, est: number, centro: number): Promise<void> {
  const r = await tx.uma(
    'SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND analitico = TRUE AND excluido_em IS NULL',
    [centro, est],
  );
  if (!r)
    throw recusa('centro-inexistente', 'O centro de custo não existe neste estabelecimento.', {
      campos: ['centroCusto'],
    });
}

/** O usuário da operação (a gravação sempre tem o usuário da sessão). */
function usuarioDe(tx: TxOperacao): number {
  const u = tx.contexto.usuario;
  if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
  return u;
}

/** O saldo do item no local, travado; sem linha: cria a linha zerada. */
async function saldoTravado(tx: TxOperacao, est: number, local: number, insumo: number): Promise<Linha> {
  const [s] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, quantidade, custo_medio FROM saldo_estoque
      WHERE local_estoque_id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [local, insumo, est],
  );
  if (s) return s;
  const id = await tx.incluir('saldo_estoque', {
    estabelecimento_id: est,
    local_estoque_id: local,
    insumo_id: insumo,
    quantidade: 0,
    custo_medio: 0,
  });
  return { id, versao: 1, quantidade: 0, custo_medio: 0 };
}

/** O lote do item no estabelecimento pelo número e validade; com `criar`, inclui o que faltar (entrada). */
async function loteDoItem(
  tx: TxOperacao,
  est: number,
  insumo: number,
  l: LoteMandado,
  criar: boolean,
): Promise<number> {
  const r = await tx.uma<Linha>(
    `SELECT id FROM lote_insumo WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND validade = ?
        AND excluido_em IS NULL`,
    [est, insumo, l.lote.trim(), l.validade],
  );
  if (r) return n(r['id']);
  if (!criar)
    throw recusa('lote-inexistente', `O lote ${l.lote} não existe para o item.`, { campos: ['lotes'] });
  return tx.incluir('lote_insumo', {
    estabelecimento_id: est,
    insumo_id: insumo,
    numero_lote: l.lote.trim(),
    validade: l.validade,
    situacao: 'liberado',
  });
}

/** Os lotes com saldo do item no local (primeiro o que vence primeiro), travados. */
function lotesTravados(tx: TxOperacao, est: number, local: number, insumo: number): Promise<Linha[]> {
  return tx.consultarParaAtualizar<Linha>(
    `SELECT sl.id, sl.versao, sl.quantidade, sl.lote_insumo_id, sl.bloqueado, li.numero_lote, li.validade, li.situacao
       FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
      WHERE sl.estabelecimento_id = ? AND sl.local_estoque_id = ? AND li.insumo_id = ? AND sl.excluido_em IS NULL
        AND sl.quantidade > 0
      ORDER BY li.validade, li.id`,
    [est, local, insumo],
  );
}

/** Ajusta o saldo do lote no local (cria a linha na entrada). */
async function moverLote(
  tx: TxOperacao,
  est: number,
  local: number,
  lote: number,
  delta: number,
  hoje: string,
): Promise<void> {
  const [s] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao, quantidade FROM saldo_lote WHERE local_estoque_id = ? AND lote_insumo_id = ? AND excluido_em IS NULL',
    [local, lote],
  );
  const agora = new Date();
  if (s) {
    const q = qtd(n(s['quantidade']) + delta);
    if (q < 0)
      throw recusa('saldo-lote-insuficiente', 'O lote não tem saldo para esta saída.', { campos: ['lotes'] });
    await tx.alterar('saldo_lote', n(s['id']), n(s['versao']), {
      quantidade: q,
      ultima_movimentacao_em: agora,
    });
    return;
  }
  if (delta < 0)
    throw recusa('saldo-lote-insuficiente', 'O lote não tem saldo neste local.', { campos: ['lotes'] });
  await tx.incluir('saldo_lote', {
    estabelecimento_id: est,
    local_estoque_id: local,
    lote_insumo_id: lote,
    quantidade: qtd(delta),
    competencia: `${hoje.slice(0, 7)}-01`,
    ultima_movimentacao_em: agora,
  });
}

interface Movimento {
  readonly local: number;
  readonly insumo: number;
  readonly quantidade: number;
  readonly natureza: 'entrada' | 'saida';
  readonly tipoMovimento: number;
  /** Entrada: o valor total que entra (custo médio novo); saída: ignorado (sai pelo custo médio do local). */
  readonly valorEntrada?: number;
  /**
   * Saída que desfaz uma entrada (desconsolidação): sai o valor dessa entrada, não o custo médio de hoje, e o custo
   * médio do que fica é recalculado. Sem ele, a saída vai pelo custo médio do local.
   */
  readonly valorSaida?: number;
  readonly lotes: readonly LoteUsado[];
  readonly hoje: string;
  readonly documento?: number;
  readonly documentoItem?: number;
  readonly notaItem?: number;
  readonly requisicaoItem?: number;
  readonly contrapartida?: number;
  readonly atendimento?: number | null;
  readonly paciente?: number | null;
  readonly centroCusto?: number | null;
  readonly fornecedor?: number | null;
  readonly profissional?: number | null;
  readonly estorno?: number | null;
  readonly motivoAjuste?: number | null;
  readonly faturavel?: boolean;
  readonly consignado?: boolean;
}

/**
 * Grava o movimento: o saldo do item no local (custo médio na entrada), o saldo de cada lote, o movimento com o saldo e
 * o custo depois, e os lotes do movimento. A saída nunca deixa saldo negativo (o item consignado sai do consignado).
 */
async function movimentar(
  tx: TxOperacao,
  est: number,
  m: Movimento,
): Promise<{ id: number; custo: number; valor: number }> {
  const s = await saldoTravado(tx, est, m.local, m.insumo);
  const antes = n(s['quantidade']);
  const custoAntes = n(s['custo_medio']);
  let depois: number;
  let custo: number;
  let valor: number;
  if (m.natureza === 'entrada') {
    valor = reais2(m.valorEntrada ?? m.quantidade * custoAntes);
    depois = qtd(antes + m.quantidade);
    custo =
      depois > 0 ? Math.round(((antes * custoAntes + valor) / depois) * 1_000_000) / 1_000_000 : custoAntes;
    custo = Math.max(0, custo);
  } else {
    depois = qtd(antes - m.quantidade);
    if (depois < 0)
      throw recusa(
        'saldo-insuficiente',
        `Saldo insuficiente no local para o item ${m.insumo} (há ${antes}).`,
        {
          campos: ['itens'],
        },
      );
    if (m.valorSaida !== undefined) {
      valor = reais2(m.valorSaida);
      custo =
        depois > 0
          ? Math.max(0, Math.round(((antes * custoAntes - valor) / depois) * 1_000_000) / 1_000_000)
          : custoAntes;
    } else {
      custo = custoAntes;
      valor = reais2(m.quantidade * custoAntes);
    }
  }
  const agora = new Date();
  await tx.alterar('saldo_estoque', n(s['id']), n(s['versao']), {
    quantidade: depois,
    custo_medio: custo,
    ultima_movimentacao_em: agora,
    ...(m.natureza === 'entrada' && m.notaItem
      ? { ultima_entrada_em: agora, ultimo_custo_entrada: m.quantidade > 0 ? valor / m.quantidade : 0 }
      : {}),
  });
  for (const l of m.lotes)
    await moverLote(tx, est, m.local, l.id, m.natureza === 'entrada' ? l.quantidade : -l.quantidade, m.hoje);
  const u = await tx.uma<Linha>('SELECT estoque_unidade_medida_id FROM insumo WHERE id = ?', [m.insumo]);
  const id = await tx.incluir('movimento_estoque', {
    estabelecimento_id: est,
    local_estoque_id: m.local,
    ocorrido_em: agora,
    competencia: `${m.hoje.slice(0, 7)}-01`,
    tipo_movimento_estoque_id: m.tipoMovimento,
    natureza: m.natureza,
    propriedade: m.consignado ? 'consignado' : 'proprio',
    insumo_id: m.insumo,
    unidade_medida_id: n(u?.['estoque_unidade_medida_id']),
    quantidade: m.quantidade,
    quantidade_estoque: m.quantidade,
    custo_unitario: m.quantidade > 0 ? Math.round((valor / m.quantidade) * 10_000) / 10_000 : 0,
    valor_total: valor,
    saldo_apos: depois,
    custo_medio_apos: Math.round(custo * 10_000) / 10_000,
    documento_estoque_id: m.documento ?? null,
    documento_estoque_item_id: m.documentoItem ?? null,
    nota_entrada_item_id: m.notaItem ?? null,
    requisicao_material_item_id: m.requisicaoItem ?? null,
    contrapartida_local_estoque_id: m.contrapartida ?? null,
    atendimento_id: m.atendimento ?? null,
    paciente_id: m.paciente ?? null,
    centro_custo_id: m.centroCusto ?? null,
    empresa_fornecedora_id: m.fornecedor ?? null,
    solicitante_profissional_id: m.profissional ?? null,
    estorno_movimento_estoque_id: m.estorno ?? null,
    motivo_ajuste_estoque_id: m.motivoAjuste ?? null,
    usuario_id: usuarioDe(tx),
    faturavel: m.faturavel ?? false,
  });
  for (const [k, l] of m.lotes.entries())
    await tx.incluir('movimento_lote', {
      movimento_estoque_id: id,
      sequencia: k + 1,
      lote_insumo_id: l.id,
      quantidade: l.quantidade,
    });
  return { id, custo, valor };
}

/**
 * Os lotes da saída: os mandados pela tela (conferidos pela regra do lote) ou, sem lote mandado no item rastreável,
 * os que vencem primeiro (nunca vencido nem bloqueado). Item sem controle de lote sai sem lote.
 */
async function lotesDaSaida(
  tx: TxOperacao,
  est: number,
  local: number,
  insumo: Linha,
  quantidade: number,
  mandados: readonly LoteMandado[],
  hoje: string,
): Promise<LoteUsado[]> {
  if (!verdadeiro(insumo['controla_lote']) && !mandados.length) return [];
  const disponiveis = await lotesTravados(tx, est, local, n(insumo['id']));
  const livres = disponiveis.filter((r) => !verdadeiro(r['bloqueado']) && r['situacao'] === 'liberado');
  if (mandados.length) {
    recusar(
      conferirLotesSaida(
        quantidade,
        mandados,
        livres.map((r) => ({
          id: n(r['lote_insumo_id']),
          lote: String(r['numero_lote']),
          validade: dataIso(r['validade']),
          saldo: n(r['quantidade']),
        })),
        hoje,
      )[0] ?? null,
    );
    return Promise.all(
      mandados.map(async (l) => ({
        id: await loteDoItem(tx, est, n(insumo['id']), l, false),
        quantidade: l.quantidade,
      })),
    );
  }
  const usados: LoteUsado[] = [];
  let falta = quantidade;
  for (const r of livres) {
    if (falta <= 0) break;
    if (vencido(dataIso(r['validade']), hoje)) continue;
    const q = Math.min(falta, n(r['quantidade']));
    usados.push({ id: n(r['lote_insumo_id']), quantidade: qtd(q) });
    falta = qtd(falta - q);
  }
  if (falta > 0)
    throw recusa(
      'saldo-lote-insuficiente',
      `Os lotes válidos do item ${String(insumo['nome'])} não cobrem a saída.`,
      {
        campos: ['lotes'],
      },
    );
  return usados;
}

/** O saldo do item no local cobre a saída (o consignado não confere saldo próprio). */
async function exigirSaldo(
  tx: TxOperacao,
  est: number,
  local: number,
  insumo: Linha,
  quantidade: number,
): Promise<void> {
  if (verdadeiro(insumo['consignado'])) return;
  const s = await tx.uma<Linha>(
    'SELECT quantidade FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [local, n(insumo['id']), est],
  );
  if (qtd(n(s?.['quantidade'])) < qtd(quantidade))
    throw recusa(
      'saldo-insuficiente',
      `Saldo insuficiente no local para o item ${String(insumo['nome'])} (há ${n(s?.['quantidade'])}).`,
      {
        campos: ['itens'],
      },
    );
}

/** Os lotes da entrada (rastreável exige lote e validade válidos; o lote que falta é incluído). */
async function lotesDaEntrada(
  tx: TxOperacao,
  est: number,
  insumo: Linha,
  quantidade: number,
  mandados: readonly LoteMandado[],
  hoje: string,
): Promise<LoteUsado[]> {
  if (verdadeiro(insumo['controla_lote'])) {
    if (!mandados.length)
      throw recusa('sem-lote', `Informe o lote do item ${String(insumo['nome'])}.`, { campos: ['lotes'] });
    for (const l of mandados) recusar(conferirLoteEntrada(l, hoje)[0] ?? null);
  }
  if (mandados.length && qtd(mandados.reduce((s, l) => s + l.quantidade, 0)) !== qtd(quantidade))
    throw recusa('lotes-diferem', 'A soma dos lotes difere da quantidade do item.', { campos: ['lotes'] });
  return Promise.all(
    mandados.map(async (l) => ({
      id: await loteDoItem(tx, est, n(insumo['id']), l, true),
      quantidade: l.quantidade,
    })),
  );
}

/** O documento do estoque novo (número de negócio do estabelecimento), já concluído e consolidado. */
async function novoDocumento(
  tx: TxOperacao,
  est: number,
  d: {
    tipo: string;
    tipoMovimento: number;
    origem: number;
    destino?: number | null;
    centroCusto?: number | null;
    atendimento?: number | null;
    paciente?: number | null;
    requisicao?: number | null;
    motivoAjuste?: number | null;
    terceiro?: string | null;
    observacao?: string | null;
    situacao?: 'aberto' | 'concluido';
  },
): Promise<{ id: number; numero: number; em: Date }> {
  const numero = await tx.proximoNumero('documento_estoque');
  const em = new Date();
  const concluido = (d.situacao ?? 'concluido') === 'concluido';
  const id = await tx.incluir('documento_estoque', {
    estabelecimento_id: est,
    numero: numero.valor,
    tipo: d.tipo,
    tipo_movimento_estoque_id: d.tipoMovimento,
    origem_local_estoque_id: d.origem,
    destino_local_estoque_id: d.destino ?? null,
    centro_custo_id: d.centroCusto ?? null,
    atendimento_id: d.atendimento ?? null,
    paciente_id: d.paciente ?? null,
    requisicao_material_id: d.requisicao ?? null,
    motivo_ajuste_estoque_id: d.motivoAjuste ?? null,
    destinatario_terceiro: d.terceiro ?? null,
    movimentado_em: em,
    concluido_em: concluido ? em : null,
    concluido_usuario_id: concluido ? usuarioDe(tx) : null,
    consolidado: concluido,
    situacao: concluido ? 'concluido' : 'aberto',
    observacao: d.observacao ?? null,
  });
  return { id, numero: numero.valor, em };
}

/** O item do documento (uma linha por item, com o movimento ligado). */
async function itemDoDocumento(
  tx: TxOperacao,
  documento: number,
  sequencia: number,
  insumo: Linha,
  quantidade: number,
  extra: Record<string, unknown> = {},
): Promise<number> {
  return tx.incluir('documento_estoque_item', {
    documento_estoque_id: documento,
    sequencia,
    insumo_id: n(insumo['id']),
    unidade_medida_id: n(insumo['estoque_unidade_medida_id']),
    quantidade,
    ...extra,
  });
}

/** Liga o movimento ao item do documento e grava o custo e o valor nele. */
async function fecharItem(
  tx: TxOperacao,
  item: number,
  mov: { id: number; valor: number },
  quantidade: number,
): Promise<void> {
  const r = await tx.uma<Linha>('SELECT versao FROM documento_estoque_item WHERE id = ?', [item]);
  await tx.alterar('documento_estoque_item', item, n(r?.['versao']), {
    movimento_estoque_id: mov.id,
    custo_unitario: quantidade > 0 ? Math.round((mov.valor / quantidade) * 1_000_000) / 1_000_000 : 0,
    valor_total: mov.valor,
  });
}

/** Soma o valor dos itens no cabeçalho do documento. */
async function totalizarDocumento(tx: TxOperacao, documento: number, valor: number): Promise<void> {
  const r = await tx.uma<Linha>('SELECT versao FROM documento_estoque WHERE id = ?', [documento]);
  await tx.alterar('documento_estoque', documento, n(r?.['versao']), { valor_total: reais2(valor) });
}

/** O documento do estoque pelo id, no estabelecimento e nos tipos pedidos, travado. */
async function documentoPorId(
  tx: TxOperacao,
  est: number,
  documento: number,
  tipos: readonly string[],
): Promise<Linha> {
  const [d] = await tx.consultarParaAtualizar<Linha>(
    `SELECT * FROM documento_estoque
      WHERE id = ? AND estabelecimento_id = ? AND tipo IN (${lista(tipos.length)}) AND excluido_em IS NULL`,
    [documento, est, ...tipos],
  );
  if (!d) throw recusa('documento-inexistente', 'O documento não existe neste estabelecimento.');
  return d;
}

/** O paciente do atendimento do estabelecimento. */
async function pacienteDoAtendimento(tx: TxOperacao, est: number, atendimento: number): Promise<number> {
  const a = await tx.uma<Linha>(
    'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ?',
    [atendimento, est],
  );
  if (!a)
    throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.', {
      campos: ['atendimento'],
    });
  return n(a['paciente_id']);
}

/** O pedido de compra pelo número no ano, travado. */
async function pedidoTravado(tx: TxOperacao, est: number, ano: number, doc: number): Promise<Linha> {
  const [p] = await tx.consultarParaAtualizar<Linha>(
    'SELECT * FROM pedido_compra WHERE estabelecimento_id = ? AND ano = ? AND numero = ? AND excluido_em IS NULL',
    [est, ano, doc],
  );
  if (!p) throw recusa('pedido-inexistente', 'O pedido não existe.', { campos: ['pedido'] });
  return p;
}

/** O escopo do usuário da operação no estabelecimento. */
const escopoDaOperacao = (tx: TxOperacao, est: number) => escopoDoUsuario(tx, est, usuarioDe(tx));

/** Hoje no fuso do estabelecimento. */
async function hojeNoEstabelecimento(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return relogioNoFuso(r?.fuso_horario || FUSO_PADRAO).hoje;
}

/** O envio de transferência em trânsito, travado (recebido ou cancelado: recusa). */
async function envioTravado(tx: TxOperacao, est: number, id: number): Promise<Linha> {
  const [d] = await tx.consultarParaAtualizar<Linha>(
    `SELECT d.id, d.versao, d.situacao, d.criado_por, d.origem_local_estoque_id, d.observacao FROM documento_estoque d
       JOIN tipo_movimento_estoque t ON t.id = d.tipo_movimento_estoque_id AND t.codigo = ?
      WHERE d.id = ? AND d.estabelecimento_id = ? AND d.tipo = 'transferencia' AND d.excluido_em IS NULL`,
    [TIPO_MOVIMENTO.envio, id, est],
  );
  if (!d || d['situacao'] !== 'aberto')
    throw recusa('envio-recebido', 'O envio já foi recebido ou cancelado.');
  return d;
}

/** A observação com o texto novo no fim (até 2000 caracteres). */
const juntar = (antes: unknown, novo: string): string =>
  `${texto(antes) ? `${texto(antes)} | ` : ''}${novo}`.slice(0, 2000);

// ── Operações do executor (as gravações da tela pelo nome da operação) ──────────────────────────────────────────

type Ids = Record<string, number | string>;
type Manipulador = (tx: TxOperacao, est: number, e: never, hoje: string) => Promise<Ids>;

/** A saída (paciente, setor ou terceiro): documento, itens, movimentos e lotes; atende a requisição quando vem nela. */
async function registrarSaida(
  tx: TxOperacao,
  est: number,
  e: RegistrarSaidaEntrada,
  hoje: string,
): Promise<Ids> {
  recusar(conferirCabecalhoSaida({ centroCusto: e.centroCusto, local: e.local })[0] ?? null);
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, e.local);
  await centroDoEstabelecimento(tx, est, e.centroCusto);
  const escopo = await escopoDaOperacao(tx, est);
  recusar(conferirLocal(escopo, e.local, 'saida'));
  recusar(conferirCentroCusto(escopo, e.centroCusto));
  const paraPaciente = e.destino === 1 || e.destino === 3;
  if (paraPaciente && !e.atendimento)
    throw recusa('sem-paciente', 'Informe o atendimento do paciente.', { campos: ['atendimento'] });
  let terceiro: string | null = null;
  if (e.destino === 5) {
    if (!e.terceiro) throw recusa('sem-terceiro', 'Informe o terceiro que recebe.', { campos: ['terceiro'] });
    const t = await tx.uma<Linha>(
      'SELECT nome FROM terceiro_destinatario WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
      [e.terceiro, est],
    );
    if (!t)
      throw recusa('terceiro-inexistente', 'O terceiro não está cadastrado neste estabelecimento.', {
        campos: ['terceiro'],
      });
    terceiro = String(t['nome']);
  }
  const paciente = paraPaciente && e.atendimento ? await pacienteDoAtendimento(tx, est, e.atendimento) : null;
  let requisicao: Linha | null = null;
  let itensRequisicao: Linha[] = [];
  if (e.requisicao) {
    requisicao =
      (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT id, versao, situacao FROM requisicao_material
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.requisicao, est],
        )
      )[0] ?? null;
    if (
      !requisicao ||
      !['solicitada', 'autorizada', 'em_separacao', 'atendida_parcial'].includes(
        String(requisicao['situacao']),
      )
    )
      throw recusa('requisicao-atendida', 'A requisição já foi atendida ou não existe mais.', {
        campos: ['requisicao'],
      });
    itensRequisicao = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM requisicao_material_item WHERE requisicao_material_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [n(requisicao['id'])],
    );
  }
  const tipo = paraPaciente ? 'saida_paciente' : e.destino === 5 ? 'saida_terceiro' : 'saida_setor';
  const tipoMov = await tipoMovimentoId(
    tx,
    paraPaciente
      ? TIPO_MOVIMENTO.saidaPaciente
      : e.destino === 5
        ? TIPO_MOVIMENTO.saidaTerceiro
        : TIPO_MOVIMENTO.saidaSetor,
  );
  const doc = await novoDocumento(tx, est, {
    tipo,
    tipoMovimento: tipoMov,
    origem: e.local,
    centroCusto: e.centroCusto,
    atendimento: paraPaciente ? (e.atendimento ?? null) : null,
    paciente,
    requisicao: requisicao ? n(requisicao['id']) : null,
    terceiro,
    observacao: e.observacao ?? null,
  });
  let total = 0;
  let ultimo: SaidaFeita | null = null;
  const contaDoEstoque = lancadorContaEstoque(tx, est, usuarioDe(tx));
  for (const [k, it] of e.itens.entries()) {
    const insumo = await insumoAtivo(tx, it.item);
    await exigirSaldo(tx, est, e.local, insumo, it.quantidade);
    const lotes = await lotesDaSaida(tx, est, e.local, insumo, it.quantidade, it.lotes, hoje);
    const ri = itensRequisicao.find((r) =>
      it.seq ? n(r['sequencia']) === it.seq : n(r['insumo_id']) === it.item,
    );
    if (requisicao && !ri)
      throw recusa('item-fora-da-requisicao', `O item ${it.item} não está na requisição.`, {
        campos: ['itens'],
      });
    const item = await itemDoDocumento(tx, doc.id, k + 1, insumo, it.quantidade, {
      lote_insumo_id: lotes.length === 1 ? lotes[0]!.id : null,
      requisicao_material_item_id: ri ? n(ri['id']) : null,
      cobravel: paraPaciente,
    });
    const mov = await movimentar(tx, est, {
      local: e.local,
      insumo: it.item,
      quantidade: it.quantidade,
      natureza: 'saida',
      tipoMovimento: tipoMov,
      lotes,
      hoje,
      documento: doc.id,
      documentoItem: item,
      ...(ri ? { requisicaoItem: n(ri['id']) } : {}),
      atendimento: paraPaciente ? (e.atendimento ?? null) : null,
      paciente,
      centroCusto: e.centroCusto,
      profissional: it.prescritorControlado ?? e.medico ?? null,
      faturavel: paraPaciente,
      consignado: verdadeiro(insumo['consignado']),
    });
    if (paraPaciente)
      await contaDoEstoque.lancarSaida({
        movimento: mov.id,
        atendimento: e.atendimento ?? null,
        insumo: it.item,
        quantidade: it.quantidade,
        lote: lotes.length === 1 ? lotes[0]!.id : null,
        centroCusto: e.centroCusto,
        solicitante: it.prescritorControlado ?? e.medico ?? null,
        realizadoEm: new Date(),
        dataBase: hoje,
      });
    await fecharItem(tx, item, mov, it.quantidade);
    total += mov.valor;
    ultimo = { mov, item, lotes, insumo: it.item, quantidade: it.quantidade };
    if (ri) {
      const atendida = qtd(n(ri['quantidade_atendida']) + it.quantidade);
      const pedida = n(ri['quantidade_solicitada']) - n(ri['quantidade_cancelada']);
      await tx.alterar('requisicao_material_item', n(ri['id']), n(ri['versao']), {
        quantidade_atendida: atendida,
        situacao: atendida >= pedida ? 'atendido' : 'atendido_parcial',
      });
      ri['quantidade_atendida'] = atendida;
      ri['versao'] = n(ri['versao']) + 1;
    }
  }
  await totalizarDocumento(tx, doc.id, total);
  if (requisicao) {
    const completa = itensRequisicao.every(
      (r) => n(r['quantidade_atendida']) >= n(r['quantidade_solicitada']) - n(r['quantidade_cancelada']),
    );
    await tx.alterar('requisicao_material', n(requisicao['id']), n(requisicao['versao']), {
      situacao: completa ? 'atendida' : 'atendida_parcial',
      atendido_em: new Date(),
    });
  }
  const extra: Ids = {};
  // O OPME e a manipulação saem com um item só (o contrato confere): o registro deles aponta o movimento da saída.
  if (e.opme && ultimo) extra['consumo'] = await gravarConsumoOpme(tx, est, e, ultimo);
  if (e.manipulacao && ultimo)
    extra['ordem'] = await baixarInsumoManipulacao(tx, est, e.manipulacao, e.local, ultimo);
  const c = chaveLida(doc.numero, doc.em);
  return { id: doc.id, ano: c.ano, mes: c.mes, doc: c.doc, itens: e.itens.length, ...extra };
}

/** O que a saída de um item gravou (o OPME e a manipulação apontam o movimento e o item do documento). */
interface SaidaFeita {
  readonly mov: { id: number; custo: number; valor: number };
  readonly item: number;
  readonly lotes: readonly LoteUsado[];
  readonly insumo: number;
  readonly quantidade: number;
}

/**
 * O consumo de OPME em sala, ligado ao movimento da saída a paciente: lote, série, registro Anvisa, etiqueta lida,
 * fornecedor e a exceção sem autorização. Com a solicitação, confere a versão vista e marca o item e a solicitação
 * como utilizados quando já autorizados (o consumo sem autorização fica só no consumo, com o motivo).
 */
async function gravarConsumoOpme(
  tx: TxOperacao,
  est: number,
  e: RegistrarSaidaEntrada,
  u: SaidaFeita,
): Promise<number> {
  const o = e.opme!;
  if (o.modelo) throw modeloPendente('o modelo do OPME no consumo (coluna de modelo em consumo_opme)');
  const fab = await tx.uma<Linha>(
    `SELECT id FROM fabricante WHERE UPPER(nome) = UPPER(?) AND ativo = TRUE AND excluido_em IS NULL
      ORDER BY id LIMIT 1`,
    [o.fabricante],
  );
  if (!fab)
    throw recusa('fabricante-nao-cadastrado', 'O fabricante não está no cadastro de fabricantes.', {
      campos: ['fabricante'],
    });
  // A cirurgia é do estabelecimento da sessão; a sala gravada é a do agendamento (cadastro), não a da tela.
  const ag = await tx.uma<Linha>(
    `SELECT sala_cirurgica_id, atendimento_id, paciente_id FROM agendamento_cirurgico
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [o.agendamento, est],
  );
  if (!ag)
    throw recusa('agendamento-inexistente', 'A cirurgia não é deste estabelecimento.', {
      campos: ['agendamento'],
    });
  // A cirurgia é do mesmo atendimento (e do mesmo paciente) da saída: o rastreio reverso e a conta dependem disso.
  const pacienteSaida = e.atendimento ? await pacienteDoAtendimento(tx, est, e.atendimento) : null;
  if (
    (ag['atendimento_id'] != null && n(ag['atendimento_id']) !== e.atendimento) ||
    (ag['paciente_id'] != null && pacienteSaida !== null && n(ag['paciente_id']) !== pacienteSaida)
  )
    throw recusa(
      'agendamento-de-outro-atendimento',
      'A cirurgia é de outro atendimento ou de outro paciente.',
      {
        campos: ['agendamento'],
      },
    );
  let item: Linha | null = null;
  if (o.solicitacao !== null) {
    item =
      (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT s.id, s.versao, s.situacao, s.autorizado_em, s.agendamento_cirurgico_id, i.id AS item_id, i.versao AS item_versao,
                  i.insumo_id, i.quantidade_autorizada, i.empresa_fornecedora_id
             FROM solicitacao_opme s
             JOIN solicitacao_opme_item i ON i.solicitacao_opme_id = s.id AND i.excluido_em IS NULL
            WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL
            ORDER BY i.sequencia LIMIT 1`,
          [o.solicitacao, est],
        )
      )[0] ?? null;
    if (!item || n(item['agendamento_cirurgico_id']) !== o.agendamento || n(item['insumo_id']) !== u.insumo)
      throw recusa('solicitacao-inexistente', 'A solicitação não é desta cirurgia nem deste item.', {
        campos: ['solicitacao'],
      });
    if (o.versaoVista !== null && n(item['versao']) !== o.versaoVista)
      throw recusa('opme-mudou', 'A solicitação de OPME mudou em outra tela: recarregue e confira.');
  }
  const id = await tx.incluir('consumo_opme', {
    estabelecimento_id: est,
    atendimento_id: e.atendimento ?? null,
    solicitacao_opme_item_id: item ? n(item['item_id']) : null,
    agendamento_cirurgico_id: o.agendamento,
    sala_cirurgica_id: numeroOuNulo(ag['sala_cirurgica_id']),
    insumo_id: u.insumo,
    fabricante_id: n(fab['id']),
    empresa_fornecedora_id: o.fornecedor,
    lote_insumo_id: u.lotes.length === 1 ? u.lotes[0]!.id : null,
    numero_lote: o.lote,
    numero_serie: o.serie,
    registro_anvisa: o.registroAnvisa,
    validade: o.validade,
    etiqueta_rastreabilidade: o.codigoLido,
    quantidade: u.quantidade,
    local_estoque_id: e.local,
    movimento_estoque_id: u.mov.id,
    consignado: o.consignado,
    sem_autorizacao: o.semAutorizacao !== null,
    motivo_sem_autorizacao: o.semAutorizacao?.motivo ?? null,
    registrado_por_usuario_id: usuarioDe(tx),
    registrado_em: new Date(),
    situacao: 'consumido',
  });
  if (item && item['quantidade_autorizada'] !== null && item['empresa_fornecedora_id'] !== null)
    await tx.alterar('solicitacao_opme_item', n(item['item_id']), n(item['item_versao']), {
      situacao: 'utilizado',
    });
  if (item && item['autorizado_em'] !== null)
    await tx.alterar('solicitacao_opme', n(item['id']), n(item['versao']), { situacao: 'utilizada' });
  // Sem autorização (a exceção registrada): a situação fica, mas a versão muda (o consumo mudou o que a tela leu).
  else if (item)
    await tx.alterar('solicitacao_opme', n(item['id']), n(item['versao']), {
      situacao: String(item['situacao']),
    });
  return id;
}

/**
 * A baixa do insumo da ordem de manipulação conferida: o insumo da ordem aponta o movimento da saída, com o lote, o
 * custo e o valor; a ordem passa a baixada com o custo total. A versão vista e o local da ordem são conferidos.
 */
async function baixarInsumoManipulacao(
  tx: TxOperacao,
  est: number,
  m: NonNullable<RegistrarSaidaEntrada['manipulacao']>,
  local: number,
  u: SaidaFeita,
): Promise<number> {
  const [o] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, local_estoque_id FROM ordem_manipulacao
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [m.ordem, est],
  );
  if (!o) throw recusa('ordem-inexistente', 'A ordem de manipulação não existe.', { campos: ['ordem'] });
  if (n(o['versao']) !== m.versaoVista)
    throw recusa('ordem-mudou', 'A ordem de manipulação mudou em outra tela: recarregue e confira.');
  if (String(o['situacao']) !== 'conferida')
    throw recusa('ordem-nao-conferida', 'Só a ordem conferida tem o insumo baixado.', { campos: ['ordem'] });
  if (n(o['local_estoque_id']) !== local)
    throw recusa('local-da-ordem', 'O insumo sai do local de estoque da ordem.', { campos: ['local'] });
  const [oi] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, insumo_id, lote_insumo_id, quantidade_utilizada, movimento_estoque_id
       FROM ordem_manipulacao_insumo
      WHERE ordem_manipulacao_id = ? AND excluido_em IS NULL ORDER BY sequencia LIMIT 1`,
    [m.ordem],
  );
  if (!oi || n(oi['insumo_id']) !== u.insumo || oi['movimento_estoque_id'] !== null)
    throw recusa('insumo-fora-da-ordem', 'O item baixado não é o insumo da ordem.', { campos: ['itens'] });
  if (qtd(n(oi['quantidade_utilizada'])) !== qtd(u.quantidade))
    throw recusa('quantidade-da-ordem', 'A baixa é da quantidade usada na ordem.', { campos: ['itens'] });
  await tx.alterar('ordem_manipulacao_insumo', n(oi['id']), n(oi['versao']), {
    movimento_estoque_id: u.mov.id,
    lote_insumo_id: u.lotes.length === 1 ? u.lotes[0]!.id : numeroOuNulo(oi['lote_insumo_id']),
    custo_unitario: u.mov.custo,
    valor_total: u.mov.valor,
  });
  await tx.alterar('ordem_manipulacao', n(o['id']), n(o['versao']), {
    situacao: 'baixada',
    valor_custo_total: u.mov.valor,
  });
  return n(o['id']);
}

/** A requisição de material ao local que atende (setor ou paciente), com os itens. */
async function requisitarMaterial(
  tx: TxOperacao,
  est: number,
  e: RequisitarMaterialEntrada,
  hoje: string,
): Promise<Ids> {
  recusar(conferirCabecalhoSaida({ centroCusto: e.centroCusto, local: e.local })[0] ?? null);
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, e.local);
  await centroDoEstabelecimento(tx, est, e.centroCusto);
  recusar(conferirCentroCusto(await escopoDaOperacao(tx, est), e.centroCusto));
  const paraPaciente = e.destino === 1 || e.destino === 3;
  if (paraPaciente && !e.atendimento)
    throw recusa('sem-paciente', 'Informe o atendimento do paciente.', { campos: ['atendimento'] });
  if (paraPaciente && e.atendimento) await pacienteDoAtendimento(tx, est, e.atendimento);
  const insumos = [];
  for (const it of e.itens) insumos.push(await insumoAtivo(tx, it.item));
  const numero = await tx.proximoNumero('requisicao_material');
  const em = new Date();
  const id = await tx.incluir('requisicao_material', {
    estabelecimento_id: est,
    numero: numero.valor,
    tipo: paraPaciente ? 'paciente' : 'setor',
    atendente_local_estoque_id: e.local,
    centro_custo_id: e.centroCusto,
    atendimento_id: paraPaciente ? (e.atendimento ?? null) : null,
    solicitante_usuario_id: usuarioDe(tx),
    solicitado_em: em,
    situacao: 'solicitada',
    observacao: e.observacao ?? null,
  });
  for (const [k, it] of e.itens.entries())
    await tx.incluir('requisicao_material_item', {
      requisicao_material_id: id,
      sequencia: k + 1,
      insumo_id: it.item,
      unidade_medida_id: n(insumos[k]!['estoque_unidade_medida_id']),
      quantidade_solicitada: it.quantidade,
      faturavel: paraPaciente,
      situacao: 'pendente',
    });
  const c = chaveLida(numero.valor, em);
  return { id, ano: c.ano, mes: c.mes, doc: c.doc, itens: e.itens.length };
}

/** A devolução ao estoque do que saiu (pelo item da saída), no custo da saída e nos lotes que saíram. */
async function registrarDevolucao(
  tx: TxOperacao,
  est: number,
  e: RegistrarDevolucaoEntrada,
  hoje: string,
): Promise<Ids> {
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, e.local);
  recusar(conferirLocal(await escopoDaOperacao(tx, est), e.local, 'devolucao'));
  const saida = await documentoPorId(tx, est, e.saida, TIPOS_SAIDA);
  const tipoMov = await tipoMovimentoId(tx, TIPO_MOVIMENTO.devolucao);
  const doc = await novoDocumento(tx, est, {
    tipo: 'devolucao_interna',
    tipoMovimento: tipoMov,
    origem: e.local,
    centroCusto: numeroOuNulo(saida['centro_custo_id']),
    atendimento: numeroOuNulo(saida['atendimento_id']),
    paciente: numeroOuNulo(saida['paciente_id']),
    observacao: e.observacao ?? null,
  });
  let total = 0;
  for (const [k, it] of e.itens.entries()) {
    const [orig] = await tx.consultarParaAtualizar<Linha>(
      `SELECT di.id, di.insumo_id, di.quantidade, di.movimento_estoque_id, di.custo_unitario,
              (SELECT COALESCE(SUM(dv.quantidade), 0) FROM movimento_estoque dv
                WHERE dv.estorno_movimento_estoque_id = di.movimento_estoque_id AND dv.excluido_em IS NULL) AS devolvido
         FROM documento_estoque_item di WHERE di.id = ? AND di.documento_estoque_id = ? AND di.excluido_em IS NULL`,
      [it.lancamentoSaida, n(saida['id'])],
    );
    if (!orig || n(orig['insumo_id']) !== it.item)
      throw recusa('item-fora-da-saida', 'O item devolvido não é desta saída.', { campos: ['itens'] });
    if (qtd(n(orig['devolvido']) + it.quantidade) > qtd(n(orig['quantidade'])))
      throw recusa('devolucao-acima', 'A devolução passa da quantidade que saiu.', { campos: ['itens'] });
    const saiu = await tx.consultar<Linha>(
      'SELECT lote_insumo_id, quantidade FROM movimento_lote WHERE movimento_estoque_id = ? AND excluido_em IS NULL',
      [n(orig['movimento_estoque_id'])],
    );
    // Por lote: o que saiu dele menos o que já voltou dele (devoluções anteriores deste item da saída).
    const jaVoltou = await tx.consultar<Linha>(
      `SELECT ml.lote_insumo_id, SUM(ml.quantidade) AS quantidade FROM movimento_lote ml
         JOIN movimento_estoque dv ON dv.id = ml.movimento_estoque_id
        WHERE dv.estorno_movimento_estoque_id = ? AND dv.excluido_em IS NULL AND ml.excluido_em IS NULL
        GROUP BY ml.lote_insumo_id`,
      [n(orig['movimento_estoque_id'])],
    );
    // O OPME volta pelos lotes da saída, sem a tela escolher: o que saiu de cada lote e ainda não voltou.
    const lotesDv = it.lotes.length || !e.opme ? it.lotes : lotesQueVoltam(saiu, jaVoltou, it.quantidade);
    const pedidoPorLote = new Map<number, number>();
    for (const l of lotesDv)
      pedidoPorLote.set(l.loteSaida, (pedidoPorLote.get(l.loteSaida) ?? 0) + l.quantidade);
    for (const [lote, q] of pedidoPorLote) {
      const saiuDoLote = saiu
        .filter((r) => n(r['lote_insumo_id']) === lote)
        .reduce((t, r) => t + n(r['quantidade']), 0);
      if (!saiuDoLote)
        throw recusa('lote-fora-da-saida', 'O lote devolvido não saiu neste item.', { campos: ['lotes'] });
      const voltou = n(jaVoltou.find((r) => n(r['lote_insumo_id']) === lote)?.['quantidade']);
      if (qtd(voltou + q) > qtd(saiuDoLote))
        throw recusa('devolucao-lote-acima', 'A devolução passa do que saiu deste lote.', {
          campos: ['lotes'],
        });
    }
    if (saiu.length && qtd(lotesDv.reduce((s, l) => s + l.quantidade, 0)) !== qtd(it.quantidade))
      throw recusa('lotes-diferem', 'Informe os lotes devolvidos (a soma é a quantidade).', {
        campos: ['lotes'],
      });
    const insumo = await insumoAtivo(tx, it.item);
    const item = await itemDoDocumento(tx, doc.id, k + 1, insumo, it.quantidade);
    const mov = await movimentar(tx, est, {
      local: e.local,
      insumo: it.item,
      quantidade: it.quantidade,
      natureza: 'entrada',
      tipoMovimento: tipoMov,
      valorEntrada: reais2(it.quantidade * n(orig['custo_unitario'])),
      lotes: lotesDv.map((l) => ({ id: l.loteSaida, quantidade: l.quantidade })),
      hoje,
      documento: doc.id,
      documentoItem: item,
      atendimento: numeroOuNulo(saida['atendimento_id']),
      paciente: numeroOuNulo(saida['paciente_id']),
      centroCusto: numeroOuNulo(saida['centro_custo_id']),
      estorno: n(orig['movimento_estoque_id']),
    });
    await lancadorContaEstoque(tx, est, usuarioDe(tx)).estornarDevolucao({
      movimentoSaida: n(orig['movimento_estoque_id']),
      movimentoDevolucao: mov.id,
      quantidade: it.quantidade,
    });
    await fecharItem(tx, item, mov, it.quantidade);
    total += mov.valor;
    if (e.opme) await devolverConsumoOpme(tx, est, e.opme, n(orig['movimento_estoque_id']));
  }
  await totalizarDocumento(tx, doc.id, total);
  const c = chaveLida(doc.numero, doc.em);
  return { id: doc.id, ano: c.ano, mes: c.mes, doc: c.doc, itens: e.itens.length };
}

/** Os lotes que voltam: de cada lote da saída, o que saiu menos o que já voltou, até a quantidade devolvida. */
function lotesQueVoltam(
  saiu: readonly Linha[],
  jaVoltou: readonly Linha[],
  quantidade: number,
): { loteSaida: number; quantidade: number }[] {
  const r: { loteSaida: number; quantidade: number }[] = [];
  let falta = quantidade;
  for (const s of saiu) {
    if (falta <= 0) break;
    const lote = n(s['lote_insumo_id']);
    const livre = qtd(
      n(s['quantidade']) - n(jaVoltou.find((v) => n(v['lote_insumo_id']) === lote)?.['quantidade']),
    );
    const q = qtd(Math.min(livre, falta));
    if (q > 0) {
      r.push({ loteSaida: lote, quantidade: q });
      falta = qtd(falta - q);
    }
  }
  return r;
}

/** A devolução do consumo de OPME: o consumo é o do movimento devolvido; devolvido por inteiro, muda de situação. */
async function devolverConsumoOpme(
  tx: TxOperacao,
  est: number,
  o: NonNullable<RegistrarDevolucaoEntrada['opme']>,
  movimentoSaida: number,
): Promise<void> {
  const [c] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, quantidade, movimento_estoque_id, situacao FROM consumo_opme
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [o.consumo, est],
  );
  if (!c || n(c['movimento_estoque_id']) !== movimentoSaida || String(c['situacao']) !== 'consumido')
    throw recusa('consumo-fora-da-saida', 'O consumo de OPME não é deste item da saída.', {
      campos: ['consumo'],
    });
  const [v] = await tx.consultar<Linha>(
    `SELECT COALESCE(SUM(quantidade), 0) AS q FROM movimento_estoque
      WHERE estorno_movimento_estoque_id = ? AND excluido_em IS NULL`,
    [movimentoSaida],
  );
  const tudo = qtd(n(v?.['q'])) >= qtd(n(c['quantidade']));
  await tx.alterar('consumo_opme', n(c['id']), n(c['versao']), {
    motivo_devolucao: o.motivo,
    ...(tudo ? { situacao: 'devolvido' } : {}),
  });
}

/**
 * A transferência entre locais do estabelecimento: sai da origem pelo custo médio e entra no destino pelo mesmo
 * valor. Com o envio, o recebimento conclui o documento do envio (o que não chegou fica na origem: divergente).
 */
async function transferir(tx: TxOperacao, est: number, e: TransferirEntrada, hoje: string): Promise<Ids> {
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, e.origem, 'origem');
  await localDoEstabelecimento(tx, est, e.destino, 'destino');
  recusar(conferirTransferencia(await escopoDaOperacao(tx, est), e.origem, e.destino)[0] ?? null);
  const tipoSai = await tipoMovimentoId(tx, TIPO_MOVIMENTO.transferenciaSaida);
  const tipoEntra = await tipoMovimentoId(tx, TIPO_MOVIMENTO.transferenciaEntrada);
  let doc: { id: number; numero: number; em: Date };
  let envioItens: Linha[] = [];
  if (e.envio) {
    const [env] = await tx.consultarParaAtualizar<Linha>(
      `SELECT d.* FROM documento_estoque d JOIN tipo_movimento_estoque t ON t.id = d.tipo_movimento_estoque_id AND t.codigo = ?
        WHERE d.id = ? AND d.estabelecimento_id = ? AND d.tipo = 'transferencia' AND d.excluido_em IS NULL`,
      [TIPO_MOVIMENTO.envio, e.envio, est],
    );
    if (!env || env['situacao'] !== 'aberto')
      throw recusa('envio-recebido', 'O envio já foi recebido ou cancelado.');
    if (n(env['origem_local_estoque_id']) !== e.origem || n(env['destino_local_estoque_id']) !== e.destino)
      throw recusa('envio-de-outros-locais', 'O envio é de outros locais.');
    const agora = new Date();
    await tx.alterar('documento_estoque', n(env['id']), n(env['versao']), {
      situacao: 'concluido',
      consolidado: true,
      movimentado_em: agora,
      concluido_em: agora,
      concluido_usuario_id: usuarioDe(tx),
      ...(e.observacao ? { observacao: e.observacao } : {}),
    });
    doc = { id: n(env['id']), numero: n(env['numero']), em: agora };
    envioItens = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, insumo_id, quantidade FROM documento_estoque_item WHERE documento_estoque_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [doc.id],
    );
    for (const it of e.itens)
      if (!envioItens.some((r) => n(r['insumo_id']) === it.item))
        throw recusa('item-fora-do-envio', 'Há item recebido que não veio no envio.', { campos: ['itens'] });
  } else
    doc = await novoDocumento(tx, est, {
      tipo: 'transferencia',
      tipoMovimento: tipoSai,
      origem: e.origem,
      destino: e.destino,
      observacao: e.observacao ?? null,
    });
  let total = 0;
  let seq = envioItens.length;
  for (const it of e.itens) {
    const insumo = await insumoAtivo(tx, it.item);
    await exigirSaldo(tx, est, e.origem, insumo, it.quantidade);
    const lotes = await lotesDaSaida(tx, est, e.origem, insumo, it.quantidade, it.lotes, hoje);
    const doEnvio = envioItens.filter((r) => n(r['insumo_id']) === it.item);
    const item = doEnvio[0]
      ? n(doEnvio[0]['id'])
      : await itemDoDocumento(tx, doc.id, ++seq, insumo, it.quantidade);
    const sai = await movimentar(tx, est, {
      local: e.origem,
      insumo: it.item,
      quantidade: it.quantidade,
      natureza: 'saida',
      tipoMovimento: tipoSai,
      lotes,
      hoje,
      documento: doc.id,
      documentoItem: item,
      contrapartida: e.destino,
    });
    await movimentar(tx, est, {
      local: e.destino,
      insumo: it.item,
      quantidade: it.quantidade,
      natureza: 'entrada',
      tipoMovimento: tipoEntra,
      valorEntrada: sai.valor,
      lotes,
      hoje,
      documento: doc.id,
      documentoItem: item,
      contrapartida: e.origem,
    });
    total += sai.valor;
    if (doEnvio.length) {
      // O recebido vai às linhas do envio do item, na ordem (o que sobra delas fica sem atender).
      let resta = it.quantidade;
      for (const r of doEnvio) {
        const q = Math.min(resta, n(r['quantidade']));
        resta = qtd(resta - q);
        await tx.alterar('documento_estoque_item', n(r['id']), n(r['versao']), {
          quantidade_atendida: qtd(q),
        });
        r['versao'] = n(r['versao']) + 1;
      }
      const primeira = doEnvio[0]!;
      await tx.alterar('documento_estoque_item', n(primeira['id']), n(primeira['versao']), {
        movimento_estoque_id: sai.id,
        valor_total: sai.valor,
        custo_unitario:
          it.quantidade > 0 ? Math.round((sai.valor / it.quantidade) * 1_000_000) / 1_000_000 : 0,
      });
    } else await fecharItem(tx, item, sai, it.quantidade);
  }
  // Item do envio que não chegou: recebido zero (divergente).
  for (const r of envioItens)
    if (!e.itens.some((it) => it.item === n(r['insumo_id'])))
      await tx.alterar('documento_estoque_item', n(r['id']), n(r['versao']), { quantidade_atendida: 0 });
  await totalizarDocumento(tx, doc.id, total);
  const c = chaveLida(doc.numero, doc.em);
  return { id: doc.id, ano: c.ano, mes: c.mes, doc: c.doc, itens: e.itens.length, envio: e.envio ?? 0 };
}

/**
 * A entrada por nota fiscal: a nota (número de negócio), os itens com o custo (frete e outros rateados, desconto
 * abatido), os lotes, o movimento com o custo médio novo e o recebido do pedido. Fora da tolerância do pedido, só com
 * a aprovação do comprador e o motivo.
 */
async function registrarEntradaNF(
  tx: TxOperacao,
  est: number,
  e: RegistrarEntradaNFEntrada,
  hoje: string,
): Promise<Ids> {
  recusar(
    conferirCabecalhoNota(
      { fornecedor: e.fornecedor, numero: e.numero, serie: e.serie, emissao: e.emissao },
      hoje,
    )[0] ?? null,
  );
  await exigirMesAberto(tx, est, hoje);
  await localDoEstabelecimento(tx, est, e.local);
  recusar(conferirLocal(await escopoDaOperacao(tx, est), e.local, 'entrada'));
  const f = await tx.uma<Linha>(
    "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
    [e.fornecedor],
  );
  if (!f)
    throw recusa('fornecedor-inexistente', 'O fornecedor não está cadastrado ou não está ativo.', {
      campos: ['fornecedor'],
    });
  const repetida = await tx.uma(
    `SELECT id FROM nota_entrada WHERE empresa_fornecedora_id = ? AND numero_documento = ? AND serie <=> ?
        AND situacao <> 'cancelada' AND excluido_em IS NULL`,
    [e.fornecedor, String(e.numero), e.serie],
  );
  if (repetida)
    throw recusa('nota-repetida', 'Esta nota do fornecedor já foi lançada.', { campos: ['numero'] });
  const tipoEntrada = await tx.uma<Linha>(
    "SELECT id FROM tipo_entrada_estoque WHERE codigo = 'compra' AND ativo = TRUE",
  );
  if (!tipoEntrada)
    throw recusa(
      'tipo-entrada-nao-configurado',
      'O tipo de entrada "compra" não está no catálogo do estoque deste cliente.',
    );
  const tipoMov = await tipoMovimentoId(tx, TIPO_MOVIMENTO.entradaNota);
  let pedido: Linha | null = null;
  let itensPedido: Linha[] = [];
  if (e.pedido) {
    pedido = await pedidoTravado(tx, est, e.pedido.ano, e.pedido.doc);
    if (n(pedido['empresa_fornecedora_id']) !== e.fornecedor)
      throw recusa('pedido-de-outro-fornecedor', 'O pedido é de outro fornecedor.', { campos: ['pedido'] });
    itensPedido = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM pedido_compra_item WHERE pedido_compra_id = ? AND excluido_em IS NULL AND cancelado_em IS NULL ORDER BY sequencia',
      [n(pedido['id'])],
    );
  }
  const conf = conferirNota(
    e.itens.map((i) => ({
      item: i.item,
      quantidade: i.quantidade,
      valorUnitario: i.valorUnitario,
      fator: i.fator,
    })),
    pedido
      ? itensPedido.map((r) => ({
          item: n(r['insumo_id']),
          quantidade: n(r['quantidade']),
          comprada: n(r['quantidade_recebida']),
          valorUnitario: n(r['valor_unitario']),
          entrega: r['data_prevista_entrega'] ? dataIso(r['data_prevista_entrega']) : null,
        }))
      : null,
    e.tolerancias,
    hoje,
  );
  recusar(
    podeConsolidarNota(
      conf,
      e.aprovacaoComprador ? { aprovador: String(usuarioDe(tx)), motivo: e.aprovacaoComprador } : null,
    ),
  );
  const bruto = e.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
  const acrescimo = e.frete + e.outros - e.desconto;
  const numero = await tx.proximoNumero('nota_entrada');
  const agora = new Date();
  const nota = await tx.incluir('nota_entrada', {
    estabelecimento_id: est,
    numero: numero.valor,
    empresa_fornecedora_id: e.fornecedor,
    local_estoque_id: e.local,
    tipo_entrada_estoque_id: n(tipoEntrada['id']),
    pedido_compra_id: pedido ? n(pedido['id']) : null,
    numero_documento: String(e.numero),
    serie: e.serie,
    data_emissao: e.emissao,
    data_entrada: hoje,
    recebido_em: agora,
    recebido_por_usuario_id: usuarioDe(tx),
    valor_produtos: reais2(bruto),
    valor_desconto: e.desconto,
    valor_frete: e.frete,
    valor_outras_despesas: e.outros,
    valor_total: reais2(bruto + acrescimo),
    situacao: 'confirmada',
    confirmada_em: agora,
    confirmada_por_usuario_id: usuarioDe(tx),
    observacao: e.observacao ?? null,
  });
  for (const [k, it] of e.itens.entries()) {
    const insumo = await insumoAtivo(tx, it.item);
    const fator = it.fator > 0 ? it.fator : 1;
    const qEstoque = qtd(it.quantidade * fator);
    const valorItem = reais2(it.quantidade * it.valorUnitario);
    const custoTotal = reais2(valorItem + (bruto > 0 ? (acrescimo * valorItem) / bruto : 0));
    const lotes = await lotesDaEntrada(tx, est, insumo, qEstoque, it.lotes, hoje);
    const pi = itensPedido.find((r) => n(r['insumo_id']) === it.item);
    const ni = await tx.incluir('nota_entrada_item', {
      nota_entrada_id: nota,
      sequencia: k + 1,
      insumo_id: it.item,
      unidade_medida_id: n(insumo['estoque_unidade_medida_id']),
      fator_conversao: fator,
      quantidade: it.quantidade,
      quantidade_estoque: qEstoque,
      valor_unitario: it.valorUnitario,
      valor_total: valorItem,
      custo_unitario: qEstoque > 0 ? Math.round((custoTotal / qEstoque) * 1_000_000) / 1_000_000 : 0,
      lote_insumo_id: lotes.length === 1 ? lotes[0]!.id : null,
      pedido_compra_item_id: pi ? n(pi['id']) : null,
      marca: it.marca ?? null,
    });
    await movimentar(tx, est, {
      local: e.local,
      insumo: it.item,
      quantidade: qEstoque,
      natureza: 'entrada',
      tipoMovimento: tipoMov,
      valorEntrada: custoTotal,
      lotes,
      hoje,
      notaItem: ni,
      fornecedor: e.fornecedor,
      consignado: verdadeiro(insumo['consignado']),
    });
    if (pi) {
      await tx.alterar('pedido_compra_item', n(pi['id']), n(pi['versao']), {
        quantidade_recebida: qtd(n(pi['quantidade_recebida']) + it.quantidade),
      });
      pi['quantidade_recebida'] = qtd(n(pi['quantidade_recebida']) + it.quantidade);
      // F3.6 (05-SUP linha 20): a agenda de entregas do item abate da mais antiga para a mais nova.
      await baixarEntregasRecebidas(tx, n(pi['id']), it.quantidade);
    }
  }
  if (pedido) {
    const tudo = itensPedido.every(
      (r) => n(r['quantidade_recebida']) + n(r['quantidade_cancelada']) >= n(r['quantidade']),
    );
    await tx.alterar('pedido_compra', n(pedido['id']), n(pedido['versao']), {
      situacao: tudo ? 'recebido' : 'parcialmente_recebido',
      ...(pedido['aprovado_em'] ? {} : { aprovado_em: agora }),
    });
  }
  const c = chaveLida(numero.valor, hoje);
  return { id: nota, ano: c.ano, mes: c.mes, doc: c.doc, itens: e.itens.length };
}

/**
 * O pedido de compra (número no ano) com a cotação aos fornecedores convidados: um item da cotação por item e uma
 * proposta (a preencher) por fornecedor e item. O pedido nasce com o primeiro fornecedor e fica com o vencedor.
 */
async function criarPedido(tx: TxOperacao, est: number, e: CriarPedidoEntrada, hoje: string): Promise<Ids> {
  if (e.contrato)
    throw modeloPendente(
      'o vínculo do pedido de compra ao contrato do fornecedor (vinculo_contrato_fornecedor)',
    );
  recusar(conferirItensPedido(e.itens)[0] ?? null);
  await centroDoEstabelecimento(tx, est, e.centroCusto);
  if (!e.fornecedores.length)
    throw recusa(
      'sem-fornecedor',
      'Convide ao menos um fornecedor: o pedido de compra nasce com a cotação.',
      { campos: ['fornecedores'] },
    );
  for (const f of e.fornecedores)
    if (
      !(await tx.uma(
        "SELECT id FROM empresa_fornecedora WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
        [f],
      ))
    )
      throw recusa('fornecedor-inexistente', 'O fornecedor não está cadastrado.', {
        campos: ['fornecedores'],
      });
  const insumos = [];
  for (const it of e.itens) insumos.push(await insumoAtivo(tx, it.item));
  const ano = Number(hoje.slice(0, 4));
  const [ult] = await tx.consultarParaAtualizar<Linha>(
    'SELECT MAX(numero) AS n FROM pedido_compra WHERE estabelecimento_id = ? AND ano = ?',
    [est, ano],
  );
  const numero = n(ult?.['n']) + 1;
  const agora = new Date();
  const usuario = usuarioDe(tx);
  const cotacao = await tx.incluir('cotacao', {
    estabelecimento_id: est,
    numero: `PC-${ano}-${numero}`,
    tipo: e.tipoCompra === 'E' ? 'emergencial' : 'compra',
    comprador_usuario_id: usuario,
    aberta_em: agora,
    prazo_resposta_em: new Date(agora.getTime() + 7 * 86_400_000),
    situacao: 'aberta',
  });
  const pedido = await tx.incluir('pedido_compra', {
    estabelecimento_id: est,
    ano,
    numero,
    empresa_fornecedora_id: e.fornecedores[0],
    cotacao_id: cotacao,
    centro_custo_id: e.centroCusto,
    comprador_usuario_id: usuario,
    tipo_compra: e.tipoCompra === 'E' ? 'emergencial' : e.tipoCompra === 'P' ? 'programada' : 'outra',
    data_pedido: hoje,
    situacao: e.situacao === 1 ? 'rascunho' : 'em_cotacao',
  });
  const fornecedores = [];
  for (const [k, f] of e.fornecedores.entries())
    fornecedores.push(
      await tx.incluir('cotacao_fornecedor', {
        cotacao_id: cotacao,
        sequencia: k + 1,
        empresa_fornecedora_id: f,
      }),
    );
  for (const [k, it] of e.itens.entries()) {
    const unidade = n(insumos[k]!['estoque_unidade_medida_id']);
    await tx.incluir('pedido_compra_item', {
      pedido_compra_id: pedido,
      sequencia: k + 1,
      insumo_id: it.item,
      unidade_medida_id: unidade,
      quantidade: it.quantidade,
      valor_unitario: 0,
    });
    const ci = await tx.incluir('cotacao_item', {
      cotacao_id: cotacao,
      sequencia: k + 1,
      insumo_id: it.item,
      unidade_medida_id: unidade,
      quantidade: it.quantidade,
    });
    for (const cf of fornecedores)
      await tx.incluir('cotacao_resposta_item', {
        cotacao_fornecedor_id: cf,
        sequencia: k + 1,
        cotacao_item_id: ci,
        quantidade_ofertada: it.quantidade,
        valor_unitario: 0,
        valor_total: 0,
      });
  }
  return { id: pedido, ano, doc: numero, itens: e.itens.length, fornecedores: e.fornecedores.length };
}

/** As propostas da cotação do pedido, travadas. */
async function propostasDoPedido(tx: TxOperacao, pedido: Linha): Promise<PropostaLida[]> {
  const cot = numeroOuNulo(pedido['cotacao_id']);
  if (cot === null) throw recusa('pedido-sem-cotacao', 'O pedido não tem cotação.', { campos: ['pedido'] });
  await tx.consultarParaAtualizar('SELECT id FROM cotacao WHERE id = ?', [cot]);
  return (await tx.consultar<Linha>(SQL_PROPOSTAS, [cot])).map(propostaLida);
}

/** O preço (e a marca) da proposta do fornecedor no pedido. */
async function registrarProposta(tx: TxOperacao, est: number, e: RegistrarPropostaEntrada): Promise<Ids> {
  const pedido = await pedidoTravado(tx, est, e.pedido.ano, e.pedido.doc);
  if (!['rascunho', 'em_cotacao'].includes(String(pedido['situacao'])))
    throw recusa('pedido-fechado', 'O pedido não está mais em cotação.', { campos: ['pedido'] });
  const p = (await propostasDoPedido(tx, pedido)).find((x) => x.id === e.proposta);
  if (!p) throw recusa('proposta-inexistente', 'A proposta não é deste pedido.', { campos: ['proposta'] });
  const r = await tx.uma<Linha>(
    'SELECT versao, cotacao_fornecedor_id FROM cotacao_resposta_item WHERE id = ?',
    [p.id],
  );
  await tx.alterar('cotacao_resposta_item', p.id, n(r?.['versao']), {
    valor_unitario: e.valorUnitario,
    valor_total: reais2(p.quantidade * e.valorUnitario),
    ...(e.marca !== undefined ? { marca: e.marca || null } : {}),
  });
  const cf = await tx.uma<Linha>('SELECT id, versao FROM cotacao_fornecedor WHERE id = ?', [
    n(r?.['cotacao_fornecedor_id']),
  ]);
  if (cf)
    await tx.alterar('cotacao_fornecedor', n(cf['id']), n(cf['versao']), {
      situacao: 'respondida',
      respondido_em: new Date(),
    });
  return { id: p.id };
}

/** A escolha do vencedor do item na cotação (rateio entre mais de um), com justificativa fora da menor proposta. */
async function definirVencedorCotacao(tx: TxOperacao, est: number, e: DefinirVencedorEntrada): Promise<Ids> {
  const pedido = await pedidoTravado(tx, est, e.pedido.ano, e.pedido.doc);
  const propostas = (await propostasDoPedido(tx, pedido)).map(propostaCotacao);
  const plano = planejarVencedor(propostas, { item: e.item, seq: e.seq }, e.vencedoras);
  recusar(plano.recusas[0] ?? null);
  if (
    exigeJustificativa(propostas, e.item, e.seq, e.vencedoras) &&
    (e.justificativa ?? '').trim().length < 10
  )
    throw recusa('sem-justificativa', 'A escolhida não é a menor proposta: escreva a justificativa.', {
      campos: ['justificativa'],
    });
  for (const m of plano.marcas) {
    const r = await tx.uma<Linha>(
      'SELECT versao, quantidade_ofertada FROM cotacao_resposta_item WHERE id = ?',
      [m.id],
    );
    const vence = m.vencedor === 'T';
    await tx.alterar('cotacao_resposta_item', m.id, n(r?.['versao']), {
      vencedor: vence,
      quantidade_adjudicada: vence ? n(r?.['quantidade_ofertada']) : null,
      motivo_escolha: vence ? e.justificativa?.trim() || null : null,
    });
  }
  const ci = await tx.uma<Linha>(
    'SELECT id, versao FROM cotacao_item WHERE cotacao_id = ? AND sequencia = ? AND insumo_id = ? AND excluido_em IS NULL',
    [n(pedido['cotacao_id']), e.seq, e.item],
  );
  if (ci) await tx.alterar('cotacao_item', n(ci['id']), n(ci['versao']), { situacao: 'adjudicado' });
  // O item do pedido fica com o preço da vencedora (no rateio, o da primeira escolhida).
  const venc = propostas.find((p) => p.id === e.vencedoras[0]);
  const pi = await tx.uma<Linha>(
    'SELECT id, versao, quantidade FROM pedido_compra_item WHERE pedido_compra_id = ? AND sequencia = ? AND excluido_em IS NULL',
    [n(pedido['id']), e.seq],
  );
  if (pi && venc)
    await tx.alterar('pedido_compra_item', n(pi['id']), n(pi['versao']), {
      valor_unitario: venc.valorUnitario,
      valor_total: reais2(n(pi['quantidade']) * venc.valorUnitario),
      justificativa_escolha: e.justificativa?.trim() || null,
    });
  return { item: e.item, vencedoras: e.vencedoras.length, marcas: plano.marcas.length };
}

/** O movimento direto ao paciente ou ao centro de custo (sem requisição), pelo custo médio. */
async function registrarMovimentoDireto(
  tx: TxOperacao,
  est: number,
  e: MovimentoDiretoEntrada,
  hoje: string,
): Promise<Ids> {
  if (e.para === 'paciente' && !e.atendimento)
    throw recusa('sem-paciente', 'Informe o atendimento do paciente.', { campos: ['atendimento'] });
  const r = await registrarSaida(
    tx,
    est,
    {
      destino: e.para === 'paciente' ? 1 : 2,
      origem: 'E',
      local: e.local,
      centroCusto: e.centroCusto,
      localConsumo: 1,
      ...(e.para === 'paciente' && e.atendimento ? { atendimento: e.atendimento } : {}),
      itens: e.itens.map((i) => ({ item: i.item, quantidade: i.quantidade, lotes: [] })),
    },
    hoje,
  );
  // O alvo da trilha é o documento de estoque criado pela saída; o atendimento vai em campo próprio.
  return e.para === 'paciente' && e.atendimento ? { ...r, atendimento: e.atendimento } : r;
}

/**
 * O balanço do inventário aprovado: o acerto de entrada (sobra) e o de saída (falta), pelo custo médio, com o motivo
 * "inventario" do catálogo; o inventário fica ligado ao primeiro documento e não gera balanço duas vezes.
 */
async function registrarBalanco(
  tx: TxOperacao,
  est: number,
  e: RegistrarBalancoEntrada,
  hoje: string,
): Promise<Ids> {
  await exigirMesAberto(tx, est, hoje);
  const [inv] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao, situacao, local_estoque_id, limite_divergencia_pct, documento_estoque_id FROM inventario_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [e.inventario, est],
  );
  if (!inv || inv['situacao'] !== 'aprovado')
    throw recusa('inventario-nao-aprovado', 'O inventário não foi aprovado.');
  if (inv['documento_estoque_id'])
    throw recusa('balanco-gravado', 'O balanço deste inventário já foi gravado.');
  const local = n(inv['local_estoque_id']);
  recusar(conferirLocal(await escopoDaOperacao(tx, est), local, 'inventario'));
  const linhas = await tx.consultar<Linha>(
    `SELECT it.insumo_id, it.saldo_sistema, it.quantidade_contada, it.contagem_usuario_id
       FROM inventario_estoque_item it JOIN inventario_estoque_contagem ct ON ct.id = it.inventario_estoque_contagem_id
      WHERE it.inventario_estoque_id = ? AND it.excluido_em IS NULL ORDER BY it.insumo_id, ct.sequencia, it.id`,
    [e.inventario],
  );
  const aj = ajusteDoInventario(
    [...porInsumo(linhas)].map(([item, ls]) => itemContado(item, ls)),
    n(inv['limite_divergencia_pct']),
  );
  recusar(aj.recusa);
  const motivo = await tx.uma<Linha>(
    "SELECT id FROM motivo_ajuste_estoque WHERE codigo = 'inventario' AND ativo = TRUE",
  );
  if (!motivo)
    throw recusa(
      'motivo-nao-configurado',
      'O motivo de ajuste "inventario" não está no catálogo do estoque deste cliente.',
    );
  // A sobra de item com controle de lote só entra no lote contado; o item do inventário ainda não guarda o lote.
  for (const l of aj.linhas.filter((x) => x.diferenca > 0)) {
    const insumo = await insumoAtivo(tx, l.item);
    if (verdadeiro(insumo['controla_lote']))
      throw recusa(
        'sobra-sem-lote',
        `A sobra do item ${String(insumo['nome'])} controla lote: o acerto precisa do lote contado, que a contagem do inventário ainda não registra.`,
        { campos: ['inventario'] },
      );
  }
  const docs: { id: number; numero: number; em: Date }[] = [];
  for (const sinal of ['entrada', 'saida'] as const) {
    const doSinal = aj.linhas.filter((l) => (sinal === 'entrada' ? l.diferenca > 0 : l.diferenca < 0));
    if (!doSinal.length) continue;
    const tipoMov = await tipoMovimentoId(
      tx,
      sinal === 'entrada' ? TIPO_MOVIMENTO.acertoEntrada : TIPO_MOVIMENTO.acertoSaida,
    );
    const doc = await novoDocumento(tx, est, {
      tipo: sinal === 'entrada' ? 'acerto_entrada' : 'acerto_saida',
      tipoMovimento: tipoMov,
      origem: local,
      motivoAjuste: n(motivo['id']),
      observacao: `Balanço do inventário ${e.inventario}`,
    });
    docs.push(doc);
    let total = 0;
    for (const [k, l] of doSinal.entries()) {
      const insumo = await insumoAtivo(tx, l.item);
      const q = Math.abs(l.diferenca);
      if (sinal === 'saida') await exigirSaldo(tx, est, local, insumo, q);
      const lotes = sinal === 'saida' ? await lotesDaSaida(tx, est, local, insumo, q, [], hoje) : [];
      const item = await itemDoDocumento(tx, doc.id, k + 1, insumo, q);
      const mov = await movimentar(tx, est, {
        local,
        insumo: l.item,
        quantidade: q,
        natureza: sinal,
        tipoMovimento: tipoMov,
        lotes,
        hoje,
        documento: doc.id,
        documentoItem: item,
        motivoAjuste: n(motivo['id']),
      });
      await fecharItem(tx, item, mov, q);
      total += mov.valor;
    }
    await totalizarDocumento(tx, doc.id, total);
  }
  if (!docs.length) throw recusa('balanco-sem-diferenca', 'O inventário não tem diferença a acertar.');
  await tx.alterar('inventario_estoque', e.inventario, n(inv['versao']), {
    documento_estoque_id: docs[0]!.id,
  });
  const c = chaveLida(docs[0]!.numero, docs[0]!.em);
  return { ano: c.ano, mes: c.mes, doc: c.doc, inventario: e.inventario };
}

/** Os meses fechados do estoque do estabelecimento. */
async function mesesFechadosTx(tx: TxOperacao, est: number): Promise<{ ano: number; mes: number }[]> {
  return (
    await tx.consultarParaAtualizar<Linha>(
      'SELECT competencia, situacao FROM fechamento_estoque WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [est],
    )
  )
    .filter((r) => r['situacao'] === 'fechado')
    .map((r) => {
      const d = dataIso(r['competencia']);
      return { ano: Number(d.slice(0, 4)), mes: Number(d.slice(5, 7)) };
    });
}

/**
 * O custo médio do saldo no fim do mês fechado: sem movimento depois dele, o de hoje; senão o do último movimento até
 * o mês, o do fechamento anterior ou o custo de antes do primeiro movimento depois do mês (desfeito pelo que esse
 * movimento gravou: saldo e custo depois, quantidade e valor). Sem nenhum deles, só o saldo zerado fecha.
 */
async function custoNoFimDoMes(tx: TxOperacao, p: Linha, comp: string, final: number): Promise<number> {
  const tem = (v: unknown) => v !== null && v !== undefined;
  if (n(p['movs_depois']) === 0) return n(p['custo_medio']);
  if (tem(p['custo_ate'])) return n(p['custo_ate']);
  if (tem(p['custo_anterior'])) return n(p['custo_anterior']);
  const m = await tx.uma<Linha>(
    `SELECT m.natureza, m.quantidade_estoque, m.valor_total, m.saldo_apos, m.custo_medio_apos
       FROM movimento_estoque m JOIN saldo_estoque s ON s.local_estoque_id = m.local_estoque_id AND s.insumo_id = m.insumo_id
      WHERE s.id = ? AND m.excluido_em IS NULL AND m.competencia > ? ORDER BY m.ocorrido_em, m.id LIMIT 1`,
    [n(p['id']), comp],
  );
  if (m && tem(m['saldo_apos']) && tem(m['custo_medio_apos'])) {
    const apos = n(m['saldo_apos']);
    const q = n(m['quantidade_estoque']);
    const antes = qtd(m['natureza'] === 'entrada' ? apos - q : apos + q);
    const valorAntes =
      apos * n(m['custo_medio_apos']) + (m['natureza'] === 'entrada' ? -1 : 1) * n(m['valor_total']);
    if (antes > 0) return Math.max(0, Math.round((valorAntes / antes) * 10_000) / 10_000);
  }
  if (final === 0) return 0;
  throw recusa(
    'custo-do-mes-indisponivel',
    `O saldo ${String(p['id'])} não tem custo conhecido no fim do mês (sem movimento nem fechamento anterior).`,
  );
}

/**
 * O fechamento do mês (só o próximo da fila e só depois de terminado): o fechamento e a posição de cada saldo no fim
 * do mês (saldo de hoje menos o que entrou e mais o que saiu depois), com as entradas e as saídas do mês.
 */
async function fecharMes(tx: TxOperacao, est: number, e: FecharMesEntrada, hoje: string): Promise<Ids> {
  const corrente = { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
  const prox = proximoAFechar(await mesesFechadosTx(tx, est), corrente);
  if (prox.ano !== e.ano || prox.mes !== e.mes)
    throw recusa(
      'fora-de-ordem',
      `O próximo mês a fechar é ${String(prox.mes).padStart(2, '0')}/${prox.ano}.`,
    );
  if (e.ano * 100 + e.mes >= corrente.ano * 100 + corrente.mes)
    throw recusa('mes-corrente', 'O mês corrente só fecha depois de terminar.');
  const comp = competenciaDe(e.ano, e.mes);
  const agora = new Date();
  const usuario = usuarioDe(tx);
  const [f] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao FROM fechamento_estoque WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL',
    [est, comp],
  );
  const valores = { situacao: 'fechado', fechado_em: agora, fechamento_usuario_id: usuario };
  const fechamento = f
    ? (await tx.alterar('fechamento_estoque', n(f['id']), n(f['versao']), valores), n(f['id']))
    : await tx.incluir('fechamento_estoque', { estabelecimento_id: est, competencia: comp, ...valores });
  const posicoes = await tx.consultar<Linha>(
    `SELECT s.id, s.quantidade, s.custo_medio,
            (SELECT m2.custo_medio_apos FROM movimento_estoque m2
              WHERE m2.local_estoque_id = s.local_estoque_id AND m2.insumo_id = s.insumo_id AND m2.excluido_em IS NULL
                AND m2.competencia <= ? ORDER BY m2.ocorrido_em DESC, m2.id DESC LIMIT 1) AS custo_ate,
            (SELECT sm.custo_medio FROM saldo_estoque_mensal sm
              WHERE sm.saldo_estoque_id = s.id AND sm.competencia < ? ORDER BY sm.competencia DESC LIMIT 1) AS custo_anterior,
            COUNT(CASE WHEN m.competencia > ? THEN 1 END) AS movs_depois,
            COALESCE(SUM(CASE WHEN m.competencia > ? THEN (CASE WHEN m.natureza = 'entrada' THEN -m.quantidade_estoque ELSE m.quantidade_estoque END) END), 0) AS depois,
            COALESCE(SUM(CASE WHEN m.competencia = ? AND m.natureza = 'entrada' THEN m.quantidade_estoque END), 0) AS q_entrada,
            COALESCE(SUM(CASE WHEN m.competencia = ? AND m.natureza = 'entrada' THEN m.valor_total END), 0) AS v_entrada,
            COALESCE(SUM(CASE WHEN m.competencia = ? AND m.natureza = 'saida' THEN m.quantidade_estoque END), 0) AS q_saida,
            COALESCE(SUM(CASE WHEN m.competencia = ? AND m.natureza = 'saida' THEN m.valor_total END), 0) AS v_saida
       FROM saldo_estoque s
       LEFT JOIN movimento_estoque m ON m.local_estoque_id = s.local_estoque_id AND m.insumo_id = s.insumo_id
            AND m.excluido_em IS NULL AND m.competencia >= ?
      WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL
      GROUP BY s.id, s.quantidade, s.custo_medio, s.local_estoque_id, s.insumo_id`,
    [comp, comp, comp, comp, comp, comp, comp, comp, comp, est],
  );
  for (const p of posicoes) {
    const final = qtd(n(p['quantidade']) + n(p['depois']));
    const custoMes = await custoNoFimDoMes(tx, p, comp, final);
    const valorFinal = reais2(final * custoMes);
    const [m] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao FROM saldo_estoque_mensal WHERE saldo_estoque_id = ? AND competencia = ?',
      [n(p['id']), comp],
    );
    const v = {
      quantidade_inicial: qtd(final - n(p['q_entrada']) + n(p['q_saida'])),
      quantidade_entrada: qtd(n(p['q_entrada'])),
      valor_entrada: reais2(n(p['v_entrada'])),
      quantidade_final: final,
      valor_final: valorFinal,
      custo_medio: custoMes,
      fechado: true,
      fechamento_estoque_id: fechamento,
      dados: JSON.stringify({ quantidadeSaida: qtd(n(p['q_saida'])), valorSaida: reais2(n(p['v_saida'])) }),
      ocorrido_em: agora,
      usuario_id: usuario,
    };
    if (m)
      await tx.alterar('saldo_estoque_mensal', n(m['id']), n(m['versao']), { ...v, operacao: 'alteracao' });
    else await tx.incluir('saldo_estoque_mensal', { saldo_estoque_id: n(p['id']), competencia: comp, ...v });
  }
  return { ano: e.ano, mes: e.mes };
}

/** A reabertura do último mês fechado (quem desbloqueia o fechamento, com o motivo). */
async function reabrirMes(tx: TxOperacao, est: number, e: ReabrirMesEntrada): Promise<Ids> {
  const escopo = await escopoDaOperacao(tx, est);
  recusar(
    conferirReabertura(e, await mesesFechadosTx(tx, est), {
      podeReabrir: escopo.flags.desbloquearFechamento,
      motivo: e.motivo,
    }),
  );
  const comp = competenciaDe(e.ano, e.mes);
  const [f] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao FROM fechamento_estoque WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL',
    [est, comp],
  );
  if (!f) throw recusa('mes-aberto', 'O mês não está fechado.');
  await tx.alterar('fechamento_estoque', n(f['id']), n(f['versao']), {
    situacao: 'reaberto',
    reaberto_em: new Date(),
    reabertura_usuario_id: usuarioDe(tx),
    motivo_reabertura: e.motivo,
  });
  for (const m of await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao FROM saldo_estoque_mensal WHERE fechamento_estoque_id = ? AND fechado = TRUE',
    [n(f['id'])],
  ))
    await tx.alterar('saldo_estoque_mensal', n(m['id']), n(m['versao']), {
      fechado: false,
      operacao: 'alteracao',
    });
  return { ano: e.ano, mes: e.mes };
}

/** A reposição do carrinho pela saída que o abasteceu: o item volta à quantidade padrão, com o movimento do kit. */
async function reporKitRastreavel(tx: TxOperacao, est: number, e: ReporKitEntrada): Promise<Ids> {
  const [kit] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id FROM kit_rastreavel WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [e.kit, est],
  );
  if (!kit) throw recusa('kit-inexistente', 'O carrinho não existe.');
  const saida = await documentoPorId(tx, est, e.saida, TIPOS_SAIDA);
  const agora = new Date();
  for (const i of e.itens) {
    const [it] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, insumo_id, quantidade_padrao FROM kit_rastreavel_item WHERE id = ? AND kit_rastreavel_id = ? AND excluido_em IS NULL',
      [i.itemKit, e.kit],
    );
    if (!it) throw recusa('item-de-outro-kit', 'Há item que não é deste carrinho.');
    const di = await tx.uma<Linha>(
      'SELECT id, insumo_id, movimento_estoque_id FROM documento_estoque_item WHERE id = ? AND documento_estoque_id = ? AND excluido_em IS NULL',
      [i.lancamentoSaida, n(saida['id'])],
    );
    if (!di || n(di['insumo_id']) !== n(it['insumo_id']))
      throw recusa('item-fora-da-saida', 'A reposição não é do item que saiu.', { campos: ['itens'] });
    await tx.alterar('kit_rastreavel_item', n(it['id']), n(it['versao']), {
      saldo_atual: n(it['quantidade_padrao']),
    });
    await tx.incluir('movimento_kit_rastreavel', {
      kit_rastreavel_id: e.kit,
      ocorrido_em: agora,
      usuario_id: usuarioDe(tx),
      tipo_movimento: 'reposicao',
      kit_rastreavel_item_id: n(it['id']),
      quantidade: n(it['quantidade_padrao']),
      movimento_estoque_id: numeroOuNulo(di['movimento_estoque_id']),
      documento_estoque_id: n(saida['id']),
    });
  }
  return { kit: e.kit, itens: e.itens.length };
}

/** A desconsolidação da nota (a saída se desfaz pela devolução): o estoque que entrou sai de novo, com o motivo na trilha. */
async function desconsolidarDocumento(
  tx: TxOperacao,
  est: number,
  e: DesconsolidarEntrada,
  hoje: string,
): Promise<Ids> {
  if (e.tipo !== 'nota')
    throw recusa('so-nota', 'Só a nota fiscal é desconsolidada aqui: para saída, use a devolução.');
  await exigirMesAberto(tx, est, hoje);
  const [nota] = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, situacao, local_estoque_id, empresa_fornecedora_id FROM nota_entrada
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [e.documento, est],
  );
  if (!nota) throw recusa('documento-inexistente', 'O documento não existe.');
  if (nota['situacao'] !== 'confirmada') throw recusa('nao-consolidado', 'O documento não está consolidado.');
  const movs = await tx.consultar<Linha>(
    `SELECT m.id, m.insumo_id, m.quantidade_estoque, m.tipo_movimento_estoque_id, m.valor_total FROM movimento_estoque m
       JOIN nota_entrada_item ni ON ni.id = m.nota_entrada_item_id AND ni.nota_entrada_id = ?
      WHERE m.natureza = 'entrada' AND m.excluido_em IS NULL AND m.estorno_movimento_estoque_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM movimento_estoque x
                         WHERE x.estorno_movimento_estoque_id = m.id AND x.excluido_em IS NULL)`,
    [n(nota['id'])],
  );
  for (const m of movs) {
    const lotes = (
      await tx.consultar<Linha>(
        'SELECT lote_insumo_id, quantidade FROM movimento_lote WHERE movimento_estoque_id = ? AND excluido_em IS NULL',
        [n(m['id'])],
      )
    ).map((r) => ({ id: n(r['lote_insumo_id']), quantidade: n(r['quantidade']) }));
    await movimentar(tx, est, {
      local: n(nota['local_estoque_id']),
      insumo: n(m['insumo_id']),
      quantidade: n(m['quantidade_estoque']),
      natureza: 'saida',
      tipoMovimento: n(m['tipo_movimento_estoque_id']),
      // Sai o valor que a nota pôs no estoque, e o custo médio do que fica é recalculado.
      valorSaida: n(m['valor_total']),
      lotes,
      hoje,
      fornecedor: n(nota['empresa_fornecedora_id']),
      estorno: n(m['id']),
    });
  }
  // O pedido de compra volta a esperar o que a nota tinha recebido (na unidade de compra, como a nota somou).
  const recebidos = await tx.consultar<Linha>(
    `SELECT ni.pedido_compra_item_id, SUM(ni.quantidade) AS quantidade FROM nota_entrada_item ni
      WHERE ni.nota_entrada_id = ? AND ni.pedido_compra_item_id IS NOT NULL AND ni.excluido_em IS NULL
      GROUP BY ni.pedido_compra_item_id`,
    [n(nota['id'])],
  );
  const pedidos = new Set<number>();
  for (const r of recebidos) {
    const [pi] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, pedido_compra_id, quantidade_recebida FROM pedido_compra_item WHERE id = ? AND excluido_em IS NULL',
      [n(r['pedido_compra_item_id'])],
    );
    if (!pi) continue;
    await tx.alterar('pedido_compra_item', n(pi['id']), n(pi['versao']), {
      quantidade_recebida: qtd(Math.max(0, n(pi['quantidade_recebida']) - n(r['quantidade']))),
    });
    pedidos.add(n(pi['pedido_compra_id']));
  }
  for (const id of pedidos) {
    const [pc] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, situacao, enviado_fornecedor_em FROM pedido_compra WHERE id = ? AND excluido_em IS NULL',
      [id],
    );
    if (!pc || (pc['situacao'] !== 'recebido' && pc['situacao'] !== 'parcialmente_recebido')) continue;
    const itens = await tx.consultar<Linha>(
      'SELECT quantidade_recebida FROM pedido_compra_item WHERE pedido_compra_id = ? AND excluido_em IS NULL',
      [id],
    );
    const algum = itens.some((x) => n(x['quantidade_recebida']) > 0);
    await tx.alterar('pedido_compra', id, n(pc['versao']), {
      situacao: algum ? 'parcialmente_recebido' : pc['enviado_fornecedor_em'] ? 'enviado' : 'aprovado',
    });
  }
  await tx.alterar('nota_entrada', n(nota['id']), n(nota['versao']), { situacao: 'conferencia' });
  return { id: n(nota['id']) };
}

/** O saneamento da validade digitada errada: a validade nova, com a original guardada no lote. */
async function corrigirValidadeLote(
  tx: TxOperacao,
  est: number,
  e: CorrigirValidadeEntrada,
  hoje: string,
): Promise<Ids> {
  const [l] = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao, insumo_id, numero_lote, validade, validade_original FROM lote_insumo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [e.lote, est],
  );
  if (!l) throw recusa('lote-inexistente', 'O lote não existe.');
  const atual = dataIso(l['validade']);
  recusar(conferirCorrecaoValidade(atual, e.validade));
  if (
    await tx.uma(
      'SELECT id FROM lote_insumo WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND validade = ? AND id <> ? AND excluido_em IS NULL',
      [est, n(l['insumo_id']), String(l['numero_lote']), e.validade, e.lote],
    )
  )
    throw recusa('lote-repetido', 'Já existe o mesmo lote com esta validade: una os saldos antes.', {
      campos: ['validade'],
    });
  await tx.alterar('lote_insumo', e.lote, n(l['versao']), {
    validade: e.validade,
    validade_original: l['validade_original'] ?? atual,
  });
  return { id: e.lote, ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
}

/** As operações do executor no estoque (o nome da tela e o manipulador). */
const OPERACOES: Readonly<Record<string, Manipulador>> = {
  'suprimentos.registrarSaida': registrarSaida as Manipulador,
  'suprimentos.registrarDevolucao': registrarDevolucao as Manipulador,
  'suprimentos.requisitarMaterial': requisitarMaterial as Manipulador,
  'suprimentos.transferir': transferir as Manipulador,
  'suprimentos.registrarEntradaNF': registrarEntradaNF as Manipulador,
  'suprimentos.criarPedido': criarPedido as Manipulador,
  'suprimentos.registrarProposta': registrarProposta as Manipulador,
  'suprimentos.definirVencedorCotacao': definirVencedorCotacao as Manipulador,
  'suprimentos.registrarMovimentoDireto': registrarMovimentoDireto as Manipulador,
  'suprimentos.registrarBalanco': registrarBalanco as Manipulador,
  'suprimentos.fecharMes': fecharMes as Manipulador,
  'suprimentos.reabrirMes': reabrirMes as Manipulador,
  'suprimentos.reporKitRastreavel': reporKitRastreavel as Manipulador,
  'suprimentos.desconsolidarDocumento': desconsolidarDocumento as Manipulador,
  'suprimentos.corrigirValidadeLote': corrigirValidadeLote as Manipulador,
  [OPERACAO_KIT_PADRAO]: gravarKitPadrao as Manipulador,
  // F3.6 (05-SUP linha 20): a gestão do pedido emitido.
  [OPERACAO_PROGRAMAR_ENTREGAS]: programarEntregasPedido as Manipulador,
  [OPERACAO_ACOMPANHAR_PEDIDO]: acompanharPedido as Manipulador,
  [OPERACAO_CANCELAR_COMPRA]: cancelarCompra as Manipulador,
  [OPERACAO_MOTIVO_CANCELAMENTO]: gravarMotivoCancelamentoCompra as Manipulador,
  [OPERACAO_RECALCULO_SALDO]: recalcularSaldos as Manipulador,
};

/** As tabelas que as operações do estoque gravam. */
export const TABELAS_OPERACOES_SUPRIMENTOS = [
  'documento_estoque',
  'documento_estoque_item',
  'movimento_estoque',
  'movimento_lote',
  'saldo_estoque',
  'saldo_lote',
  'lote_insumo',
  'requisicao_material',
  'requisicao_material_item',
  'nota_entrada',
  'nota_entrada_item',
  'pedido_compra',
  'pedido_compra_item',
  'cotacao',
  'cotacao_fornecedor',
  'cotacao_item',
  'cotacao_resposta_item',
  'inventario_estoque',
  'fechamento_estoque',
  'saldo_estoque_mensal',
  'kit_rastreavel_item',
  'movimento_kit_rastreavel',
  'consumo_opme',
  'solicitacao_opme',
  'solicitacao_opme_item',
  'ordem_manipulacao',
  'ordem_manipulacao_insumo',
  // Motor estoque → conta: a saída ao paciente lança o item na conta; a devolução o estorna.
  ...TABELAS_CONTA_ESTOQUE.filter((t) => t !== 'movimento_estoque'),
  // F3.6 (05-SUP linha 13): o cadastro do kit padrão.
  ...TABELAS_KIT_PADRAO,
  // F3.6 (05-SUP linha 20): entregas programadas, acompanhamento e motivo de cancelamento do pedido.
  ...TABELAS_GESTAO_PEDIDO,
  // F3.6 (05-SUP linha 16): o recálculo auditado do saldo.
  ...TABELAS_RECALCULO_SALDO,
] as const;

/** O nome da operação no núcleo (minúsculas com sublinhado: suprimentos.registrar_saida). */
const nomeNoNucleo = (op: string): string => op.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

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

  /** A definição da operação no núcleo (o esquema da tela, as tabelas e o manipulador sobre o estabelecimento). */
  private definicao(op: string, est: number) {
    const o = operacaoSuprimentos(op);
    const manipulador = OPERACOES[op];
    if (!manipulador) throw recusa('operacao-desconhecida', 'Operação desconhecida no estoque.');
    return definirOperacao({
      nome: nomeNoNucleo(o.nome),
      tabelas: TABELAS_OPERACOES_SUPRIMENTOS,
      entrada: o.entrada,
      async gravar(tx, entrada) {
        return (await manipulador(
          tx,
          est,
          entrada as never,
          await hojeNoEstabelecimento(tx, est),
        )) as ResultadoOperacao;
      },
      alvo: (_e, r) => ({
        tabela:
          op === OPERACAO_MOTIVO_CANCELAMENTO
            ? 'motivo_cancelamento_compra'
            : op === OPERACAO_CANCELAR_COMPRA
              ? 'pedido_compra'
              : op === OPERACAO_KIT_PADRAO
                ? 'kit_material'
                : op === OPERACAO_RECALCULO_SALDO
                  ? 'recalculo_saldo_estoque'
                  : op.endsWith('Pedido') || op.endsWith('Cotacao') || op.endsWith('Proposta')
                    ? 'pedido_compra'
                    : 'documento_estoque',
        id: typeof r['id'] === 'number' && r['id'] > 0 ? r['id'] : null,
      }),
      eventos: (_e, r) => [{ tipo: nomeNoNucleo(o.nome), carga: { id: r['id'] ?? null } }],
    });
  }

  async podeGravar(c: ContextoSuprimentos, op: string): Promise<LiberacaoGravacao> {
    if (!Object.hasOwn(ENTRADAS_SUPRIMENTOS, op) || !OPERACOES[op])
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida no estoque.' };
    const est = c.estabelecimento;
    if (est === null)
      return { pode: false, codigo: 'sem-estabelecimento', motivo: 'Escolha o estabelecimento da sessão.' };
    return this.executor.liberacao(this.definicao(op, est), {
      ...contextoNucleo(c, 'suprimentos-liberacao'),
      chaveIdempotencia: 'liberacao-consulta',
    });
  }

  async executar(c: ContextoSuprimentos, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    const r = await this.executor.executar(this.definicao(op, est), c.cliente, entrada, {
      ...contextoNucleo(c, 'suprimentos'),
      ...(ctx.reautenticadoEm !== undefined ? { reautenticadoEm: ctx.reautenticadoEm } : {}),
      chaveIdempotencia: ctx.chaveIdempotencia,
    });
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
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

  /** A busca do item no cadastro (nome ou código), até 50; o ativo primeiro. */
  buscarItens(c: ContextoSuprimentos, termo: string) {
    return this.ler(c, async (l): Promise<ItemBusca[]> => {
      const t = termo.trim();
      if (!t) return [];
      const porId = /^\d+$/.test(t) ? Number(t) : 0;
      return (
        await l.consultar<Linha>(
          `SELECT i.id, i.nome, um.sigla, i.controla_lote, i.controlado, i.antimicrobiano, i.consignado, i.situacao
             FROM insumo i
             JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id
            WHERE i.excluido_em IS NULL AND (i.nome LIKE ? OR i.codigo = ? OR i.id = ?)
            ORDER BY i.situacao = 'ativo' DESC, i.nome, i.id
            LIMIT 50`,
          [parecido(t), t, porId],
        )
      ).map((r) => ({
        codigo: n(r['id']),
        nome: String(r['nome']),
        unidade: texto(r['sigla']),
        rastreavel: verdadeiro(r['controla_lote']),
        controlado: verdadeiro(r['controlado']),
        antimicrobiano: verdadeiro(r['antimicrobiano']),
        consignado: verdadeiro(r['consignado']),
        ativo: r['situacao'] === 'ativo',
      }));
    });
  }

  /** A ficha do item: grupo e subgrupo (a classe), as unidades e os fatores de conversão. */
  fichaItem(c: ContextoSuprimentos, item: number) {
    return this.ler(c, async (l): Promise<FichaItem | null> => {
      const r = await l.uma<Linha>(
        `SELECT i.id, g.id AS grupo_id, g.descricao AS grupo_nome, sg.id AS sub_id, sg.descricao AS sub_nome,
                ue.sigla AS u_estoque, uc.sigla AS u_compra, uco.sigla AS u_consumo, up.sigla AS u_prescricao,
                i.fator_compra_estoque, i.fator_estoque_consumo, i.fator_consumo_prescricao
           FROM insumo i
           JOIN grupo_insumo g ON g.id = i.grupo_insumo_id
           LEFT JOIN subgrupo_insumo sg ON sg.id = i.subgrupo_insumo_id
           JOIN unidade_medida ue ON ue.id = i.estoque_unidade_medida_id
           LEFT JOIN unidade_medida uc ON uc.id = i.compra_unidade_medida_id
           LEFT JOIN unidade_medida uco ON uco.id = i.consumo_unidade_medida_id
           LEFT JOIN unidade_medida up ON up.id = i.prescricao_unidade_medida_id
          WHERE i.id = ? AND i.excluido_em IS NULL`,
        [item],
      );
      if (!r) return null;
      const estoque = texto(r['u_estoque']);
      return {
        item: n(r['id']),
        classe:
          r['sub_id'] === null || r['sub_id'] === undefined
            ? null
            : { codigo: n(r['sub_id']), nome: texto(r['sub_nome']) },
        grupo: { codigo: n(r['grupo_id']), nome: texto(r['grupo_nome']) },
        unidades: {
          compra: texto(r['u_compra']) || estoque,
          armazenamento: estoque,
          consumo: texto(r['u_consumo']) || estoque,
          prescricao: texto(r['u_prescricao']) || texto(r['u_consumo']) || estoque,
        },
        fatores: {
          compraConsumo: qtd(n(r['fator_compra_estoque']) * n(r['fator_estoque_consumo'])),
          consumoPrescricao: numeroOuNulo(r['fator_consumo_prescricao']),
        },
      };
    });
  }

  /** A posição do item: o saldo final dos últimos 12 meses (saldo_estoque_mensal) e o saldo atual por local. */
  posicaoMensal(c: ContextoSuprimentos, item: number, hoje: string) {
    return this.ler(c, async (l, est): Promise<PosicaoMensal> => {
      const cad = await l.uma<Linha>('SELECT id, nome FROM insumo WHERE id = ? AND excluido_em IS NULL', [
        item,
      ]);
      if (!cad) throw recusa('item-inexistente', 'O item não existe no cadastro.');
      const inicio = competenciaDe(Number(hoje.slice(0, 4)) - 1, Number(hoje.slice(5, 7)));
      const meses = await l.consultar<Linha>(
        `SELECT sm.competencia, SUM(sm.quantidade_final) AS q, SUM(sm.valor_final) AS v
           FROM saldo_estoque_mensal sm
           JOIN saldo_estoque s ON s.id = sm.saldo_estoque_id AND s.estabelecimento_id = ? AND s.excluido_em IS NULL
          WHERE s.insumo_id = ? AND sm.competencia >= ?
          GROUP BY sm.competencia ORDER BY sm.competencia`,
        [est, item, inicio],
      );
      const locais = await l.consultar<Linha>(
        `SELECT s.local_estoque_id, le.nome, s.quantidade, s.custo_medio FROM saldo_estoque s
           JOIN local_estoque le ON le.id = s.local_estoque_id
          WHERE s.estabelecimento_id = ? AND s.insumo_id = ? AND s.excluido_em IS NULL
          ORDER BY le.nome, le.id`,
        [est, item],
      );
      return {
        item: n(cad['id']),
        nome: String(cad['nome']),
        meses: meses.map((r) => {
          const d = dataIso(r['competencia']);
          return {
            ano: Number(d.slice(0, 4)),
            mes: Number(d.slice(5, 7)),
            quantidade: n(r['q']),
            valor: reais2(n(r['v'])),
          };
        }),
        porLocal: locais.map((r) => ({
          local: n(r['local_estoque_id']),
          localNome: String(r['nome']),
          quantidade: n(r['quantidade']),
          valor: reais2(n(r['quantidade']) * n(r['custo_medio'])),
        })),
      };
    });
  }

  /** Os documentos do período por tipo (50 por página), do estabelecimento da sessão. */
  documentos(
    c: ContextoSuprimentos,
    f: { tipo: TipoDocumentoEstoque; local?: number; inicio: string; fim: string; pagina?: number },
  ) {
    return this.ler(c, async (l, est) => {
      const pagina = Math.max(1, f.pagina ?? 1);
      const linhas = await consultarDocumentos(l, est, f.tipo, {
        ...(f.local ? { local: f.local } : {}),
        inicio: f.inicio,
        fim: f.fim,
        limite: POR_PAGINA + 1,
        desloca: (pagina - 1) * POR_PAGINA,
      });
      return { itens: linhas.slice(0, POR_PAGINA), cortada: linhas.length > POR_PAGINA };
    });
  }

  /** O documento pela chave de negócio (número no estabelecimento e mês do movimento), com os itens e os lotes. */
  documento(c: ContextoSuprimentos, tipo: TipoDocumentoEstoque, chave: Chave) {
    return this.ler(c, async (l, est): Promise<DocumentoDetalhe | null> => {
      const [cab] = await consultarDocumentos(l, est, tipo, { chave, limite: 1, desloca: 0 });
      if (!cab) return null;
      let itens: Linha[];
      if (tipo === 'nota')
        itens = await l.consultar<Linha>(
          `SELECT ni.id, ni.sequencia, ni.insumo_id, i.nome, ni.quantidade_estoque AS quantidade, ni.valor_total,
                  m.id AS movimento_id, ni.quantidade_devolvida AS devolvido
             FROM nota_entrada_item ni
             JOIN insumo i ON i.id = ni.insumo_id
             LEFT JOIN movimento_estoque m ON m.nota_entrada_item_id = ni.id AND m.excluido_em IS NULL AND m.natureza = 'entrada'
            WHERE ni.nota_entrada_id = ? AND ni.excluido_em IS NULL ORDER BY ni.sequencia`,
          [cab.id],
        );
      else if (tipo === 'requisicao')
        itens = await l.consultar<Linha>(
          `SELECT ri.id, ri.sequencia, ri.insumo_id, i.nome, ri.quantidade_solicitada AS quantidade, 0 AS valor_total,
                  NULL AS movimento_id, 0 AS devolvido
             FROM requisicao_material_item ri JOIN insumo i ON i.id = ri.insumo_id
            WHERE ri.requisicao_material_id = ? AND ri.excluido_em IS NULL ORDER BY ri.sequencia`,
          [cab.id],
        );
      else
        itens = await l.consultar<Linha>(
          `SELECT di.id, di.sequencia, di.insumo_id, i.nome, di.quantidade, di.valor_total, di.movimento_estoque_id AS movimento_id,
                  (SELECT COALESCE(SUM(dv.quantidade), 0) FROM movimento_estoque dv
                    WHERE dv.estorno_movimento_estoque_id = di.movimento_estoque_id AND dv.excluido_em IS NULL) AS devolvido
             FROM documento_estoque_item di JOIN insumo i ON i.id = di.insumo_id
            WHERE di.documento_estoque_id = ? AND di.excluido_em IS NULL ORDER BY di.sequencia`,
          [cab.id],
        );
      const movimentos = itens.map((r) => n(r['movimento_id'])).filter((x) => x > 0);
      const lotes = new Map<number, DocumentoDetalhe['itensDetalhe'][number]['lotes']>();
      if (movimentos.length)
        for (const r of await l.consultar<Linha>(
          `SELECT ml.movimento_estoque_id, li.id, li.numero_lote, li.validade, ml.quantidade
             FROM movimento_lote ml JOIN lote_insumo li ON li.id = ml.lote_insumo_id
            WHERE ml.movimento_estoque_id IN (${lista(movimentos.length)}) AND ml.excluido_em IS NULL
            ORDER BY ml.sequencia`,
          movimentos,
        )) {
          const k = n(r['movimento_estoque_id']);
          lotes.set(k, [
            ...(lotes.get(k) ?? []),
            {
              id: n(r['id']),
              lote: String(r['numero_lote']),
              validade: dataIso(r['validade']),
              quantidade: n(r['quantidade']),
            },
          ]);
        }
      return {
        ...cab,
        observacao: cab.observacao,
        itensDetalhe: itens.map((r) => ({
          id: n(r['id']),
          seq: n(r['sequencia']),
          item: n(r['insumo_id']),
          nome: String(r['nome']),
          quantidade: n(r['quantidade']),
          valor: reais2(n(r['valor_total'])),
          consolidado: cab.consolidado,
          lotes: lotes.get(n(r['movimento_id'])) ?? [],
          devolvido: n(r['devolvido']),
        })),
        // A desconsolidação e o estorno ficam na trilha de auditoria (motivo e autor), não no documento.
        ocorrencias: [],
      };
    });
  }

  /** As requisições a atender (solicitadas ou autorizadas, sem atendimento completo), com o saldo do local. */
  requisicoes(c: ContextoSuprimentos, o: { local?: number; hoje: string }) {
    return this.ler(c, async (l, est) => {
      const cab = await l.consultar<Linha>(
        `SELECT d.id, d.numero, d.solicitado_em, d.atendente_local_estoque_id, le.nome AS local_nome, d.tipo,
                d.centro_custo_id, cc.nome AS centro_nome, u.login, d.atendimento_id, ${NOME_PACIENTE} AS paciente_nome,
                ua.login AS autorizou, d.autorizado_em
           FROM requisicao_material d
           JOIN local_estoque le ON le.id = d.atendente_local_estoque_id
           LEFT JOIN centro_custo cc ON cc.id = d.centro_custo_id
           LEFT JOIN usuario u ON u.id = d.solicitante_usuario_id
           LEFT JOIN usuario ua ON ua.id = d.autorizador_usuario_id
           ${SQL_PACIENTE}
          WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL
            AND d.situacao IN ('solicitada', 'autorizada', 'em_separacao', 'atendida_parcial')
            ${o.local ? 'AND d.atendente_local_estoque_id = ?' : ''}
          ORDER BY d.urgente DESC, d.solicitado_em, d.id
          LIMIT ${LIMITE_LISTA + 1}`,
        o.local ? [est, o.local] : [est],
      );
      const usadas = cab.slice(0, LIMITE_LISTA);
      const ids = usadas.map((r) => n(r['id']));
      const porReq = new Map<number, Linha[]>();
      if (ids.length)
        for (const r of await l.consultar<Linha>(
          `SELECT ri.requisicao_material_id, ri.sequencia, ri.insumo_id, i.nome, i.controla_lote,
                  ri.quantidade_solicitada - ri.quantidade_atendida - ri.quantidade_cancelada AS falta,
                  COALESCE(s.quantidade, 0) AS saldo
             FROM requisicao_material_item ri
             JOIN requisicao_material rm ON rm.id = ri.requisicao_material_id
             JOIN insumo i ON i.id = ri.insumo_id
             LEFT JOIN saldo_estoque s ON s.insumo_id = ri.insumo_id AND s.local_estoque_id = rm.atendente_local_estoque_id
                  AND s.excluido_em IS NULL
            WHERE ri.requisicao_material_id IN (${lista(ids.length)}) AND ri.excluido_em IS NULL
              AND ri.situacao IN ('pendente', 'atendido_parcial')
            ORDER BY ri.sequencia`,
          ids,
        )) {
          const k = n(r['requisicao_material_id']);
          porReq.set(k, [...(porReq.get(k) ?? []), r]);
        }
      const itens: RequisicaoPendente[] = usadas.map((r) => ({
        chave: chaveLida(r['numero'], r['solicitado_em']),
        id: n(r['id']),
        data: dataIso(r['solicitado_em']),
        hora: hora(r['solicitado_em']),
        local: n(r['atendente_local_estoque_id']),
        localNome: String(r['local_nome']),
        destino: r['tipo'] === 'paciente' ? 1 : 2,
        centroCusto: n(r['centro_custo_id']),
        centroCustoNome: texto(r['centro_nome']),
        usuario: texto(r['login']),
        paciente: pacienteLido(r),
        itens: (porReq.get(n(r['id'])) ?? []).map((x) => ({
          seq: n(x['sequencia']),
          item: n(x['insumo_id']),
          nome: String(x['nome']),
          quantidade: n(x['falta']),
          saldoLocal: n(x['saldo']),
          rastreavel: verdadeiro(x['controla_lote']),
        })),
        autorizacao: r['autorizado_em']
          ? { por: texto(r['autorizou']), em: instante(r['autorizado_em']) }
          : null,
      }));
      return { itens, cortada: cab.length > LIMITE_LISTA };
    });
  }

  /** O rastreio do lote: o saldo por local e os movimentos (entrada, saída, devolução, transferência, balanço). */
  rastreio(c: ContextoSuprimentos, item: number, lote: string) {
    return this.ler(c, async (l, est): Promise<RastreioLote> => {
      const cad = await l.uma<Linha>('SELECT id, nome FROM insumo WHERE id = ? AND excluido_em IS NULL', [
        item,
      ]);
      if (!cad) throw recusa('item-inexistente', 'O item não existe no cadastro.');
      const lotes = await l.consultar<Linha>(
        `SELECT id, validade FROM lote_insumo
          WHERE estabelecimento_id = ? AND insumo_id = ? AND numero_lote = ? AND excluido_em IS NULL ORDER BY validade`,
        [est, item, lote.trim()],
      );
      const ids = lotes.map((r) => n(r['id']));
      const base = { item, nome: String(cad['nome']), lote: lote.trim() };
      if (!ids.length)
        return { ...base, validade: null, saldos: [], movimentos: [], pacientes: 0, cortada: false };
      const saldos = await l.consultar<Linha>(
        `SELECT sl.local_estoque_id, le.nome, SUM(sl.quantidade) AS q FROM saldo_lote sl
           JOIN local_estoque le ON le.id = sl.local_estoque_id
          WHERE sl.estabelecimento_id = ? AND sl.lote_insumo_id IN (${lista(ids.length)}) AND sl.excluido_em IS NULL
          GROUP BY sl.local_estoque_id, le.nome ORDER BY le.nome`,
        [est, ...ids],
      );
      const movs = await l.consultar<Linha>(
        `SELECT m.natureza, m.ocorrido_em, ml.quantidade, m.local_estoque_id, m.contrapartida_local_estoque_id,
                m.centro_custo_id, m.atendimento_id, m.nota_entrada_item_id, m.estorno_movimento_estoque_id,
                d.tipo AS doc_tipo, d.numero AS doc_numero, d.movimentado_em AS doc_em,
                ne.numero AS nota_numero, ne.data_entrada AS nota_em, f.razao_social, ${NOME_PACIENTE} AS paciente_nome
           FROM movimento_lote ml
           JOIN movimento_estoque m ON m.id = ml.movimento_estoque_id AND m.excluido_em IS NULL AND m.estabelecimento_id = ?
           LEFT JOIN documento_estoque d ON d.id = m.documento_estoque_id
           LEFT JOIN nota_entrada_item ni ON ni.id = m.nota_entrada_item_id
           LEFT JOIN nota_entrada ne ON ne.id = ni.nota_entrada_id
           LEFT JOIN empresa_fornecedora f ON f.id = ne.empresa_fornecedora_id
           LEFT JOIN atendimento a ON a.id = m.atendimento_id
           LEFT JOIN paciente p ON p.id = a.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE ml.lote_insumo_id IN (${lista(ids.length)}) AND ml.excluido_em IS NULL
          ORDER BY m.ocorrido_em, m.id
          LIMIT ${LIMITE_LISTA + 1}`,
        [est, ...ids],
      );
      const movimentos = movs.slice(0, LIMITE_LISTA).map((r) => {
        const docTipo = texto(r['doc_tipo']);
        const tipo: RastreioLote['movimentos'][number]['tipo'] = r['nota_entrada_item_id']
          ? 'entrada'
          : docTipo === 'transferencia'
            ? 'transferencia'
            : docTipo === 'devolucao_interna'
              ? 'devolucao'
              : docTipo.startsWith('acerto_')
                ? 'balanco'
                : r['natureza'] === 'entrada'
                  ? 'inicial'
                  : 'saida';
        return {
          tipo,
          chave: r['nota_numero']
            ? chaveLida(r['nota_numero'], r['nota_em'])
            : chaveLida(r['doc_numero'], r['doc_em'] ?? r['ocorrido_em']),
          data: dataIso(r['ocorrido_em']),
          quantidade: n(r['quantidade']),
          local: n(r['local_estoque_id']),
          destino: numeroOuNulo(r['contrapartida_local_estoque_id']),
          centroCusto: numeroOuNulo(r['centro_custo_id']),
          paciente: pacienteLido(r),
          fornecedor: r['razao_social'] ? String(r['razao_social']) : null,
        };
      });
      const pacientes = new Set(
        movs
          .filter((r) => r['atendimento_id'] && r['natureza'] === 'saida')
          .map((r) => n(r['atendimento_id'])),
      ).size;
      return {
        ...base,
        validade: dataIso(lotes[0]?.['validade']) || null,
        saldos: saldos.map((r) => ({
          local: n(r['local_estoque_id']),
          localNome: String(r['nome']),
          quantidade: n(r['q']),
        })),
        movimentos,
        pacientes,
        cortada: movs.length > LIMITE_LISTA,
      };
    });
  }

  /** Os lotes que saíram para o atendimento (líquido das devoluções), do estabelecimento da sessão. */
  lotesDoPaciente(c: ContextoSuprimentos, atendimento: number) {
    return this.ler(c, async (l, est): Promise<LotesDoPaciente> => {
      const linhas = await l.consultar<Linha>(
        `SELECT m.insumo_id, i.nome, li.numero_lote, li.validade, ml.quantidade, m.ocorrido_em,
                d.numero AS doc_numero, d.movimentado_em AS doc_em,
                (SELECT COALESCE(SUM(dl.quantidade), 0) FROM movimento_estoque dv
                   JOIN movimento_lote dl ON dl.movimento_estoque_id = dv.id AND dl.lote_insumo_id = ml.lote_insumo_id
                  WHERE dv.estorno_movimento_estoque_id = m.id AND dv.excluido_em IS NULL) AS devolvido
           FROM movimento_estoque m
           JOIN movimento_lote ml ON ml.movimento_estoque_id = m.id AND ml.excluido_em IS NULL
           JOIN lote_insumo li ON li.id = ml.lote_insumo_id
           JOIN insumo i ON i.id = m.insumo_id
           LEFT JOIN documento_estoque d ON d.id = m.documento_estoque_id
          WHERE m.estabelecimento_id = ? AND m.atendimento_id = ? AND m.natureza = 'saida' AND m.excluido_em IS NULL
            AND m.estorno_movimento_estoque_id IS NULL
          ORDER BY m.ocorrido_em, m.id, ml.sequencia`,
        [est, atendimento],
      );
      return {
        atendimento,
        itens: linhas
          .map((r) => ({
            item: n(r['insumo_id']),
            nome: String(r['nome']),
            lote: String(r['numero_lote']),
            validade: dataIso(r['validade']),
            quantidade: qtd(n(r['quantidade']) - n(r['devolvido'])),
            data: dataIso(r['ocorrido_em']),
            chave: chaveLida(r['doc_numero'], r['doc_em'] ?? r['ocorrido_em']),
          }))
          .filter((x) => x.quantidade > 0),
      };
    });
  }

  /** O consumo da competência pelos movimentos: saídas menos devoluções por centro de custo e por local. */
  consumo(c: ContextoSuprimentos, competencia: { ano: number; mes: number }) {
    return this.ler(c, async (l, est) => {
      const comp = competenciaDe(competencia.ano, competencia.mes);
      const porCentro = await l.consultar<Linha>(
        `SELECT m.centro_custo_id, cc.nome, MAX(cl.classe IN ('produtivo', 'auxiliar')) AS tecnico,
                SUM(CASE WHEN m.natureza = 'saida' THEN m.quantidade_estoque ELSE -m.quantidade_estoque END) AS q,
                SUM(CASE WHEN m.natureza = 'saida' THEN m.valor_total ELSE -m.valor_total END) AS v
           FROM movimento_estoque m
           JOIN centro_custo cc ON cc.id = m.centro_custo_id
           LEFT JOIN classificacao_centro_custo cl ON cl.id = cc.classificacao_centro_custo_id
           LEFT JOIN documento_estoque d ON d.id = m.documento_estoque_id
          WHERE m.estabelecimento_id = ? AND m.competencia = ? AND m.excluido_em IS NULL
            AND (d.tipo IN ('saida_setor', 'saida_paciente', 'devolucao_interna') OR (d.id IS NULL AND m.estorno_movimento_estoque_id IS NOT NULL))
          GROUP BY m.centro_custo_id, cc.nome ORDER BY cc.nome, m.centro_custo_id`,
        [est, comp],
      );
      const porLocal = await l.consultar<Linha>(
        `SELECT m.local_estoque_id, le.nome,
                SUM(CASE WHEN d.tipo <> 'devolucao_interna' THEN m.quantidade_estoque ELSE 0 END) AS saida,
                SUM(CASE WHEN d.tipo = 'devolucao_interna' THEN m.quantidade_estoque ELSE 0 END) AS devolucao,
                SUM(CASE WHEN d.tipo <> 'devolucao_interna' THEN m.valor_total ELSE 0 END) AS valor_saida,
                SUM(CASE WHEN d.tipo = 'devolucao_interna' THEN m.valor_total ELSE 0 END) AS valor_devolucao
           FROM movimento_estoque m
           JOIN documento_estoque d ON d.id = m.documento_estoque_id
           JOIN local_estoque le ON le.id = m.local_estoque_id
          WHERE m.estabelecimento_id = ? AND m.competencia = ? AND m.excluido_em IS NULL
            AND d.tipo IN ('saida_setor', 'saida_paciente', 'devolucao_interna')
          GROUP BY m.local_estoque_id, le.nome ORDER BY le.nome`,
        [est, comp],
      );
      const linhas = porCentro.map((r) => ({
        centroCusto: n(r['centro_custo_id']),
        nome: String(r['nome']),
        quantidade: qtd(n(r['q'])),
        valor: reais2(n(r['v'])),
        tecnico: verdadeiro(r['tecnico']),
      }));
      const parcelas = linhas.map((x) => x.valor);
      return {
        competencia,
        porCentroCusto: linhas,
        porLocal: porLocal.map((r) => ({
          local: n(r['local_estoque_id']),
          localNome: String(r['nome']),
          saida: qtd(n(r['saida'])),
          devolucao: qtd(n(r['devolucao'])),
          valorSaida: reais2(n(r['valor_saida'])),
          valorDevolucao: reais2(n(r['valor_devolucao'])),
        })),
        total: { valor: reais2(parcelas.reduce((s, v) => s + v, 0)), parcelas },
      };
    });
  }

  /** O consumo mensal por item (saídas de consumo menos devoluções) nas competências pedidas. */
  consumoMensalPorItem(
    c: ContextoSuprimentos,
    o: { local?: number; meses: readonly { ano: number; mes: number }[] },
  ) {
    return this.ler(c, async (l, est) => {
      const r = new Map<number, { consumos: number[]; valor: number }>();
      if (!o.meses.length) return r;
      const comps = o.meses.map((m) => competenciaDe(m.ano, m.mes));
      const linhas = await l.consultar<Linha>(
        `SELECT m.insumo_id, m.competencia,
                SUM(CASE WHEN m.natureza = 'saida' THEN m.quantidade_estoque ELSE -m.quantidade_estoque END) AS q,
                SUM(CASE WHEN m.natureza = 'saida' THEN m.valor_total ELSE -m.valor_total END) AS v
           FROM movimento_estoque m
           JOIN documento_estoque d ON d.id = m.documento_estoque_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL AND m.competencia IN (${lista(comps.length)})
            AND d.tipo IN ('saida_setor', 'saida_paciente', 'devolucao_interna')
            ${o.local ? 'AND m.local_estoque_id = ?' : ''}
          GROUP BY m.insumo_id, m.competencia`,
        [est, ...comps, ...(o.local ? [o.local] : [])],
      );
      for (const x of linhas) {
        const k = n(x['insumo_id']);
        const e = r.get(k) ?? { consumos: comps.map(() => 0), valor: 0 };
        const i = comps.indexOf(dataIso(x['competencia']));
        if (i >= 0) e.consumos[i] = qtd(n(x['q']));
        e.valor = reais2(e.valor + n(x['v']));
        r.set(k, e);
      }
      return r;
    });
  }

  /** A quantidade ainda a receber por item nos pedidos abertos desde o ano dado. */
  emPedidoPorItem(c: ContextoSuprimentos, desdeAno: number) {
    return this.ler(c, async (l, est) => {
      const r = new Map<number, number>();
      for (const x of await l.consultar<Linha>(
        `SELECT pi.insumo_id, SUM(GREATEST(pi.quantidade * pi.fator_conversao - pi.quantidade_recebida - pi.quantidade_cancelada, 0)) AS q
           FROM pedido_compra_item pi
           JOIN pedido_compra p ON p.id = pi.pedido_compra_id
          WHERE p.estabelecimento_id = ? AND p.ano >= ? AND p.excluido_em IS NULL AND pi.excluido_em IS NULL
            AND pi.insumo_id IS NOT NULL AND pi.cancelado_em IS NULL AND p.situacao IN (${lista(SITUACOES_PEDIDO_ABERTAS.length)})
          GROUP BY pi.insumo_id`,
        [est, desdeAno, ...SITUACOES_PEDIDO_ABERTAS],
      ))
        if (n(x['q']) > 0) r.set(n(x['insumo_id']), qtd(n(x['q'])));
      return r;
    });
  }

  /** Os pedidos de compra do ano (situação e termo no nome do item ou do fornecedor). */
  pedidos(c: ContextoSuprimentos, o: { ano: number; situacao?: number; termo?: string }) {
    return this.ler(c, async (l, est) => {
      const situacoes = o.situacao
        ? Object.entries(SITUACAO_PEDIDO_NA_TELA)
            .filter(([, v]) => v === o.situacao)
            .map(([k]) => k)
        : [];
      if (o.situacao && !situacoes.length) return { itens: [], cortada: false };
      const linhas = await consultarPedidos(l, est, {
        ano: o.ano,
        situacoes,
        ...(o.termo?.trim() ? { termo: o.termo.trim() } : {}),
        limite: LIMITE_LISTA + 1,
      });
      return { itens: linhas.slice(0, LIMITE_LISTA), cortada: linhas.length > LIMITE_LISTA };
    });
  }

  /** O pedido de compra pelo número no ano, com os itens, as propostas da cotação e as escolhas. */
  /** F3.6 (05-SUP linha 20): a gestão do pedido emitido (agenda de entregas, contatos e motivos). */
  gestaoPedido(c: ContextoSuprimentos, ano: number, doc: number) {
    return this.ler(c, async (l, est) =>
      lerGestaoPedido(l, est, ano, doc, await hojeNoEstabelecimento(l, est)),
    );
  }

  pedido(c: ContextoSuprimentos, ano: number, doc: number) {
    return this.ler(c, async (l, est): Promise<PedidoDetalhe | null> => {
      const [cab] = await consultarPedidos(l, est, { ano, numero: doc, situacoes: [], limite: 1 });
      if (!cab) return null;
      const extra = await l.uma<Linha>('SELECT cotacao_id FROM pedido_compra WHERE id = ?', [cab.id]);
      const cotacao = numeroOuNulo(extra?.['cotacao_id']);
      const itens = await l.consultar<Linha>(
        `SELECT pi.id, pi.sequencia, pi.insumo_id, i.nome, pi.quantidade, pi.quantidade_recebida, pi.cancelado_em
           FROM pedido_compra_item pi JOIN insumo i ON i.id = pi.insumo_id
          WHERE pi.pedido_compra_id = ? AND pi.excluido_em IS NULL ORDER BY pi.sequencia`,
        [cab.id],
      );
      const propostas = cotacao === null ? [] : await l.consultar<Linha>(SQL_PROPOSTAS, [cotacao]);
      const escolhas =
        cotacao === null
          ? []
          : await l.consultar<Linha>(
              `SELECT ci.insumo_id, ci.sequencia, ua.login, cri.alterado_em, cri.motivo_escolha,
                (SELECT COUNT(*) FROM cotacao_resposta_item x WHERE x.cotacao_item_id = ci.id AND x.vencedor AND x.excluido_em IS NULL) AS vencedoras
           FROM cotacao_item ci
           JOIN cotacao_resposta_item cri ON cri.cotacao_item_id = ci.id AND cri.vencedor AND cri.excluido_em IS NULL
           LEFT JOIN usuario ua ON ua.id = cri.alterado_por
          WHERE ci.cotacao_id = ? AND ci.excluido_em IS NULL AND ci.situacao = 'adjudicado'
          GROUP BY ci.id, ci.insumo_id, ci.sequencia
          ORDER BY ci.sequencia`,
              [cotacao],
            );
      const emCotacao = cab.situacao === 3;
      return {
        ...cab,
        itensDetalhe: itens.map((r) => {
          const estado = estadoItemPedido(r, emCotacao);
          return {
            id: n(r['id']),
            seq: n(r['sequencia']),
            item: n(r['insumo_id']),
            nome: String(r['nome']),
            quantidade: n(r['quantidade']),
            comprada: n(r['quantidade_recebida']),
            estado,
            estadoRotulo: ROTULO_ESTADO_ITEM[estado] ?? estado,
          };
        }),
        propostas: propostas.map(propostaLida),
        escolhas: escolhas.map((r) => ({
          item: n(r['insumo_id']),
          seq: n(r['sequencia']),
          autor: texto(r['login']),
          em: instante(r['alterado_em']),
          justificativa: texto(r['motivo_escolha']),
          rateio: n(r['vencedoras']) > 1,
        })),
        portal: [],
      };
    });
  }

  /** As últimas compras do item (notas confirmadas), o último custo e o menor unitário. */
  historicoCompras(c: ContextoSuprimentos, item: number) {
    return this.ler(c, async (l, est): Promise<HistoricoCompra> => {
      const cad = await l.uma<Linha>('SELECT id, nome FROM insumo WHERE id = ? AND excluido_em IS NULL', [
        item,
      ]);
      if (!cad) throw recusa('item-inexistente', 'O item não existe no cadastro.');
      const linhas = await l.consultar<Linha>(
        `SELECT ne.data_entrada, ne.empresa_fornecedora_id, f.razao_social, ne.numero_documento, ni.quantidade_estoque,
                ni.valor_unitario, ni.custo_unitario, ni.marca
           FROM nota_entrada_item ni
           JOIN nota_entrada ne ON ne.id = ni.nota_entrada_id AND ne.estabelecimento_id = ? AND ne.excluido_em IS NULL
                AND ne.situacao = 'confirmada'
           JOIN empresa_fornecedora f ON f.id = ne.empresa_fornecedora_id
          WHERE ni.insumo_id = ? AND ni.excluido_em IS NULL
          ORDER BY ne.data_entrada DESC, ni.id DESC
          LIMIT 21`,
        [est, item],
      );
      const compras = linhas.slice(0, 20).map((r) => ({
        data: dataIso(r['data_entrada']),
        fornecedor: n(r['empresa_fornecedora_id']),
        fornecedorNome: String(r['razao_social']),
        nota: Number(String(r['numero_documento']).replace(/\D/g, '')) || 0,
        quantidade: n(r['quantidade_estoque']),
        unitario: n(r['valor_unitario']),
        custo: n(r['custo_unitario']),
        marca: texto(r['marca']),
      }));
      return {
        item,
        nome: String(cad['nome']),
        compras,
        ultimoCusto: compras[0]?.custo ?? null,
        menorUnitario: compras.length ? Math.min(...compras.map((x) => x.unitario)) : null,
        cortada: linhas.length > 20,
      };
    });
  }

  /** Os meses fechados, o próximo a fechar e as ocorrências (fechamento e reabertura, com o autor). */
  fechamentos(c: ContextoSuprimentos, corrente: { ano: number; mes: number }) {
    return this.ler(c, async (l, est): Promise<FechamentosEstoque> => {
      const linhas = await l.consultar<Linha>(
        `SELECT f.competencia, f.situacao, f.exportado_contabilidade, f.fechado_em, f.reaberto_em, f.motivo_reabertura,
                uf.login AS fechou, ur.login AS reabriu
           FROM fechamento_estoque f
           LEFT JOIN usuario uf ON uf.id = f.fechamento_usuario_id
           LEFT JOIN usuario ur ON ur.id = f.reabertura_usuario_id
          WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL ORDER BY f.competencia DESC`,
        [est],
      );
      const comp = (r: Linha) => {
        const d = dataIso(r['competencia']);
        return { ano: Number(d.slice(0, 4)), mes: Number(d.slice(5, 7)) };
      };
      const fechados = linhas
        .filter((r) => r['situacao'] === 'fechado')
        .map((r) => ({ ...comp(r), exportado: verdadeiro(r['exportado_contabilidade']) }));
      const ocorrencias: FechamentosEstoque['ocorrencias'] = [];
      for (const r of linhas) {
        if (r['fechado_em'])
          ocorrencias.push({
            tipo: 'fechamento-mes',
            ...comp(r),
            motivo: '',
            autor: texto(r['fechou']),
            em: instante(r['fechado_em']),
          });
        if (r['reaberto_em'])
          ocorrencias.push({
            tipo: 'reabertura-mes',
            ...comp(r),
            motivo: texto(r['motivo_reabertura']),
            autor: texto(r['reabriu']),
            em: instante(r['reaberto_em']),
          });
      }
      ocorrencias.sort((a, b) =>
        a.em !== b.em ? (a.em < b.em ? 1 : -1) : a.tipo === 'reabertura-mes' ? -1 : 1,
      );
      return { fechados, proximo: proximoAFechar(fechados, corrente), ocorrencias };
    });
  }

  /** Os recálculos de saldo do estabelecimento (os 100 últimos). */
  recalculos(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est): Promise<RecalculosEstoque> => ({
      itens: (
        await l.consultar<Linha>(
          `SELECT r.id, r.ocorrido_em, r.concluido_em, u.login, r.situacao, r.competencia_inicio, r.competencia_fim,
                  r.motivo, r.insumos_atingidos, r.diferenca_valor_total
             FROM recalculo_saldo_estoque r LEFT JOIN usuario u ON u.id = r.usuario_id
            WHERE r.estabelecimento_id = ? ORDER BY r.ocorrido_em DESC, r.id DESC LIMIT 100`,
          [est],
        )
      ).map((r) => ({
        id: n(r['id']),
        inicio: instante(r['ocorrido_em']),
        fim: instante(r['concluido_em']),
        usuario: texto(r['login']),
        tela: null,
        terminado: r['situacao'] !== 'em_andamento',
        competencia: `${dataIso(r['competencia_inicio']).slice(0, 7)}${
          dataIso(r['competencia_fim']) !== dataIso(r['competencia_inicio'])
            ? ` a ${dataIso(r['competencia_fim']).slice(0, 7)}`
            : ''
        }`,
        motivo: texto(r['motivo']),
        insumos: r['insumos_atingidos'] === null ? null : n(r['insumos_atingidos']),
        diferencaValor: r['diferenca_valor_total'] === null ? null : n(r['diferenca_valor_total']),
      })),
    }));
  }

  /** Os parâmetros do usuário no estoque (as permissões por local) e a numeração de negócio do estoque. */
  parametros(c: ContextoSuprimentos, login: string) {
    return this.ler(c, async (l, est): Promise<ParametrosEstoque> => {
      const u = await l.uma<Linha>('SELECT id, login FROM usuario WHERE login = ? AND excluido_em IS NULL', [
        login,
      ]);
      const perms = u ? await l.consultar<Linha>(SQL_PERMISSOES_LOCAL, [est, n(u['id'])]) : [];
      const parametros = perms.flatMap((r) =>
        TIPOS_DO_USUARIO.map(([coluna, , cod]) => ({
          chave: `${n(r['local_estoque_id'])}:${cod}`,
          rotulo: `${String(r['local_nome'])}: ${TIPOS_MOVIMENTO_LOCAL.find((t) => t.codigo === cod)?.rotulo ?? cod}`,
          valor: verdadeiro(r[coluna]) ? 'sim' : 'não',
        })),
      );
      const seqs = await l.consultar<Linha>(
        `SELECT tipo, proximo_valor, alterado_em FROM sequencia_negocio
          WHERE estabelecimento_id = ? AND tipo IN ('documento_estoque', 'requisicao_material', 'nota_entrada', 'pedido_compra', 'inventario_estoque')
          ORDER BY tipo`,
        [est],
      );
      return {
        usuario: texto(u?.['login'] ?? login),
        parametros,
        numeracao: seqs.map((r) => ({
          tipo: String(r['tipo']),
          competencia: dataIso(r['alterado_em']).slice(0, 7),
          ultimo: n(r['proximo_valor']) - 1,
        })),
        sequencias: [],
      };
    });
  }

  /** O escopo do usuário (pelo login) no estoque do estabelecimento; usuário inexistente: null. */
  escopo(c: ContextoSuprimentos, login: string) {
    return this.ler(c, async (l, est): Promise<EscopoUsuarioEstoque | null> => {
      const u = await l.uma<Linha>(
        'SELECT id, login, nome FROM usuario WHERE login = ? AND excluido_em IS NULL',
        [login],
      );
      if (!u) return null;
      const id = n(u['id']);
      const linhas = await l.consultar<Linha>(SQL_PERMISSOES_LOCAL, [est, id]);
      const centros = await l.consultar<Linha>(SQL_CENTROS_USUARIO, [est, id]);
      const classes = await l.consultar<Linha>(
        `SELECT DISTINCT g.id, g.descricao FROM usuario_estoque_classificacao uc
           JOIN grupo_insumo g ON g.id = uc.grupo_insumo_id
          WHERE uc.estabelecimento_id = ? AND uc.usuario_id = ? AND uc.excluido_em IS NULL
            AND uc.vigencia_inicio <= CURRENT_DATE AND (uc.vigencia_fim IS NULL OR uc.vigencia_fim >= CURRENT_DATE)
          ORDER BY g.descricao`,
        [est, id],
      );
      const e = await escopoDoUsuario(l, est, id);
      return {
        usuario: String(u['login']),
        nome: String(u['nome']),
        locais: linhas.map((r) => ({
          local: n(r['local_estoque_id']),
          localNome: String(r['local_nome']),
          tipos: TIPOS_DO_USUARIO.filter(([coluna]) => verdadeiro(r[coluna])).map(([, , cod]) => cod),
        })),
        centrosCusto: centros.map((r) => ({ codigo: n(r['id']), nome: String(r['nome']) })),
        classes: classes.map((r) => ({ codigo: n(r['id']), nome: String(r['descricao']) })),
        flags: {
          ...e.flags,
          autorizarNecessidade: e.flags.autorizarPedido,
          lancarControlado: linhas.some((r) => verdadeiro(r['pode_movimentar_controlado'])),
        },
      };
    });
  }

  /** Os usuários com cadastro no estoque do estabelecimento (login ou nome), com o número de locais. */
  usuarios(c: ContextoSuprimentos, termo: string) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT u.login, u.nome, COUNT(DISTINCT lu.local_estoque_id) AS locais
             FROM usuario u
             JOIN local_estoque_usuario lu ON lu.usuario_id = u.id AND lu.excluido_em IS NULL
             JOIN local_estoque le ON le.id = lu.local_estoque_id AND le.estabelecimento_id = ? AND le.excluido_em IS NULL
            WHERE u.excluido_em IS NULL AND (u.login LIKE ? OR u.nome LIKE ?)
            GROUP BY u.id, u.login, u.nome ORDER BY u.nome, u.login LIMIT 50`,
          [est, parecido(termo), parecido(termo)],
        )
      ).map((r) => ({ usuario: String(r['login']), nome: String(r['nome']), locais: n(r['locais']) })),
    );
  }

  /** Os fornecedores ativos (razão social, fantasia ou documento), até 50. */
  fornecedores(c: ContextoSuprimentos, termo: string) {
    return this.ler(c, async (l) => {
      const linhas = await consultarFornecedores(l, termo, false);
      return {
        itens: linhas.slice(0, 50).map((r): FornecedorLido => ({
          codigo: n(r['id']),
          nome: String(r['razao_social']),
          fantasia: texto(r['nome_fantasia']),
          pessoa: r['tipo_pessoa'] === 'juridica' ? 'J' : r['tipo_pessoa'] === 'fisica' ? 'F' : '',
          documento: texto(r['cnpj'] ?? r['cpf']),
          documentoValido: documentoValido(r['cnpj'], r['cpf']),
          cidade: texto(r['cidade']),
          uf: texto(r['uf']),
          banco: null,
        })),
        cortada: linhas.length > 50,
      };
    });
  }

  /** Os terceiros (destinatários de empréstimo, venda ou doação) ativos do estabelecimento. */
  terceiros(c: ContextoSuprimentos, termo: string) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT id, nome FROM terceiro_destinatario
          WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL AND nome LIKE ?
          ORDER BY nome, id LIMIT 51`,
        [est, parecido(termo)],
      );
      return {
        itens: linhas
          .slice(0, 50)
          .map((r): TerceiroLido => ({ codigo: n(r['id']), nome: String(r['nome']) })),
        cortada: linhas.length > 50,
      };
    });
  }

  /** Os prestadores de serviço (fornecedor marcado como prestador), até 50. */
  prestadores(c: ContextoSuprimentos, termo: string) {
    return this.ler(c, async (l) => {
      const linhas = await consultarFornecedores(l, termo, true);
      return {
        itens: linhas.slice(0, 50).map((r): PrestadorLido => ({
          codigo: n(r['id']),
          empresa: n(r['id']),
          nome: String(r['razao_social']),
          documento: texto(r['cnpj'] ?? r['cpf']),
          documentoValido: documentoValido(r['cnpj'], r['cpf']),
          situacao: String(r['situacao']),
          banco: null,
        })),
        cortada: linhas.length > 50,
      };
    });
  }

  kits(c: ContextoSuprimentos, hoje: string, alertaDias: number) {
    return this.ler(c, (l, est) => lerKits(l, est, null, hoje, alertaDias));
  }

  kit(c: ContextoSuprimentos, id: number, hoje: string, alertaDias: number) {
    return this.ler(c, async (l, est) => (await lerKits(l, est, id, hoje, alertaDias))[0] ?? null);
  }

  /** F3.6 (05-SUP linha 16): a prévia do recálculo (lê, nunca grava). */
  previaRecalculo(c: ContextoSuprimentos, e: RecalcularSaldosEntrada): Promise<PreviaRecalculo> {
    return this.ler(c, async (l, est) => {
      const a = await apurarRecalculo(l, est, e, await hojeNoEstabelecimento(l, est));
      return {
        abertura: a.abertura,
        saldos: a.saldos,
        diferencas: a.diferencas,
        diferencaQuantidadeTotal: a.diferencaQuantidadeTotal,
        diferencaValorTotal: a.diferencaValorTotal,
        pendentes: a.pendentes,
      };
    });
  }

  /** F3.6 (05-SUP linha 13): o cadastro dos kits padrão (ativos e inativos) e a busca do procedimento do vínculo. */
  kitsPadraoCadastro(c: ContextoSuprimentos) {
    return this.ler(c, (l, est) => lerKitsPadraoCadastro(l, est));
  }

  procedimentosKit(c: ContextoSuprimentos, termo: string) {
    return this.ler(c, (l) => buscarProcedimentosKit(l, termo));
  }

  /** Os kits padrão (kit_material ativo do estabelecimento) com os itens e as quantidades. */
  kitsPadrao(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT k.id, k.nome, ki.insumo_id, i.nome AS item_nome, ki.quantidade
           FROM kit_material k
           JOIN kit_material_item ki ON ki.kit_material_id = k.id AND ki.excluido_em IS NULL
           JOIN insumo i ON i.id = ki.insumo_id
          WHERE k.estabelecimento_id = ? AND k.ativo = TRUE AND k.excluido_em IS NULL
          ORDER BY k.nome, k.id, ki.sequencia`,
        [est],
      );
      const r = new Map<
        number,
        { codigo: number; nome: string; itens: { item: number; nome: string; quantidade: number }[] }
      >();
      for (const x of linhas) {
        const k = n(x['id']);
        const e = r.get(k) ?? { codigo: k, nome: String(x['nome']), itens: [] };
        e.itens.push({
          item: n(x['insumo_id']),
          nome: String(x['item_nome']),
          quantidade: n(x['quantidade']),
        });
        r.set(k, e);
      }
      return [...r.values()];
    });
  }

  /** Os documentos de estoque inicial (entrada por acerto com o tipo de movimento "estoque_inicial"). */
  estoqueInicial(c: ContextoSuprimentos) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar<Linha>(
          `SELECT d.numero, d.movimentado_em, d.origem_local_estoque_id,
                  (SELECT COUNT(*) FROM documento_estoque_item di WHERE di.documento_estoque_id = d.id AND di.excluido_em IS NULL) AS itens
             FROM documento_estoque d
             JOIN tipo_movimento_estoque t ON t.id = d.tipo_movimento_estoque_id AND t.codigo = ?
            WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao = 'concluido'
            ORDER BY d.movimentado_em DESC, d.id DESC LIMIT ${LIMITE_LISTA}`,
          [TIPO_MOVIMENTO.estoqueInicial, est],
        )
      ).map((r) => ({
        doc: n(r['numero']),
        data: dataIso(r['movimentado_em']),
        local: n(r['origem_local_estoque_id']),
        itens: n(r['itens']),
      })),
    );
  }

  /** Os envios de transferência (o documento de transferência aberto é o envio em trânsito). */
  transferencias(c: ContextoSuprimentos, o: { local?: number; etapa?: string }) {
    return this.ler(c, async (l, est) => {
      const envios = await lerEnvios(l, est, { ...(o.local ? { local: o.local } : {}) });
      return o.etapa ? envios.filter((x) => x.etapa === o.etapa) : envios;
    });
  }

  envio(c: ContextoSuprimentos, id: number) {
    return this.ler(c, async (l, est) => {
      const [e] = await lerEnvios(l, est, { id });
      if (!e) return null;
      const lotes = await l.consultar<Linha>(
        `SELECT di.insumo_id, li.numero_lote, di.data_validade, di.quantidade FROM documento_estoque_item di
           JOIN lote_insumo li ON li.id = di.lote_insumo_id
          WHERE di.documento_estoque_id = ? AND di.excluido_em IS NULL ORDER BY di.sequencia`,
        [id],
      );
      return {
        origem: e.origem,
        destino: e.destino,
        etapa: e.etapa,
        itens: e.itens.map((x) => {
          const ls = lotes.filter((r) => n(r['insumo_id']) === x.item);
          return {
            item: x.item,
            quantidade: x.quantidade,
            lotes: ls.length
              ? JSON.stringify(
                  ls.map((r) => ({
                    lote: String(r['numero_lote']),
                    validade: dataIso(r['data_validade']),
                    quantidade: n(r['quantidade']),
                  })),
                )
              : null,
          };
        }),
      };
    });
  }

  /** Os pontos de pedido definidos (parametro_reposicao: prazo e estoque de segurança) por item e local. */
  pontosPedido(c: ContextoSuprimentos, local?: number) {
    return this.ler(c, async (l, est) => {
      const r = new Map<string, { prazoDias: number; estoqueSeguranca: number | null }>();
      for (const x of await l.consultar<Linha>(
        `SELECT insumo_id, local_estoque_id, prazo_reposicao_dias, estoque_seguranca FROM parametro_reposicao
          WHERE estabelecimento_id = ? AND ativo = TRUE ${local ? 'AND local_estoque_id = ?' : ''}`,
        local ? [est, local] : [est],
      ))
        r.set(chavePonto(n(x['insumo_id']), n(x['local_estoque_id'])), {
          prazoDias: n(x['prazo_reposicao_dias']),
          estoqueSeguranca: numeroOuNulo(x['estoque_seguranca']),
        });
      return r;
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSuprimentosIndisponivel(): PortaSuprimentos {
  return portaIndisponivel<PortaSuprimentos>(METODOS_PORTA_SUPRIMENTOS);
}
