// Prescrição eletrônica no banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo): a família de gravação e das leituras
// que a acompanham (futuras, reconciliações, fichas, grades, a vencer, cabeçalho do documento). Classe auxiliar
// construída com (nucleo, cliente); o integrador liga os métodos na PortaPrescricaoPropria.
// Leituras pelo Leitor (somente leitura, filtro por estabelecimento e por exclusão lógica); gravações pelo Executor
// (trilha, idempotência e versão na mesma transação). Registro clínico nunca é apagado (SBIS-26): nenhuma exclusão
// física; a correção é suspensão (com o item de correção), cancelamento com motivo ou nova versão.
// A gravação clínica exige o profissional da sessão: usuário → usuario_profissional (vigente) → profissional (ativo) →
// inscrição no conselho ativa ou provisória, com a ocupação (CBO) da operação quando ela vem na entrada.
// Tabelas: prescricao, prescricao_item, prescricao_item_medicamento, horario_administracao, prescricao_evento,
// decisao_alerta, planejamento_prescricao, reconciliacao_medicamentosa, reconciliacao_item, ficha_antimicrobiano,
// grade_horario_classe (migração 06_PEP/95_prescricao_gravacao).
// Ainda sem adaptador (501 pendente-modelo-proprio, nada gravado): itens de tipo diferente de medicamento e cuidado
// simples, medicamento não padronizado, kit e motivos de "se necessário" no item, fichas de antimicrobiano na
// gravação da prescrição, registrarFicha e gravarRegra.
import { randomUUID } from 'node:crypto';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { PLANO_DO_TIPO } from '@sgh/contratos';
import { z } from 'zod';
import type { ContextoPrescricao } from './prescricao-porta.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';
import type {
  CabecalhoDocumentoLido,
  CampoDocumentoLido,
  FichaAntigaLida,
  FichaNovaLida,
  FuturaGravadaLida,
  FuturaProgramada,
  GradeClasseLida,
  GravacaoPrescricao,
  InclusaoItem,
  ItemGravacao,
  LiberacaoConsultada,
  NovaGradeClasse,
  PrescricaoAVencer,
  ReconciliacaoGravacao,
  ReconciliacaoGravadaLida,
  SuspensaoItem,
  SuspensaoPrescricao,
} from './tipos-pep.js';

/** O que a família usa do NucleoProprio (os testes trocam). */
export interface NucleoGravacaoPrescricao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

/** Tabelas que as gravações desta família escrevem (a transação recusa as outras). */
export const TABELAS_GRAVACAO_PRESCRICAO = [
  'prescricao',
  'prescricao_item',
  'prescricao_item_medicamento',
  'horario_administracao',
  'prescricao_evento',
  'decisao_alerta',
  'planejamento_prescricao',
  'reconciliacao_medicamentosa',
  'reconciliacao_item',
  'grade_horario_classe',
  'sequencia_negocio',
] as const;

/** Teto de linhas devolvidas pelas listas desta família. */
export const TETO_LISTA = 500;

/** Situações de horário ainda por administrar (suspensas junto com o item ou a prescrição). */
export const CATEGORIAS_PENDENTES = ['pendente', 'atrasado', 'adiado', 'administrado_parcial'] as const;

/** Código de plano do tipo oferecido → categoria do tipo de item (CHECK de tipo_item_prescricao). */
export const CATEGORIA_DO_PLANO: Readonly<Record<number, string>> = {
  [PLANO_DO_TIPO.medicamento]: 'medicamento',
  [PLANO_DO_TIPO.solucao]: 'solucao',
  [PLANO_DO_TIPO['dieta-oral']]: 'dieta',
  [PLANO_DO_TIPO.hemoterapia]: 'hemocomponente',
  [PLANO_DO_TIPO.procedimento]: 'procedimento',
};
/** Mesmo valor da porta própria: plano acima dele = id do tipo de item próprio. */
export const BASE_PLANO_PROPRIO = 1000;

/** Decisão do contrato → decisão gravada (CHECK de decisao_alerta). "exibido" (só aviso) fica como aceito. */
export function decisaoGravada(decisao: string, justificativa: string | null): string {
  if (decisao === 'retirado') return 'cancelou_item';
  return justificativa ? 'justificou' : 'aceitou';
}

const FONTES_RECONCILIACAO = ['paciente', 'familiar', 'receita', 'prontuario', 'outro'] as const;
const CONDUTAS_RECONCILIACAO = ['manter', 'suspender', 'substituir', 'ajustar'] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const verdadeiro = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, status === 404 ? 'Não encontrado' : 'Operação recusada', detalhe);

