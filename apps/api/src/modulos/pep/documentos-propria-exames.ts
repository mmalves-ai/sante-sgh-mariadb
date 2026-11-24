// Porta PRÓPRIA dos documentos do prontuário, família exames, anexos e termo de consentimento livre e esclarecido
// (TCLE), sobre o banco do cliente (MariaDB, pelo @sgh/nucleo). Leituras pelo Leitor; gravações pelo Executor (trilha,
// idempotência e versão na mesma transação). O integrador liga estes métodos à PortaDocumentosPropria.
//   - catálogo de exames: exame (+ sexo e o material padrão de exame_material); kits: kit_exame + kit_exame_item;
//   - pedidos: requisicao_exame + exame_item (o pedido é a requisição; cada exame pedido é um item);
//   - resultados: resultado_exame liberado ou retificado + resultado_analito (+ analito, unidade_resultado);
//   - exames de fora: exame_lancado_prontuario ativo + exame_lancado_valor;
//   - anexos: anexo_prontuario + arquivo (o conteúdo vem da porta de armazenamento de arquivos, em disco; ADR 0004);
//   - termos: termo_consentimento_modelo (tipos), termo_consentimento_paciente (versões), termo_consentimento_recepcao
//     (o termo herdado da recepção).
// Registro clínico nunca é apagado: a mudança de situação do termo grava NOVA versão (termo_anterior_id, migração
// 06_PEP/97_exames), com chave única de sucessor (a segunda mudança sobre a mesma leitura é conflito de versão).
// A gravação exige o profissional da sessão: usuário → vínculo vigente no estabelecimento → profissional → inscrição no
// conselho ativa (a indicada pelo serviço, quando vem).
// Vocabulário neutro na saída; o "ato" do tipo de leitura é o grupo do exame (15 laboratório, 16 imagem, 0 outros),
// tirado do tipo de serviço do catálogo próprio.
import { randomUUID } from 'node:crypto';
import {
  type ArmazemArquivos,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type ExtrasTrilha,
  type Leitor,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoDocs } from './documentos-porta.js';
import type { NucleoDocumentosPep } from './documentos-porta-propria.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';
import type {
  AnexoLido,
  ContextoGravacaoPep,
  ExameCatalogoLido,
  PedidoLido,
  ResultadoLido,
  TcleLido,
  ValorLido,
} from './tipos-pep.js';

/** Teto de linhas por leitura (catálogo, pedidos, resultados, anexos, termos). */
export const TETO_LEITURA = 500;
/** Teto de ids por lista. */
export const TETO_IDS = 200;
/** Motivo mínimo da revogação (o mesmo do CHECK de termo_consentimento_paciente). */
export const MOTIVO_MINIMO_REVOGACAO = 10;

const TABELAS_TERMO = [
  'termo_consentimento_paciente',
  'documento_prontuario',
  'documento_prontuario_evento',
] as const;

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const marcadores = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
export const idsValidos = (ids: readonly number[]): number[] =>
  [...new Set(ids)].filter((i) => Number.isSafeInteger(i) && i > 0).slice(0, TETO_IDS);

const recusar = (status: number, codigo: string, detalhe: string): ErroOperacao =>
  new ErroOperacao(status, codigo, 'Operação recusada', detalhe);

/** Grupo do exame pelo tipo de serviço do catálogo (15 laboratório, 16 imagem, 0 outros: grupoDoAto do domínio). */
export function atoDoServico(tipoServico: unknown): number {
  if (tipoServico === 'laboratorio') return 15;
  if (tipoServico === 'imagem') return 16;
  return 0;
}

/** Idade do catálogo (dias) em anos completos, como o domínio compara (idade do paciente em anos). */
export function anosDeDias(dias: unknown): number | null {
  if (dias === null || dias === undefined) return null;
  return Math.floor(Number(dias) / 365.25);
}

/** Sexo do catálogo pela sigla/código ('F'/'M'); outro valor ou nenhum: sem restrição. */
export function sexoDe(sigla: unknown, codigo: unknown): 'F' | 'M' | null {
  for (const v of [sigla, codigo]) {
    const t = String(v ?? '')
      .trim()
      .toUpperCase();
    if (t === 'F' || t === 'M') return t;
  }
  return null;
}

/**
 * Situação do termo (vocabulário da tela) pela etapa do catálogo do cliente. Recusado e cancelado deixam de valer como
 * o revogado (o termo não autoriza o procedimento); o motivo vai junto.
 */
export function situacaoDoTermo(etapa: unknown): TcleLido['situacao'] {
  if (etapa === 'assinado') return 'assinado';
  if (etapa === 'revogado' || etapa === 'recusado' || etapa === 'cancelado') return 'revogado';
  return 'pendente';
}

