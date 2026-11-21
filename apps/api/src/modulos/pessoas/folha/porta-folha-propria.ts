// Porta da interface com a folha externa sobre o MariaDB do cliente (M53.1), pelo @sgh/nucleo. Leituras numa transação
// curta somente leitura, sempre filtradas pelo estabelecimento da sessão; gravações pelo Executor (trilha, outbox e
// idempotência na mesma transação), com a trava otimista pela `versao`.
// Tabelas: estabelecimento, tipo_hora, motivo_afastamento, tipo_folha, competencia_folha, vinculo_trabalho,
// categoria_trabalhador, colaborador, cargo, inscricao_conselho, conselho_classe, unidade_federativa, ocupacao_cbo, validade_conselho e afastamento.
// Lotes trocados com a folha externa (exportado, retorno conferido e o resumo por rubrica): lote_folha_intercambio e
// lote_folha_intercambio_resumo. O número do lote no contrato é o número de negócio do estabelecimento
// (lote_folha_intercambio.numero, pela sequência `lote_folha_intercambio`), reservado antes de montar o conteúdo; o id
// interno nunca sai da porta, e o lote exportado a que o retorno responde é traduzido do número para a chave.
// Unidades no banco (DECIMAL(15,2)): o valor do resumo e a soma do lote recebido ficam em reais, como os títulos e os
// fatos contábeis; o contrato fala em centavos inteiros e a porta converte na ida e na volta. A soma do lote exportado
// é a de minutos (ponto mais plantão) e fica em minutos.
// O afastamento grava só o fato: 'em_andamento' (ativo) ou 'cancelado'. O andamento que depende do relógio (previsto,
// encerrado) não é gravado, porque venceria sem ninguém o atualizar; quem precisa dele usa `situacaoDoAfastamento` na
// leitura.
// Melhoria: o tipo do vínculo sai da categoria do trabalhador (901 estagiário, 902 residente) e do regime, pela regra pura
// `tipoVinculoDaFolha`; categoria fora da folha de empregados não vai à folha (antes, todo vínculo saía como CLT).
// Melhoria: afastamento sobreposto no mesmo vínculo é recusado na inclusão e na prorrogação do fim, com o vínculo travado
// (SELECT ... FOR UPDATE) para que duas gravações simultâneas não passem juntas.
// Melhoria: o vínculo e o motivo são conferidos no estabelecimento da sessão antes de gravar (outro estabelecimento é recusado).
// Melhoria: a validade do conselho vem do acompanhamento do RH (validade_conselho) e, na falta, da inscrição.
import { randomUUID } from 'node:crypto';
import {
  alterarAuditado,
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Escritor,
  erroRegistroInexistente,
  type Executor,
  incluirAuditado,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  garantirSequencia,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaM18,
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../../exames/public-api.js';
import {
  type ContextoFolha,
  type GravadorFolha,
  METODOS_PORTA_FOLHA,
  type PortaFolha,
} from './porta-folha.js';
import {
  type AfastamentoFolha,
  type ConselhoDoProfissional,
  type FiltroAfastamentosFolha,
  type FiltroLotesDaFolha,
  type ItemDominioFolha,
  type LinhaResumoDaFolha,
  type LoteDaFolha,
  type LoteFolhaCompleto,
  type NovoAfastamentoFolha,
  type ResumoDaFolha,
  type RemessaDaFolha,
  tipoVinculoDaFolha,
  type VinculoDaFolha,
} from './tipos-folha.js';

const n = (v: unknown): number => Number(v ?? 0);
/** Reais do banco (DECIMAL) em centavos inteiros do contrato, e de volta. */
const centavos = (v: unknown): number => Math.round(n(v) * 100);
const reais = (c: number): number => Math.round(c) / 100;
/** A soma do lote: centavos no recebido (reais no banco), minutos no exportado. */
const somaDoBanco = (sentido: unknown, v: unknown): number => (sentido === 'recebido' ? centavos(v) : n(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const doisDigitos = (x: number) => String(x).padStart(2, '0');

/** DATE do banco em ISO (AAAA-MM-DD): o driver entrega Date à meia-noite local ou texto. */
function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${doisDigitos(v.getMonth() + 1)}-${doisDigitos(v.getDate())}`;
  return String(v).slice(0, 10);
}
const diaObrigatorio = (v: unknown): string => dia(v) ?? '';

/** Data e hora locais no fuso do estabelecimento (AAAA-MM-DD e AAAA-MM-DDTHH:MM:SS). */
export function relogioDoFuso(fuso: string, instante = new Date()): { hoje: string; agora: string } {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(instante);
  return { hoje: p.slice(0, 10), agora: p.replace(' ', 'T').slice(0, 19) };
}

const FUSO_PADRAO = 'America/Sao_Paulo';
async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

/** Vínculos do estabelecimento ativos em algum dia de [inicio, fim] (com o colaborador e o cargo). */
const SQL_VINCULOS = `
  SELECT v.id, v.matricula, v.regime_trabalhista, v.data_admissao, v.data_desligamento, v.centro_custo_id,
         v.setor_funcional_id, c.profissional_id, c.cpf, g.carga_semanal_horas_padrao,
         ct.codigo_esocial AS categoria, ct.grupo AS grupo_categoria
    FROM vinculo_trabalho v
    JOIN colaborador c ON c.id = v.colaborador_id
    JOIN categoria_trabalhador ct ON ct.id = v.categoria_trabalhador_id
    LEFT JOIN cargo g ON g.id = v.cargo_id
   WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND c.excluido_em IS NULL
     AND v.data_admissao <= ? AND (v.data_desligamento IS NULL OR v.data_desligamento >= ?)
   ORDER BY v.id`;

export type NucleoFolha = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** O que a porta precisa da cifra do CPF (o vínculo sai com o CPF cifrado, nunca em claro). */
export interface CifradorCpf {
  cifrar(cpf: string): string;
}

const TABELAS_FOLHA = [
  'afastamento',
  'lote_folha_intercambio',
  'lote_folha_intercambio_resumo',
  'sequencia_negocio',
] as const;

/** Tipo da sequência do número do lote (por estabelecimento). */
export const SEQUENCIA_LOTE_FOLHA = 'lote_folha_intercambio';

/** DATETIME do banco no instante local AAAA-MM-DDTHH:MM:SS (o driver entrega Date local ou texto). */
function instanteLocal(v: unknown): string {
  if (v instanceof Date)
    return `${dia(v)}T${doisDigitos(v.getHours())}:${doisDigitos(v.getMinutes())}:${doisDigitos(v.getSeconds())}`;
  return texto(v).replace(' ', 'T').slice(0, 19);
}

/** AAAA-MM do contrato no primeiro dia do mês (a coluna `competencia`), e de volta. */
const competenciaNoBanco = (c: string): string => `${c.slice(0, 7)}-01`;
const competenciaDoBanco = (v: unknown): string => diaObrigatorio(v).slice(0, 7);

const SQL_LOTES = `
  SELECT l.id, l.numero, l.estabelecimento_id, l.competencia, l.sentido, ex.numero AS numero_exportado, l.leiaute,
         l.situacao, l.quantidade_colaboradores, l.soma, l.totais, l.vinculos, l.divergencias, l.resumo, l.gerado_em,
         u.login, l.versao
    FROM lote_folha_intercambio l
    LEFT JOIN lote_folha_intercambio ex ON ex.id = l.lote_exportado_id
    LEFT JOIN usuario u ON u.id = l.criado_por
   WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL`;

const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v);

function loteDe(r: Record<string, unknown>): LoteFolhaCompleto {
  return {
    id: n(r['numero']),
    empresa: n(r['estabelecimento_id']),
    competencia: competenciaDoBanco(r['competencia']),
    sentido: r['sentido'] === 'recebido' ? 'recebido' : 'exportado',
    loteExportado: numOuNulo(r['numero_exportado']),
    leiaute: texto(r['leiaute']),
    situacao: texto(r['situacao']),
    colaboradores: n(r['quantidade_colaboradores']),
    soma: somaDoBanco(r['sentido'], r['soma']),
    totais: json(r['totais']) ?? '{}',
    divergencias: json(r['divergencias']),
    resumo: texto(r['resumo']),
    geradoEm: instanteLocal(r['gerado_em']),
    geradoPor: texto(r['login']),
    versao: n(r['versao']),
    vinculos: json(r['vinculos']),
  };
}

const semVinculos = (lote: LoteFolhaCompleto): LoteDaFolha => {
  const { vinculos, ...l } = lote;
  void vinculos;
  return l;
};

async function lerLotes(
  l: Leitor,
  est: number,
  f: { empresa?: number; competencia?: string },
): Promise<LoteDaFolha[]> {
  // A empresa da folha é o estabelecimento: outro estabelecimento não é visto desta sessão.
  if (f.empresa !== undefined && f.empresa !== est) return [];
  let sql = SQL_LOTES;
  const p: unknown[] = [est];
  if (f.competencia !== undefined) {
    sql += ' AND l.competencia = ?';
    p.push(competenciaNoBanco(f.competencia));
  }
  return (await l.consultar(`${sql} ORDER BY l.numero DESC`, p)).map((r) => semVinculos(loteDe(r)));
}

async function lerLote(l: Leitor, est: number, numero: number): Promise<LoteFolhaCompleto | null> {
  const r = await l.uma(`${SQL_LOTES} AND l.numero = ?`, [est, numero]);
  return r ? loteDe(r) : null;
}

async function competenciaLancadaEm(
  l: Leitor,
  est: number,
  empresa: number,
  competencia: string,
): Promise<boolean> {
  if (empresa !== est) return false;
  const r = await l.uma(
    `SELECT id FROM lote_folha_intercambio
      WHERE estabelecimento_id = ? AND competencia = ? AND situacao = 'lancado' AND excluido_em IS NULL LIMIT 1`,
    [est, competenciaNoBanco(competencia)],
  );
  return r !== null && r !== undefined;
}

/** Chave interna do lote pelo número de negócio, travada para a troca (outro estabelecimento não existe). */
async function travarLote(e: Escritor, est: number, numero: number) {
  const [r] = await e.consultarParaAtualizar<{
    id: unknown;
    situacao: unknown;
    versao: unknown;
    sentido: unknown;
  }>(
    'SELECT id, situacao, versao, sentido FROM lote_folha_intercambio WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
    [est, numero],
  );
  return r
    ? { id: n(r.id), situacao: texto(r.situacao), versao: n(r.versao), sentido: texto(r.sentido) }
    : null;
}

const SQL_AFASTAMENTOS = `
  SELECT a.id, a.vinculo_trabalho_id, a.motivo_afastamento_id, a.data_inicio, a.data_fim, a.observacao, a.situacao, a.versao
    FROM afastamento a
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

function afastamentoDe(r: Record<string, unknown>): AfastamentoFolha {
  return {
    id: n(r['id']),
    vinculo: n(r['vinculo_trabalho_id']),
    motivo: n(r['motivo_afastamento_id']),
    inicio: diaObrigatorio(r['data_inicio']),
    fim: dia(r['data_fim']),
    observacao: textoOuNulo(r['observacao']),
    situacao: r['situacao'] === 'cancelado' ? 'cancelado' : 'ativo',
    // O motivo do cancelamento vai à trilha; a coluna própria é pedido de DDL (afastamento.motivo_cancelamento).
    motivoCancelamento: null,
    versao: n(r['versao']),
  };
}

async function lerAfastamentos(
  l: Leitor,
  est: number,
  f: FiltroAfastamentosFolha,
): Promise<AfastamentoFolha[]> {
  let sql = SQL_AFASTAMENTOS;
  const p: unknown[] = [est];
  if (f.vinculo !== undefined) {
    sql += ' AND a.vinculo_trabalho_id = ?';
    p.push(f.vinculo);
  }
  if (f.ate !== undefined) {
    sql += ' AND a.data_inicio <= ?';
    p.push(f.ate);
  }
  if (f.de !== undefined) {
    sql += ' AND (a.data_fim IS NULL OR a.data_fim >= ?)';
    p.push(f.de);
  }
  return (await l.consultar(`${sql} ORDER BY a.data_inicio, a.id`, p)).map(afastamentoDe);
}

async function lerAfastamento(l: Leitor, est: number, id: number): Promise<AfastamentoFolha | null> {
  const r = await l.uma(`${SQL_AFASTAMENTOS} AND a.id = ?`, [est, id]);
  return r ? afastamentoDe(r) : null;
}

/** Trava o vínculo do estabelecimento (serializa as gravações de afastamento dele) e devolve o colaborador. */
async function travarVinculo(e: Escritor, est: number, vinculo: number): Promise<number> {
  const [v] = await e.consultarParaAtualizar<{ colaborador_id: unknown }>(
    'SELECT colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
    [vinculo, est],
  );
  if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
  return n(v.colaborador_id);
}

/** Recusa se outro afastamento ativo do vínculo toca [inicio, fim] (fim null: em aberto). */
async function conferirSobreposicao(
  e: Escritor,
  vinculo: number,
  inicio: string,
  fim: string | null,
  exceto: number | null,
): Promise<void> {
  const sobreposto = await e.uma(
    `SELECT id FROM afastamento
      WHERE vinculo_trabalho_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND id <> ?
        AND (? IS NULL OR data_inicio <= ?) AND (data_fim IS NULL OR data_fim >= ?)
      LIMIT 1`,
    [vinculo, exceto ?? 0, fim, fim, inicio],
  );
  if (sobreposto)
    throw recusa(
      'afastamento-sobreposto',
      'O vínculo já tem afastamento nesse período; encerre ou cancele o anterior.',
    );
}

function gravadorFolha(e: TxOperacao, c: ContextoFolha, est: number): GravadorFolha {
  const carimbo = () => ({ usuario: c.usuario, agora: new Date() });
  const atual = async (id: number) => {
    const a = await lerAfastamento(e, est, id);
    if (!a) throw erroRegistroInexistente();
    return a;
  };
  return {
    async proximoIdLote() {
      await garantirSequencia(e, { tipo: SEQUENCIA_LOTE_FOLHA, estabelecimento: est }, carimbo());
      return (await e.proximoNumero(SEQUENCIA_LOTE_FOLHA)).valor;
    },
    lote: (numero) => lerLote(e, est, numero),
    lotesDaCompetencia: (empresa, competencia) => lerLotes(e, est, { empresa, competencia }),
    competenciaLancada: (empresa, competencia) => competenciaLancadaEm(e, est, empresa, competencia),
    async incluirLote(x) {
      if (x.empresa !== est)
        throw recusa('empresa-fora-da-sessao', 'A empresa da folha é o estabelecimento da sessão.');
      if (await travarLote(e, est, x.id))
        throw recusa('lote-repetido', 'O número do lote já foi usado: gere de novo.');
      let exportado: number | null = null;
      if (x.loteExportado !== null) {
        const ex = await travarLote(e, est, x.loteExportado);
        if (!ex || ex.sentido !== 'exportado')
          throw recusa('lote-inexistente', 'O lote exportado a que o retorno responde não existe.');
        exportado = ex.id;
      }
      const competencia = competenciaNoBanco(x.competencia);
      // A competência da folha só é ligada quando há uma única folha do mês (normal ou não) no estabelecimento.
      const folhas = await e.consultar(
        `SELECT id FROM competencia_folha
          WHERE estabelecimento_id = ? AND ano = ? AND mes = ? AND excluido_em IS NULL LIMIT 2`,
        [est, Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7))],
      );
      await e.incluir('lote_folha_intercambio', {
        estabelecimento_id: est,
        numero: x.id,
        competencia_folha_id: folhas.length === 1 ? n(folhas[0]!['id']) : null,
        competencia,
        sentido: x.sentido,
        lote_exportado_id: exportado,
        leiaute: x.leiaute,
        situacao: x.situacao,
        quantidade_colaboradores: x.colaboradores,
        soma: x.sentido === 'recebido' ? reais(x.soma) : x.soma,
        totais: x.totais,
        vinculos: x.sentido === 'exportado' ? x.vinculos : null,
        divergencias: x.divergencias,
        resumo: x.resumo,
        gerado_em: x.geradoEm.slice(0, 19).replace('T', ' '),
      });
      return x.id;
    },
    async situacaoLote(x) {
      const l = await travarLote(e, est, x.id);
      if (!l || !x.de.includes(l.situacao)) throw desatualizadoLote();
      await e.alterar('lote_folha_intercambio', l.id, l.versao, { situacao: x.para });
    },
    async incluirResumo(x) {
      const l = await travarLote(e, est, x.interface);
      if (!l || x.empresa !== est) throw erroRegistroInexistente();
      const vistos = new Set<string>();
      const [ult] = await e.consultar(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM lote_folha_intercambio_resumo WHERE lote_folha_intercambio_id = ?',
        [l.id],
      );
      let seq = n(ult?.['s']);
      const ja = await e.consultar(
        `SELECT vinculo_trabalho_id, rubrica FROM lote_folha_intercambio_resumo
          WHERE lote_folha_intercambio_id = ? AND excluido_em IS NULL AND vinculo_trabalho_id IS NOT NULL`,
        [l.id],
      );
      for (const r of ja) vistos.add(`${n(r['vinculo_trabalho_id'])}|${texto(r['rubrica'])}`);
      for (const r of x.linhas as readonly LinhaResumoDaFolha[]) {
        if (r.vinculo !== null) {
          const k = `${r.vinculo}|${r.rubrica}`;
          if (vistos.has(k))
            throw recusa('resumo-repetido', 'O resumo deste colaborador já foi gravado neste retorno.');
          vistos.add(k);
        }
        await e.incluir('lote_folha_intercambio_resumo', {
          lote_folha_intercambio_id: l.id,
          sequencia: ++seq,
          vinculo_trabalho_id: r.vinculo,
          centro_custo_id: r.centroCusto,
          rubrica: r.rubrica,
          valor: reais(r.valor),
          vencimento: r.vencimento ?? null,
        });
      }
      return x.linhas.length;
    },
    resumo: (numero) => lerResumo(e, est, numero),
    afastamento: (id) => lerAfastamento(e, est, id),
    afastamentos: (f) => lerAfastamentos(e, est, f),
    async incluirAfastamento(x: NovoAfastamentoFolha) {
      const colaborador = await travarVinculo(e, est, x.vinculo);
      const m = await e.uma('SELECT id FROM motivo_afastamento WHERE id = ? AND ativo = TRUE', [x.motivo]);
      if (!m) throw recusa('motivo-inexistente', 'O motivo de afastamento não existe ou está inativo.');
      if (x.fim !== null && x.fim < x.inicio)
        throw recusa('periodo-invertido', 'O fim do afastamento é anterior ao início.');
      await conferirSobreposicao(e, x.vinculo, x.inicio, x.fim, null);
      return incluirAuditado(
        e,
        'afastamento',
        {
          estabelecimento_id: est,
          colaborador_id: colaborador,
          vinculo_trabalho_id: x.vinculo,
          motivo_afastamento_id: x.motivo,
          data_inicio: x.inicio,
          data_fim: x.fim,
          observacao: x.observacao,
          situacao: 'em_andamento',
        },
        carimbo(),
      );
    },
    async encerrarAfastamento(x) {
      const a = await atual(x.id);
      if (a.situacao === 'cancelado') throw recusa('afastamento-cancelado', 'O afastamento está cancelado.');
      if (x.fim < a.inicio) throw recusa('periodo-invertido', 'O fim do afastamento é anterior ao início.');
      await travarVinculo(e, est, a.vinculo);
      await conferirSobreposicao(e, a.vinculo, a.inicio, x.fim, a.id);
      await alterarAuditado(e, 'afastamento', x.id, x.versao, { data_fim: x.fim }, carimbo());
    },
    async cancelarAfastamento(x) {
      const a = await atual(x.id);
      if (a.situacao === 'cancelado')
        throw recusa('afastamento-cancelado', 'O afastamento já está cancelado.');
      await alterarAuditado(e, 'afastamento', x.id, x.versao, { situacao: 'cancelado' }, carimbo());
    },
  };
}

const desatualizadoLote = () =>
  recusa('desatualizado', 'O lote mudou depois que você abriu (outra pessoa gravou). Abra de novo.');

async function lerResumo(l: Leitor, est: number, numero: number): Promise<ResumoDaFolha[]> {
  return (
    await l.consultar(
      `SELECT r.vinculo_trabalho_id, r.centro_custo_id, r.rubrica, r.valor
         FROM lote_folha_intercambio_resumo r
         JOIN lote_folha_intercambio l ON l.id = r.lote_folha_intercambio_id
        WHERE l.estabelecimento_id = ? AND l.numero = ? AND l.excluido_em IS NULL AND r.excluido_em IS NULL
        ORDER BY r.sequencia`,
      [est, numero],
    )
  ).map((r) => ({
    vinculo: numOuNulo(r['vinculo_trabalho_id']),
    centroCusto: numOuNulo(r['centro_custo_id']),
    rubrica: texto(r['rubrica']),
    valor: centavos(r['valor']),
  }));
}

export class PortaFolhaPropria implements PortaFolha {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoFolha,
    private readonly cifra: CifradorCpf,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<GravacaoFeita> {
    throw recusa(
      'sem-operacao',
      'A interface com a folha grava pelos próprios registros, não por operação avulsa.',
    );
  }

  async gravarSgh<T>(
    c: ContextoFolha,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorFolha) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = (): TrilhaDaGravacao | null =>
      typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha;
    const op = definirOperacao({
      nome: 'pessoas.folha.gravacao-direta',
      tabelas: TABELAS_FOLHA,
      entrada: z.object({ impressao: z.string() }),
      gravar: async (tx: TxOperacao) => {
        saida = { valor: await fn(gravadorFolha(tx, c, est)) };
        return { valor: saida.valor } as unknown as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'afastamento', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `direta:${randomUUID()}`;
    const ctx: ContextoOperacao = {
      ...contextoDe(c),
      correlacao: c.correlacao || 'folha',
      chaveIdempotencia: chave,
    };
    const r = await this.executor.executar(op, c.cliente, { impressao: chave }, ctx);
    return (r.resultado as unknown as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoFolha) {
    return this.ler(c, async (l, est) => relogioDoFuso(await fusoDe(l, est)));
  }

  empresas(c: ContextoFolha): Promise<ItemDominioFolha[]> {
    // A empresa da folha é o estabelecimento da sessão.
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          'SELECT id, nome_fantasia FROM estabelecimento WHERE id = ? AND excluido_em IS NULL',
          [est],
        )
      ).map((r) => ({ codigo: n(r['id']), rotulo: texto(r['nome_fantasia']) })),
    );
  }

  eventosPonto(c: ContextoFolha): Promise<ItemDominioFolha[]> {
    // Catálogo da rede inteira (tipo_hora não tem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, descricao FROM tipo_hora WHERE ativo = TRUE ORDER BY descricao, id')
      ).map((r) => ({
        codigo: n(r['id']),
        rotulo: texto(r['descricao']),
      })),
    );
  }

  motivosAfastamento(c: ContextoFolha): Promise<ItemDominioFolha[]> {
    // Catálogo da rede inteira (motivo_afastamento não tem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao FROM motivo_afastamento WHERE ativo = TRUE ORDER BY descricao, id',
        )
      ).map((r) => ({ codigo: n(r['id']), rotulo: texto(r['descricao']) })),
    );
  }

  tiposFolha(c: ContextoFolha): Promise<ItemDominioFolha[]> {
    // Catálogo da rede inteira (tipo_folha não tem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar('SELECT id, descricao FROM tipo_folha WHERE ativo = TRUE ORDER BY descricao, id')
      ).map((r) => ({
        codigo: n(r['id']),
        rotulo: texto(r['descricao']),
      })),
    );
  }

  remessas(c: ContextoFolha, empresa: number): Promise<RemessaDaFolha[]> {
    return this.ler(c, async (l, est) => {
      // A empresa da folha é o estabelecimento: outro estabelecimento não é visto desta sessão.
      if (empresa !== est) return [];
      const rs = await l.consultar(
        `SELECT id, ano, mes, numero_folha, tipo_folha_id, apuracao_inicio, apuracao_fim, data_pagamento, situacao
           FROM competencia_folha
          WHERE estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY ano DESC, mes DESC, numero_folha, id`,
        [est],
      );
      return rs.map((r) => ({
        id: n(r['id']),
        empresa: est,
        competencia: `${n(r['ano'])}-${doisDigitos(n(r['mes']))}`,
        numero: numOuNulo(r['numero_folha']),
        tipoFolha: n(r['tipo_folha_id']),
        inicioApuracao: dia(r['apuracao_inicio']),
        fimApuracao: dia(r['apuracao_fim']),
        pagamento: dia(r['data_pagamento']),
        fechada: r['situacao'] === 'fechada',
      }));
    });
  }

  lotes(c: ContextoFolha, f: FiltroLotesDaFolha): Promise<LoteDaFolha[]> {
    return this.ler(c, (l, est) => lerLotes(l, est, f));
  }

  lote(c: ContextoFolha, id: number): Promise<LoteFolhaCompleto | null> {
    return this.ler(c, (l, est) => lerLote(l, est, id));
  }

  competenciaLancada(c: ContextoFolha, empresa: number, competencia: string): Promise<boolean> {
    return this.ler(c, (l, est) => competenciaLancadaEm(l, est, empresa, competencia));
  }

  vinculosDaFolha(c: ContextoFolha, inicio: string, fim: string): Promise<VinculoDaFolha[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar(SQL_VINCULOS, [est, fim, inicio])).flatMap((r) => {
        const tipo = tipoVinculoDaFolha(
          texto(r['categoria']),
          texto(r['grupo_categoria']),
          texto(r['regime_trabalhista']),
        );
        // Categoria fora da folha de empregados (avulso, contribuinte individual...) não vai à folha.
        if (tipo === null) return [];
        return [
          {
            id: n(r['id']),
            cpfCifrado: this.cifra.cifrar(texto(r['cpf'])),
            matricula: textoOuNulo(r['matricula']),
            tipo,
            admissao: diaObrigatorio(r['data_admissao']),
            desligamento: dia(r['data_desligamento']),
            centroCusto: numOuNulo(r['centro_custo_id']),
            unidade: numOuNulo(r['setor_funcional_id']),
            profissional: numOuNulo(r['profissional_id']),
          },
        ];
      }),
    );
  }

  conselhos(
    c: ContextoFolha,
    profissionais: readonly number[],
  ): Promise<Map<number, ConselhoDoProfissional>> {
    if (profissionais.length === 0) return Promise.resolve(new Map());
    // O registro no conselho é do profissional (cadastro da rede inteira, sem estabelecimento).
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT i.profissional_id, cc.sigla, i.numero_inscricao, uf.sigla AS uf, o.codigo_cbo,
                COALESCE((SELECT vc.data_validade FROM validade_conselho vc
                           WHERE vc.inscricao_conselho_id = i.id ORDER BY vc.ocorrido_em DESC, vc.id DESC LIMIT 1),
                         i.validade) AS validade
           FROM inscricao_conselho i
           JOIN conselho_classe cc ON cc.id = i.conselho_classe_id
           JOIN unidade_federativa uf ON uf.id = i.unidade_federativa_id
           LEFT JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
          WHERE i.profissional_id IN (${profissionais.map(() => '?').join(', ')}) AND i.excluido_em IS NULL
            AND i.situacao IN ('ativa', 'provisoria')
          ORDER BY i.profissional_id, i.principal DESC, i.sequencia`,
        [...profissionais],
      );
      const m = new Map<number, ConselhoDoProfissional>();
      for (const r of rs) {
        const p = n(r['profissional_id']);
        if (m.has(p)) continue;
        const numero = texto(r['numero_inscricao']);
        m.set(p, {
          profissional: p,
          sigla: textoOuNulo(r['sigla']),
          numero: /^\d+$/.test(numero) ? Number(numero) : null,
          uf: textoOuNulo(r['uf']),
          validade: dia(r['validade']),
          cbo: textoOuNulo(r['codigo_cbo']),
        });
      }
      return m;
    });
  }

  afastamentos(c: ContextoFolha, f: FiltroAfastamentosFolha): Promise<AfastamentoFolha[]> {
    return this.ler(c, (l, est) => lerAfastamentos(l, est, f));
  }

  afastamento(c: ContextoFolha, id: number): Promise<AfastamentoFolha | null> {
    return this.ler(c, (l, est) => lerAfastamento(l, est, id));
  }
}

export function portaFolhaIndisponivel(): PortaFolha {
  return portaIndisponivel<PortaFolha>(METODOS_PORTA_FOLHA);
}