export function recusaPendenteGravacao(oque: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A gravação de ${oque} na prescrição ainda não tem adaptador no banco próprio.`,
  );
}

/**
 * Data e hora civil do estabelecimento (AAAA-MM-DDTHH:MM[:SS]) → instante (UTC), sem depender do TZ do processo: o
 * deslocamento do fuso é achado pelo próprio formatador (duas voltas cobrem a troca de horário de verão).
 */
export function instanteLocal(civil: string, fuso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(civil);
  if (!m) throw recusar(422, 'data-hora-invalida', 'Data e hora fora do formato AAAA-MM-DDTHH:MM.');
  const alvo = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  let t = alvo;
  for (let i = 0; i < 2; i++) {
    const visto = Date.parse(`${dataHora(new Date(t), fuso) ?? ''}Z`);
    t += alvo - visto;
  }
  return new Date(t);
}

/** Login do usuário ligado ao profissional (o vínculo vigente primeiro); sem vínculo, o nome de exibição. */
const loginDoProfissional = (coluna: string) => `COALESCE(
  (SELECT u.login FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id
    WHERE up.profissional_id = ${coluna} AND up.excluido_em IS NULL
    ORDER BY up.vigencia_fim IS NULL DESC, up.vigencia_inicio DESC, up.id DESC LIMIT 1),
  (SELECT pf.nome_exibicao FROM profissional pf WHERE pf.id = ${coluna}))`;

const VISIVEL = (a: string) =>
  `${a}.estabelecimento_id = ? AND ${a}.excluido_em IS NULL AND ${a}.situacao <> 'rascunho'`;

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** O profissional da sessão que grava (usuário, profissional e a ocupação da inscrição usada). */
export interface ProfissionalDaGravacao {
  readonly usuario: number;
  readonly profissional: number;
  readonly ocupacao: number | null;
}

/** Linha da prescrição relida sob trava (FOR UPDATE) na transação. */
interface PrescricaoTravada {
  readonly id: number;
  readonly versao: number;
  readonly situacao: string;
  readonly atendimento: number;
  readonly paciente: number;
  readonly inicio: Date;
  readonly fim: Date;
  readonly suspensa: boolean;
}

export class GravacaoPrescricaoPropria {
  private executorCriado: Executor | null = null;

  constructor(
    private readonly nucleo: NucleoGravacaoPrescricao,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
  ) {}

  private get executor(): Executor {
    this.executorCriado ??= this.nucleo.criarExecutor();
    return this.executorCriado;
  }

  private clienteDe(c: ContextoPrescricao): string {
    return c.cliente || this.cliente;
  }

  private ler<T>(
    c: ContextoPrescricao,
    rotulo: string,
    fn: (l: Leitor, est: Estabelecimento) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.clienteDe(c), correlacao: `pep.prescricao.${rotulo}` },
      async (l) => fn(l, await estabelecimentoDe(l, c.hospital)),
    );
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  /** Programações de prescrição futura do atendimento (as do sistema; as trazidas da origem vão nas antigas). */
  futuras(c: ContextoPrescricao, atendimento: number): Promise<FuturaGravadaLida[]> {
    return this.ler(c, 'futuras', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT f.id, f.liberar_em, f.planejado_em, f.descricao, f.situacao, f.prescricao_id,
                CAST(f.itens_programados AS CHAR) AS itens
           FROM planejamento_prescricao f
          WHERE f.estabelecimento_id = ? AND f.atendimento_id = ? AND f.excluido_em IS NULL
            AND f.origem <> 'migracao'
          ORDER BY f.liberar_em, f.id LIMIT ${TETO_LISTA}`,
        [est.id, atendimento],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        aPartirDe: dataHora(x['liberar_em'] ?? x['planejado_em'], est.fuso) ?? '',
        descricao: textoOuNull(x['descricao']) ?? '',
        situacao: String(x['situacao']) as FuturaGravadaLida['situacao'],
        prescricao: x['situacao'] === 'efetivada' ? numOuNull(x['prescricao_id']) : null,
        itemJson: textoOuNull(x['itens']),
      }));
    });
  }

  /** Reconciliações medicamentosas do atendimento (uma por lote), com as linhas em ordem. */
  reconciliacoes(c: ContextoPrescricao, atendimento: number): Promise<ReconciliacaoGravadaLida[]> {
    return this.ler(c, 'reconciliacoes', async (l, est) => {
      const lotes = await l.consultar(
        `SELECT r.id, r.momento, COALESCE(r.concluida_em, r.iniciada_em) AS em,
                ${loginDoProfissional('r.responsavel_profissional_id')} AS usuario
           FROM reconciliacao_medicamentosa r
          WHERE r.estabelecimento_id = ? AND r.atendimento_id = ? AND r.excluido_em IS NULL
            AND r.situacao <> 'cancelada'
          ORDER BY r.iniciada_em, r.id LIMIT ${TETO_LISTA}`,
        [est.id, atendimento],
      );
      if (lotes.length === 0) return [];
      const ids = lotes.map((x) => num(x['id']));
      const linhas = await l.consultar(
        `SELECT reconciliacao_medicamentosa_id AS lote, descricao, item_prescritivel_id, dose, frequencia, fonte,
                conduta, justificativa, prescricao_item_id
           FROM reconciliacao_item
          WHERE reconciliacao_medicamentosa_id IN (${ids.map(() => '?').join(',')}) AND excluido_em IS NULL
          ORDER BY reconciliacao_medicamentosa_id, sequencia, id`,
        ids,
      );
      return lotes.map((r) => ({
        lote: num(r['id']),
        momento: String(r['momento']) as ReconciliacaoGravadaLida['momento'],
        em: dataHora(r['em'], est.fuso),
        usuario: textoOuNull(r['usuario']) ?? '',
        linhas: linhas
          .filter((x) => num(x['lote']) === num(r['id']))
          .map((x) => ({
            descricao: String(x['descricao']),
            produto: numOuNull(x['item_prescritivel_id']),
            dose: textoOuNull(x['dose']),
            frequencia: textoOuNull(x['frequencia']),
            fonte: String(x['fonte']),
            conduta: String(x['conduta']),
            justificativa: textoOuNull(x['justificativa']),
            item: numOuNull(x['prescricao_item_id']),
          })),
      }));
    });
  }

  /** Fichas de antimicrobiano do sistema (do paciente, ou do estabelecimento todo com paciente null). */
  fichas(c: ContextoPrescricao, paciente: number | null): Promise<FichaNovaLida[]> {
    return this.ler(c, 'fichas', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT f.id, f.paciente_id, f.prescricao_item_id, i.item_prescritivel_id, ip.descricao AS produto_nome,
                f.justificativa, si.descricao AS sitio, ft.codigo AS tipo, f.cultura_coletada, i.dia_tratamento,
                f.criado_em
           FROM ficha_antimicrobiano f
           JOIN prescricao_item i ON i.id = f.prescricao_item_id
           LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id
           LEFT JOIN sitio_infeccao si ON si.id = f.sitio_infeccao_id
           LEFT JOIN finalidade_terapeutica ft ON ft.id = f.finalidade_terapeutica_id
          WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.origem <> 'migracao'
            AND (? IS NULL OR f.paciente_id = ?)
          ORDER BY f.criado_em DESC, f.id DESC LIMIT ${TETO_LISTA}`,
        [est.id, paciente, paciente],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        paciente: num(x['paciente_id']),
        item: numOuNull(x['prescricao_item_id']),
        produto: num(x['item_prescritivel_id'] ?? 0),
        produtoNome: textoOuNull(x['produto_nome']),
        indicacao: String(x['justificativa']),
        sitio: textoOuNull(x['sitio']) ?? '',
        tipo: textoOuNull(x['tipo']) ?? '',
        culturaColhida: verdadeiro(x['cultura_coletada']),
        diaTratamento: numOuNull(x['dia_tratamento']) ?? 1,
        em: dataHora(x['criado_em'], est.fuso),
      }));
    });
  }

  /** Fichas trazidas da origem (carga), só para consulta do histórico do paciente. */
  fichasAntigas(c: ContextoPrescricao, paciente: number): Promise<FichaAntigaLida[]> {
    return this.ler(c, 'fichasAntigas', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT f.id, COALESCE(ip.descricao, a.descricao) AS produto,
                DATE_FORMAT(f.data_inicio, '%Y-%m-%d') AS inicio, f.dias_previstos, f.avaliacao_situacao
           FROM ficha_antimicrobiano f
           LEFT JOIN prescricao_item i ON i.id = f.prescricao_item_id
           LEFT JOIN item_prescritivel ip ON ip.id = i.item_prescritivel_id
           LEFT JOIN antimicrobiano a ON a.id = f.antimicrobiano_id
          WHERE f.estabelecimento_id = ? AND f.paciente_id = ? AND f.excluido_em IS NULL AND f.origem = 'migracao'
          ORDER BY f.data_inicio DESC, f.id DESC LIMIT ${TETO_LISTA}`,
        [est.id, paciente],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        produto: textoOuNull(x['produto']),
        inicio: textoOuNull(x['inicio']),
        dias: num(x['dias_previstos']),
        situacao: String(x['avaliacao_situacao']),
      }));
    });
  }

  /** Planejamentos trazidos da origem (carga), com a vigência da prescrição planejada. */
  planejamentosAntigos(
    c: ContextoPrescricao,
    paciente: number,
  ): Promise<{ id: number; inicio: string | null; fim: string | null }[]> {
    return this.ler(c, 'planejamentosAntigos', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT f.id, COALESCE(p.vigencia_inicio_em, f.liberar_em) AS inicio, p.vigencia_fim_em AS fim
           FROM planejamento_prescricao f
           LEFT JOIN prescricao p ON p.id = f.prescricao_id
          WHERE f.estabelecimento_id = ? AND f.paciente_id = ? AND f.excluido_em IS NULL AND f.origem = 'migracao'
          ORDER BY f.planejado_em DESC, f.id DESC LIMIT ${TETO_LISTA}`,
        [est.id, paciente],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        inicio: dataHora(x['inicio'], est.fuso),
        fim: dataHora(x['fim'], est.fuso),
      }));
    });
  }

  /** As grades de horário por classe do estabelecimento (todas as versões, a mais nova primeiro). */
  grades(c: ContextoPrescricao): Promise<GradeClasseLida[]> {
    return this.ler(c, 'grades', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT g.id, g.unidade_assistencial_id, g.classe, g.doses_por_dia, g.horarios,
                DATE_FORMAT(g.vigente_desde, '%Y-%m-%d') AS vigente_desde, g.ativo, u.login
           FROM grade_horario_classe g
           JOIN usuario u ON u.id = g.autor_usuario_id
          WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL
          ORDER BY g.unidade_assistencial_id, g.classe, g.vigente_desde DESC, g.id DESC LIMIT ${TETO_LISTA}`,
        [est.id],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        unidade: num(x['unidade_assistencial_id']),
        classe: String(x['classe']),
        numDoses: num(x['doses_por_dia']),
        horarios: String(x['horarios']).split(';'),
        vigenteDesde: String(x['vigente_desde']),
        ativa: verdadeiro(x['ativo']),
        autor: String(x['login']),
      }));
    });
  }

  /** Prescrições vigentes (não suspensas) que vencem entre agora e o fim do turno, com paciente, unidade e leito. */
  vencemAte(
    c: ContextoPrescricao,
    agora: string,
    ate: string,
    unidade: number | null,
  ): Promise<PrescricaoAVencer[]> {
    return this.ler(c, 'vencemAte', async (l, est) => {
      const de = instanteLocal(`${agora.slice(0, 16)}:00`, est.fuso);
      const atePara = instanteLocal(`${ate.slice(0, 16)}:59`, est.fuso);
      const linhas = await l.consultar(
        `SELECT p.id, p.atendimento_id, p.vigencia_fim_em, p.paciente_id, pf.nome,
                CASE WHEN pc.usa_nome_social THEN pc.nome_social
                     WHEN pf.usa_nome_social THEN pf.nome_social END AS nome_social,
                a.unidade_assistencial_id, ua.nome AS unidade_nome, lh.codigo AS leito
           FROM prescricao p
           JOIN atendimento a ON a.id = p.atendimento_id
           LEFT JOIN paciente pc ON pc.id = p.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pc.pessoa_fisica_id
           LEFT JOIN unidade_assistencial ua ON ua.id = a.unidade_assistencial_id
           LEFT JOIN leito_hospitalar lh ON lh.id = p.leito_hospitalar_id
          WHERE ${VISIVEL('p')} AND p.situacao = 'vigente' AND p.suspensa_em IS NULL AND p.periodo = 'atual'
            AND p.vigencia_fim_em >= ? AND p.vigencia_fim_em <= ?
            AND (? IS NULL OR a.unidade_assistencial_id = ?)
          ORDER BY p.vigencia_fim_em, p.id LIMIT ${TETO_LISTA}`,
        [est.id, de, atePara, unidade, unidade],
      );
      return linhas.map((x) => ({
        prescricao: num(x['id']),
        atendimento: num(x['atendimento_id']),
        fim: dataHora(x['vigencia_fim_em'], est.fuso),
        paciente: num(x['paciente_id']),
        nome: textoOuNull(x['nome']),
        nomeSocial: textoOuNull(x['nome_social']),
        unidade: numOuNull(x['unidade_assistencial_id']),
        unidadeNome: textoOuNull(x['unidade_nome']),
        leito: textoOuNull(x['leito']),
      }));
    });
  }

  /**
   * Cabeçalho do documento da prescrição: estabelecimento, paciente, atendimento e a ocupação do profissional. No
   * banco próprio os retratos são o próprio paciente e o próprio atendimento. Paciente ou atendimento fora do
   * estabelecimento: 404.
   */
  cabecalhoDocumento(
    c: ContextoPrescricao,
    retratos: { readonly htPaciente: number; readonly htAtendimento: number },
    cbo: number,
  ): Promise<CabecalhoDocumentoLido> {
    return this.ler(c, 'cabecalhoDocumento', async (l, est) => {
      const h = await l.uma(
        'SELECT id, nome_fantasia, razao_social, cnpj, codigo_cnes FROM estabelecimento WHERE id = ?',
        [est.id],
      );
      const a = await l.uma(
        `SELECT a.id, a.numero, a.paciente_id, k.descricao AS categoria, k.tipo_base, ua.nome AS unidade
           FROM atendimento a
           JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
           LEFT JOIN unidade_assistencial ua ON ua.id = a.unidade_assistencial_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [retratos.htAtendimento, est.id],
      );
      if (!a || num(a['paciente_id']) !== retratos.htPaciente)
        throw recusar(404, 'registro-inexistente', 'O atendimento do paciente não foi encontrado.');
      const p = await l.uma(
        `SELECT pc.id, pc.numero_prontuario, pf.nome,
                CASE WHEN pc.usa_nome_social THEN pc.nome_social
                     WHEN pf.usa_nome_social THEN pf.nome_social END AS nome_social,
                DATE_FORMAT(pf.data_nascimento, '%Y-%m-%d') AS nascimento
           FROM paciente pc LEFT JOIN pessoa_fisica pf ON pf.id = pc.pessoa_fisica_id
          WHERE pc.id = ? AND pc.excluido_em IS NULL`,
        [retratos.htPaciente],
      );
      const o = await l.uma(
        `SELECT codigo_cbo, descricao FROM ocupacao_cbo
          WHERE REPLACE(REPLACE(codigo_cbo, '-', ''), '.', '') = ? ORDER BY id LIMIT 1`,
        [String(cbo)],
      );
      const campos = (pares: [string, unknown][]): CampoDocumentoLido[] =>
        pares.map(([k, v]) => [k, v === null || v === undefined ? null : typeof v === 'number' ? v : String(v)]);
      return {
        hospital: campos([
          ['id', est.id],
          ['nome', h?.['nome_fantasia']],
          ['razao_social', h?.['razao_social']],
          ['cnpj', h?.['cnpj']],
          ['cnes', h?.['codigo_cnes']],
        ]),
        paciente: campos([
          ['id', retratos.htPaciente],
          ['nome', p?.['nome']],
          ['nome_social', p?.['nome_social']],
          ['prontuario', p?.['numero_prontuario']],
          ['nascimento', p?.['nascimento']],
        ]),
        atendimento: campos([
          ['id', retratos.htAtendimento],
          ['numero', a['numero']],
          ['tipo_atendimento', a['categoria']],
          ['unidade', a['unidade']],
        ]),
        profissional: campos([
          ['cbo', cbo],
          ['ocupacao', o?.['descricao']],
        ]),
        tipoAssinatura: 'Prescrição Geral',
        situacao: 'Prescrito',
      };
    });
  }

  // ── Liberação (passo 0) ─────────────────────────────────────────────────────────────────────────

  /**
   * A operação grava agora para este login? Exige o estabelecimento da sessão e o profissional com vínculo vigente e
   * inscrição ativa no conselho (falha fechada: sem ele, consulta com o motivo); depois, o passo 0 do executor.
   */
  async podeGravar(c: ContextoPrescricao, operacao: string, login: string): Promise<LiberacaoConsultada> {
    const r = await this.ler(c, 'podeGravar', async (l, est) => ({
      est,
      prof: await profissionalDaSessao(l, { usuario: null, login }, null),
    })).catch((e: unknown) => {
      if (e instanceof ErroOperacao) return { erro: e } as const;
      throw e;
    });
    if ('erro' in r)
      return { pode: false, codigo: r.erro.problema.codigo ?? null, motivo: r.erro.problema.detail };
    if (!r.prof)
      return {
        pode: false,
        codigo: 'profissional-sem-cbo',
        motivo: 'O usuário não tem profissional com inscrição ativa no conselho neste cliente.',
      };
    const op = definirOperacao({
      nome: nomeOperacao(operacao),
      tabelas: TABELAS_GRAVACAO_PRESCRICAO,
      entrada: z.object({}).strict(),
      gravar: async () => ({}),
      alvo: () => ({ tabela: 'prescricao', id: null }),
    });
    return this.executor.liberacao(op, {
      cliente: this.clienteDe(c),
      estabelecimento: r.est.id,
      usuario: r.prof.usuario,
      correlacao: (c.correlacao || 'pep.prescricao').slice(0, 64),
      chaveIdempotencia: 'consulta.liberacao',
    });
  }

  // ── Gravações clínicas ──────────────────────────────────────────────────────────────────────────

  /** Prescrever, copiar ou renovar: a prescrição liberada (vigente) com os itens, os horários e as decisões. */
  prescrever(
    c: ContextoPrescricao,
    operacao: 'pep.prescrever' | 'pep.copiarPrescricao' | 'pep.renovarPrescricao',
    e: GravacaoPrescricao,
    ctx: ContextoOperacao,
  ): Promise<{ prescricao: number; horarios: number }> {
    conferirItensSuportados(e.itens);
    if (e.sgh.fichas.length > 0) throw recusaPendenteGravacao('fichas de antimicrobiano');
    return this.gravar(c, ctx, operacao, e.cbo, async (tx, est, prof) => {
      const atd = await tx.uma(
        'SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.atendimento, est.id],
      );
      if (!atd || num(atd['paciente_id']) !== e.paciente)
        throw recusar(404, 'registro-inexistente', 'O atendimento do paciente não foi encontrado.');
      const inicio = instanteLocal(e.vigencia.inicio, est.fuso);
      const fim = instanteLocal(e.vigencia.fim, est.fuso);
      if (fim.getTime() <= inicio.getTime())
        throw recusar(422, 'vigencia-invalida', 'O fim da vigência tem de ser depois do início.');
      const ocupada = await umaTravada(tx, 
        `SELECT p.id FROM prescricao p
          WHERE ${VISIVEL('p')} AND p.atendimento_id = ? AND p.situacao IN ('vigente','futura')
            AND p.suspensa_em IS NULL AND p.vigencia_inicio_em <= ? AND p.vigencia_fim_em >= ?
          LIMIT 1`,
        [est.id, e.atendimento, fim, inicio],
      );
      if (ocupada)
        throw recusar(
          409,
          operacao === 'pep.renovarPrescricao' ? 'periodo-ocupado' : 'outra-ativa-no-periodo',
          'Já existe prescrição ativa no período.',
        );
      if (e.origem) {
        const o = await travarPrescricao(tx, est.id, e.origem.prescricao);
        if (!o || o.suspensa || o.situacao === 'cancelada' || o.atendimento !== e.atendimento)
          throw recusar(409, 'origem-alterada', 'A prescrição de origem foi suspensa ou cancelada.');
        const ativos = new Set(
          (
            await tx.consultar(
              `SELECT id FROM prescricao_item WHERE prescricao_id = ? AND excluido_em IS NULL AND situacao = 'ativo'`,
              [o.id],
            )
          ).map((x) => num(x['id'])),
        );
        if (e.origem.itens.some((x) => x.ativo && !ativos.has(x.item)))
          throw recusar(409, 'origem-alterada', 'Item da origem suspenso.');
      }
      const agora = new Date();
      const numero = await tx.proximoNumero('prescricao');
      const prescricao = await tx.incluir('prescricao', {
        estabelecimento_id: est.id,
        numero: numero.valor,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        prescritor_profissional_id: prof.profissional,
        ocupacao_cbo_id: prof.ocupacao,
        prioridade: e.sgh.prioridade,
        situacao: 'vigente',
        prescrito_em: instanteLocal(e.dataHora, est.fuso),
        vigencia_inicio_em: inicio,
        vigencia_fim_em: fim,
        retroativo: e.justificativaRetroativo !== null,
        justificativa_retroativo: e.justificativaRetroativo,
        anterior_prescricao_id: e.origem?.prescricao ?? null,
        modo_origem: e.origem?.modo ?? null,
        liberada_em: agora,
        observacao_geral: e.observacaoGeral,
        coassinatura_exigida: e.sgh.coassinaturaExigida,
        origem: 'sistema',
      });
      let horarios = 0;
      const porChave = new Map<string, number>();
      for (const [i, it] of e.itens.entries()) {
        const r = await inserirItem(tx, est, prescricao, e.atendimento, prof, it, i + 1, inicio, fim, e.sgh);
        porChave.set(it.chave, r.item);
        horarios += r.horarios;
      }
      await gravarDecisoes(tx, prof, porChave, e.sgh.decisoes, agora);
      for (const futura of e.sgh.futuras) await efetivarFutura(tx, est.id, e.atendimento, futura, prescricao, agora);
      const evento =
        operacao === 'pep.copiarPrescricao' ? 'copia' : operacao === 'pep.renovarPrescricao' ? 'renovacao' : 'criacao';
      await evento_(tx, prescricao, null, 'inclusao', evento, null, 'vigente', null, prof, agora, {
        itens: e.itens.length,
        horarios,
        protocolos: e.protocolos,
      });
      await evento_(tx, prescricao, null, 'alteracao', 'assinatura', 'vigente', 'vigente', null, prof, agora, {
        hashConteudo: e.hashConteudo,
        comoSuporte: e.sgh.comoSuporte,
      });
      return { prescricao, horarios };
    }, (r) => ({ tabela: 'prescricao', id: r.prescricao }));
  }

  /** Item incluído depois da liberação (adendo) numa prescrição vigente. */
  incluirItem(c: ContextoPrescricao, e: InclusaoItem, ctx: ContextoOperacao): Promise<{ item: number }> {
    conferirItensSuportados([e.item]);
    return this.gravar(c, ctx, 'pep.incluirItem', e.cbo, async (tx, est, prof) => {
      const p = await vigenteDoPaciente(tx, est.id, e.prescricao, e.paciente);
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM prescricao_item WHERE prescricao_id = ?',
        [p.id],
      );
      const agora = new Date();
      const inicio = agora.getTime() > p.inicio.getTime() ? agora : p.inicio;
      const r = await inserirItem(tx, est, p.id, p.atendimento, prof, e.item, num(seq?.['s']), inicio, p.fim, e.sgh);
      await gravarDecisoes(tx, prof, new Map([[e.item.chave, r.item]]), e.sgh.decisoes, agora);
      await tx.alterar('prescricao', p.id, p.versao, {});
      await evento_(tx, p.id, r.item, 'inclusao', 'inclusao_item', p.situacao, p.situacao, null, prof, agora, {
        hashConteudo: e.hashConteudo,
        comoSuporte: e.sgh.comoSuporte,
        horarios: r.horarios,
      });
      return { item: r.item };
    }, (r) => ({ tabela: 'prescricao_item', id: r.item }));
  }

  /** Suspende o item (ou corrige: suspende e inclui o item de correção); os horários pendentes ficam suspensos. */
  suspenderItem(c: ContextoPrescricao, e: SuspensaoItem, ctx: ContextoOperacao): Promise<{ horarios: number }> {
    if (e.correcao) conferirItensSuportados([e.correcao]);
    return this.gravar(c, ctx, 'pep.suspenderItem', e.cbo, async (tx, est, prof) => {
      const p = await vigenteDoPaciente(tx, est.id, e.prescricao, e.paciente);
      const it = await umaTravada(tx, 
        `SELECT id, versao, situacao, sequencia FROM prescricao_item
          WHERE id = ? AND prescricao_id = ? AND excluido_em IS NULL`,
        [e.item, p.id],
      );
      const pendentes = it ? await horariosPendentes(tx, est.id, p.id, e.item) : [];
      if (!it || it['situacao'] !== 'ativo' || pendentes.length === 0)
        throw recusar(409, 'item-nao-ativo', 'O item já está suspenso.');
      const agora = new Date();
      const situacao = e.correcao ? 'suspenso_correcao' : 'suspenso';
      await tx.alterar('prescricao_item', e.item, num(it['versao']), {
        situacao,
        suspenso_em: agora,
        suspensao_profissional_id: prof.profissional,
        motivo_suspensao: e.justificativa,
        fim_em: agora.getTime() >= p.inicio.getTime() ? agora : p.inicio,
      });
      const n = await suspenderHorarios(tx, pendentes, agora);
      let correcao: number | null = null;
      if (e.correcao) {
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM prescricao_item WHERE prescricao_id = ?',
          [p.id],
        );
        const inicio = agora.getTime() > p.inicio.getTime() ? agora : p.inicio;
        const r = await inserirItem(tx, est, p.id, p.atendimento, prof, e.correcao, num(seq?.['s']), inicio, p.fim, e.sgh);
        correcao = r.item;
        if (e.sgh) await gravarDecisoes(tx, prof, new Map([[e.correcao.chave, r.item]]), e.sgh.decisoes, agora);
      }
      await tx.alterar('prescricao', p.id, p.versao, {});
      await evento_(tx, p.id, e.item, 'alteracao', e.correcao ? 'suspensao_correcao' : 'suspensao', 'ativo', situacao,
        e.justificativa, prof, agora, { hashConteudo: e.hashConteudo, comoSuporte: e.comoSuporte, horarios: n, correcao });
      return { horarios: n };
    }, () => ({ tabela: 'prescricao_item', id: e.item }));
  }

  /** Suspende a prescrição inteira: itens ativos e horários pendentes suspensos, com o motivo. */
  suspenderPrescricao(
    c: ContextoPrescricao,
    e: SuspensaoPrescricao,
    ctx: ContextoOperacao,
  ): Promise<{ horarios: number }> {
    return this.gravar(c, ctx, 'pep.suspenderPrescricao', e.cbo, async (tx, est, prof) => {
      const p = await travarPrescricao(tx, est.id, e.prescricao);
      if (!p || p.paciente !== e.paciente)
        throw recusar(404, 'registro-inexistente', 'A prescrição não foi encontrada para este paciente.');
      if (p.suspensa || p.situacao === 'suspensa' || p.situacao === 'cancelada')
        throw recusar(409, 'prescricao-nao-vigente', 'A prescrição já está suspensa.');
      const agora = new Date();
      const pendentes = await horariosPendentes(tx, est.id, p.id, null);
      const n = await suspenderHorarios(tx, pendentes, agora);
      const ativos = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM prescricao_item
          WHERE prescricao_id = ? AND excluido_em IS NULL AND situacao = 'ativo'`,
        [p.id],
      );
      for (const it of ativos)
        await tx.alterar('prescricao_item', num(it['id']), num(it['versao']), {
          situacao: 'suspenso',
          suspenso_em: agora,
          suspensao_profissional_id: prof.profissional,
          motivo_suspensao: e.justificativa,
        });
      await tx.alterar('prescricao', p.id, p.versao, {
        situacao: 'suspensa',
        suspensa_em: agora,
        suspensao_profissional_id: prof.profissional,
        motivo_suspensao: e.justificativa,
      });
      await evento_(tx, p.id, null, 'alteracao', 'suspensao', p.situacao, 'suspensa', e.justificativa, prof, agora, {
        hashConteudo: e.hashConteudo,
        comoSuporte: e.comoSuporte,
        horarios: n,
        itens: ativos.length,
      });
      return { horarios: n };
    }, () => ({ tabela: 'prescricao', id: e.prescricao }));
  }

  /** Coassinatura do profissional da sessão (login) numa prescrição que a exige; a segunda vez não grava de novo. */
  async coassinar(c: ContextoPrescricao, prescricao: number, usuario: string): Promise<void> {
    await this.gravar(c, contextoDoLogin(c, 'pep.coassinar', usuario), 'pep.coassinar', null, async (tx, est, prof) => {
      const p = await umaTravada(tx, 
        `SELECT id, versao, situacao, coassinatura_exigida, coassinada_em FROM prescricao p
          WHERE p.id = ? AND ${VISIVEL('p')}`,
        [prescricao, est.id],
      );
      if (!p) throw recusar(404, 'registro-inexistente', 'A prescrição não foi encontrada.');
      if (p['situacao'] === 'cancelada')
        throw recusar(409, 'prescricao-nao-vigente', 'A prescrição foi cancelada.');
      if (p['coassinada_em'] !== null) return null;
      const agora = new Date();
      await tx.alterar('prescricao', prescricao, num(p['versao']), {
        coassinatura_exigida: true,
        coassinada_em: agora,
        coassinatura_profissional_id: prof.profissional,
      });
      await evento_(tx, prescricao, null, 'alteracao', 'coassinatura', String(p['situacao']), String(p['situacao']),
        null, prof, agora, null);
      return null;
    }, () => ({ tabela: 'prescricao', id: prescricao }));
  }

  /** Programa uma prescrição futura do atendimento (gatilho por data). */
  programarFutura(c: ContextoPrescricao, usuario: string, f: FuturaProgramada): Promise<number> {
    return this.gravar(c, contextoDoLogin(c, 'pep.programarFutura', usuario), 'pep.programarFutura', null,
      async (tx, est, prof) => {
        const atd = await tx.uma(
          'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [f.atendimento, est.id],
        );
        if (!atd || num(atd['paciente_id']) !== f.paciente)
          throw recusar(404, 'registro-inexistente', 'O atendimento do paciente não foi encontrado.');
        try {
          JSON.parse(f.itemJson);
        } catch {
          throw recusar(422, 'itens-invalidos', 'Os itens programados não são um JSON válido.');
        }
        return tx.incluir('planejamento_prescricao', {
          estabelecimento_id: est.id,
          paciente_id: f.paciente,
          atendimento_id: f.atendimento,
          gatilho: 'data',
          liberar_em: instanteLocal(f.aPartirDe.length === 10 ? `${f.aPartirDe}T00:00` : f.aPartirDe, est.fuso),
          prescritor_profissional_id: prof.profissional,
          ocupacao_cbo_id: prof.ocupacao,
          planejado_em: new Date(),
          situacao: 'programada',
          descricao: f.descricao,
          itens_programados: f.itemJson,
          motivo_programacao: f.motivo,
          origem: 'sistema',
        });
      }, (id) => ({ tabela: 'planejamento_prescricao', id }));
  }

  /** Cancela a programação (só a do paciente da rota: 404; só enquanto programada: 409), com o motivo. */
  async cancelarFutura(
    c: ContextoPrescricao,
    usuario: string,
    paciente: number,
    id: number,
    motivo: string,
  ): Promise<void> {
    await this.gravar(c, contextoDoLogin(c, 'pep.cancelarFutura', usuario), 'pep.cancelarFutura', null,
      async (tx, est) => {
        const f = await umaTravada(tx, 
          `SELECT id, versao, situacao FROM planejamento_prescricao
            WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL`,
          [id, est.id, paciente],
        );
        if (!f)
          throw recusar(404, 'registro-inexistente', 'A prescrição futura não foi encontrada para este paciente.');
        if (f['situacao'] !== 'programada')
          throw recusar(409, 'futura-nao-programada', 'A prescrição futura não está programada.');
        await tx.alterar('planejamento_prescricao', id, num(f['versao']), {
          situacao: 'cancelada',
          cancelado_em: new Date(),
          motivo_cancelamento: motivo.slice(0, 500),
        });
        return null;
      }, () => ({ tabela: 'planejamento_prescricao', id }), motivo);
  }

  /** Registra a reconciliação (um lote concluído com as linhas); devolve o lote. */
  registrarReconciliacao(c: ContextoPrescricao, usuario: string, r: ReconciliacaoGravacao): Promise<number> {
    for (const x of r.linhas) {
      if (!(FONTES_RECONCILIACAO as readonly string[]).includes(x.fonte))
        throw recusar(422, 'valor-fora-do-dominio', 'Fonte da informação fora da lista.');
      if (!(CONDUTAS_RECONCILIACAO as readonly string[]).includes(x.conduta))
        throw recusar(422, 'valor-fora-do-dominio', 'Conduta fora da lista.');
      if (x.conduta !== 'manter' && !x.justificativa)
        throw recusar(422, 'justificativa-obrigatoria', 'A conduta diferente de manter pede justificativa.');
    }
    return this.gravar(c, contextoDoLogin(c, 'pep.registrarReconciliacao', usuario), 'pep.registrarReconciliacao',
      null, async (tx, est, prof) => {
        const atd = await tx.uma(
          'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [r.atendimento, est.id],
        );
        if (!atd || num(atd['paciente_id']) !== r.paciente)
          throw recusar(404, 'registro-inexistente', 'O atendimento do paciente não foi encontrado.');
        const agora = new Date();
        const lote = await tx.incluir('reconciliacao_medicamentosa', {
          estabelecimento_id: est.id,
          paciente_id: r.paciente,
          atendimento_id: r.atendimento,
          momento: r.momento,
          responsavel_profissional_id: prof.profissional,
          iniciada_em: agora,
          concluida_em: agora,
          situacao: 'concluida',
          origem: 'sistema',
        });
        for (const [i, x] of r.linhas.entries())
          await tx.incluir('reconciliacao_item', {
            reconciliacao_medicamentosa_id: lote,
            sequencia: i + 1,
            item_prescritivel_id: x.produto,
            descricao: x.descricao.slice(0, 200),
            dose: x.dose?.slice(0, 60) ?? null,
            frequencia: x.frequencia?.slice(0, 60) ?? null,
            fonte: x.fonte,
            conduta: x.conduta,
            justificativa: x.justificativa?.slice(0, 255) ?? null,
            prescricao_item_id: x.item,
            origem: 'sistema',
          });
        return lote;
      }, (lote) => ({ tabela: 'reconciliacao_medicamentosa', id: lote }));
  }

  /** Nova versão da grade de horários por classe (cadastro: só o usuário do autor, sem profissional). */
  gravarGrade(c: ContextoPrescricao, autor: string, g: NovaGradeClasse): Promise<number> {
    if (g.horarios.some((h) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)))
      throw recusar(422, 'horario-invalido', 'Horário fora do formato HH:MM.');
    return this.gravar(c, contextoDoLogin(c, 'pep.gravarGrade', autor), 'pep.gravarGrade', 'sem-profissional',
      async (tx, est, prof) => {
        const u = await tx.uma(
          'SELECT id FROM unidade_assistencial WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [g.unidade, est.id],
        );
        if (!u) throw recusar(404, 'registro-inexistente', 'A unidade não foi encontrada no estabelecimento.');
        return tx.incluir('grade_horario_classe', {
          estabelecimento_id: est.id,
          unidade_assistencial_id: g.unidade,
          classe: g.classe,
          doses_por_dia: g.numDoses,
          horarios: g.horarios.join(';'),
          vigente_desde: g.vigenteDesde.slice(0, 10),
          ativo: g.ativa,
          autor_usuario_id: prof.usuario,
          origem: 'sistema',
        });
      }, (id) => ({ tabela: 'grade_horario_classe', id }));
  }

  /** Ainda sem adaptador: a ficha pede o cadastro de antimicrobiano, finalidade e sítio do modelo próprio. */
  async registrarFicha(): Promise<number> {
    throw recusaPendenteGravacao('ficha de antimicrobiano');
  }

  /** Ainda sem adaptador: a regra pede o cenário de alerta do cadastro próprio (família do catálogo). */
  async gravarRegra(): Promise<{ id: number; versao: number }> {
    throw recusaPendenteGravacao('regra de alerta');
  }

  // ── Executor ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Uma gravação pelo Executor: resolve o estabelecimento e o profissional da sessão (com a ocupação `cbo` quando a
   * operação a traz; `sem-profissional` = cadastro, basta o usuário), e roda `fn` na transação com a trilha.
   */
  private async gravar<T>(
    c: ContextoPrescricao,
    ctx: ContextoOperacao & { readonly login?: string | null },
    operacao: string,
    cbo: number | null | 'sem-profissional',
    fn: (tx: TxOperacao, est: Estabelecimento, prof: ProfissionalDaGravacao) => Promise<T>,
    alvo: (r: T) => { tabela: string; id: number | null },
    motivo: string | null = null,
  ): Promise<T> {
    const cliente = this.clienteDe(c);
    const ident = await this.ler(c, 'identidade', async (l, est) => ({
      est,
      prof:
        cbo === 'sem-profissional'
          ? await usuarioDaSessao(l, ctx)
          : await profissionalDaSessao(l, ctx, cbo),
    }));
    if (!ident.prof)
      throw recusar(
        409,
        'profissional-sem-cbo',
        cbo === 'sem-profissional' ? 'O usuário da sessão não existe neste cliente.' : 'Só o profissional da sessão prescreve.',
      );
    const prof = ident.prof;
    let feito: { r: T } | null = null;
    const op = definirOperacao({
      nome: nomeOperacao(operacao),
      tabelas: TABELAS_GRAVACAO_PRESCRICAO,
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, ident.est, prof);
        feito = { r };
        const a = alvo(r);
        return { tabela: a.tabela, id: a.id };
      },
      alvo: (_e, s) => ({ tabela: String(s['tabela']), id: s['id'] === null ? null : Number(s['id']) }),
      trilha: () => ({ motivo }),
    });
    const r = await this.executor.executar(op, cliente, {}, {
      cliente,
      estabelecimento: ident.est.id,
      usuario: prof.usuario,
      correlacao: (ctx.correlacao || operacao).slice(0, 64),
      chaveIdempotencia: ctx.chaveIdempotencia,
      ...(ctx.reautenticadoEm !== undefined ? { reautenticadoEm: ctx.reautenticadoEm } : {}),
    });
    if (!feito) {
      // Reenvio com a mesma chave: o executor devolve o resultado gravado sem gravar de novo.
      if (r.repetida) return (r.resultado as Record<string, unknown>)['id'] as T;
      throw new Error(`A operação ${operacao} terminou sem resultado.`);
    }
    return (feito as { r: T }).r;
  }
}

