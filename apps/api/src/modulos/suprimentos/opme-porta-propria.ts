// Porta do OPME (M46, etapa 3) sobre o banco do cliente, pelo @sgh/nucleo, sempre restrita ao estabelecimento da sessão:
//   - leitura: a solicitação (solicitacao_opme com o item da solicitação), as respostas da operadora
//     (autorizacao_opme), o consumo em sala (consumo_opme ligado ao movimento da saída), os itens de OPME com saldo e
//     lotes, os fornecedores, o pedido e a nota das etapas, o rastreio reverso e os itens da conta (conta_hospitalar_item
//     pelo movimento do estoque);
//   - gravação: a solicitação e as etapas numa operação do executor (trilha, outbox e idempotência pela chave da tela);
//     o consumo e a devolução em sala vão pela operação do estoque (suprimentos.registrarSaida e registrarDevolucao),
//     que grava o consumo_opme na mesma transação do movimento.
// Melhoria: "é OPME" vem da marca do cadastro do insumo (insumo.opme); o local sugerido conta o saldo próprio e o
// consignado; a solicitação é cabeçalho com item (o contrato da tela é o item 1); as etapas lidas vêm dos registros
// reais (solicitação, resposta da operadora, consumo, devolução e cancelamento), nunca de um histórico paralelo.
// Pendência (pedido p2-suprimentos-farmacia): as etapas de pedido de compra, consignação, esterilização e nota fiscal
// não têm onde ficar ligadas à solicitação: respondem 409 com o motivo, nada em silêncio.
import {
  CLASSE_OPME,
  type EtapaOpme,
  type EtapaOpmeLida,
  type ExpostoOpme,
  type ItemOpme,
  type SaidaLoteOpme,
  type SituacaoOpme,
  type SolicitacaoOpme,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  erroIdempotenciaDivergente,
  type Executor,
  gravarIdempotencia,
  hashEntrada,
  type Leitor,
  lerIdempotencia,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../exames/public-api.js';
import { contextoNucleo, modeloPendente } from './operacoes.js';
import {
  type GravadorOpme,
  type ConsumoOpmeLeitura,
  METODOS_PORTA_OPME,
  type MudancaSolicitacaoOpme,
  type NovaEtapaOpme,
  type NovaSolicitacaoOpme,
  type PedidoEtapaOpme,
  type PortaOpme,
} from './opme-porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

export type NucleoOpme = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que a gravação da solicitação e das etapas escreve (o executor confere cada escrita). */
export const TABELAS_OPME = [
  'solicitacao_opme',
  'solicitacao_opme_item',
  'autorizacao_opme',
  'sequencia_negocio',
  'idempotencia_operacao',
] as const;

/** As operações do estoque que o OPME usa (o consumo e a devolução em sala). */
const OPERACOES_ESTOQUE = new Set(['suprimentos.registrarSaida', 'suprimentos.registrarDevolucao']);

/** As etapas sem estrutura ligada à solicitação no banco (pedido p2-suprimentos-farmacia). */
const ETAPA_PENDENTE: Partial<Record<EtapaOpme, string>> = {
  pedido: 'a etapa de pedido de compra da solicitação de OPME (ligação da solicitação ao pedido de compra)',
  consignacao: 'a etapa de recebimento em consignação da solicitação de OPME (ligação à remessa consignada)',
  cme: 'a etapa de esterilização da solicitação de OPME (ligação ao processamento da esterilização)',
  nf: 'a etapa de nota fiscal da solicitação de OPME (ligação da solicitação à nota de entrada)',
};

const TETO = 200;
type Linha = Record<string, unknown>;
type Fonte = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const hm = (v: unknown): string => instante(v).slice(0, 16);
const dia = (v: unknown): string | null => (v ? instante(v).slice(0, 10) : null);
const qtd = (x: number): number => Math.round(x * 10_000) / 10_000;
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');
/** AAAA-MM-DDTHH:mm da tela para a coluna (hora civil do estabelecimento, como a tela mandou). */
const coluna = (em: string): string => `${em.slice(0, 10)} ${em.slice(11, 16)}:00`;
const diaSeguinte = (d: string): string => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const chaveDoc = (numero: unknown, em: unknown) => ({
  ano: Number(instante(em).slice(0, 4)),
  mes: Number(instante(em).slice(5, 7)),
  doc: n(numero),
});

/** A guia da operadora fica na primeira linha da observação da resposta (pedido de coluna própria). */
const GUIA = 'guia:';
const comGuia = (guia: string | null | undefined, obs: string | null | undefined): string | null =>
  [guia ? `${GUIA}${guia}` : null, obs ?? null].filter(Boolean).join('\n') || null;
const guiaDe = (obs: unknown): { guia: string | null; observacao: string | null } => {
  const t = txt(obs);
  if (!t) return { guia: null, observacao: null };
  const [p, ...resto] = t.split('\n');
  return p!.startsWith(GUIA)
    ? { guia: p!.slice(GUIA.length) || null, observacao: resto.join('\n') || null }
    : { guia: null, observacao: t };
};

// ── Situação: banco ↔ contrato ───────────────────────────────────────────────────────────────────────────────────

const PARA_BANCO: Record<SituacaoOpme, string> = {
  solicitada: 'solicitada',
  cotacao: 'em_cotacao',
  autorizada: 'autorizada',
  negada: 'negada',
  pedido: 'autorizada',
  consignada: 'autorizada',
  cme: 'autorizada',
  consumida: 'utilizada',
  devolvida: 'utilizada',
  faturada: 'utilizada',
  cancelada: 'cancelada',
};

function situacaoLida(db: string, consumida: number, devolvida: number): SituacaoOpme {
  if (db === 'cancelada') return 'cancelada';
  if (consumida > 0) return qtd(consumida - devolvida) > 0 ? 'consumida' : 'devolvida';
  if (db === 'em_cotacao' || db === 'aguardando_autorizacao') return 'cotacao';
  if (db === 'autorizada' || db === 'utilizada') return 'autorizada';
  if (db === 'negada') return 'negada';
  return 'solicitada';
}

// ── Leituras comuns (o leitor da sessão ou a transação da gravação) ──────────────────────────────────────────────

const SQL_SOLICITACAO = `
  SELECT s.id, s.versao, s.situacao, s.agendamento_cirurgico_id, s.atendimento_id, s.cirurgia_prevista_em,
         s.justificativa_clinica, s.solicitado_em, s.cancelado_em, s.observacao, us.login AS criado_por,
         uc.login AS alterado_login, i.id AS item_id, i.insumo_id, i.descricao, i.codigo_referencia,
         i.quantidade_solicitada, i.quantidade_autorizada, i.empresa_fornecedora_id, i.situacao AS item_situacao,
         i.alterado_em AS item_alterado_em, ins.nome AS insumo_nome, ins.consignado,
         COALESCE(ef.nome_fantasia, ef.razao_social) AS fornecedor_nome, ag.sala_cirurgica_id, ag.inicio_previsto_em
    FROM solicitacao_opme s
    JOIN solicitacao_opme_item i ON i.solicitacao_opme_id = s.id AND i.sequencia = 1 AND i.excluido_em IS NULL
    JOIN usuario us ON us.id = s.solicitante_usuario_id
    LEFT JOIN usuario uc ON uc.id = s.alterado_por
    LEFT JOIN insumo ins ON ins.id = i.insumo_id
    LEFT JOIN empresa_fornecedora ef ON ef.id = i.empresa_fornecedora_id
    LEFT JOIN agendamento_cirurgico ag ON ag.id = s.agendamento_cirurgico_id
   WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL`;

const SQL_CONSUMO = `
  SELECT co.id, co.solicitacao_opme_item_id, si.solicitacao_opme_id, co.agendamento_cirurgico_id, co.sala_cirurgica_id,
         co.atendimento_id, co.insumo_id, co.quantidade, co.numero_lote, co.numero_serie, co.registro_anvisa,
         co.validade, co.consignado, co.sem_autorizacao, co.motivo_sem_autorizacao, co.registrado_em, co.situacao,
         co.empresa_fornecedora_id, co.movimento_estoque_id, co.alterado_em, u.login, f.nome AS fabricante_nome,
         ins.nome AS insumo_nome, ag.inicio_previsto_em, ag.sala_cirurgica_id AS ag_sala, ag.cirurgiao_profissional_id, a.paciente_id,
         me.documento_estoque_id, me.documento_estoque_item_id, d.numero AS doc_numero, d.criado_em AS doc_em,
         (SELECT COALESCE(SUM(dv.quantidade), 0) FROM movimento_estoque dv
           WHERE dv.estorno_movimento_estoque_id = co.movimento_estoque_id AND dv.excluido_em IS NULL) AS devolvida,
         COALESCE(
           (SELECT chi.conta_hospitalar_id FROM conta_hospitalar_item chi
             WHERE chi.movimento_estoque_id = co.movimento_estoque_id AND chi.excluido_em IS NULL LIMIT 1),
           (SELECT ch.id FROM conta_hospitalar ch
             WHERE ch.atendimento_id = co.atendimento_id AND ch.estabelecimento_id = co.estabelecimento_id
               AND ch.cancelada_em IS NULL AND ch.excluido_em IS NULL ORDER BY ch.id DESC LIMIT 1),
           0) AS conta
    FROM consumo_opme co
    JOIN usuario u ON u.id = co.registrado_por_usuario_id
    LEFT JOIN solicitacao_opme_item si ON si.id = co.solicitacao_opme_item_id
    LEFT JOIN fabricante f ON f.id = co.fabricante_id
    LEFT JOIN insumo ins ON ins.id = co.insumo_id
    LEFT JOIN agendamento_cirurgico ag ON ag.id = co.agendamento_cirurgico_id
    LEFT JOIN atendimento a ON a.id = co.atendimento_id
    LEFT JOIN movimento_estoque me ON me.id = co.movimento_estoque_id
    LEFT JOIN documento_estoque d ON d.id = me.documento_estoque_id
   WHERE co.estabelecimento_id = ? AND co.excluido_em IS NULL`;

function consumoDe(r: Linha): ConsumoOpmeLeitura {
  const sem = verdadeiro(r['sem_autorizacao']);
  return {
    id: n(r['id']),
    solicitacao: nulo(r['solicitacao_opme_id']),
    agendamento: n(r['agendamento_cirurgico_id']),
    sala: n(r['sala_cirurgica_id'] ?? r['ag_sala']),
    dataHora: hm(r['inicio_previsto_em'] ?? r['registrado_em']),
    atendimento: n(r['atendimento_id']),
    item: n(r['insumo_id']),
    itemNome: txt(r['insumo_nome']),
    quantidade: n(r['quantidade']),
    devolvida: n(r['devolvida']),
    saida: { id: n(r['documento_estoque_id']), ...chaveDoc(r['doc_numero'], r['doc_em']) },
    lancamento: n(r['documento_estoque_item_id']),
    conta: n(r['conta']),
    lote: txt(r['numero_lote']),
    serie: txt(r['numero_serie']),
    fabricante: String(r['fabricante_nome'] ?? ''),
    modelo: null,
    registroAnvisa: String(r['registro_anvisa'] ?? ''),
    validade: dia(r['validade']),
    consignado: verdadeiro(r['consignado']),
    semAutorizacao: sem
      ? { por: String(r['login']), motivo: String(r['motivo_sem_autorizacao'] ?? '') }
      : null,
    usuario: String(r['login']),
    em: hm(r['registrado_em']),
    paciente: nulo(r['paciente_id']),
    cirurgiao: nulo(r['cirurgiao_profissional_id']),
    fornecedor: nulo(r['empresa_fornecedora_id']),
  };
}

async function lerConsumos(
  l: Fonte,
  est: number,
  filtro: string,
  args: readonly unknown[],
  teto = TETO,
): Promise<{ itens: ConsumoOpmeLeitura[]; cortada: boolean }> {
  const linhas = await l.consultar<Linha>(
    `${SQL_CONSUMO} AND ${filtro} ORDER BY co.registrado_em, co.id LIMIT ?`,
    [est, ...args, teto + 1],
  );
  return { itens: linhas.slice(0, teto).map(consumoDe), cortada: linhas.length > teto };
}

async function lerSolicitacoes(
  l: Fonte,
  est: number,
  filtro: string,
  args: readonly unknown[],
  teto = TETO,
): Promise<{ itens: SolicitacaoOpme[]; cortada: boolean }> {
  const linhas = await l.consultar<Linha>(
    `${SQL_SOLICITACAO} AND ${filtro} ORDER BY s.cirurgia_prevista_em, s.id LIMIT ?`,
    [est, ...args, teto + 1],
  );
  const cab = linhas.slice(0, teto);
  if (!cab.length) return { itens: [], cortada: false };
  const ids = cab.map((r) => n(r['id']));
  const itens = cab.map((r) => n(r['item_id']));
  const [respostas, consumos] = await Promise.all([
    l.consultar<Linha>(
      `SELECT a.id, a.solicitacao_opme_id, a.situacao, a.senha_autorizacao, a.validade, a.respondido_em,
              a.motivo_negativa, a.observacao, u.login
         FROM autorizacao_opme a LEFT JOIN usuario u ON u.id = a.autorizador_usuario_id
        WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.solicitacao_opme_id IN (${marcas(ids)})
        ORDER BY a.respondido_em, a.id`,
      [est, ...ids],
    ),
    lerConsumos(l, est, `co.solicitacao_opme_item_id IN (${marcas(itens)})`, itens, 10_000),
  ]);
  return {
    itens: cab.map((r) => solicitacaoDe(r, respostas, consumos.itens)),
    cortada: linhas.length > teto,
  };
}

function solicitacaoDe(
  r: Linha,
  respostas: readonly Linha[],
  consumos: readonly ConsumoOpmeLeitura[],
): SolicitacaoOpme {
  const id = n(r['id']);
  const meus = consumos.filter((c) => c.solicitacao === id);
  const consumida = qtd(meus.reduce((s, c) => s + c.quantidade, 0));
  const devolvida = qtd(meus.reduce((s, c) => s + c.devolvida, 0));
  const etapas: Omit<EtapaOpmeLida, 'seq'>[] = [];
  const vazia = {
    quantidade: null,
    fornecedor: null,
    senha: null,
    guia: null,
    validade: null,
    pedido: null,
    nf: null,
    saida: null,
    lancamento: null,
    consumo: null,
    observacao: null,
  };
  etapas.push({
    ...vazia,
    etapa: 'solicitacao',
    em: hm(r['solicitado_em']),
    quantidade: n(r['quantidade_solicitada']),
    usuario: String(r['criado_por']),
  });
  if (String(r['item_situacao']) === 'cotado' && r['item_alterado_em'])
    etapas.push({
      ...vazia,
      etapa: 'cotacao',
      em: hm(r['item_alterado_em']),
      fornecedor: nulo(r['empresa_fornecedora_id']),
      usuario: String(r['alterado_login'] ?? r['criado_por']),
    });
  let senha: string | null = null;
  let guia: string | null = null;
  let validade: string | null = null;
  for (const a of respostas.filter((x) => n(x['solicitacao_opme_id']) === id)) {
    const negada = String(a['situacao']) === 'negada';
    const g = guiaDe(a['observacao']);
    if (!negada) {
      senha = txt(a['senha_autorizacao']);
      guia = g.guia;
      validade = dia(a['validade']);
    }
    etapas.push({
      ...vazia,
      etapa: negada ? 'negativa' : 'autorizacao',
      em: hm(a['respondido_em']),
      quantidade: negada ? null : nulo(r['quantidade_autorizada']),
      senha: negada ? null : txt(a['senha_autorizacao']),
      guia: negada ? null : g.guia,
      validade: negada ? null : dia(a['validade']),
      observacao: negada ? txt(a['motivo_negativa']) : g.observacao,
      usuario: String(a['login'] ?? ''),
    });
  }
  for (const c of meus) {
    etapas.push({
      ...vazia,
      etapa: 'consumo',
      em: c.em,
      quantidade: c.quantidade,
      saida: c.saida,
      lancamento: c.lancamento,
      consumo: c.id,
      usuario: c.usuario,
    });
    if (c.devolvida > 0)
      etapas.push({
        ...vazia,
        etapa: 'devolucao',
        em: c.em,
        quantidade: c.devolvida,
        consumo: c.id,
        usuario: c.usuario,
      });
  }
  if (r['cancelado_em'])
    etapas.push({
      ...vazia,
      etapa: 'cancelamento',
      em: hm(r['cancelado_em']),
      observacao: txt(r['observacao']),
      usuario: String(r['alterado_login'] ?? r['criado_por']),
    });
  return {
    id,
    agendamento: n(r['agendamento_cirurgico_id']),
    sala: n(r['sala_cirurgica_id']),
    dataHora: hm(r['cirurgia_prevista_em'] ?? r['inicio_previsto_em']),
    atendimento: n(r['atendimento_id']),
    item: n(r['insumo_id']),
    itemNome: txt(r['insumo_nome']) ?? txt(r['descricao']),
    tuss: String(r['codigo_referencia'] ?? ''),
    quantidade: n(r['quantidade_solicitada']),
    fornecedor: nulo(r['empresa_fornecedora_id']),
    fornecedorNome: txt(r['fornecedor_nome']),
    justificativa: String(r['justificativa_clinica'] ?? ''),
    situacao: situacaoLida(String(r['situacao']), consumida, devolvida),
    autorizada: n(r['quantidade_autorizada']),
    consumida,
    devolvida,
    consignado: verdadeiro(r['consignado']),
    senha,
    guia,
    validadeSenha: validade,
    versao: n(r['versao']),
    criadoPor: String(r['criado_por']),
    criadoEm: hm(r['solicitado_em']),
    etapas: etapas.map((e, k) => ({ ...e, seq: k + 1 })),
  };
}

// ── O gravador (dentro da operação do executor) ──────────────────────────────────────────────────────────────────

const OP_SOLICITAR = 'opme.solicitar';
const OP_ETAPA = 'opme.etapa';

/**
 * O pedido da solicitação que o reenvio com a mesma chave tem de repetir: só o que a tela manda (a hora do pedido é
 * a do servidor e o resto vem do cadastro, por isso ficam fora).
 */
const pedidoSolicitacao = (s: NovaSolicitacaoOpme) => ({
  agendamento: s.agendamento,
  item: s.item,
  tuss: s.tuss,
  quantidade: s.quantidade,
  fornecedor: s.fornecedor ?? null,
  justificativa: s.justificativa,
});

/** O pedido da etapa que o reenvio com a mesma chave tem de repetir (sem a versão vista e a mudança, que são lidas). */
export const pedidoEtapa = (x: PedidoEtapaOpme) => ({
  solicitacao: x.solicitacao,
  etapa: x.etapa,
  em: x.em,
  quantidade: x.quantidade ?? null,
  fornecedor: x.fornecedor ?? null,
  senha: x.senha ?? null,
  guia: x.guia ?? null,
  validade: x.validade ?? null,
  pedido: x.pedido ?? null,
  nf: x.nf ?? null,
  saida: x.saida ?? null,
  lancamento: x.lancamento ?? null,
  consumo: x.consumo ?? null,
  observacao: x.observacao ?? null,
});

function gravadorSobre(tx: TxOperacao, est: number): GravadorOpme {
  const usuario = (): number => {
    const u = tx.contexto.usuario;
    if (u === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    return u;
  };
  const guardar = async (operacao: string, chave: string | null, entrada: unknown, r: ResultadoOperacao) => {
    if (!chave) return;
    await gravarIdempotencia(tx, {
      operacao,
      chave,
      estabelecimento: est,
      usuario: tx.contexto.usuario,
      hashEntrada: hashEntrada(operacao, entrada),
      resultado: r,
      trilha: null,
      agora: new Date(),
    });
  };
  return {
    async solicitacao(id) {
      const trava = await tx.consultarParaAtualizar<Linha>(
        'SELECT id FROM solicitacao_opme WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      if (!trava.length) return null;
      return (await lerSolicitacoes(tx, est, 's.id = ?', [id])).itens[0] ?? null;
    },

    async etapaPelaChave(chave, pedido) {
      const r = await lerIdempotencia(tx, OP_ETAPA, chave);
      if (!r) return null;
      // A chave é do usuário, do estabelecimento e do conteúdo do pedido: qualquer diferença é outro pedido.
      const sol = await tx.uma<Linha>(
        'SELECT id FROM solicitacao_opme WHERE id = ? AND estabelecimento_id = ?',
        [n(r.resultado['solicitacao']), est],
      );
      if (
        !sol ||
        r.usuario !== tx.contexto.usuario ||
        r.hashEntrada !== hashEntrada(OP_ETAPA, pedidoEtapa(pedido))
      )
        throw erroIdempotenciaDivergente();
      return { id: n(r.resultado['etapa']), solicitacao: n(r.resultado['solicitacao']) };
    },

    async solicitar(s: NovaSolicitacaoOpme) {
      if (s.chave) {
        const ja = await lerIdempotencia(tx, OP_SOLICITAR, s.chave);
        if (ja) {
          const id = n(ja.resultado['id']);
          const v = await tx.uma<Linha>(
            'SELECT versao FROM solicitacao_opme WHERE id = ? AND estabelecimento_id = ?',
            [id, est],
          );
          // A chave é do usuário, do estabelecimento e do conteúdo do pedido: qualquer diferença é outro pedido.
          if (
            !v ||
            ja.usuario !== tx.contexto.usuario ||
            ja.hashEntrada !== hashEntrada(OP_SOLICITAR, pedidoSolicitacao(s))
          )
            throw erroIdempotenciaDivergente();
          return { id, versao: n(v['versao']), repetida: true };
        }
      }
      const a = await tx.uma<Linha>(
        `SELECT a.paciente_id, a.fonte_pagadora_id, a.profissional_id, ag.cirurgiao_profissional_id,
                ag.solicitante_profissional_id, ag.fonte_pagadora_id AS ag_fonte, ag.plano_fonte_pagadora_id
           FROM atendimento a
           LEFT JOIN agendamento_cirurgico ag ON ag.id = ? AND ag.estabelecimento_id = a.estabelecimento_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [s.agendamento, s.reg, est],
      );
      if (!a) throw recusa('atendimento-inexistente', 'O atendimento não é deste estabelecimento.');
      const medico = nulo(
        a['cirurgiao_profissional_id'] ?? a['solicitante_profissional_id'] ?? a['profissional_id'],
      );
      if (medico === null)
        throw recusa(
          'sem-medico',
          'A cirurgia não tem o médico solicitante: informe o cirurgião no agendamento.',
        );
      const fonte = nulo(a['ag_fonte'] ?? a['fonte_pagadora_id']);
      if (fonte === null) throw recusa('sem-fonte-pagadora', 'O atendimento não tem a fonte pagadora.');
      const ins = await tx.uma<Linha>('SELECT nome FROM insumo WHERE id = ? AND excluido_em IS NULL', [
        s.item,
      ]);
      if (!ins) throw recusa('item-inexistente', 'O item não está no cadastro.', { campos: ['item'] });
      const numero = await tx.proximoNumero('solicitacao_opme');
      const id = await tx.incluir('solicitacao_opme', {
        estabelecimento_id: est,
        numero: numero.valor,
        atendimento_id: s.reg,
        paciente_id: n(a['paciente_id']),
        agendamento_cirurgico_id: s.agendamento,
        profissional_id: medico,
        fonte_pagadora_id: fonte,
        plano_fonte_pagadora_id: nulo(a['plano_fonte_pagadora_id']),
        cirurgia_prevista_em: coluna(s.dataHora),
        justificativa_clinica: s.justificativa,
        solicitante_usuario_id: usuario(),
        solicitado_em: coluna(s.em),
        situacao: 'solicitada',
      });
      await tx.incluir('solicitacao_opme_item', {
        solicitacao_opme_id: id,
        sequencia: 1,
        insumo_id: s.item,
        descricao: String(ins['nome']).slice(0, 150),
        codigo_referencia: s.tuss,
        quantidade_solicitada: s.quantidade,
        empresa_fornecedora_id: s.fornecedor,
        situacao: 'solicitado',
      });
      await guardar(OP_SOLICITAR, s.chave, pedidoSolicitacao(s), { id });
      return { id, versao: 1, repetida: false };
    },

    async avancar(
      x: NovaEtapaOpme & { readonly versaoVista: number; readonly mudanca: MudancaSolicitacaoOpme },
    ) {
      const pendente = ETAPA_PENDENTE[x.etapa];
      if (pendente) throw modeloPendente(pendente);
      const [s] = await tx.consultarParaAtualizar<Linha>(
        `SELECT s.id, s.versao, s.atendimento_id, s.fonte_pagadora_id, s.solicitante_usuario_id, s.solicitado_em,
                s.agendamento_cirurgico_id, s.observacao, i.id AS item_id, i.versao AS item_versao,
                i.empresa_fornecedora_id
           FROM solicitacao_opme s
           JOIN solicitacao_opme_item i ON i.solicitacao_opme_id = s.id AND i.sequencia = 1 AND i.excluido_em IS NULL
          WHERE s.id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL`,
        [x.solicitacao, est],
      );
      if (!s) throw recusa('solicitacao-inexistente', 'A solicitação de OPME não existe.');
      if (n(s['versao']) !== x.versaoVista)
        throw recusa('opme-mudou', 'A solicitação de OPME mudou em outra tela: recarregue e confira.');
      const m = x.mudanca;
      const situacao = PARA_BANCO[m.situacao];
      const em = coluna(x.em);
      let etapa: number;
      const fornecedor = x.fornecedor ?? m.fornecedor ?? nulo(s['empresa_fornecedora_id']);
      const cab: Record<string, unknown> = { situacao };
      if (x.etapa === 'cotacao') {
        await tx.alterar('solicitacao_opme_item', n(s['item_id']), n(s['item_versao']), {
          empresa_fornecedora_id: fornecedor,
          situacao: 'cotado',
        });
        etapa = n(s['item_id']);
      } else if (x.etapa === 'autorizacao' || x.etapa === 'negativa') {
        const autoriza = x.etapa === 'autorizacao';
        etapa = await tx.incluir('autorizacao_opme', {
          estabelecimento_id: est,
          solicitacao_opme_id: n(s['id']),
          atendimento_id: n(s['atendimento_id']),
          fonte_pagadora_id: n(s['fonte_pagadora_id']),
          agendamento_cirurgico_id: nulo(s['agendamento_cirurgico_id']),
          senha_autorizacao: autoriza ? (x.senha ?? null) : null,
          validade: autoriza ? (x.validade ?? null) : null,
          solicitante_usuario_id: n(s['solicitante_usuario_id']),
          solicitado_em: s['solicitado_em'],
          autorizador_usuario_id: usuario(),
          respondido_em: em,
          situacao: autoriza ? 'autorizada' : 'negada',
          motivo_negativa: autoriza ? null : (x.observacao ?? 'Negada pela operadora.'),
          observacao: autoriza ? comGuia(x.guia, x.observacao) : null,
        });
        await tx.alterar('solicitacao_opme_item', n(s['item_id']), n(s['item_versao']), {
          ...(autoriza
            ? {
                quantidade_autorizada: m.autorizada ?? x.quantidade ?? 0,
                ...(fornecedor !== null
                  ? { situacao: 'autorizado', empresa_fornecedora_id: fornecedor }
                  : {}),
              }
            : { situacao: 'negado' }),
        });
        if (autoriza) Object.assign(cab, { autorizador_usuario_id: usuario(), autorizado_em: em });
      } else if (x.etapa === 'cancelamento') {
        await tx.alterar('solicitacao_opme_item', n(s['item_id']), n(s['item_versao']), {
          situacao: 'cancelado',
        });
        Object.assign(cab, {
          cancelado_em: em,
          observacao: x.observacao ? x.observacao.slice(0, 4000) : txt(s['observacao']),
        });
        etapa = n(s['id']);
      } else {
        throw recusa('etapa-automatica', 'O consumo e a devolução nascem do estoque, não desta tela.');
      }
      const versao = await tx.alterar('solicitacao_opme', n(s['id']), n(s['versao']), cab);
      await guardar(OP_ETAPA, x.chave, pedidoEtapa(x), { etapa, solicitacao: n(s['id']) });
      return { etapa, versao };
    },
  };
}

export class PortaOpmePropria implements PortaOpme {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;
  private readonly estoque: PortaSuprimentosPropria;

  constructor(
    private readonly nucleo: NucleoOpme,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
    this.estoque = new PortaSuprimentosPropria(nucleo, this.executor);
  }

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoNucleo(c, 'opme'), (l) => fn(l, est));
  }

  /** O consumo e a devolução em sala vão pela operação do estoque (o consumo_opme na mesma transação). */
  async podeGravar(c: ContextoPortaM18, op?: string): Promise<LiberacaoGravacao> {
    const nome = op ?? 'suprimentos.registrarSaida';
    if (!OPERACOES_ESTOQUE.has(nome))
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida no OPME.' };
    return this.estoque.podeGravar(c, nome);
  }

  executar(c: ContextoNucleo, op: string, e: unknown, ctx: ContextoOperacao) {
    if (!OPERACOES_ESTOQUE.has(op))
      return Promise.reject(recusa('operacao-desconhecida', 'Operação desconhecida no OPME.'));
    return this.estoque.executar(c, op, e, ctx);
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorOpme) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const op = definirOperacao({
      nome: 'opme.gravacao',
      tabelas: [...TABELAS_OPME],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'solicitacao_opme', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
      eventos: () => [{ tipo: 'opme.gravacao', carga: { id: linha()?.entidadeId ?? null } }],
    });
    // A idempotência da tela é a do gravador (pela chave do pedido); a do executor é por chamada.
    const chave = `opme:${randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      {
        ...contextoNucleo(c, 'opme'),
        chaveIdempotencia: chave,
      },
    );
    if (!saida) throw new Error('Gravação do OPME sem resultado.');
    return (saida as { valor: T }).valor;
  }

  /** A classe de OPME quando o insumo tem a marca de OPME; fora do OPME ou inexistente: null (a tela recusa). */
  classeDoItem(c: ContextoNucleo, item: number): Promise<number | null> {
    return this.ler(c, async (l) => {
      // Cadastro do insumo: da rede inteira (sem estabelecimento).
      const r = await l.uma<{ opme: unknown }>(
        'SELECT opme FROM insumo WHERE id = ? AND excluido_em IS NULL',
        [item],
      );
      return r && verdadeiro(r.opme) ? CLASSE_OPME : null;
    });
  }

  itemConsignado(c: ContextoNucleo, item: number): Promise<boolean> {
    return this.ler(c, async (l) => {
      const r = await l.uma<{ consignado: unknown }>(
        'SELECT consignado FROM insumo WHERE id = ? AND excluido_em IS NULL',
        [item],
      );
      return !!r && verdadeiro(r.consignado);
    });
  }

  /** O primeiro dos locais (na ordem dada) do estabelecimento com saldo de OPME, próprio ou consignado. */
  localComSaldo(c: ContextoNucleo, locais: readonly number[]): Promise<number | null> {
    const ids = [...new Set(locais.filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<{ local_estoque_id: unknown }>(
        `SELECT DISTINCT s.local_estoque_id
           FROM saldo_estoque s
           JOIN insumo i ON i.id = s.insumo_id AND i.opme = TRUE AND i.excluido_em IS NULL
           JOIN local_estoque le ON le.id = s.local_estoque_id AND le.estabelecimento_id = ? AND le.excluido_em IS NULL
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL AND (s.quantidade > 0 OR s.quantidade_consignada > 0)
            AND s.local_estoque_id IN (${marcas(ids)})`,
        [est, est, ...ids],
      );
      const com = new Set(linhas.map((r) => Number(r.local_estoque_id)));
      return locais.find((x) => com.has(x)) ?? null;
    });
  }

  async solicitacoesDosAgendamentos(c: ContextoPortaM18, agendamentos: readonly number[]) {
    if (!agendamentos.length) return [];
    return this.ler(
      c,
      async (l, est) =>
        (
          await lerSolicitacoes(
            l,
            est,
            `s.agendamento_cirurgico_id IN (${marcas(agendamentos)})`,
            agendamentos,
            10_000,
          )
        ).itens,
    );
  }

  solicitacoesDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    return this.ler(c, (l, est) =>
      lerSolicitacoes(l, est, 's.cirurgia_prevista_em >= ? AND s.cirurgia_prevista_em < ?', [
        de,
        diaSeguinte(ate),
      ]),
    );
  }

  solicitacao(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) => (await lerSolicitacoes(l, est, 's.id = ?', [id])).itens[0] ?? null);
  }

  async consumosDosAgendamentos(c: ContextoPortaM18, agendamentos: readonly number[]) {
    if (!agendamentos.length) return [];
    return this.ler(
      c,
      async (l, est) =>
        (
          await lerConsumos(
            l,
            est,
            `co.agendamento_cirurgico_id IN (${marcas(agendamentos)})`,
            agendamentos,
            10_000,
          )
        ).itens,
    );
  }

  consumosDoPeriodo(c: ContextoPortaM18, de: string, ate: string) {
    return this.ler(c, (l, est) =>
      lerConsumos(
        l,
        est,
        'COALESCE(ag.inicio_previsto_em, co.registrado_em) >= ? AND COALESCE(ag.inicio_previsto_em, co.registrado_em) < ?',
        [de, diaSeguinte(ate)],
      ),
    );
  }

  consumo(c: ContextoPortaM18, id: number) {
    return this.ler(c, async (l, est) => (await lerConsumos(l, est, 'co.id = ?', [id])).itens[0] ?? null);
  }

  /** O consumo gravado pela chave do pedido: o resultado guardado da saída do estoque aponta o consumo. */
  consumoPelaChave(c: ContextoPortaM18, chave: string) {
    return this.ler(c, async (l, est) => {
      const r = await lerIdempotencia(l, 'suprimentos.registrar_saida', chave);
      const id = r ? nulo(r.resultado['consumo']) : null;
      if (id === null) return null;
      return (await lerConsumos(l, est, 'co.id = ?', [id])).itens[0] ?? null;
    });
  }

  localDaSaida(c: ContextoPortaM18, saida: { ano: number; mes: number; doc: number; id?: number }) {
    return this.ler(c, async (l, est) => {
      const r =
        saida.id !== undefined
          ? await l.uma<Linha>(
              'SELECT origem_local_estoque_id, numero FROM documento_estoque WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [saida.id, est],
            )
          : await l.uma<Linha>(
              `SELECT origem_local_estoque_id FROM documento_estoque
                WHERE numero = ? AND estabelecimento_id = ? AND YEAR(criado_em) = ? AND MONTH(criado_em) = ?
                  AND excluido_em IS NULL`,
              [saida.doc, est, saida.ano, saida.mes],
            );
      return r ? nulo(r['origem_local_estoque_id']) : null;
    });
  }

  documentosCompra(
    c: ContextoPortaM18,
    d: {
      fornecedor: number | null;
      pedido: { ano: number; doc: number } | null;
      nf: { ano: number; mes: number; doc: number } | null;
    },
  ) {
    return this.ler(c, async (l, est) => {
      const f =
        d.fornecedor === null
          ? null
          : await l.uma<Linha>(
              'SELECT COALESCE(nome_fantasia, razao_social) AS nome FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL',
              [d.fornecedor],
            );
      let pedido: { fornecedores: number[] } | null = null;
      if (d.pedido) {
        const p = await l.uma<Linha>(
          `SELECT id, empresa_fornecedora_id, cotacao_id FROM pedido_compra
            WHERE estabelecimento_id = ? AND ano = ? AND numero = ? AND excluido_em IS NULL`,
          [est, d.pedido.ano, d.pedido.doc],
        );
        if (p) {
          const cot = p['cotacao_id']
            ? await l.consultar<Linha>(
                'SELECT empresa_fornecedora_id FROM cotacao_fornecedor WHERE cotacao_id = ? AND excluido_em IS NULL',
                [n(p['cotacao_id'])],
              )
            : [];
          pedido = {
            fornecedores: [
              ...new Set([n(p['empresa_fornecedora_id']), ...cot.map((x) => n(x['empresa_fornecedora_id']))]),
            ].filter((x) => x > 0),
          };
        }
      }
      let nf: { fornecedor: number } | null = null;
      if (d.nf) {
        const x = await l.uma<Linha>(
          `SELECT empresa_fornecedora_id FROM nota_entrada
            WHERE estabelecimento_id = ? AND numero = ? AND YEAR(criado_em) = ? AND MONTH(criado_em) = ?
              AND excluido_em IS NULL`,
          [est, d.nf.doc, d.nf.ano, d.nf.mes],
        );
        if (x) nf = { fornecedor: n(x['empresa_fornecedora_id']) };
      }
      return { fornecedor: f ? String(f['nome']) : null, pedido, nf };
    });
  }

  /** Os fornecedores de OPME ativos (cadastro da rede) pelo código ou pelo nome. */
  fornecedores(c: ContextoPortaM18, termo: string) {
    return this.ler(c, async (l) => {
      const t = termo.trim();
      const porCodigo = /^\d+$/.test(t);
      const linhas = await l.consultar<Linha>(
        `SELECT id, COALESCE(nome_fantasia, razao_social) AS nome FROM empresa_fornecedora
          WHERE excluido_em IS NULL AND situacao = 'ativo' AND fornece_opme = TRUE
            AND ${porCodigo ? 'id = ?' : '(UPPER(razao_social) LIKE ? OR UPPER(nome_fantasia) LIKE ?)'}
          ORDER BY nome LIMIT 31`,
        porCodigo ? [Number(t)] : [`%${t.toUpperCase()}%`, `%${t.toUpperCase()}%`],
      );
      return {
        itens: linhas.slice(0, 30).map((r) => ({ codigo: n(r['id']), nome: String(r['nome']) })),
        cortada: linhas.length > 30,
      };
    });
  }

  /** Os itens de OPME com o saldo no local, o saldo do estabelecimento e os lotes válidos do local. */
  itens(c: ContextoPortaM18, f: { termo: string; local: number; hoje: string }) {
    return this.ler(c, async (l, est) => {
      const t = f.termo.trim().toUpperCase();
      const filtro = /^\d+$/.test(t)
        ? { sql: 'i.id = ?', args: [Number(t)] }
        : t.length >= 2
          ? { sql: 'UPPER(i.nome) LIKE ?', args: [`%${t}%`] }
          : { sql: '(COALESCE(sl.quantidade, 0) > 0 OR i.consignado = TRUE)', args: [] };
      const linhas = await l.consultar<Linha>(
        `SELECT i.id, i.nome, i.consignado, i.controla_lote, um.sigla,
                COALESCE(sl.quantidade, 0) + COALESCE(sl.quantidade_consignada, 0) AS saldo_local,
                (SELECT COALESCE(SUM(s2.quantidade + s2.quantidade_consignada), 0) FROM saldo_estoque s2
                  WHERE s2.insumo_id = i.id AND s2.estabelecimento_id = ? AND s2.excluido_em IS NULL) AS estoque
           FROM insumo i
           LEFT JOIN unidade_medida um ON um.id = i.estoque_unidade_medida_id
           LEFT JOIN saldo_estoque sl ON sl.insumo_id = i.id AND sl.local_estoque_id = ? AND sl.estabelecimento_id = ?
                AND sl.excluido_em IS NULL
          WHERE i.opme = TRUE AND i.excluido_em IS NULL AND ${filtro.sql}
          ORDER BY i.nome, i.id LIMIT 51`,
        [est, f.local, est, ...filtro.args],
      );
      const cab = linhas.slice(0, 50);
      const ids = cab.map((r) => n(r['id']));
      const lotes = ids.length
        ? await l.consultar<Linha>(
            `SELECT li.insumo_id, li.numero_lote, li.validade, sl.quantidade + sl.quantidade_consignada AS saldo
               FROM saldo_lote sl JOIN lote_insumo li ON li.id = sl.lote_insumo_id AND li.excluido_em IS NULL
              WHERE sl.estabelecimento_id = ? AND sl.local_estoque_id = ? AND sl.excluido_em IS NULL
                AND sl.quantidade + sl.quantidade_consignada > 0 AND li.validade >= ? AND li.situacao = 'liberado'
                AND li.insumo_id IN (${marcas(ids)})
              ORDER BY li.validade, li.numero_lote`,
            [est, f.local, f.hoje, ...ids],
          )
        : [];
      const itens = cab.map((r): ItemOpme => ({
        item: n(r['id']),
        nome: String(r['nome']),
        unidade: String(r['sigla'] ?? ''),
        saldoLocal: n(r['saldo_local']),
        estoque: n(r['estoque']),
        consignado: verdadeiro(r['consignado']),
        rastreavel: verdadeiro(r['controla_lote']),
        lotes: lotes
          .filter((x) => n(x['insumo_id']) === n(r['id']))
          .map((x) => ({
            lote: String(x['numero_lote']),
            validade: dia(x['validade']) ?? '',
            saldo: n(x['saldo']),
          })),
      }));
      return { itens, cortada: linhas.length > 50 };
    });
  }

  /** Do lote, da série ou do registro Anvisa aos pacientes expostos; com item e lote, as saídas do lote no estoque. */
  rastreioReverso(
    c: ContextoPortaM18,
    f: { item: number | null; lote: string | null; serie: string | null; registroAnvisa: string | null },
  ) {
    return this.ler(c, async (l, est) => {
      const conds: string[] = [];
      const args: unknown[] = [];
      if (f.item !== null) {
        conds.push('co.insumo_id = ?');
        args.push(f.item);
      }
      if (f.lote) {
        conds.push('co.numero_lote = ?');
        args.push(f.lote);
      }
      if (f.serie) {
        conds.push('co.numero_serie = ?');
        args.push(f.serie);
      }
      if (f.registroAnvisa) {
        conds.push('co.registro_anvisa = ?');
        args.push(f.registroAnvisa);
      }
      if (!conds.length)
        return { itemNome: null, expostos: [], saidasDoLote: 0, saidasEstoque: [], cortada: false };
      const r = await lerConsumos(l, est, conds.join(' AND '), args);
      const expostos = r.itens.map((x): ExpostoOpme => ({
        consumo: x.id,
        atendimento: x.atendimento,
        paciente: x.paciente,
        agendamento: x.agendamento,
        sala: x.sala,
        dataHora: x.dataHora,
        cirurgiao: x.cirurgiao,
        quantidade: x.quantidade,
        devolvida: x.devolvida,
        saida: x.saida,
        lote: x.lote,
        serie: x.serie,
        registroAnvisa: x.registroAnvisa,
        usuario: x.usuario,
      }));
      let saidasEstoque: SaidaLoteOpme[] = [];
      let cortada = r.cortada;
      if (f.item !== null && f.lote) {
        const ls = await l.consultar<Linha>(
          `SELECT me.id, me.documento_estoque_id, d.numero, d.criado_em, me.ocorrido_em, me.insumo_id,
                  me.atendimento_id, me.paciente_id, ml.quantidade,
                  EXISTS (SELECT 1 FROM consumo_opme co WHERE co.movimento_estoque_id = me.id AND co.excluido_em IS NULL)
                    AS em_sala
             FROM movimento_lote ml
             JOIN lote_insumo li ON li.id = ml.lote_insumo_id
             JOIN movimento_estoque me ON me.id = ml.movimento_estoque_id
             LEFT JOIN documento_estoque d ON d.id = me.documento_estoque_id
            WHERE me.estabelecimento_id = ? AND me.natureza = 'saida' AND me.excluido_em IS NULL
              AND ml.excluido_em IS NULL AND li.insumo_id = ? AND li.numero_lote = ?
            ORDER BY me.ocorrido_em, me.id LIMIT ?`,
          [est, f.item, f.lote, TETO + 1],
        );
        cortada = cortada || ls.length > TETO;
        saidasEstoque = ls.slice(0, TETO).map((x) => ({
          saida: { id: n(x['documento_estoque_id']), ...chaveDoc(x['numero'], x['criado_em']) },
          data: dia(x['ocorrido_em']),
          item: n(x['insumo_id']),
          atendimento: n(x['atendimento_id']),
          paciente: nulo(x['paciente_id']),
          quantidade: n(x['quantidade']),
          origem: verdadeiro(x['em_sala']) ? 'consumo-em-sala' : 'estoque',
        }));
      }
      const nome =
        f.item !== null
          ? await l.uma<Linha>('SELECT nome FROM insumo WHERE id = ? AND excluido_em IS NULL', [f.item])
          : null;
      return {
        itemNome: nome ? String(nome['nome']) : null,
        expostos,
        saidasDoLote: saidasEstoque.length,
        saidasEstoque,
        cortada,
      };
    });
  }

  /** O que a conta do paciente cobra de cada item (lançamentos ligados ao movimento do estoque). */
  async itensDaConta(c: ContextoPortaM18, contas: readonly number[], itens: readonly number[]) {
    if (!contas.length || !itens.length) return [];
    return this.ler(c, async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT chi.conta_hospitalar_id AS conta, me.insumo_id AS item, SUM(chi.quantidade) AS quantidade
           FROM conta_hospitalar_item chi
           JOIN conta_hospitalar ch ON ch.id = chi.conta_hospitalar_id AND ch.estabelecimento_id = ?
           JOIN movimento_estoque me ON me.id = chi.movimento_estoque_id
          WHERE chi.excluido_em IS NULL AND chi.conta_hospitalar_id IN (${marcas(contas)})
            AND me.insumo_id IN (${marcas(itens)})
          GROUP BY chi.conta_hospitalar_id, me.insumo_id`,
        [est, ...contas, ...itens],
      );
      return linhas
        .map((r) => ({ conta: n(r['conta']), item: n(r['item']), quantidade: qtd(n(r['quantidade'])) }))
        .filter((x) => x.quantidade > 0);
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaOpmeIndisponivel(): PortaOpme {
  return portaIndisponivel<PortaOpme>(METODOS_PORTA_OPME);
}