/** Extensão do arquivo pelo nome original; sem ela, pelo tipo MIME (só PDF é aceito no prontuário). */
export function extensaoDe(nome: unknown, mime: unknown): string | null {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(nome ?? ''));
  if (m) return m[1]!.toLowerCase();
  return String(mime ?? '') === 'application/pdf' ? 'pdf' : null;
}

/** Estabelecimento da sessão: id e fuso IANA. */
interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

/** O que a família usa do armazenamento de arquivos (só a leitura conferida pelo hash). */
export type LeitorArquivos = Pick<ArmazemArquivos, 'ler'>;

/** Dados da emissão do termo (a porta; `texto` é o texto do termo, quando o serviço o manda). */
export interface EmissaoTcle {
  paciente: number;
  atendimento: number;
  tipo: number | null;
  procedimento: string;
  cbo: number | null;
  hashConteudo: string;
  comoSuporte?: boolean;
  texto?: string | null;
}

export class DocumentosPropriaExames {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoDocumentosPep,
    /** Cliente desta API (um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
    /** A porta de armazenamento de arquivos (disco); sem ela, o conteúdo do anexo é recusado (falha fechada). */
    private readonly arquivos: LeitorArquivos | null = null,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private clienteDe(c: ContextoDocs): string {
    return c.cliente || this.cliente;
  }

  private ler<T>(c: ContextoDocs, rotulo: string, fn: (l: Leitor, est: Estabelecimento) => Promise<T>) {
    return this.nucleo.lerSomente(
      { cliente: this.clienteDe(c), correlacao: `pep.documentos.${rotulo}` },
      async (l) => fn(l, await this.estabelecimento(l, c.hospital)),
    );
  }