// ── Apoio (exportado para os testes) ──────────────────────────────────────────────────────────────

/** Nome da operação no formato do executor (minúsculas): pep.copiarPrescricao → pep.prescricao.copiar-prescricao. */
export function nomeOperacao(operacao: string): string {
  const base = operacao.replace(/^pep\./, '').replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return `pep.prescricao.${base}`.replace(/[^a-z0-9_.-]/g, '-').slice(0, 119);
}

/** Contexto de gravação dos métodos que recebem só o login (o reenvio não é idempotente: chave única da chamada). */
function contextoDoLogin(
  c: ContextoPrescricao,
  operacao: string,
  login: string,
): ContextoOperacao & { readonly login: string } {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: null,
    correlacao: c.correlacao || operacao,
    chaveIdempotencia: `${operacao}:${randomUUID()}`.slice(0, 80),
    login,
  };
}

async function estabelecimentoDe(l: Leitor, codigo: string): Promise<Estabelecimento> {
  const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
    'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
    [codigo],
  );
  if (!e)
    throw new ErroOperacao(
      404,
      'estabelecimento-inexistente',
      'Estabelecimento não encontrado',
      'O estabelecimento da sessão não existe neste cliente.',
    );
  return { id: num(e.id), fuso: fusoValido(e.fuso_horario) };
}

