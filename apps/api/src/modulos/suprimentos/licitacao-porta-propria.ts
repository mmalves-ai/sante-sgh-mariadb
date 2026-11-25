// Porta própria do processo de contratação pública (C2-017, 09-AREA linha 81; Lei 14.133/2021) sobre o MariaDB do
// cliente, pelo executor do núcleo (a trilha na mesma transação). As mesmas regras e recusas da porta em memória, todas
// do domínio (regras-suprimentos/licitacao): a porta só lê o estado relido na transação, com o processo travado pela
// versão, e grava o que a regra decidiu.
//   - processo_licitatorio e processo_licitatorio_item: o termo de referência, a estimativa, o julgamento por item
//     (resultado, vencedor pela proposta do item, valor adjudicado) e a homologação (quem e quando);
//   - pesquisa_preco e pesquisa_preco_item: a pesquisa de preços do processo (uma por processo, fechada ao sair da
//     etapa), o descarte do preço fica gravado com a justificativa (fora da conta, nunca apagado);
//   - proposta_licitacao e proposta_licitacao_item: a proposta do fornecedor (habilitação é do licitante: a
//     inabilitação vale para todos os itens dele) e o preço por item (desclassificação por item);
//   - evento_processo_licitatorio: o histórico, só de inclusão (etapa, parecer, publicação, esclarecimento, recurso,
//     decisão, documento, ata, pedido); o pedido de compra gerado fica ligado ao processo (pedido_compra).
// A chave de cada ato da tela fica em idempotencia_operacao: o reenvio igual devolve o já gravado.
import {
  type EtapaLicitacao,
  type EventoLicitacao,
  type FiltroLicitacoes,
  type ItemLicitacao,
  type ItemLicitacaoEntrada,
  type LicitacaoGravada,
  type PainelLicitacoes,
  type ParametrosLicitacao,
  type PedidoMarcadoLicitacao,
  type PrecoPesquisado,
  type PropostaLicitacao,
  TETO_LISTA_LICITACOES,
} from '@sgh/contratos';
import {
  descricaoDocumentoLicitacao,
  estimarLicitacao,
  etapaDepoisDoEvento,
  etapaFinal,
  julgarLicitacao,
  montarLicitacao,
  podeAlterarTermo,
  podeAvancar,
  podeDescartarPreco,
  podeEncerrar,
  podeHomologar,
  podeMudarSituacaoProposta,
  podeRegistrarEvento,
  podeRegistrarPreco,
  podeRegistrarProposta,
  type RecusaSuprimentos,
  resumoLicitacao,
} from '@sgh/dominio-suprimentos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  erroConflitoVersao,
  erroIdempotenciaDivergente,
  type Executor,
  gravarIdempotencia,
  hashEntrada,
  type Leitor,
  type Linha,
  lerIdempotencia,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { portaIndisponivel } from '../exames/public-api.js';
import type { FornecedorContrato, UsuarioContrato } from './contrato-porta.js';
import {
  type GravadorLicitacao,
  type LicitacaoGravacao,
  METODOS_PORTA_LICITACAO,
  type PortaLicitacao,
} from './licitacao-porta.js';

export type NucleoLicitacao = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que a gravação do processo escreve (o executor confere cada escrita contra esta lista). */
export const TABELAS_LICITACAO = [
  'processo_licitatorio',
  'processo_licitatorio_item',
  'pesquisa_preco',
  'pesquisa_preco_item',
  'proposta_licitacao',
  'proposta_licitacao_item',
  'evento_processo_licitatorio',
  'pedido_compra',
  'idempotencia_operacao',
] as const;

/** A operação do executor e a operação sob a qual a chave de cada ato da tela fica guardada. */
export const OPERACAO_LICITACAO = 'suprimentos.licitacao.gravacao';
export const OPERACAO_CHAVE_LICITACAO = 'suprimentos.licitacao.ato';
const TETO_PEDIDOS = 500;

type L = Linha;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txtOuNull = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);
/** Código do contrato (com hífen) ↔ código do banco (com sublinhado). */
const hifen = <T extends string>(v: unknown): T => String(v).replace(/_/g, '-') as T;
const sub = (v: string): string => v.replace(/-/g, '_');
function dataIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}
function instante(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? '').replace(' ', 'T');
}
const hojeLocal = (): string => dataIso(new Date())!;
const lancar = (r: RecusaSuprimentos | null) => {
  if (r) throw recusa(r.codigo, r.mensagem, r.campos ? { campos: r.campos } : {});
};
const like = (t: string) => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const SQL_PROCESSO = `SELECT p.*, ua.login AS agente_login, uj.login AS julgado_login, uh.login AS homologado_login,
        uc.login AS criado_login
   FROM processo_licitatorio p
   LEFT JOIN usuario ua ON ua.id = p.agente_contratacao_usuario_id
   LEFT JOIN usuario uj ON uj.id = p.julgado_por_usuario_id
   LEFT JOIN usuario uh ON uh.id = p.homologado_por_usuario_id
   LEFT JOIN usuario uc ON uc.id = p.criado_por`;

function processoDe(r: L): LicitacaoGravada {
  return {
    id: num(r['id']),
    numero: String(r['numero']),
    regime: hifen(r['regime']),
    modalidade: hifen(r['modalidade']),
    criterio: hifen(r['criterio_julgamento']),
    natureza: hifen(r['natureza_objeto']),
    objeto: String(r['objeto']),
    justificativa: String(r['justificativa']),
    fundamento: txtOuNull(r['fundamento_legal']),
    pesoTecnica: numOuNull(r['peso_tecnica_percentual']),
    sigiloso: Boolean(num(r['orcamento_sigiloso'])),
    metodoEstimativa: hifen(r['metodo_estimativa'] ?? 'mediana'),
    valorEstimado: numOuNull(r['valor_estimado']),
    agente: String(r['agente_login'] ?? ''),
    centroCusto: numOuNull(r['centro_custo_id']),
    etapa: String(r['etapa']) as EtapaLicitacao,
    dataPublicacao: dataIso(r['data_publicacao']),
    dataAbertura: dataIso(r['sessao_em']),
    dataJulgamento: dataIso(r['julgado_em']),
    julgadoPor: txtOuNull(r['julgado_login']),
    homologadoPor: txtOuNull(r['homologado_login']),
    homologadoEm: r['homologado_em'] ? instante(r['homologado_em']) : null,
    versao: num(r['versao']),
    usuario: String(r['criado_login'] ?? ''),
    criadoEm: instante(r['criado_em']),
  };
}