  private async estabelecimento(l: Leitor, codigo: string): Promise<Estabelecimento> {
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

  // ── Catálogo de exames e kits ────────────────────────────────────────────────────────────────────

  private static readonly SQL_EXAME = `
    SELECT ex.id, ex.codigo, ex.nome, ex.tipo_servico, ex.ativo, ex.idade_minima_dias, ex.idade_maxima_dias,
           sx.sigla AS sexo_sigla, sx.codigo AS sexo_codigo,
           (SELECT em.material_biologico_id FROM exame_material em
             WHERE em.exame_id = ex.id AND em.ativo = TRUE AND em.excluido_em IS NULL
             ORDER BY em.padrao DESC, em.id LIMIT 1) AS material
      FROM exame ex
      LEFT JOIN sexo sx ON sx.id = ex.sexo_id
     WHERE ex.excluido_em IS NULL`;

  private static exameLido(x: Record<string, unknown>): ExameCatalogoLido {
    return {
      id: num(x['id']),
      ato: atoDoServico(x['tipo_servico']),
      codigo: String(x['codigo']),
      nome: String(x['nome']),
      ativo: bool(x['ativo']),
      sexo: sexoDe(x['sexo_sigla'], x['sexo_codigo']),
      idadeMinima: anosDeDias(x['idade_minima_dias']),
      idadeMaxima: anosDeDias(x['idade_maxima_dias']),
      material: numOuNull(x['material']),
    };
  }

  /** Exames que o prontuário pode pedir: pelo nome (contém) ou pelo código (igual), sem distinguir caixa. */
  catalogoExames(c: ContextoDocs, termo: string | null): Promise<ExameCatalogoLido[]> {
    const t = termo?.trim().toUpperCase() || null;
    return this.ler(c, 'exames.catalogo', async (l) => {
      const filtro = t ? ' AND (UPPER(ex.nome) LIKE ? OR UPPER(ex.codigo) = ?)' : '';
      const ls = await l.consultar(
        `${DocumentosPropriaExames.SQL_EXAME} AND ex.solicitavel_prontuario = TRUE${filtro}
          ORDER BY ex.nome, ex.id LIMIT ${TETO_LEITURA}`,
        t ? [`%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, t] : [],
      );
      return ls.map((x) => DocumentosPropriaExames.exameLido(x));
    });
  }

  /** Os exames pelos ids (inclusive os inativos: o domínio avisa do exame inativo no pedido). */
  examesPorId(c: ContextoDocs, ids: readonly number[]): Promise<ExameCatalogoLido[]> {
    const validos = idsValidos(ids);
    if (!validos.length) return Promise.resolve([]);
    return this.ler(c, 'exames.porId', async (l) => {
      const ls = await l.consultar(
        `${DocumentosPropriaExames.SQL_EXAME} AND ex.id IN (${marcadores(validos.length)}) ORDER BY ex.nome, ex.id`,
        validos,
      );
      return ls.map((x) => DocumentosPropriaExames.exameLido(x));
    });
  }

  /** Kits ativos disponíveis no prontuário, com os exames na ordem do kit. */
  kits(c: ContextoDocs): Promise<{ id: number; nome: string; exames: number[] }[]> {
    return this.ler(c, 'exames.kits', async (l) => {
      const ls = await l.consultar(
        `SELECT k.id, k.nome, i.exame_id
           FROM kit_exame k
           LEFT JOIN kit_exame_item i ON i.kit_exame_id = k.id AND i.excluido_em IS NULL
          WHERE k.ativo = TRUE AND k.disponivel_prontuario = TRUE AND k.excluido_em IS NULL
          ORDER BY k.nome, k.id, i.sequencia`,
      );
      const kits = new Map<number, { id: number; nome: string; exames: number[] }>();
      for (const x of ls) {
        const id = num(x['id']);
        const k = kits.get(id) ?? { id, nome: String(x['nome']), exames: [] };
        const ex = numOuNull(x['exame_id']);
        if (ex !== null && !k.exames.includes(ex)) k.exames.push(ex);
        kits.set(id, k);
      }
      return [...kits.values()];
    });
  }

  // ── Pedidos, resultados e exames de fora ─────────────────────────────────────────────────────────

  /** Exames pedidos para o paciente no estabelecimento (sem os cancelados ou recusados), do mais antigo ao recente. */
  pedidos(c: ContextoDocs, paciente: number): Promise<PedidoLido[]> {
    return this.ler(c, 'exames.pedidos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT ei.id, r.id AS requisicao, ei.exame_id, ex.nome, ex.tipo_servico, r.solicitado_em, r.prioridade,
                ei.urgente, ei.situacao, r.indicacao_clinica, pf.nome AS profissional
           FROM requisicao_exame r
           JOIN exame_item ei ON ei.requisicao_exame_id = r.id AND ei.excluido_em IS NULL
           JOIN exame ex ON ex.id = ei.exame_id
           LEFT JOIN profissional p ON p.id = r.solicitante_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND r.excluido_em IS NULL AND r.situacao <> 'cancelada'
            AND ei.situacao NOT IN ('cancelado', 'recusado')
          ORDER BY r.solicitado_em, r.id, ei.sequencia LIMIT ${TETO_LEITURA}`,
        [est.id, paciente],
      );
      return ls.map((x) => {
        const situacao = String(x['situacao']);
        const solicitadoEm = dataHora(x['solicitado_em'], est.fuso);
        return {
          id: num(x['id']),
          agrupamento: num(x['requisicao']),
          exame: num(x['exame_id']),
          nome: String(x['nome']),
          ato: atoDoServico(x['tipo_servico']),
          data: solicitadoEm ? solicitadoEm.slice(0, 10) : null,
          solicitadoEm,
          urgente: bool(x['urgente']) || ['urgente', 'emergencia'].includes(String(x['prioridade'])),
          // 'T' = ainda só solicitado (o serviço mostra "solicitado"); nulo = em andamento.
          pendSadt: situacao === 'solicitado' || situacao === 'autorizado' ? 'T' : null,
          liberado: situacao === 'liberado' || situacao === 'entregue',
          profissional: textoOuNull(x['profissional']),
          indicacao: textoOuNull(x['indicacao_clinica']),
        };
      });
    });
  }

  /**
   * Resultados liberados (ou retificados) do paciente no estabelecimento, com os valores por analito. `exame` é o id do
   * exame pedido (exame_item), único por resultado: a ciência de valor crítico se liga a ele.
   */
  resultados(c: ContextoDocs, paciente: number): Promise<ResultadoLido[]> {
    return this.ler(c, 'exames.resultados', async (l, est) => {
      const rs = await l.consultar(
        `SELECT re.id, ei.id AS item, ei.sequencia, ex.nome, ex.codigo, ex.tipo_servico, r.id AS requisicao,
                a.numero AS atendimento, re.liberado_em, re.texto_resultado, re.conclusao
           FROM resultado_exame re
           JOIN exame_item ei ON ei.id = re.exame_item_id AND ei.excluido_em IS NULL
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
           JOIN exame ex ON ex.id = ei.exame_id
           LEFT JOIN atendimento a ON a.id = r.atendimento_id
          WHERE r.estabelecimento_id = ? AND re.paciente_id = ? AND re.excluido_em IS NULL
            AND re.situacao IN ('liberado', 'retificado')
          ORDER BY re.liberado_em, re.id LIMIT ${TETO_LEITURA}`,
        [est.id, paciente],
      );
      if (!rs.length) return [];
      const ids = rs.map((r) => num(r['id']));
      const vs = await l.consultar(
        `SELECT ra.resultado_exame_id, an.nome AS elemento, ra.valor_numerico, ra.valor_texto,
                COALESCE(u.simbolo, u.codigo) AS unidade, ra.referencia_minimo, ra.referencia_maximo,
                ra.referencia_texto, ra.critico_minimo, ra.critico_maximo
           FROM resultado_analito ra
           JOIN analito an ON an.id = ra.analito_id
           LEFT JOIN unidade_resultado u ON u.id = ra.unidade_resultado_id
          WHERE ra.resultado_exame_id IN (${marcadores(ids.length)}) AND ra.excluido_em IS NULL
          ORDER BY ra.resultado_exame_id, ra.sequencia`,
        ids,
      );
      const valores = new Map<number, ValorLido[]>();
      for (const v of vs) {
        const id = num(v['resultado_exame_id']);
        const lista = valores.get(id) ?? [];
        lista.push({
          elemento: String(v['elemento']),
          numerico: numOuNull(v['valor_numerico']),
          alfa: textoOuNull(v['valor_texto']),
          unidade: textoOuNull(v['unidade']),
          refIni: numOuNull(v['referencia_minimo']),
          refFin: numOuNull(v['referencia_maximo']),
          referencia: textoOuNull(v['referencia_texto']),
          minAbe: numOuNull(v['critico_minimo']),
          maxAbe: numOuNull(v['critico_maximo']),
        });
        valores.set(id, lista);
      }
      return rs.map((r) => {
        const liberadoEm = dataHora(r['liberado_em'], est.fuso);
        return {
          exame: num(r['item']),
          nome: String(r['nome']),
          chave: {
            data: liberadoEm ? liberadoEm.slice(0, 10) : '',
            reg: paciente,
            conta: num(r['requisicao']),
            atend: String(r['atendimento'] ?? ''),
            ato: atoDoServico(r['tipo_servico']),
            exame: String(r['codigo']),
            sequencia: num(r['sequencia']),
          },
          liberadoEm,
          valores: valores.get(num(r['id'])) ?? [],
          texto: textoOuNull(r['texto_resultado']) ?? textoOuNull(r['conclusao']),
        };
      });
    });
  }

  /** Exames feitos fora e lançados no prontuário (ativos), com os nomes dos elementos lançados. */
  examesExternos(
    c: ContextoDocs,
    paciente: number,
  ): Promise<{ id: number; nome: string; em: string | null; elementos: string[] }[]> {
    return this.ler(c, 'exames.externos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT el.id, COALESCE(ex.nome, el.nome_exame) AS nome, el.realizado_em
           FROM exame_lancado_prontuario el
           LEFT JOIN exame ex ON ex.id = el.exame_id
          WHERE el.estabelecimento_id = ? AND el.paciente_id = ? AND el.excluido_em IS NULL AND el.situacao = 'ativo'
          ORDER BY el.realizado_em, el.id LIMIT ${TETO_LEITURA}`,
        [est.id, paciente],
      );
      if (!ls.length) return [];
      const ids = ls.map((x) => num(x['id']));
      const vs = await l.consultar(
        `SELECT exame_lancado_prontuario_id AS id, elemento FROM exame_lancado_valor
          WHERE exame_lancado_prontuario_id IN (${marcadores(ids.length)}) AND excluido_em IS NULL
          ORDER BY exame_lancado_prontuario_id, sequencia`,
        ids,
      );
      const elementos = new Map<number, string[]>();
      for (const v of vs)
        elementos.set(num(v['id']), [...(elementos.get(num(v['id'])) ?? []), String(v['elemento'])]);
      return ls.map((x) => ({
        id: num(x['id']),
        nome: String(x['nome']),
        em: dataHora(x['realizado_em'], est.fuso),
        elementos: elementos.get(num(x['id'])) ?? [],
      }));
    });
  }

  // ── Anexos ───────────────────────────────────────────────────────────────────────────────────────

  anexos(c: ContextoDocs, paciente: number): Promise<AnexoLido[]> {
    return this.ler(c, 'anexos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT ap.id, ap.paciente_id, ap.titulo, ap.situacao, ap.importado_em, t.descricao AS tipo,
                a.nome_original, a.tipo_mime, a.tamanho_bytes, pf.nome AS profissional
           FROM anexo_prontuario ap
           JOIN arquivo a ON a.id = ap.arquivo_id
           LEFT JOIN tipo_anexo t ON t.id = ap.tipo_anexo_id
           LEFT JOIN profissional p ON p.id = ap.importado_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE ap.estabelecimento_id = ? AND ap.paciente_id = ? AND ap.excluido_em IS NULL
          ORDER BY ap.importado_em, ap.id LIMIT ${TETO_LEITURA}`,
        [est.id, paciente],
      );
      return ls.map((x) => ({
        id: num(x['id']),
        paciente: num(x['paciente_id']),
        nome: textoOuNull(x['titulo']),
        extensao: extensaoDe(x['nome_original'], x['tipo_mime']),
        tipo: textoOuNull(x['tipo']),
        em: dataHora(x['importado_em'], est.fuso),
        profissional: textoOuNull(x['profissional']),
        suspenso: String(x['situacao']) === 'suspenso',
        bytes: numOuNull(x['tamanho_bytes']),
      }));
    });
  }