/** O usuário da sessão (cadastros sem profissional): pelo id do contexto ou pelo login. */
async function usuarioDaSessao(
  l: Leitor,
  ctx: { readonly usuario: number | null; readonly login?: string | null },
): Promise<ProfissionalDaGravacao | null> {
  const u = await l.uma(
    `SELECT id FROM usuario WHERE excluido_em IS NULL AND ${ctx.usuario !== null ? 'id = ?' : 'login = ?'}`,
    [ctx.usuario ?? ctx.login ?? ''],
  );
  return u ? { usuario: num(u['id']), profissional: 0, ocupacao: null } : null;
}

/**
 * O profissional que a conta da sessão representa (vínculo vigente), ativo, com inscrição no conselho ativa ou
 * provisória; com `cbo`, a ocupação (da inscrição ou do profissional) tem de ser esse código. Sem ele, null.
 */
export async function profissionalDaSessao(
  l: Leitor,
  ctx: { readonly usuario: number | null; readonly login?: string | null },
  cbo: number | null,
): Promise<ProfissionalDaGravacao | null> {
  const filtroUsuario = ctx.usuario !== null ? 'u.id = ?' : 'u.login = ?';
  const linhas = await l.consultar(
    `SELECT u.id AS usuario, pf.id AS profissional, oi.id AS oc_inscricao, oi.codigo_cbo AS cbo_inscricao,
            op.id AS oc_profissional, op.codigo_cbo AS cbo_profissional
       FROM usuario u
       JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
         AND up.vigencia_inicio <= CURRENT_DATE AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURRENT_DATE)
       JOIN profissional pf ON pf.id = up.profissional_id AND pf.excluido_em IS NULL
       JOIN inscricao_conselho ic ON ic.profissional_id = pf.id AND ic.excluido_em IS NULL
         AND ic.situacao IN ('ativa','provisoria')
       LEFT JOIN ocupacao_cbo oi ON oi.id = ic.ocupacao_cbo_id
       LEFT JOIN profissional_ocupacao po ON po.profissional_id = pf.id AND po.ativo AND po.excluido_em IS NULL
       LEFT JOIN ocupacao_cbo op ON op.id = po.ocupacao_cbo_id
      WHERE ${filtroUsuario} AND u.excluido_em IS NULL
      ORDER BY ic.principal DESC, po.principal DESC, ic.id, po.id`,
    [ctx.usuario ?? ctx.login ?? ''],
  );
  const cboDe = (v: unknown) => {
    const t = textoOuNull(v)?.replace(/\D/g, '') ?? '';
    return t ? Number(t) : 0;
  };
  for (const x of linhas) {
    const base = { usuario: num(x['usuario']), profissional: num(x['profissional']) };
    if (cbo === null)
      return { ...base, ocupacao: numOuNull(x['oc_inscricao']) ?? numOuNull(x['oc_profissional']) };
    if (cboDe(x['cbo_inscricao']) === cbo) return { ...base, ocupacao: num(x['oc_inscricao']) };
    if (cboDe(x['cbo_profissional']) === cbo) return { ...base, ocupacao: num(x['oc_profissional']) };
  }
  return null;
}