function tipoEventoDe(r: L): EventoLicitacao['tipo'] {
  if (r['assunto']) return hifen(r['assunto']);
  const t = String(r['tipo']);
  if (t === 'avanco' || t === 'homologacao' || t === 'encerramento') return 'etapa';
  return t === 'registro' ? 'parecer' : hifen(t);
}

/** O estado do processo relido (na transação ou na leitura), para as regras do domínio. */
async function carregar(q: Leitor, est: number, id: number) {
  const r = await q.uma(
    `${SQL_PROCESSO} WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
    [id, est],
  );
  if (!r) return null;
  const processo = processoDe(r);
  const itens: ItemLicitacao[] = (
    await q.consultar(
      `SELECT i.id, i.sequencia, i.descricao, i.insumo_id, i.unidade_fornecimento, i.quantidade,
              i.valor_unitario_estimado, i.resultado_julgamento, i.valor_adjudicado, pl.empresa_fornecedora_id AS vencedor
         FROM processo_licitatorio_item i
         LEFT JOIN proposta_licitacao_item pi ON pi.id = i.vencedora_proposta_licitacao_item_id
         LEFT JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
        WHERE i.processo_licitatorio_id = ? AND i.excluido_em IS NULL
        ORDER BY i.sequencia`,
      [id],
      { teto: 2_000 },
    )
  ).map((x) => ({
    id: num(x['id']),
    numero: num(x['sequencia']),
    descricao: String(x['descricao']),
    itemEstoque: numOuNull(x['insumo_id']),
    unidade: String(x['unidade_fornecimento']),
    quantidade: num(x['quantidade']),
    valorEstimado: numOuNull(x['valor_unitario_estimado']),
    resultado: (txtOuNull(x['resultado_julgamento']) as ItemLicitacao['resultado']) ?? null,
    vencedor: numOuNull(x['vencedor']),
    valorAdjudicado: numOuNull(x['valor_adjudicado']),
  }));
  const precos: PrecoPesquisado[] = (
    await q.consultar(
      `SELECT x.id, x.processo_licitatorio_item_id, x.fonte, x.referencia, x.valor_unitario, x.data_preco,
              x.empresa_fornecedora_id, x.considerado, x.motivo_desconsideracao, x.desconsiderado_em,
              uc.login AS criado_login, ua.login AS alterado_login
         FROM pesquisa_preco_item x
         JOIN pesquisa_preco pp ON pp.id = x.pesquisa_preco_id
         LEFT JOIN usuario uc ON uc.id = x.criado_por
         LEFT JOIN usuario ua ON ua.id = x.desconsiderado_por_usuario_id
        WHERE pp.processo_licitatorio_id = ? AND x.excluido_em IS NULL
        ORDER BY x.id`,
      [id],
      { teto: 10_000 },
    )
  ).map((x) => ({
    id: num(x['id']),
    item: num(x['processo_licitatorio_item_id']),
    fonte: hifen(x['fonte']),
    referencia: String(x['referencia']),
    valor: num(x['valor_unitario']),
    data: dataIso(x['data_preco'])!,
    fornecedor: numOuNull(x['empresa_fornecedora_id']),
    usuario: String(x['criado_login'] ?? ''),
    descarte: num(x['considerado'])
      ? null
      : {
          justificativa: String(x['motivo_desconsideracao'] ?? ''),
          usuario: String(x['alterado_login'] ?? ''),
          em: instante(x['desconsiderado_em']),
        },
  }));
  const propostas: PropostaLicitacao[] = (
    await q.consultar(
      `SELECT pi.id, pi.processo_licitatorio_item_id, pl.empresa_fornecedora_id, f.razao_social, pi.valor_unitario,
              pi.valor_ultimo_lance, pi.nota_tecnica, pi.marca, pi.resultado, pi.motivo_resultado, pl.habilitacao,
              pl.motivo_inabilitacao
         FROM proposta_licitacao_item pi
         JOIN proposta_licitacao pl ON pl.id = pi.proposta_licitacao_id
         JOIN empresa_fornecedora f ON f.id = pl.empresa_fornecedora_id
        WHERE pl.processo_licitatorio_id = ? AND pi.excluido_em IS NULL AND pl.excluido_em IS NULL
        ORDER BY pi.id`,
      [id],
      { teto: 10_000 },
    )
  ).map((x) => {
    const desclassificada = x['resultado'] === 'desclassificado';
    const inabilitada = !desclassificada && x['habilitacao'] === 'inabilitada';
    return {
      id: num(x['id']),
      item: num(x['processo_licitatorio_item_id']),
      fornecedor: num(x['empresa_fornecedora_id']),
      fornecedorNome: String(x['razao_social']),
      valor: num(x['valor_unitario']),
      lance: numOuNull(x['valor_ultimo_lance']),
      notaTecnica: numOuNull(x['nota_tecnica']),
      marca: txtOuNull(x['marca']),
      situacao: desclassificada ? 'desclassificada' : inabilitada ? 'inabilitada' : 'valida',
      motivo: desclassificada
        ? txtOuNull(x['motivo_resultado'])
        : inabilitada
          ? txtOuNull(x['motivo_inabilitacao'])
          : null,
    };
  });
  const eventos: EventoLicitacao[] = (
    await q.consultar(
      `SELECT e.*, u.login FROM evento_processo_licitatorio e JOIN usuario u ON u.id = e.usuario_id
        WHERE e.processo_licitatorio_id = ? ORDER BY e.id`,
      [id],
      { teto: 5_000 },
    )
  ).map((x) => ({
    id: num(x['id']),
    tipo: tipoEventoDe(x),
    de: (txtOuNull(x['etapa_anterior']) as EtapaLicitacao | null) ?? null,
    para: (txtOuNull(x['etapa_posterior']) as EtapaLicitacao | null) ?? null,
    data: dataIso(x['data_ato']),
    veiculo: x['veiculo_publicacao']
      ? hifen<NonNullable<EventoLicitacao['veiculo']>>(x['veiculo_publicacao'])
      : null,
    referencia: txtOuNull(x['referencia_ato']) ?? txtOuNull(x['referencia']),
    fornecedor: numOuNull(x['empresa_fornecedora_id']),
    resultado: txtOuNull(x['resultado']),
    pedido: numOuNull(x['pedido_compra_id']),
    documento: numOuNull(x['documento_id']),
    descricao: String(x['descricao'] ?? ''),
    usuario: String(x['login'] ?? ''),
    criadoEm: instante(x['criado_em']),
  }));
  return { processo, itens, precos, propostas, eventos };
}

async function feriadosDe(q: Leitor, est: number): Promise<string[]> {
  return (
    await q.consultar(
      `SELECT data FROM feriado WHERE ativo AND NOT ponto_facultativo AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
      [est],
      { teto: 5_000 },
    )
  ).map((x) => dataIso(x['data'])!);
}