  /** O conteúdo do anexo, pela porta de armazenamento (conferido pelo hash; divergência é erro, nunca conteúdo). */
  async arquivoAnexo(c: ContextoDocs, id: number): Promise<{ paciente: number; pdf: Buffer } | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const a = await this.ler(c, 'anexos.arquivo', async (l, est) => {
      const x = await l.uma(
        `SELECT ap.paciente_id, ap.arquivo_id FROM anexo_prontuario ap
          WHERE ap.id = ? AND ap.estabelecimento_id = ? AND ap.excluido_em IS NULL`,
        [id, est.id],
      );
      return x ? { est: est.id, paciente: num(x['paciente_id']), arquivo: num(x['arquivo_id']) } : null;
    });
    if (!a) return null;
    if (!this.arquivos)
      throw new ErroOperacao(
        503,
        'armazenamento-indisponivel',
        'Armazenamento de arquivos indisponível',
        'A porta de armazenamento de arquivos não está configurada nesta API.',
      );
    const lido = await this.arquivos.ler(
      {
        cliente: this.clienteDe(c),
        estabelecimento: a.est,
        usuario: c.usuario ?? null,
        correlacao: (c.correlacao || 'pep.documentos.anexos.arquivo').slice(0, 64),
      },
      a.arquivo,
    );
    return { paciente: a.paciente, pdf: lido.conteudo };
  }

  tiposAnexo(c: ContextoDocs): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, 'anexos.tipos', async (l) => {
      const ls = await l.consultar(
        'SELECT id, descricao FROM tipo_anexo WHERE ativo = TRUE ORDER BY descricao, id',
      );
      return ls.map((x) => ({ id: num(x['id']), nome: String(x['descricao']) }));
    });
  }

  // ── Termo de consentimento ───────────────────────────────────────────────────────────────────────

  /** Modelos de termo vigentes hoje no estabelecimento (os do cliente inteiro e os do estabelecimento). */
  tiposTermo(c: ContextoDocs): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, 'tcle.tipos', async (l, est) => {
      const ls = await l.consultar(
        `SELECT id, titulo FROM termo_consentimento_modelo
          WHERE ativo = TRUE AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
            AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
          ORDER BY titulo, id`,
        [est.id],
      );
      return ls.map((x) => ({ id: num(x['id']), nome: String(x['titulo']) }));
    });
  }

  /**
   * O termo herdado da recepção: o título do termo assinado na recepção pelo paciente do atendimento (o mais recente,
   * não revogado), a confirmar com o paciente. Sem termo da recepção: null.
   */
  tcleHerdado(c: ContextoDocs, atendimento: number): Promise<string | null> {
    return this.ler(c, 'tcle.herdado', async (l, est) => {
      const x = await l.uma(
        `SELECT m.titulo
           FROM atendimento a
           JOIN termo_consentimento_recepcao r ON r.paciente_id = a.paciente_id AND r.estabelecimento_id = a.estabelecimento_id
           JOIN termo_consentimento_modelo m ON m.id = r.termo_consentimento_modelo_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND r.excluido_em IS NULL AND r.revogado_em IS NULL
          ORDER BY r.assinado_em DESC, r.id DESC LIMIT 1`,
        [atendimento, est.id],
      );
      return x ? textoOuNull(x['titulo']) : null;
    });
  }

  /** Todas as versões dos termos do paciente no estabelecimento, da mais antiga à mais recente. */
  tcles(c: ContextoDocs, paciente: number): Promise<TcleLido[]> {
    return this.ler(c, 'tcle.lista', async (l, est) => {
      const ls = await l.consultar(
        `SELECT t.id, t.termo_anterior_id, t.atendimento_id, t.termo_consentimento_modelo_id, t.procedimento_descricao,
                s.etapa, t.motivo_revogacao, t.motivo_recusa, t.documento_prontuario_id, t.criado_em, u.login
           FROM termo_consentimento_paciente t
           JOIN situacao_termo_consentimento s ON s.id = t.situacao_termo_consentimento_id
           LEFT JOIN usuario u ON u.id = t.criado_por
          WHERE t.estabelecimento_id = ? AND t.paciente_id = ? AND t.excluido_em IS NULL
          ORDER BY t.id LIMIT ${TETO_LEITURA}`,
        [est.id, paciente],
      );
      return ls.map((x) => ({
        id: num(x['id']),
        anterior: numOuNull(x['termo_anterior_id']),
        atendimento: num(x['atendimento_id']),
        tipo: numOuNull(x['termo_consentimento_modelo_id']),
        procedimento: String(x['procedimento_descricao']),
        situacao: situacaoDoTermo(x['etapa']),
        motivo: textoOuNull(x['motivo_revogacao']) ?? textoOuNull(x['motivo_recusa']),
        documento: numOuNull(x['documento_prontuario_id']),
        usuario: textoOuNull(x['login']) ?? '',
        em: dataHora(x['criado_em'], est.fuso) ?? '',
      }));
    });
  }

  /**
   * Gravação pelo Executor: a transação, a trilha (ação e resumo) e a idempotência do núcleo, com o profissional da
   * sessão (usuário → vínculo vigente → profissional → inscrição no conselho ativa) resolvido antes.
   */
  private async gravar<T>(
    c: ContextoGravacaoPep,
    nome: string,
    cbo: number | null,
    fn: (tx: TxOperacao, s: { est: number; usuario: number; profissional: number }) => Promise<T>,
    alvo: (r: T) => { tabela: string; id: number },
    extras: (r: T) => ExtrasTrilha,
  ): Promise<T> {
    const cliente = this.clienteDe(c);
    const s = await this.ler(c, 'tcle.sessao', async (l, est) => {
      const u = await l.uma(
        `SELECT u.id AS usuario, v.profissional_id
           FROM usuario u
           LEFT JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
                 AND v.profissional_id IS NOT NULL AND v.excluido_em IS NULL
                 AND v.vigencia_inicio <= CURRENT_DATE AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
          WHERE u.login = ? AND u.excluido_em IS NULL
          ORDER BY (v.profissional_id IS NULL), v.vigencia_inicio DESC, v.id DESC LIMIT 1`,
        [est.id, c.usuarioLogin],
      );
      if (!u) throw recusar(403, 'usuario-inexistente', 'O usuário da sessão não existe neste cliente.');
      const profissional = numOuNull(u['profissional_id']);
      if (profissional === null)
        throw recusar(
          403,
          'sem-profissional',
          'O usuário da sessão não tem vínculo vigente com um profissional neste estabelecimento.',
        );
      const insc = await l.uma(
        `SELECT i.id FROM inscricao_conselho i JOIN profissional p ON p.id = i.profissional_id AND p.excluido_em IS NULL
          WHERE i.profissional_id = ? AND i.excluido_em IS NULL AND i.situacao IN ('ativa', 'provisoria')
            ${cbo !== null ? 'AND i.id = ?' : ''}
          ORDER BY i.principal DESC, i.sequencia, i.id LIMIT 1`,
        cbo !== null ? [profissional, cbo] : [profissional],
      );
      if (!insc)
        throw recusar(
          403,
          'conselho-inativo',
          'O profissional da sessão não tem inscrição ativa no conselho (ou a inscrição indicada não é dele).',
        );
      return { est: est.id, usuario: num(u['usuario']), profissional };
    });
    const contexto: ContextoOperacao = {
      cliente,
      estabelecimento: s.est,
      usuario: s.usuario,
      correlacao: (c.correlacao || c.traceId || nome).slice(0, 64),
      chaveIdempotencia: `${nome}:${randomUUID()}`,
    };
    let feito: { r: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_TERMO,
      entrada: z.object({}).strict(),
      gravar: async (tx: TxOperacao) => {
        const r = await fn(tx, s);
        feito = { r };
        return alvo(r);
      },
      alvo: (_e, x) => ({ tabela: String(x['tabela']), id: Number(x['id']) }),
      trilha: () => (feito ? extras((feito as { r: T }).r) : {}),
    });
    await this.executor.executar(op, cliente, {}, contexto);
    if (!feito) throw new Error(`A operação ${nome} terminou sem resultado.`);
    return (feito as { r: T }).r;
  }

  /** Primeira situação ativa do termo numa das etapas, na ordem dada; sem ela, recusa (falha fechada). */
  private async situacaoTermo(tx: TxOperacao, etapas: readonly string[]): Promise<number> {
    const s = await tx.uma(
      `SELECT id FROM situacao_termo_consentimento WHERE ativo = TRUE AND etapa IN (${marcadores(etapas.length)})
        ORDER BY FIELD(etapa, ${marcadores(etapas.length)}), (ordem IS NULL), ordem, id LIMIT 1`,
      [...etapas, ...etapas],
    );
    if (!s)
      throw recusar(
        409,
        'situacao-termo-sem-cadastro',
        `O cliente não tem situação de termo ativa na etapa "${etapas[0]}".`,
      );
    return num(s['id']);
  }

  private async situacaoDocumento(tx: TxOperacao, categoria: string): Promise<number> {
    const s = await tx.uma(
      `SELECT id FROM situacao_documento_prontuario WHERE categoria = ? AND ativo = TRUE
        ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
      [categoria],
    );
    if (!s)
      throw recusar(
        409,
        'situacao-documento-sem-cadastro',
        `O cliente não tem situação de documento ativa na categoria "${categoria}".`,
      );
    return num(s['id']);
  }

  /** Emite o termo (situação pendente) e o documento do prontuário dele (lançado, à espera de assinatura). */
  async emitirTcle(c: ContextoGravacaoPep, t: EmissaoTcle): Promise<{ id: number; documento: number }> {
    const procedimento = t.procedimento.trim();
    if (procedimento.length < 3)
      throw recusar(
        422,
        'procedimento-obrigatorio',
        'Informe o procedimento do termo (ao menos 3 caracteres).',
      );
    return this.gravar(
      c,
      'pep.tcle.emitir',
      t.cbo,
      async (tx, s) => {
        const at = await tx.uma(
          `SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [t.atendimento, s.est],
        );
        if (!at)
          throw recusar(404, 'atendimento-inexistente', 'O atendimento não existe neste estabelecimento.');
        if (num(at['paciente_id']) !== t.paciente)
          throw recusar(409, 'atendimento-de-outro-paciente', 'O atendimento não é deste paciente.');
        let modelo: Record<string, unknown> | null = null;
        if (t.tipo !== null) {
          modelo = await tx.uma(
            `SELECT id, titulo, texto_simples, texto_tecnico, tipo_documento_clinico_id FROM termo_consentimento_modelo
              WHERE id = ? AND ativo = TRUE AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
                AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
            [t.tipo, s.est],
          );
          if (!modelo)
            throw recusar(422, 'tipo-termo-invalido', 'O tipo de termo não existe ou não está vigente.');
        }
        const tipoDoc =
          numOuNull(modelo?.['tipo_documento_clinico_id']) ??
          numOuNull(
            (
              await tx.uma(
                `SELECT id FROM tipo_documento_clinico WHERE categoria = 'termo' AND ativo = TRUE
                  ORDER BY (ordem IS NULL), ordem, id LIMIT 1`,
              )
            )?.['id'],
          );
        if (tipoDoc === null)
          throw recusar(
            409,
            'tipo-documento-sem-cadastro',
            'O cliente não tem tipo de documento clínico ativo na categoria "termo".',
          );
        const situacao = await this.situacaoTermo(tx, ['emitido', 'pendente']);
        const agora = new Date();
        const texto = t.texto?.trim() || textoOuNull(modelo?.['texto_simples']) || procedimento;
        const id = await tx.incluir('termo_consentimento_paciente', {
          estabelecimento_id: s.est,
          atendimento_id: t.atendimento,
          paciente_id: t.paciente,
          termo_consentimento_modelo_id: t.tipo,
          situacao_termo_consentimento_id: situacao,
          procedimento_descricao: procedimento.slice(0, 200),
          texto_simples: texto,
          texto_tecnico: textoOuNull(modelo?.['texto_tecnico']),
          profissional_id: s.profissional,
          emitido_em: agora,
          origem: 'sistema',
        });
        const situacaoDoc = await this.situacaoDocumento(tx, 'lancado');
        const documento = await tx.incluir('documento_prontuario', {
          estabelecimento_id: s.est,
          paciente_id: t.paciente,
          atendimento_id: t.atendimento,
          tipo_documento_clinico_id: tipoDoc,
          situacao_documento_prontuario_id: situacaoDoc,
          entidade_origem: 'termo_consentimento_paciente',
          entidade_origem_id: id,
          titulo: (textoOuNull(modelo?.['titulo']) ?? 'Termo de consentimento livre e esclarecido').slice(
            0,
            150,
          ),
          profissional_id: s.profissional,
          referencia_em: agora,
          lancado_em: agora,
          numero_versao: 1,
          confidencial: false,
          conteudo: JSON.stringify({ hash_conteudo: t.hashConteudo, como_suporte: t.comoSuporte === true }),
          origem: 'sistema',
        });
        await tx.incluir('documento_prontuario_evento', {
          documento_prontuario_id: documento,
          operacao: 'inclusao',
          acao: 'criacao',
          situacao_documento_prontuario_id: situacaoDoc,
          profissional_id: s.profissional,
          evento_em: agora,
          dados: JSON.stringify({ hash: t.hashConteudo }),
          ocorrido_em: agora,
          usuario_id: s.usuario,
        });
        await tx.alterar('termo_consentimento_paciente', id, 1, { documento_prontuario_id: documento });
        return { id, documento };
      },
      (r) => ({ tabela: 'termo_consentimento_paciente', id: r.id }),
      (r) => ({
        dados: {
          evento: 'pep.tcle.gravado',
          paciente: t.paciente,
          documento: r.documento,
          comoSuporte: t.comoSuporte === true,
        },
      }),
    );
  }

  /**
   * Assina ou revoga o termo lido (versao = id da versão lida): grava NOVA versão ligada à anterior, nunca altera nem
   * apaga a lida. Termo já substituído: conflito de versão; termo revogado: situação inválida.
   */
  async mudarSituacaoTcle(
    c: ContextoGravacaoPep,
    m: { paciente: number; versao: number; situacao: 'assinado' | 'revogado'; motivo: string | null },
  ): Promise<number> {
    const motivo = m.motivo?.trim() || null;
    if (m.situacao === 'revogado' && (motivo === null || motivo.length < MOTIVO_MINIMO_REVOGACAO))
      throw recusar(
        422,
        'motivo-obrigatorio',
        `A revogação do termo exige o motivo (ao menos ${MOTIVO_MINIMO_REVOGACAO} caracteres).`,
      );
    return this.gravar(
      c,
      `pep.tcle.${m.situacao === 'assinado' ? 'assinar' : 'revogar'}`,
      null,
      async (tx, s) => {
        const [t] = await tx.consultarParaAtualizar(
          `SELECT t.*, st.etapa FROM termo_consentimento_paciente t
             JOIN situacao_termo_consentimento st ON st.id = t.situacao_termo_consentimento_id
            WHERE t.id = ? AND t.paciente_id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL`,
          [m.versao, m.paciente, s.est],
        );
        if (!t) throw recusar(404, 'registro-inexistente', 'Termo não encontrado.');
        const sucessor = await tx.uma(
          'SELECT id FROM termo_consentimento_paciente WHERE termo_anterior_id = ? LIMIT 1',
          [m.versao],
        );
        if (sucessor) throw recusar(409, 'conflito-versao', 'O termo mudou desde a leitura.');
        if (situacaoDoTermo(t['etapa']) === 'revogado')
          throw recusar(409, 'situacao-invalida', 'O termo já foi revogado.');
        const situacao = await this.situacaoTermo(tx, [m.situacao]);
        const agora = new Date();
        return tx.incluir('termo_consentimento_paciente', {
          estabelecimento_id: s.est,
          atendimento_id: t['atendimento_id'],
          paciente_id: t['paciente_id'],
          termo_consentimento_modelo_id: t['termo_consentimento_modelo_id'],
          situacao_termo_consentimento_id: situacao,
          procedimento_descricao: t['procedimento_descricao'],
          item_faturavel_id: t['item_faturavel_id'],
          texto_simples: t['texto_simples'],
          texto_tecnico: t['texto_tecnico'],
          profissional_id: s.profissional,
          tipo_assinante_id: t['tipo_assinante_id'],
          responsavel_pessoa_fisica_id: t['responsavel_pessoa_fisica_id'],
          tipo_parentesco_id: t['tipo_parentesco_id'],
          primeira_testemunha_nome: t['primeira_testemunha_nome'],
          segunda_testemunha_nome: t['segunda_testemunha_nome'],
          emitido_em: t['emitido_em'],
          assinado_em: m.situacao === 'assinado' ? agora : t['assinado_em'],
          revogado_em: m.situacao === 'revogado' ? agora : null,
          motivo_revogacao: m.situacao === 'revogado' ? motivo : null,
          observacao: m.situacao === 'assinado' ? motivo : t['observacao'],
          documento_prontuario_id: t['documento_prontuario_id'],
          arquivo_id: t['arquivo_id'],
          termo_anterior_id: m.versao,
          origem: 'sistema',
        });
      },
      (id) => ({ tabela: 'termo_consentimento_paciente', id }),
      (id) => ({
        dados: {
          evento: 'pep.tcle.gravado',
          paciente: m.paciente,
          anterior: m.versao,
          situacao: m.situacao,
          id,
        },
      }),
    );
  }
}