/** Só os tipos de item com adaptador: medicamento padronizado sem kit nem "se necessário". */
export function conferirItensSuportados(itens: readonly ItemGravacao[]): void {
  for (const it of itens) {
    const d = it.detalhe;
    if (d.tipo !== 'medicamento') throw recusaPendenteGravacao(`item do tipo ${d.tipo}`);
    if (d.naoPadronizado) throw recusaPendenteGravacao('medicamento não padronizado');
    if (d.kit.length > 0) throw recusaPendenteGravacao('kit do medicamento');
    if (d.seNecessario.length > 0) throw recusaPendenteGravacao('motivos de "se necessário"');
    if (d.dose <= 0) throw recusar(422, 'dose-invalida', 'A dose do medicamento tem de ser maior que zero.');
  }
}

/** SELECT ... FOR UPDATE de uma linha (o núcleo põe a trava; o caminho de leitura recusa FOR UPDATE no texto). */
async function umaTravada(
  tx: TxOperacao,
  sql: string,
  parametros: readonly unknown[],
): Promise<Record<string, unknown> | null> {
  return (await tx.consultarParaAtualizar(sql, parametros))[0] ?? null;
}

async function travarPrescricao(tx: TxOperacao, est: number, id: number): Promise<PrescricaoTravada | null> {
  const p = await umaTravada(tx, 
    `SELECT id, versao, situacao, atendimento_id, paciente_id, vigencia_inicio_em, vigencia_fim_em, suspensa_em
       FROM prescricao p WHERE p.id = ? AND ${VISIVEL('p')}`,
    [id, est],
  );
  if (!p) return null;
  return {
    id: num(p['id']),
    versao: num(p['versao']),
    situacao: String(p['situacao']),
    atendimento: num(p['atendimento_id']),
    paciente: num(p['paciente_id']),
    inicio: new Date(p['vigencia_inicio_em'] as string | Date),
    fim: new Date(p['vigencia_fim_em'] as string | Date),
    suspensa: p['suspensa_em'] !== null,
  };
}