function estadoDe(
  k: NonNullable<Awaited<ReturnType<typeof carregar>>>,
  hoje: string,
  parametros: ParametrosLicitacao,
  feriados: readonly string[],
) {
  return {
    ...k,
    hoje,
    parametros,
    feriados,
    precosDetalhe: k.precos,
    eventosDetalhe: k.eventos,
  };
}

const TIPO_DB_ETAPA = (para: string | null): string =>
  para === 'homologado'
    ? 'homologacao'
    : para && ['fracassado', 'deserto', 'revogado', 'anulado'].includes(para)
      ? 'encerramento'
      : 'avanco';

function gravadorSobre(tx: TxOperacao, est: number, hoje: string, agora: Date): GravadorLicitacao {
  const usuarioId = tx.contexto.usuario ?? null;
  const quem = (): number => {
    if (usuarioId === null) throw recusa('sem-usuario', 'A gravação do processo exige o usuário da sessão.');
    return usuarioId;
  };
  let feriados: string[] | null = null;
  const calendario = async () => (feriados ??= await feriadosDe(tx, est));

  async function porChave(
    chave: string,
    licitacao: number | null,
    entrada: unknown,
    fazer: () => Promise<Omit<LicitacaoGravacao, 'repetido'>>,
  ): Promise<LicitacaoGravacao> {
    const hash = hashEntrada(OPERACAO_CHAVE_LICITACAO, { licitacao, entrada });
    const ja = await lerIdempotencia(tx, OPERACAO_CHAVE_LICITACAO, chave);
    if (ja) {
      const r = ja.resultado;
      if (num(r['estabelecimento']) !== est || (licitacao !== null && num(r['licitacao']) !== licitacao))
        throw recusa('chave-de-outro-processo', 'A chave do pedido já foi usada em outro processo.');
      if (ja.hashEntrada !== hash) {
        if (licitacao === null)
          throw recusa('chave-de-outro-processo', 'A chave do pedido já foi usada em outro processo.');
        throw erroIdempotenciaDivergente();
      }
      const atual = await tx.uma('SELECT etapa FROM processo_licitatorio WHERE id = ?', [
        num(r['licitacao']),
      ]);
      return {
        licitacao: num(r['licitacao']),
        registro: num(r['registro']),
        etapa: String(atual?.['etapa'] ?? r['etapa']) as EtapaLicitacao,
        repetido: true,
      };
    }
    const valor = await fazer();
    await gravarIdempotencia(tx, {
      operacao: OPERACAO_CHAVE_LICITACAO,
      chave,
      estabelecimento: est,
      usuario: usuarioId,
      hashEntrada: hash,
      resultado: { ...valor, estabelecimento: est } as unknown as ResultadoOperacao,
      trilha: null,
      agora,
    });
    return { ...valor, repetido: false };
  }

  /** O processo travado pela versão (FOR UPDATE), com a versão nova, e o estado relido na mesma transação. */
  async function travar(id: number, versao: number, parametros: ParametrosLicitacao) {
    const [r] = await tx.consultarParaAtualizar(
      'SELECT id, versao FROM processo_licitatorio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
      { teto: 1 },
    );
    if (!r) throw recusa('licitacao-inexistente', 'O processo não existe neste estabelecimento.');
    if (num(r['versao']) !== versao) throw erroConflitoVersao(['versao']);
    await tx.executar(
      'UPDATE processo_licitatorio SET versao = versao + 1, alterado_em = ?, alterado_por = ? WHERE id = ?',
      [agora, usuarioId, id],
    );
    const k = (await carregar(tx, est, id))!;
    return estadoDe(k, hoje, parametros, await calendario());
  }

  async function mudarProcesso(id: number, v: Record<string, unknown>) {
    const cols = Object.keys(v);
    if (cols.length === 0) return;
    await tx.executar(
      `UPDATE processo_licitatorio SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => v[c]), id],
    );
  }

  async function mudarItem(id: number, v: Record<string, unknown>) {
    const cols = Object.keys(v);
    await tx.executar(
      `UPDATE processo_licitatorio_item SET ${cols.map((c) => `${c} = ?`).join(', ')}, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
      [...cols.map((c) => v[c]), agora, usuarioId, id],
    );
  }

  async function usuarioDoLogin(login: string, codigo: string, campo: string): Promise<number> {
    const u = await tx.uma(
      "SELECT id FROM usuario WHERE login = ? AND situacao = 'ativo' AND excluido_em IS NULL",
      [login.trim()],
    );
    if (!u) throw recusa(codigo, 'O agente de contratação não é usuário do sistema.', { campos: [campo] });
    return num(u['id']);
  }

  async function conferirFornecedor(id: number) {
    const f = await tx.uma(
      "SELECT id FROM empresa_fornecedora WHERE id = ? AND excluido_em IS NULL AND situacao = 'ativo'",
      [id],
    );
    if (!f)
      throw recusa('fornecedor-inexistente', 'O fornecedor não está no cadastro.', {
        campos: ['fornecedor'],
      });
  }

  /** O termo de referência: os itens pela sequência (o item que sai fica marcado como excluído, nunca apagado). */
  async function gravarItens(licitacao: number, itens: readonly ItemLicitacaoEntrada[]) {
    const atuais = await tx.consultar(
      'SELECT id, sequencia FROM processo_licitatorio_item WHERE processo_licitatorio_id = ?',
      [licitacao],
      { teto: 2_000 },
    );
    const porSeq = new Map(atuais.map((x) => [num(x['sequencia']), num(x['id'])]));
    for (const [n, i] of itens.entries()) {
      const v = {
        insumo_id: i.itemEstoque,
        descricao: i.descricao,
        unidade_fornecimento: i.unidade.slice(0, 20),
        quantidade: i.quantidade,
        valor_unitario_estimado: null,
        valor_total_estimado: null,
        situacao: 'aberto',
        excluido_em: null,
        excluido_por: null,
      };
      const id = porSeq.get(n + 1);
      if (id) await mudarItem(id, v);
      else
        await tx.incluir('processo_licitatorio_item', {
          processo_licitatorio_id: licitacao,
          sequencia: n + 1,
          insumo_id: i.itemEstoque,
          descricao: i.descricao,
          unidade_fornecimento: i.unidade.slice(0, 20),
          quantidade: i.quantidade,
        });
    }
    await tx.executar(
      `UPDATE processo_licitatorio_item SET excluido_em = ?, excluido_por = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
        WHERE processo_licitatorio_id = ? AND sequencia > ? AND excluido_em IS NULL`,
      [agora, usuarioId, agora, usuarioId, licitacao, itens.length],
    );
  }

  async function evento(
    licitacao: number,
    x: Partial<Omit<EventoLicitacao, 'id' | 'usuario' | 'criadoEm'>> & Pick<EventoLicitacao, 'tipo'>,
  ): Promise<number> {
    const tipo =
      x.tipo === 'etapa'
        ? TIPO_DB_ETAPA(x.para ?? null)
        : x.tipo === 'recurso' || x.tipo === 'documento'
          ? x.tipo
          : x.tipo === 'decisao-recurso'
            ? 'decisao_recurso'
            : 'registro';
    return tx.incluir('evento_processo_licitatorio', {
      processo_licitatorio_id: licitacao,
      tipo,
      assunto: sub(x.tipo),
      etapa_anterior: x.de ?? null,
      etapa_posterior: x.para ?? null,
      descricao: (x.descricao ?? '').slice(0, 2000),
      referencia: x.tipo === 'documento' ? (x.referencia ?? null) : null,
      referencia_ato: x.tipo === 'documento' ? null : (x.referencia?.slice(0, 80) ?? null),
      data_ato: x.data ?? null,
      veiculo_publicacao: x.veiculo ? sub(x.veiculo) : null,
      empresa_fornecedora_id: x.fornecedor ?? null,
      resultado: x.resultado?.slice(0, 30) ?? null,
      pedido_compra_id: x.pedido ?? null,
      documento_id: x.documento ?? null,
      usuario_id: quem(),
      ocorrido_em: agora,
    });
  }

  /** O julgamento desfeito (o recurso provido volta à sessão) ou o item encerrado sem vencedor. */
  async function limparJulgamento(licitacao: number, resultado: string | null) {
    await tx.executar(
      `UPDATE processo_licitatorio_item SET resultado_julgamento = ?, vencedora_proposta_licitacao_item_id = NULL,
              valor_adjudicado = NULL, situacao = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
        WHERE processo_licitatorio_id = ? AND excluido_em IS NULL`,
      [resultado, resultado ?? 'aberto', agora, usuarioId, licitacao],
    );
    await tx.executar(
      `UPDATE proposta_licitacao_item SET resultado = 'em_disputa', classificacao = NULL, alterado_em = ?, alterado_por = ?,
              versao = versao + 1
        WHERE proposta_licitacao_id IN (SELECT id FROM proposta_licitacao WHERE processo_licitatorio_id = ?)
          AND resultado IN ('vencedor','perdedor')`,
      [agora, usuarioId, licitacao],
    );
  }

  return {
    criar: ({ entrada: x, parametros }) =>
      porChave(x.chave, null, x, async () => {
        const ja = await tx.uma(
          'SELECT id FROM processo_licitatorio WHERE estabelecimento_id = ? AND numero = ?',
          [est, x.numero],
        );
        if (ja)
          throw recusa('numero-repetido', 'Já existe processo com este número no estabelecimento.', {
            campos: ['numero'],
          });
        const agente = await usuarioDoLogin(x.agente, 'agente-inexistente', 'agente');
        const id = await tx.incluir('processo_licitatorio', {
          estabelecimento_id: est,
          numero: x.numero,
          regime: sub(x.regime),
          modalidade: sub(x.modalidade),
          criterio_julgamento: sub(x.criterio),
          natureza_objeto: sub(x.natureza),
          objeto: x.objeto,
          justificativa: x.justificativa,
          fundamento_legal: x.fundamento,
          peso_tecnica_percentual: x.criterio === 'tecnica-preco' ? x.pesoTecnica : null,
          orcamento_sigiloso: x.sigiloso,
          agente_contratacao_usuario_id: agente,
          centro_custo_id: x.centroCusto,
          metodo_estimativa: parametros.metodoEstimativa,
          etapa: 'planejamento',
        });
        await gravarItens(id, x.itens);
        return { licitacao: id, registro: id, etapa: 'planejamento' };
      }),

    alterar: async ({ id, entrada: x, parametros }) => {
      const e = await travar(id, x.versao, parametros);
      lancar(podeAlterarTermo(e.processo));
      const agente = await usuarioDoLogin(x.agente, 'agente-inexistente', 'agente');
      await mudarProcesso(id, {
        regime: sub(x.regime),
        modalidade: sub(x.modalidade),
        criterio_julgamento: sub(x.criterio),
        natureza_objeto: sub(x.natureza),
        objeto: x.objeto,
        justificativa: x.justificativa,
        fundamento_legal: x.fundamento,
        peso_tecnica_percentual: x.criterio === 'tecnica-preco' ? x.pesoTecnica : null,
        orcamento_sigiloso: x.sigiloso,
        agente_contratacao_usuario_id: agente,
        centro_custo_id: x.centroCusto,
      });
      await gravarItens(id, x.itens);
      return { licitacao: id, registro: id, etapa: e.processo.etapa, repetido: false };
    },

    preco: ({ licitacao, entrada: x, parametros }) =>
      porChave(x.chave, licitacao, x, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        lancar(podeRegistrarPreco(e, x.item));
        if (x.data > e.hoje)
          throw recusa('licitacao-data-futura', 'A data não pode ser futura.', { campos: ['data'] });
        if (x.fornecedor !== null) await conferirFornecedor(x.fornecedor);
        const pp = await tx.uma(
          'SELECT id FROM pesquisa_preco WHERE processo_licitatorio_id = ? AND excluido_em IS NULL',
          [licitacao],
        );
        const pesquisa =
          pp !== null
            ? num(pp['id'])
            : await tx.incluir('pesquisa_preco', {
                estabelecimento_id: est,
                numero: licitacao,
                processo_licitatorio_id: licitacao,
                objeto: e.processo.objeto.slice(0, 400),
                metodo_estimativa: e.processo.metodoEstimativa,
                data_pesquisa: e.hoje,
                responsavel_usuario_id: usuarioId,
                situacao: 'aberta',
              });
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM pesquisa_preco_item WHERE pesquisa_preco_id = ?',
          [pesquisa],
        );
        const id = await tx.incluir('pesquisa_preco_item', {
          pesquisa_preco_id: pesquisa,
          sequencia: num(seq?.['n']),
          processo_licitatorio_item_id: x.item,
          fonte: sub(x.fonte),
          referencia: x.referencia.slice(0, 200),
          empresa_fornecedora_id: x.fornecedor,
          data_preco: x.data,
          valor_unitario: x.valor,
          considerado: true,
        });
        return { licitacao, registro: id, etapa: e.processo.etapa };
      }),

    descartarPreco: ({ licitacao, preco, entrada: x, parametros }) =>
      porChave(x.chave, licitacao, { preco, x }, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        lancar(podeDescartarPreco(e, preco));
        await tx.executar(
          `UPDATE pesquisa_preco_item SET considerado = FALSE, motivo_desconsideracao = ?, desconsiderado_em = ?, desconsiderado_por_usuario_id = ?,
                  alterado_em = ?, alterado_por = ?,
                  versao = versao + 1 WHERE id = ?`,
          [x.justificativa.slice(0, 250), agora, quem(), agora, usuarioId, preco],
        );
        return { licitacao, registro: preco, etapa: e.processo.etapa };
      }),

    documento: ({ licitacao, documento: d }) =>
      porChave(`doc:${d.emissao}`.slice(0, 80), licitacao, d, async () => {
        const p = await tx.uma(
          'SELECT etapa FROM processo_licitatorio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [licitacao, est],
        );
        if (!p) throw recusa('licitacao-inexistente', 'O processo não existe neste estabelecimento.');
        const ev = await evento(licitacao, {
          tipo: 'documento',
          referencia: d.emissao.slice(0, 80),
          descricao: descricaoDocumentoLicitacao(d),
        });
        return { licitacao, registro: ev, etapa: String(p['etapa']) as EtapaLicitacao };
      }),

    proposta: ({ licitacao, entrada: x, parametros }) =>
      porChave(x.chave, licitacao, x, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        lancar(podeRegistrarProposta(e, x));
        await conferirFornecedor(x.fornecedor);
        const cab = await tx.uma(
          'SELECT id FROM proposta_licitacao WHERE processo_licitatorio_id = ? AND empresa_fornecedora_id = ?',
          [licitacao, x.fornecedor],
        );
        const proposta =
          cab !== null
            ? num(cab['id'])
            : await tx.incluir('proposta_licitacao', {
                processo_licitatorio_id: licitacao,
                empresa_fornecedora_id: x.fornecedor,
                apresentada_em: agora,
                situacao: 'valida',
                habilitacao: 'pendente',
              });
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM proposta_licitacao_item WHERE proposta_licitacao_id = ?',
          [proposta],
        );
        const item = e.itens.find((i) => i.id === x.item)!;
        const id = await tx.incluir('proposta_licitacao_item', {
          proposta_licitacao_id: proposta,
          sequencia: num(seq?.['n']),
          processo_licitatorio_item_id: x.item,
          quantidade_cotada: item.quantidade,
          valor_unitario: x.valor,
          valor_ultimo_lance: x.lance,
          nota_tecnica: x.notaTecnica,
          marca: x.marca?.slice(0, 60) ?? null,
          resultado: 'em_disputa',
        });
        return { licitacao, registro: id, etapa: e.processo.etapa };
      }),

    situacaoProposta: async ({ licitacao, proposta, entrada: x, parametros }) => {
      const e = await travar(licitacao, x.versao, parametros);
      lancar(podeMudarSituacaoProposta(e.processo));
      if (!e.propostas.some((q) => q.id === proposta))
        throw recusa('licitacao-proposta-inexistente', 'A proposta não é deste processo.');
      const cab = await tx.uma(
        'SELECT proposta_licitacao_id AS id FROM proposta_licitacao_item WHERE id = ?',
        [proposta],
      );
      const motivo = x.situacao === 'valida' ? null : String(x.motivo ?? '').slice(0, 500);
      await tx.executar(
        `UPDATE proposta_licitacao_item SET resultado = ?, motivo_resultado = ?, alterado_em = ?, alterado_por = ?,
                versao = versao + 1 WHERE id = ?`,
        [
          x.situacao === 'desclassificada' ? 'desclassificado' : 'em_disputa',
          x.situacao === 'desclassificada' ? motivo : null,
          agora,
          usuarioId,
          proposta,
        ],
      );
      // A habilitação é do licitante (Lei 14.133, art. 62): inabilitar vale para todos os itens dele.
      if (x.situacao === 'inabilitada')
        await tx.executar(
          `UPDATE proposta_licitacao SET habilitacao = 'inabilitada', motivo_inabilitacao = ?, inabilitada_em = ?,
                  alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
          [motivo, agora, agora, usuarioId, num(cab?.['id'])],
        );
      else if (x.situacao === 'valida')
        await tx.executar(
          `UPDATE proposta_licitacao SET habilitacao = 'pendente', motivo_inabilitacao = NULL, inabilitada_em = NULL,
                  alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ? AND habilitacao = 'inabilitada'`,
          [agora, usuarioId, num(cab?.['id'])],
        );
      return { licitacao, registro: proposta, etapa: e.processo.etapa, repetido: false };
    },

    avancar: ({ licitacao, entrada: x, parametros }) =>
      porChave(x.chave, licitacao, x, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        const p = e.processo;
        const de = p.etapa;
        let descricao = '';
        const mudar: Record<string, unknown> = { etapa: x.para };
        switch (x.para) {
          case 'pesquisa':
            lancar(podeAvancar(e, { para: 'pesquisa' }));
            break;
          case 'edital':
          case 'sessao':
            lancar(podeAvancar(e, { para: x.para, justificativaPesquisa: x.justificativaPesquisa }));
            if (de === 'pesquisa') {
              const es = estimarLicitacao(e.itens, e.precos, p.metodoEstimativa, parametros.minimoPrecos);
              for (const i of es.itens)
                await mudarItem(i.item, {
                  valor_unitario_estimado: i.valorUnitario,
                  valor_total_estimado: i.valorTotal,
                });
              mudar['valor_estimado'] = es.valorTotal;
              await tx.executar(
                `UPDATE pesquisa_preco SET situacao = 'fechada', fechada_em = ?, fechada_por_usuario_id = ?,
                        valor_estimado_total = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
                  WHERE processo_licitatorio_id = ? AND situacao = 'aberta'`,
                [agora, usuarioId, es.valorTotal, agora, usuarioId, licitacao],
              );
              descricao = [x.justificativaPesquisa, ...es.itens.map((i) => i.conta), `total: ${es.conta}`]
                .filter(Boolean)
                .join(' | ');
            }
            break;
          case 'publicado':
            lancar(podeAvancar(e, x));
            mudar['data_publicacao'] = x.dataPublicacao;
            mudar['sessao_em'] = `${x.dataAbertura} 00:00:00`;
            await evento(licitacao, {
              tipo: 'publicacao',
              data: x.dataPublicacao,
              veiculo: x.veiculo,
              referencia: x.referencia,
              descricao: `Abertura em ${x.dataAbertura}.`,
            });
            break;
          case 'julgado': {
            lancar(podeAvancar(e, x));
            const j = julgarLicitacao(e.itens, e.propostas, p, x.desempates);
            for (const r of j.itens) {
              const venc =
                r.vencedor === null
                  ? null
                  : (e.propostas.find((q) => q.item === r.item && q.fornecedor === r.vencedor)?.id ?? null);
              await mudarItem(r.item, {
                resultado_julgamento: r.resultado,
                vencedora_proposta_licitacao_item_id: venc,
                valor_adjudicado: r.valorUnitario,
                situacao:
                  r.resultado === 'adjudicavel'
                    ? 'adjudicado'
                    : r.resultado === 'fracassado' || r.resultado === 'deserto'
                      ? r.resultado
                      : 'aberto',
              });
              for (const q of e.propostas.filter((y) => y.item === r.item && y.situacao === 'valida'))
                await tx.executar(
                  `UPDATE proposta_licitacao_item SET resultado = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
                  [
                    q.id === venc ? 'vencedor' : venc === null ? 'em_disputa' : 'perdedor',
                    agora,
                    usuarioId,
                    q.id,
                  ],
                );
            }
            mudar['julgado_em'] = e.hoje;
            mudar['julgado_por_usuario_id'] = quem();
            descricao = [x.justificativaDesempate, j.conta].filter(Boolean).join(' | ');
            break;
          }
          case 'fracassado':
          case 'deserto':
            lancar(podeAvancar(e, { para: x.para }));
            await limparJulgamento(licitacao, x.para);
            mudar['motivo_encerramento'] = x.justificativa.slice(0, 500);
            descricao = x.justificativa;
            break;
        }
        await mudarProcesso(licitacao, mudar);
        const ev = await evento(licitacao, { tipo: 'etapa', de, para: x.para, data: e.hoje, descricao });
        return { licitacao, registro: ev, etapa: x.para };
      }),

    homologar: ({ licitacao, entrada: x, usuario, parametros }) =>
      porChave(x.chave, licitacao, x, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        lancar(podeHomologar(e, usuario));
        await mudarProcesso(licitacao, {
          etapa: 'homologado',
          homologado_por_usuario_id: quem(),
          homologado_em: agora,
          data_homologacao: e.hoje,
        });
        for (const i of e.itens.filter((y) => y.resultado === 'adjudicavel')) {
          await mudarItem(i.id, { situacao: 'homologado' });
          const venc = e.propostas.find((q) => q.item === i.id && q.fornecedor === i.vencedor);
          if (venc)
            await tx.executar(
              `UPDATE proposta_licitacao_item SET resultado = 'homologado', quantidade_homologada = ?, valor_homologado = ?,
                      homologado_em = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?`,
              [i.quantidade, i.valorAdjudicado, e.hoje, agora, usuarioId, venc.id],
            );
        }
        const ev = await evento(licitacao, {
          tipo: 'etapa',
          de: e.processo.etapa,
          para: 'homologado',
          data: e.hoje,
          descricao: x.observacao ?? '',
        });
        return { licitacao, registro: ev, etapa: 'homologado' };
      }),

    encerrar: ({ licitacao, entrada: x, parametros }) =>
      porChave(x.chave, licitacao, x, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        lancar(podeEncerrar(e.processo, x.para));
        await mudarProcesso(licitacao, { etapa: x.para, motivo_encerramento: x.justificativa.slice(0, 500) });
        const ev = await evento(licitacao, {
          tipo: 'etapa',
          de: e.processo.etapa,
          para: x.para,
          data: e.hoje,
          descricao: x.justificativa,
        });
        return { licitacao, registro: ev, etapa: x.para };
      }),

    evento: ({ licitacao, entrada: x, parametros }) =>
      porChave(x.chave, licitacao, x, async () => {
        const e = await travar(licitacao, x.versao, parametros);
        const y = x as unknown as Record<string, unknown>;
        let fornecedorPedido: number | null = null;
        let pedidoJaLigado = false;
        if (x.tipo === 'pedido') {
          const ped = await tx.uma(
            'SELECT empresa_fornecedora_id FROM pedido_compra WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [x.pedido, est],
          );
          fornecedorPedido = ped ? num(ped['empresa_fornecedora_id']) : null;
          pedidoJaLigado = e.eventos.some((v) => v.tipo === 'pedido' && v.pedido === x.pedido);
        }
        lancar(
          podeRegistrarEvento(e, {
            tipo: x.tipo,
            data: 'data' in x ? (x.data as string | null) : null,
            fornecedor: 'fornecedor' in x ? (x.fornecedor as number | null) : null,
            fornecedorPedido,
            pedidoJaLigado,
          }),
        );
        const resultado = 'resultado' in x ? (x.resultado as string | null) : null;
        const descricao = String(y['descricao'] ?? '');
        const ev = await evento(licitacao, {
          tipo: x.tipo,
          data: 'data' in x ? (x.data as string | null) : e.hoje,
          referencia: 'referencia' in x ? (x.referencia as string | null) : null,
          fornecedor:
            'fornecedor' in x
              ? (x.fornecedor as number | null)
              : x.tipo === 'pedido'
                ? fornecedorPedido
                : null,
          resultado,
          pedido: x.tipo === 'pedido' ? x.pedido : null,
          documento: 'documento' in x ? (x.documento as number | null) : null,
          descricao:
            x.tipo === 'ata' && y['validade']
              ? `${descricao} (validade até ${String(y['validade'])})`.trim()
              : descricao,
        });
        if (x.tipo === 'pedido')
          await tx.executar(
            `UPDATE pedido_compra SET processo_licitatorio_id = ?, alterado_em = ?, alterado_por = ?, versao = versao + 1
              WHERE id = ? AND processo_licitatorio_id IS NULL`,
            [licitacao, agora, usuarioId, x.pedido],
          );
        const para = etapaDepoisDoEvento(e.processo.etapa, x.tipo, resultado);
        if (para !== e.processo.etapa) {
          const mudar: Record<string, unknown> = { etapa: para };
          if (para === 'sessao') {
            await limparJulgamento(licitacao, null);
            mudar['julgado_em'] = null;
            mudar['julgado_por_usuario_id'] = null;
          }
          await mudarProcesso(licitacao, mudar);
        }
        return { licitacao, registro: ev, etapa: para };
      }),
  };
}