/** A prescrição do paciente, vigente agora (não suspensa, não cancelada, fim no futuro); senão 404 ou 409. */
async function vigenteDoPaciente(
  tx: TxOperacao,
  est: number,
  id: number,
  paciente: number,
): Promise<PrescricaoTravada> {
  const p = await travarPrescricao(tx, est, id);
  if (!p || p.paciente !== paciente)
    throw recusar(404, 'registro-inexistente', 'A prescrição não foi encontrada para este paciente.');
  if (p.suspensa || p.situacao !== 'vigente' || p.fim.getTime() < Date.now())
    throw recusar(409, 'prescricao-nao-vigente', 'A prescrição não está vigente.');
  return p;
}

async function horariosPendentes(
  tx: TxOperacao,
  est: number,
  prescricao: number,
  item: number | null,
): Promise<{ id: number; versao: number }[]> {
  const linhas = await tx.consultarParaAtualizar(
    `SELECT h.id, h.versao FROM horario_administracao h
       JOIN situacao_checagem s ON s.id = h.situacao_checagem_id
      WHERE h.prescricao_id = ? AND h.estabelecimento_id = ? AND h.excluido_em IS NULL AND NOT h.suspenso
        AND s.categoria IN (${CATEGORIAS_PENDENTES.map(() => '?').join(',')})
        AND (? IS NULL OR h.prescricao_item_id = ?)`,
    [prescricao, est, ...CATEGORIAS_PENDENTES, item, item],
  );
  return linhas.map((x) => ({ id: num(x['id']), versao: num(x['versao']) }));
}

async function suspenderHorarios(
  tx: TxOperacao,
  horarios: readonly { id: number; versao: number }[],
  agora: Date,
): Promise<number> {
  for (const h of horarios)
    await tx.alterar('horario_administracao', h.id, h.versao, { suspenso: true, suspenso_em: agora });
  return horarios.length;
}

async function idPorSigla(tx: TxOperacao, tabela: 'unidade_prescricao' | 'via_de_uso', sigla: string) {
  const x = await tx.uma(
    `SELECT id FROM ${tabela} WHERE (UPPER(sigla) = UPPER(?) OR UPPER(codigo) = UPPER(?))
      ORDER BY ativo DESC, (UPPER(sigla) = UPPER(?)) DESC, id LIMIT 1`,
    [sigla, sigla, sigla],
  );
  if (!x) throw recusar(422, 'cadastro-inexistente', `"${sigla}" não está no cadastro (${tabela}).`);
  return num(x['id']);
}

/** Insere o item (medicamento) com o detalhe e os horários pendentes; devolve o id e quantos horários. */
async function inserirItem(
  tx: TxOperacao,
  est: Estabelecimento,
  prescricao: number,
  atendimento: number,
  prof: ProfissionalDaGravacao,
  it: ItemGravacao,
  sequencia: number,
  inicio: Date,
  fim: Date,
  sgh: GravacaoPrescricao['sgh'] | undefined,
): Promise<{ item: number; horarios: number }> {
  const d = it.detalhe;
  if (d.tipo !== 'medicamento') throw recusaPendenteGravacao(`item do tipo ${d.tipo}`);
  const categoria = CATEGORIA_DO_PLANO[it.plano];
  const tipo =
    it.plano >= BASE_PLANO_PROPRIO
      ? await tx.uma('SELECT id FROM tipo_item_prescricao WHERE id = ?', [
          it.plano - BASE_PLANO_PROPRIO,
        ])
      : categoria
        ? await tx.uma(
            `SELECT t.id FROM tipo_item_prescricao t WHERE t.categoria = ?
              ORDER BY (t.id = (SELECT ip.tipo_item_prescricao_id FROM item_prescritivel ip WHERE ip.id = ?)) DESC,
                       t.ativo DESC, t.id LIMIT 1`,
            [categoria, d.produto],
          )
        : null;
  if (!tipo) throw recusar(422, 'tipo-item-sem-cadastro', 'O tipo do item não está no cadastro.');
  const produto = await tx.uma(
    'SELECT id FROM item_prescritivel WHERE id = ? AND excluido_em IS NULL',
    [d.produto],
  );
  if (!produto) throw recusar(422, 'cadastro-inexistente', 'O produto não está no cadastro.');
  const calculo = sgh?.itens.find((x) => x.chave === it.chave) ?? null;
  const item = await tx.incluir('prescricao_item', {
    prescricao_id: prescricao,
    sequencia,
    tipo_item_prescricao_id: num(tipo['id']),
    item_prescritivel_id: d.produto,
    frequencia_administracao_id: it.frequencia,
    via_de_uso_id: it.via ? await idPorSigla(tx, 'via_de_uso', it.via) : null,
    inicio_em: inicio,
    fim_em: fim,
    prioridade: d.agora ? 'agora' : 'rotina',
    nao_ajustar_horario: d.naoAjustar,
    situacao: 'ativo',
    lancamento_profissional_id: prof.profissional,
    observacao_enfermagem: it.observacao,
    calculo_regra: calculo?.regraDose && ['por_kg', 'por_m2', 'por_clearance', 'fixa'].includes(calculo.regraDose)
      ? calculo.regraDose
      : null,
    calculo_peso_kg: calculo?.pesoKg ?? null,
    calculo_altura_cm: calculo?.alturaCm ?? null,
    calculo_clearance: calculo?.clearance ?? null,
    dose_por_unidade: calculo?.dosePorUnidade ?? null,
    horario_gerado: it.horarios.length > 0,
    justificativa_alergia: d.justificativaAlergia,
    origem: 'sistema',
  });
  await tx.incluir('prescricao_item_medicamento', {
    prescricao_item_id: item,
    item_prescritivel_id: d.produto,
    dose: d.dose,
    unidade_prescricao_id: await idPorSigla(tx, 'unidade_prescricao', d.unidade),
    tempo_infusao_minutos: d.tempoInfusaoMinutos,
    iniciar_agora: d.agora,
    nao_ajustar_horario: d.naoAjustar,
    justificativa_alergia: d.justificativaAlergia,
    origem: 'sistema',
  });
  if (it.horarios.length > 0) {
    const s = await tx.uma(
      `SELECT id FROM situacao_checagem WHERE categoria = 'pendente' AND ativo ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
    );
    if (!s) throw recusar(409, 'situacao-checagem-sem-cadastro', 'O cliente não tem situação de checagem pendente.');
    for (const h of it.horarios)
      await tx.incluir('horario_administracao', {
        estabelecimento_id: est.id,
        atendimento_id: atendimento,
        prescricao_id: prescricao,
        prescricao_item_id: item,
        previsto_em: instanteLocal(h.dataHora, est.fuso),
        frequencia_horario_relativo_id: h.relativo,
        situacao_checagem_id: num(s['id']),
        origem: 'sistema',
      });
  }
  return { item, horarios: it.horarios.length };
}

/**
 * As decisões sobre os alertas, ligadas ao item pela chave, com a versão da regra no momento (versao_regra). A decisão
 * de um item retirado antes de gravar (sem item) vai só no evento da prescrição.
 */
async function gravarDecisoes(
  tx: TxOperacao,
  prof: ProfissionalDaGravacao,
  porChave: ReadonlyMap<string, number>,
  decisoes: GravacaoPrescricao['sgh']['decisoes'],
  agora: Date,
): Promise<void> {
  const seq = new Map<number, number>();
  for (const d of decisoes) {
    const item = porChave.get(d.chave);
    if (item === undefined) continue;
    const regra = await tx.uma(
      `SELECT id FROM regra_alerta WHERE codigo = ? OR (? REGEXP '^[0-9]+$' AND id = ?) ORDER BY (codigo = ?) DESC LIMIT 1`,
      [d.regra, d.regra, d.regra, d.regra],
    );
    const s = (seq.get(item) ?? 0) + 1;
    seq.set(item, s);
    await tx.incluir('decisao_alerta', {
      prescricao_item_id: item,
      sequencia: s,
      regra_alerta_id: regra ? num(regra['id']) : null,
      processo: d.tipo,
      mensagem: d.alerta,
      disparado_em: agora,
      exige_justificativa: d.nivel !== 'aviso',
      decisao: decisaoGravada(d.decisao, d.justificativa),
      justificativa: d.justificativa,
      decidido_em: agora,
      decidido_por_profissional_id: prof.profissional,
      versao_regra: d.versaoRegra,
      origem: 'sistema',
    });
  }
}

/** A programação futura usada nesta prescrição passa a efetivada (só a do atendimento e ainda programada). */
async function efetivarFutura(
  tx: TxOperacao,
  est: number,
  atendimento: number,
  id: number,
  prescricao: number,
  agora: Date,
): Promise<void> {
  const f = await umaTravada(tx, 
    `SELECT id, versao, situacao FROM planejamento_prescricao
      WHERE id = ? AND estabelecimento_id = ? AND atendimento_id = ? AND excluido_em IS NULL`,
    [id, est, atendimento],
  );
  if (!f) throw recusar(404, 'registro-inexistente', 'A prescrição futura não foi encontrada no atendimento.');
  if (f['situacao'] !== 'programada')
    throw recusar(409, 'futura-nao-programada', 'A prescrição futura não está programada.');
  await tx.alterar('planejamento_prescricao', id, num(f['versao']), {
    situacao: 'efetivada',
    efetivado_em: agora,
    prescricao_id: prescricao,
  });
}

async function evento_(
  tx: TxOperacao,
  prescricao: number,
  item: number | null,
  operacao: 'inclusao' | 'alteracao',
  evento: string,
  anterior: string | null,
  nova: string | null,
  motivo: string | null,
  prof: ProfissionalDaGravacao,
  agora: Date,
  dados: Record<string, unknown> | null,
): Promise<void> {
  await tx.incluir('prescricao_evento', {
    prescricao_id: prescricao,
    prescricao_item_id: item,
    operacao,
    evento,
    situacao_anterior: anterior,
    situacao_nova: nova,
    motivo,
    profissional_id: prof.profissional,
    dados: dados === null ? null : JSON.stringify(dados),
    ocorrido_em: agora,
    usuario_id: prof.usuario,
  });
}