const SEM_EXECUTOR = 'O processo de compra não grava pelo executor genérico: use as rotas da licitação.';

export class PortaLicitacaoPropria implements PortaLicitacao {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoLicitacao,
    executorPronto?: Executor,
    private readonly hoje: () => string = hojeLocal,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoPortaM18, est: number): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: c.correlacao || 'licitacao',
    };
  }

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
    fn: (g: GravadorLicitacao) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha((saida as { valor: T }).valor) : null) : trilha;
    const hoje = this.hoje();
    const op = definirOperacao({
      nome: OPERACAO_LICITACAO,
      tabelas: [...TABELAS_LICITACAO],
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est, hoje, new Date())) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: 'processo_licitatorio', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `licitacao:${randomUUID()}`;
    const ctx: ContextoOperacao = { ...this.contexto(c, est), chaveIdempotencia: chave };
    await this.executor.executar(op, c.cliente, { chave }, ctx);
    if (!saida) throw new Error('Gravação do processo sem resultado.');
    return (saida as { valor: T }).valor;
  }

  listar(c: ContextoPortaM18, f: FiltroLicitacoes) {
    return this.ler(c, async (l, est) => {
      const cond = ['p.estabelecimento_id = ?', 'p.excluido_em IS NULL'];
      const par: unknown[] = [est];
      if (f.etapa) {
        cond.push('p.etapa = ?');
        par.push(f.etapa);
      }
      if (f.modalidade) {
        cond.push('p.modalidade = ?');
        par.push(sub(f.modalidade));
      }
      if (f.termo) {
        cond.push('(p.numero LIKE ? OR p.objeto LIKE ?)');
        par.push(like(f.termo), like(f.termo));
      }
      const linhas = await l.consultar(
        `${SQL_PROCESSO.replace(
          'SELECT p.*,',
          'SELECT p.*, (SELECT COUNT(*) FROM processo_licitatorio_item i WHERE i.processo_licitatorio_id = p.id AND i.excluido_em IS NULL) AS qtd_itens,',
        )} WHERE ${cond.join(' AND ')} ORDER BY p.id DESC LIMIT ${TETO_LISTA_LICITACOES + 1} OFFSET ${(f.pagina - 1) * TETO_LISTA_LICITACOES}`,
        par,
        { teto: TETO_LISTA_LICITACOES + 1 },
      );
      return {
        hoje: this.hoje(),
        itens: linhas.slice(0, TETO_LISTA_LICITACOES).map((r) => {
          const p = processoDe(r);
          const x = resumoLicitacao(p, num(r['qtd_itens']));
          return p.sigiloso && !p.dataJulgamento ? { ...x, valorEstimado: null } : x;
        }),
        pagina: f.pagina,
        cortada: linhas.length > TETO_LISTA_LICITACOES,
      };
    });
  }

  detalhar(c: ContextoPortaM18, id: number, o: Parameters<PortaLicitacao['detalhar']>[2]) {
    return this.ler(c, async (l, est) => {
      const k = await carregar(l, est, id);
      if (!k) return null;
      return montarLicitacao(
        estadoDe(k, this.hoje(), o.parametros, await feriadosDe(l, est)),
        o.usuario,
        o.conduz,
      );
    });
  }

  painel(c: ContextoPortaM18): Promise<PainelLicitacoes> {
    return this.ler(c, async (l, est) => {
      const hoje = this.hoje();
      const limite = new Date(`${hoje}T00:00:00Z`);
      limite.setUTCDate(limite.getUTCDate() + 7);
      const ate = limite.toISOString().slice(0, 10);
      const rs = await l.consultar(
        `SELECT etapa, COUNT(*) AS n,
                SUM(etapa = 'publicado' AND sessao_em >= ? AND sessao_em < DATE_ADD(?, INTERVAL 1 DAY)) AS proximas
           FROM processo_licitatorio WHERE estabelecimento_id = ? AND excluido_em IS NULL GROUP BY etapa`,
        [hoje, ate, est],
        { teto: 50 },
      );
      const porEtapa: Partial<Record<EtapaLicitacao, number>> = {};
      let emAndamento = 0;
      let sessoesProximas = 0;
      for (const r of rs) {
        const etapa = String(r['etapa']) as EtapaLicitacao;
        porEtapa[etapa] = num(r['n']);
        if (!etapaFinal(etapa)) emAndamento += num(r['n']);
        sessoesProximas += num(r['proximas']);
      }
      return { porEtapa, emAndamento, sessoesProximas };
    });
  }

  /** Os pedidos de compra do estabelecimento ligados a um processo (o pedido gerado para o vencedor). */
  pedidosMarcados(c: ContextoPortaM18): Promise<PedidoMarcadoLicitacao[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT pc.id, pc.ano, pc.numero, pc.empresa_fornecedora_id, pc.data_pedido, p.numero AS processo, p.objeto
             FROM pedido_compra pc JOIN processo_licitatorio p ON p.id = pc.processo_licitatorio_id
            WHERE pc.estabelecimento_id = ? AND pc.excluido_em IS NULL
            ORDER BY pc.data_pedido DESC, pc.id DESC LIMIT ${TETO_PEDIDOS}`,
          [est],
          { teto: TETO_PEDIDOS },
        )
      ).map((r) => ({
        pedido: num(r['id']),
        ano: num(r['ano']),
        documento: num(r['numero']),
        sequencia: 1,
        descricao: `Processo ${String(r['processo'])}: ${String(r['objeto'])}`.slice(0, 200),
        fornecedor: numOuNull(r['empresa_fornecedora_id']),
        data: dataIso(r['data_pedido']),
      })),
    );
  }

  fornecedores(
    c: ContextoPortaM18,
    termo: string,
  ): Promise<{ itens: FornecedorContrato[]; cortada: boolean }> {
    const t = termo.trim();
    return this.ler(c, async (l) => {
      const xs = await l.consultar(
        `SELECT id, razao_social FROM empresa_fornecedora
          WHERE excluido_em IS NULL AND situacao = 'ativo' AND (id = ? OR razao_social LIKE ? OR nome_fantasia LIKE ?)
          ORDER BY razao_social, id LIMIT 51`,
        [/^\d+$/.test(t) ? Number(t) : 0, like(t), like(t)],
        { teto: 51 },
      );
      return {
        itens: xs.slice(0, 50).map((x) => ({ codigo: num(x['id']), nome: String(x['razao_social']) })),
        cortada: xs.length > 50,
      };
    });
  }

  usuarios(c: ContextoPortaM18, termo: string): Promise<UsuarioContrato[]> {
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT login, nome FROM usuario
            WHERE excluido_em IS NULL AND situacao = 'ativo' AND tipo_conta = 'pessoa' AND (login LIKE ? OR nome LIKE ?)
            ORDER BY nome, login LIMIT 50`,
          [like(t), like(t)],
          { teto: 50 },
        )
      ).map((x) => ({ login: String(x['login']), nome: String(x['nome']) })),
    );
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaLicitacaoIndisponivel(): PortaLicitacao {
  return portaIndisponivel<PortaLicitacao>(METODOS_PORTA_LICITACAO);
}
