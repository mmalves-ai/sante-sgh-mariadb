// Porta dos escores e dos registros assistenciais da enfermagem sobre o banco do cliente (MariaDB, pelo @sgh/nucleo):
//   - escores (NEWS2, Braden, Morse...): aplicacao_escala e aplicacao_escala_item pelas variáveis da escala do cadastro
//     (escala_clinica, escala_clinica_variavel), as regras publicadas em escala_clinica_versao e os sinais da aferição;
//   - contenção mecânica: contencao_paciente (ordem, renovação, retirada) e contencao_paciente_avaliacao (a checagem
//     periódica aprazada);
//   - Time de Resposta Rápida: acionamento_resposta_rapida (acionamento, chegada, desfecho, inativação);
//   - protocolo gerenciado do internado: inclusao_protocolo_paciente e inclusao_protocolo_evento;
//   - lesão de pele: lesao_pele_paciente e lesao_pele_avaliacao (ficha e curativos);
//   - censo: internacao e fechamento_censo (pacientes-dia dos dias fechados).
// Os avisos da central (o médico e o TRR pelo NEWS2, a contenção vencida) saem pelo outbox na mesma transação.
// Toda leitura filtra o estabelecimento da sessão e os excluídos; os cadastros de escalas são da rede inteira.
// Melhoria: o escore grava os itens pelas variáveis do cadastro da escala (recusa a variável desconhecida); a ordem de
// contenção tem o prazo e o vencimento conferidos pelo banco (CHECK) e a checagem é a avaliação aprazada da ordem; a
// chegada do TRR não é anterior ao acionamento (CHECK); o estorno do escore inativa a aplicação, que fica visível.
// Melhoria: o escore só se liga a atendimento e aferição deste estabelecimento e do mesmo paciente; a interpretação
// guarda faixa, gatilho e versão da regra inteiros (nunca um JSON cortado; os cuidados vão à trilha); o motivo do
// estorno fica na trilha da gravação e é lido dela; o NEWS2 de 5 ou mais grava o escore, os sinais e os avisos, e as
// reavaliações programadas e cumpridas ficam em reavaliacao_escala (o estorno do escore reabre a cumprida por ele).
// Classificação de pacientes (Fugulin e NAS) em classificacao_paciente, índices da UTI (APACHE II, SOFA) em
// indice_gravidade_uti (com a validação e o estorno) e o adendo da checagem da contenção em
// contencao_paciente_avaliacao_adendo (a checagem original não muda).
// Profilaxia de TEV: a decisão do prescritor sobre a sugestão do escore (Caprini ou Padua) grava em profilaxia_tev_decisao,
// ligada à avaliação de risco (profilaxia_tev_avaliacao) criada na primeira decisão a partir do escore; a retificação e
// a anulação são linhas novas (a original não muda). TRR: a chegada e o desfecho são eventos versionados em
// acionamento_resposta_rapida_evento (a retificação aponta a versão corrigida; a inativação fica visível), e as colunas
// do acionamento espelham o evento vigente. Lesão de pele: a ficha (versões), o curativo (e a correção) e a foto são
// linhas de lesao_pele_avaliacao; o tipo, a região e o estágio vêm do cadastro; o encerramento e a inativação ficam na
// lesão ou na linha, visíveis. Protocolo gerenciado do internado: a inclusão, a meta, o item do checklist, o
// encerramento e a inativação por engano gravam em inclusao_protocolo_paciente e inclusao_protocolo_evento; a ficha da
// PCR (Utstein), por versão, e a inativação dela em parada_cardiorrespiratoria_ficha.
import { createHash } from 'node:crypto';
import { avaliacaoTevDoEscore } from '@sgh/dominio-enfermagem';
import { CONFIGURACAO_INDICES_SINTETICA } from '@sgh/dominio-pep';
import { type Executor, gravarOutbox, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  booleano,
  civilDe,
  estabelecimentoDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  LOGIN_DE,
  LOGIN_DO_PROFISSIONAL,
  marcadores,
  num,
  numOuNulo,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import {
  type ContextoEscores,
  type GravadorEscores,
  METODOS_PORTA_ESCORES,
  type PortaEscores,
  type VinculoAssistencial,
} from './escores-porta.js';
import {
  afericaoDoSinal,
  type AnotacaoGravacao,
  conferirAtendimento,
  gravacaoDireta,
} from './gravacao-direta.js';
import type { NucleoEnfermagem } from './porta-propria.js';
import type {
  AcionamentoTrrRegistrado,
  AdendoChecagemLido,
  ClassificacaoRegistrada,
  ContencaoParaGravar,
  ContencaoRegistrada,
  DecisaoProfilaxiaRegistrada,
  EscoreRegistrado,
  EventoTrrRegistrado,
  HistoricoProfilaxia,
  HorarioContencao,
  IndiceUtiRegistrado,
  InternacaoParaEscore,
  LesaoRegistrada,
  ProtocoloInternadoRegistrado,
  ReavaliacaoRegistrada,
  RegistroParaEstorno,
  VersaoPcrRegistrada,
  RegraEscoreRegistrada,
} from './tipos.js';

type Linha = Record<string, unknown>;

const TETO = 2_000;
const MEMBROS: Readonly<Record<string, string>> = {
  msd: 'membro_superior_direito',
  mse: 'membro_superior_esquerdo',
  mid: 'membro_inferior_direito',
  mie: 'membro_inferior_esquerdo',
  torax: 'torax',
};
const MOTIVO_BANCO: Readonly<Record<string, string>> = {
  agitacao: 'agitacao',
  riscoDispositivo: 'risco_dispositivo',
  riscoQueda: 'risco_queda',
  autoagressao: 'autoagressao',
  heteroagressao: 'heteroagressao',
};
const MOTIVO_TELA = new Map(Object.entries(MOTIVO_BANCO).map(([k, v]) => [v, k]));
const ACHADOS = ['perfusao', 'pele', 'posicao', 'necessidades'] as const;

function lerJson<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
}

/** A chave da reavaliação no estabelecimento (paciente, escala e chave da tela); a longa vira o resumo, nunca cortada. */
function chaveReavaliacao(paciente: number, escala: string, chave: string): string {
  const k = `${paciente}:${escala}:${chave}`;
  return k.length <= 80 ? k : createHash('sha256').update(k).digest('hex');
}
const MOTIVO_REAVALIACAO_BANCO: Readonly<Record<string, string>> = {
  admissao: 'admissao',
  diaria: 'diaria',
  'mudanca-quadro': 'mudanca_quadro',
};
const segundos = (v: unknown, fuso: string) => (civilDe(v, fuso) ?? '').slice(0, 19);
/** O tipo e o motivo do estorno gravados na trilha da operação (a tabela guarda só a situação). */
const ESTORNO_NA_TRILHA = (entidade: string, id: string) => `
  (SELECT JSON_OBJECT('motivo', t.motivo, 'tipo', JSON_UNQUOTE(JSON_EXTRACT(t.dados_depois, '$.dados.estorno.tipo')))
     FROM trilha_auditoria t WHERE t.entidade = '${entidade}' AND t.entidade_id = ${id} AND t.motivo IS NOT NULL
     AND JSON_EXTRACT(t.dados_depois, '$.dados.estorno') IS NOT NULL ORDER BY t.id DESC LIMIT 1)`;

const SQL_INDICES = `
  SELECT x.*, ${LOGIN_DE('x.criado_por')} AS login, ${LOGIN_DE('x.alterado_por')} AS alterado_login,
         ${LOGIN_DO_PROFISSIONAL('x.validado_por_profissional_id', 'x.estabelecimento_id')} AS validado_login,
         ${ESTORNO_NA_TRILHA('indice_gravidade_uti', 'x.id')} AS estorno
    FROM indice_gravidade_uti x
   WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL`;

function indiceDe(r: Linha, fuso: string): IndiceUtiRegistrado {
  const v = lerJson<{ valores?: unknown; configuracao?: string }>(r['variaveis']) ?? {};
  const e = lerJson<{ motivo?: string; tipo?: string }>(r['estorno']);
  const mortalidade = numOuNulo(r['mortalidade_estimada']);
  return {
    id: num(r['id']),
    paciente: num(r['paciente_id']),
    reg: numOuNulo(r['internacao_id']),
    indice: texto(r['indice']) === 'sofa' ? 'sofa' : 'apache2',
    variaveis: v.valores ?? null,
    pontuacao: num(r['pontuacao']),
    categoria: numOuNulo(r['categoria_diagnostica']),
    tipoAdmissao: textoOuNulo(r['tipo_admissao']),
    // Guardada em percentual (duas casas), devolvida na fração da tela (quatro casas).
    mortalidade: mortalidade === null ? null : Math.round(mortalidade * 100) / 10_000,
    impressaoConfig: v.configuracao ?? '',
    coletadoEm: segundos(r['coletado_em'], fuso),
    registradoPor: texto(r['login']),
    situacao: r['validado_em'] ? 'validado' : 'registrado',
    validadoPor: r['validado_em'] ? texto(r['validado_login']) : null,
    validadoEm: r['validado_em'] ? segundos(r['validado_em'], fuso) : null,
    estorno:
      r['situacao'] === 'estornado'
        ? {
            tipo: e?.tipo === 'invalidacao' ? 'invalidacao' : 'estorno',
            motivo: e?.motivo ?? '',
            usuario: texto(r['alterado_login']),
            em: civilDe(r['alterado_em'], fuso) ?? '',
            alerta: null,
            escoreMantem: null,
          }
        : null,
  };
}

/** A decisão do contrato na coluna da decisão (a anulação guarda a decisão anulada; o contrato vai em `dados`). */
const DECISAO_BANCO = (d: 'prescrita' | 'nao-prescrita') => (d === 'prescrita' ? 'aceita' : 'recusada');

/** O histórico das decisões de profilaxia de uma avaliação, da mais antiga para a mais nova. */
function historicoDe(rs: readonly Linha[], fuso: string): (HistoricoProfilaxia & { autor: number })[] {
  return rs.map((d) => {
    const x = lerJson<{ decisao?: string; motivo?: string | null }>(d['dados']) ?? {};
    const decisao =
      x.decisao === 'anulada' || x.decisao === 'prescrita' || x.decisao === 'nao-prescrita'
        ? x.decisao
        : d['decisao'] === 'aceita'
          ? 'prescrita'
          : 'nao-prescrita';
    return {
      decisao,
      motivo: x.motivo ?? null,
      justificativa: d['operacao'] === 'retificacao' ? textoOuNulo(d['justificativa']) : null,
      usuario: texto(d['login']),
      em: civilDe(d['ocorrido_em'], fuso) ?? '',
      autor: num(d['usuario_id']),
    };
  });
}

const SQL_EVENTOS_TRR = (n: number) => `
  SELECT ev.*, ${LOGIN_DE('ev.criado_por')} AS login, ${LOGIN_DE('ev.alterado_por')} AS alterado_login
    FROM acionamento_resposta_rapida_evento ev
   WHERE ev.acionamento_resposta_rapida_id IN (${marcadores(n)}) AND ev.excluido_em IS NULL
   ORDER BY ev.acionamento_resposta_rapida_id, ev.tipo, ev.id`;

/** Os eventos do TRR por acionamento: a sequência por tipo e o vigente (o último do tipo, se não inativado). */
function eventosTrrDe(rs: readonly Linha[], fuso: string): Map<number, EventoTrrRegistrado[]> {
  const m = new Map<number, EventoTrrRegistrado[]>();
  const minuto = (v: unknown) => (civilDe(v, fuso) ?? '').slice(0, 16);
  for (const r of rs) {
    const k = num(r['acionamento_resposta_rapida_id']);
    const tipo = r['tipo'] === 'desfecho' ? 'desfecho' : 'chegada';
    const lista = m.get(k) ?? [];
    const seq = lista.filter((e) => e.tipo === tipo).length + 1;
    lista.push({
      id: num(r['id']),
      tipo,
      seq,
      em: minuto(r['ocorrido_em']),
      desfecho: textoOuNulo(r['desfecho']),
      usuario: texto(r['login']),
      motivo: textoOuNulo(r['motivo']),
      anterior: numOuNulo(r['anterior_evento_id']),
      inativacao: booleano(r['inativado'])
        ? {
            motivo: texto(r['motivo_inativacao']),
            usuario: texto(r['alterado_login']),
            em: minuto(r['alterado_em']),
          }
        : null,
      vigente: false,
    });
    m.set(k, lista);
  }
  for (const [k, lista] of m)
    m.set(
      k,
      lista.map((e) => {
        const ultimo = lista.filter((y) => y.tipo === e.tipo).at(-1);
        return { ...e, vigente: ultimo?.id === e.id && e.inativacao === null };
      }),
    );
  return m;
}

/** A unidade de internação do atendimento no instante (a ocupação de leito vigente nele). */
const UNIDADE_NO_INSTANTE = (atendimento: string, instante: string) => `(
  SELECT u.codigo FROM ocupacao_leito o JOIN internacao i ON i.id = o.internacao_id
    JOIN unidade_internacao u ON u.id = o.unidade_internacao_id
   WHERE i.atendimento_id = ${atendimento} AND o.excluido_em IS NULL AND o.data_hora_inicio <= ${instante}
   ORDER BY o.data_hora_inicio DESC LIMIT 1)`;
const UTI_NO_INSTANTE = (atendimento: string, instante: string) => `(
  SELECT u.intensiva FROM ocupacao_leito o JOIN internacao i ON i.id = o.internacao_id
    JOIN unidade_internacao u ON u.id = o.unidade_internacao_id
   WHERE i.atendimento_id = ${atendimento} AND o.excluido_em IS NULL AND o.data_hora_inicio <= ${instante}
   ORDER BY o.data_hora_inicio DESC LIMIT 1)`;

const SQL_ESCORES = `
  SELECT a.id, a.paciente_id, a.atendimento_id, i.id AS internacao, e.codigo AS escala, a.pontuacao_total,
         a.interpretacao, a.aplicado_em, a.situacao, a.afericao_id, a.alterado_em, ${LOGIN_DE('a.criado_por')} AS login,
         ${LOGIN_DE('a.alterado_por')} AS estornado_por, e.numero_versao_atual,
         (SELECT t.motivo FROM trilha_auditoria t WHERE t.entidade = 'aplicacao_escala' AND t.entidade_id = a.id
           AND t.motivo IS NOT NULL ORDER BY t.id DESC LIMIT 1) AS motivo_estorno,
         ${UNIDADE_NO_INSTANTE('a.atendimento_id', 'a.aplicado_em')} AS unidade
    FROM aplicacao_escala a
    JOIN escala_clinica e ON e.id = a.escala_clinica_id
    LEFT JOIN internacao i ON i.atendimento_id = a.atendimento_id AND i.excluido_em IS NULL
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao IN ('finalizada', 'inativada')`;

const SQL_CONTENCAO = `
  SELECT c.*, ${LOGIN_DO_PROFISSIONAL('c.prescritor_profissional_id', 'c.estabelecimento_id')} AS prescritor,
         ${LOGIN_DO_PROFISSIONAL('c.retirada_profissional_id', 'c.estabelecimento_id')} AS retirada_por,
         ${UNIDADE_NO_INSTANTE('c.atendimento_id', 'c.inicio_em')} AS unidade,
         (SELECT r.id FROM contencao_paciente r WHERE r.anterior_contencao_paciente_id = c.id AND r.excluido_em IS NULL
           AND r.situacao <> 'inativada' ORDER BY r.id DESC LIMIT 1) AS renovada_por,
         (SELECT r.inicio_em FROM contencao_paciente r WHERE r.anterior_contencao_paciente_id = c.id
           AND r.excluido_em IS NULL AND r.situacao <> 'inativada' ORDER BY r.id DESC LIMIT 1) AS renovada_em
    FROM contencao_paciente c
   WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

const SQL_TRR = `
  SELECT t.*, ${LOGIN_DE('t.acionado_por_usuario_id')} AS login, ${LOGIN_DE('t.alterado_por')} AS alterado_login,
         ${UNIDADE_NO_INSTANTE('t.atendimento_id', 't.acionado_em')} AS unidade,
         ${UTI_NO_INSTANTE('t.atendimento_id', 't.acionado_em')} AS uti,
         (SELECT x.situacao FROM aplicacao_escala x WHERE x.id = t.aplicacao_escala_id) AS escore_situacao
    FROM acionamento_resposta_rapida t
   WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL`;

export class PortaEscoresPropria implements PortaEscores {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEnfermagem,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoEscores, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = estabelecimentoDe(c);
    return this.nucleo.lerSomente(
      {
        cliente: c.cliente,
        estabelecimento: c.estabelecimento,
        usuario: c.usuario,
        correlacao: c.correlacao || 'escores',
      },
      async (l) => fn(l, est, await fusoDe(l, est)),
    );
  }

  async podeGravar(): Promise<LiberacaoGravacao> {
    return {
      pode: false,
      codigo: 'operacao-desconhecida',
      motivo: 'Os escores gravam pelos registros da tela.',
    };
  }

  async executar(): Promise<never> {
    throw recusa('operacao-desconhecida', 'Os escores gravam pelos registros da tela.');
  }

  gravarSgh<T>(
    c: ContextoEscores,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorEscores) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'enfermagem.escores.gravacao',
      tabelas: [
        'aplicacao_escala',
        'aplicacao_escala_item',
        'afericao',
        'afericao_valor',
        'escala_clinica',
        'escala_clinica_versao',
        'contencao_paciente',
        'contencao_paciente_avaliacao',
        'contencao_paciente_avaliacao_adendo',
        'reavaliacao_escala',
        'classificacao_paciente',
        'indice_gravidade_uti',
        'acionamento_resposta_rapida',
        'acionamento_resposta_rapida_evento',
        'profilaxia_tev_avaliacao',
        'profilaxia_tev_decisao',
        'parada_cardiorrespiratoria_ficha',
        'inclusao_protocolo_paciente',
        'inclusao_protocolo_evento',
        'protocolo_gerenciado',
        'lesao_pele_paciente',
        'lesao_pele_avaliacao',
        'integracao_mensagem',
      ],
      trilha,
      gravador: (tx, est, an) => gravadorEscores(tx, est, an),
      fn,
    });
  }

  // ── Escores e regras ──────────────────────────────────────────────────────────────────────────────────────

  regras(c: ContextoEscores): Promise<RegraEscoreRegistrada[]> {
    return this.ler(c, async (l, _est, fuso) => {
      // As regras das escalas são da rede inteira (cadastro de escalas sem estabelecimento).
      const rs = await l.consultar(
        `SELECT v.id, e.codigo, v.numero_versao, v.dados, v.vigencia_inicio, ${LOGIN_DE('v.usuario_id')} AS autor
           FROM escala_clinica_versao v JOIN escala_clinica e ON e.id = v.escala_clinica_id
          WHERE v.vigencia_fim IS NULL ORDER BY e.codigo, v.numero_versao DESC`,
      );
      return rs.map((r) => {
        const d = lerJson<{ faixas?: unknown; impressao?: string; notas?: string }>(r['dados']) ?? {};
        return {
          id: num(r['id']),
          escala: texto(r['codigo']),
          versao: num(r['numero_versao']),
          faixas: d.faixas ?? null,
          impressao: d.impressao ?? '',
          notas: d.notas ?? '',
          autor: texto(r['autor']),
          publicadoEm: civilDe(r['vigencia_inicio'], fuso) ?? '',
        };
      });
    });
  }

  private lerEscores(c: ContextoEscores, pacientes: readonly number[], desde: string, ultimos: boolean) {
    if (pacientes.length === 0) return Promise.resolve([] as EscoreRegistrado[]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_ESCORES} AND a.paciente_id IN (${marcadores(pacientes.length)}) AND a.aplicado_em >= ?
          ${
            ultimos
              ? `AND NOT EXISTS (SELECT 1 FROM aplicacao_escala b WHERE b.paciente_id = a.paciente_id
                   AND b.escala_clinica_id = a.escala_clinica_id AND b.excluido_em IS NULL AND b.situacao = 'finalizada'
                   AND (b.aplicado_em > a.aplicado_em OR (b.aplicado_em = a.aplicado_em AND b.id > a.id)))
                 AND a.situacao = 'finalizada'`
              : ''
          }
          ORDER BY a.aplicado_em DESC, a.id DESC LIMIT ?`,
        [est, ...pacientes, instanteDe(desde, fuso), TETO],
      );
      const ids = rs.map((r) => num(r['id']));
      const itens = new Map<number, Record<string, number>>();
      if (ids.length > 0) {
        const is = await l.consultar(
          `SELECT i.aplicacao_escala_id, v.identificador, i.pontos FROM aplicacao_escala_item i
             JOIN escala_clinica_variavel v ON v.id = i.escala_clinica_variavel_id
            WHERE i.aplicacao_escala_id IN (${marcadores(ids.length)}) AND i.excluido_em IS NULL`,
          ids,
        );
        for (const i of is) {
          const k = num(i['aplicacao_escala_id']);
          itens.set(k, { ...(itens.get(k) ?? {}), [texto(i['identificador'])]: num(i['pontos']) });
        }
      }
      return rs.map((r): EscoreRegistrado => {
        const interp = lerJson<{
          faixa?: string;
          gatilho?: string;
          versaoRegra?: number;
          suspeitaInfeccao?: boolean;
          origem?: string;
        }>(r['interpretacao']);
        return {
          id: num(r['id']),
          paciente: num(r['paciente_id']),
          reg: numOuNulo(r['internacao']),
          atendimento: numOuNulo(r['atendimento_id']),
          unidade: textoOuNulo(r['unidade']),
          escala: texto(r['escala']),
          versaoRegra: interp?.versaoRegra ?? num(r['numero_versao_atual']),
          itens: itens.get(num(r['id'])) ?? {},
          total: num(r['pontuacao_total']),
          faixa: interp?.faixa ?? texto(r['interpretacao']),
          gatilho: interp?.gatilho ?? 'nenhum',
          suspeitaInfeccao: interp?.suspeitaInfeccao === true,
          origem: r['afericao_id'] === null ? 'tela' : 'afericao',
          aferidoEm: (civilDe(r['aplicado_em'], fuso) ?? '').slice(0, 16),
          usuario: texto(r['login']),
          estorno:
            r['situacao'] === 'inativada'
              ? {
                  tipo: 'estorno',
                  motivo: texto(r['motivo_estorno']),
                  usuario: texto(r['estornado_por']),
                  em: civilDe(r['alterado_em'], fuso) ?? '',
                  alerta: null,
                  escoreMantem: null,
                }
              : null,
        };
      });
    });
  }

  escores(c: ContextoEscores, pacientes: readonly number[], desde: string) {
    return this.lerEscores(c, pacientes, desde, false);
  }

  ultimosEscores(c: ContextoEscores, pacientes: readonly number[], desde: string) {
    return this.lerEscores(c, pacientes, desde, true);
  }

  reavaliacoes(
    c: ContextoEscores,
    pacientes: readonly number[],
    desde: string,
  ): Promise<ReavaliacaoRegistrada[]> {
    if (pacientes.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT r.*, e.codigo AS escala FROM reavaliacao_escala r JOIN escala_clinica e ON e.id = r.escala_clinica_id
          WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND r.paciente_id IN (${marcadores(pacientes.length)})
            AND (r.situacao = 'pendente' OR r.cumprida_em >= ?)
          ORDER BY r.devida_em, r.id LIMIT ${TETO}`,
        [est, ...pacientes, instanteDe(desde, fuso)],
      );
      return rs.map((r): ReavaliacaoRegistrada => {
        const situacao = texto(r['situacao']) as ReavaliacaoRegistrada['situacao'];
        const escore = numOuNulo(r['aplicacao_escala_id']);
        return {
          id: num(r['id']),
          paciente: num(r['paciente_id']),
          reg: numOuNulo(r['internacao_id']),
          escala: texto(r['escala']) === 'morse' ? 'morse' : 'braden',
          motivo:
            texto(r['motivo']) === 'mudanca_quadro' ? 'mudanca-quadro' : (texto(r['motivo']) as 'admissao'),
          devidaEm: segundos(r['devida_em'], fuso),
          prazoEm: segundos(r['prazo_em'], fuso),
          situacao,
          cumpridaEm: r['cumprida_em'] ? segundos(r['cumprida_em'], fuso) : null,
          cumpridaPor: situacao !== 'cumprida' ? null : escore !== null ? 'escore' : 'formulario',
          escore,
        };
      });
    });
  }

  escalasEmFormulario(): Promise<[]> {
    return Promise.resolve([]);
  }

  internacoes(c: ContextoEscores, regs: readonly number[]): Promise<InternacaoParaEscore[]> {
    if (regs.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT i.id, i.data_hora_entrada, i.data_hora_alta, i.motivo_saida_hospitalar_id FROM internacao i
          WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.id IN (${marcadores(regs.length)})`,
        [est, ...regs],
      );
      return rs.map((r) => ({
        reg: num(r['id']),
        entrada: (civilDe(r['data_hora_entrada'], fuso) ?? '').slice(0, 16) || null,
        alta: (civilDe(r['data_hora_alta'], fuso) ?? '').slice(0, 16) || null,
        motivoAlta: numOuNulo(r['motivo_saida_hospitalar_id']),
      }));
    });
  }

  classificacoes(
    c: ContextoEscores,
    unidade: string,
    data: string,
    turno: string,
  ): Promise<ClassificacaoRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT x.*, ${LOGIN_DE('x.criado_por')} AS login, ${LOGIN_DE('x.alterado_por')} AS alterado_login,
                ${ESTORNO_NA_TRILHA('classificacao_paciente', 'x.id')} AS estorno
           FROM classificacao_paciente x JOIN unidade_internacao u ON u.id = x.unidade_internacao_id
          WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL AND u.codigo = ? AND x.data_referencia = ?
            AND x.turno = ? ORDER BY x.id LIMIT ${TETO}`,
        [est, unidade, data.slice(0, 10), turno],
      );
      return rs.map((r): ClassificacaoRegistrada => {
        const e = lerJson<{ tipo?: string }>(r['estorno']);
        return {
          id: num(r['id']),
          paciente: num(r['paciente_id']),
          reg: num(r['internacao_id']),
          instrumento: texto(r['instrumento']) === 'nas' ? 'nas' : 'fugulin',
          itens: lerJson<Record<string, number | string>>(r['itens']) ?? {},
          total: num(r['total']),
          categoria: texto(r['categoria']),
          horas24h: num(r['horas_24h']),
          usuario: texto(r['login']),
          criadoEm: civilDe(r['criado_em'], fuso) ?? '',
          data: (civilDe(r['data_referencia'], 'UTC') ?? texto(r['data_referencia'])).slice(0, 10),
          turno: texto(r['turno']),
          estorno:
            r['situacao'] === 'estornada'
              ? {
                  tipo: e?.tipo === 'invalidacao' ? 'invalidacao' : 'estorno',
                  motivo: texto(r['motivo_estorno']),
                  usuario: texto(r['alterado_login']),
                  em: civilDe(r['alterado_em'], fuso) ?? '',
                  alerta: null,
                  escoreMantem: null,
                }
              : null,
        };
      });
    });
  }

  async configuracaoIndices() {
    // Parâmetros dos índices da UTI ainda sem cadastro por estabelecimento (pendência): vale a configuração do domínio.
    return CONFIGURACAO_INDICES_SINTETICA;
  }

  indicesDoPaciente(c: ContextoEscores, paciente: number): Promise<IndiceUtiRegistrado[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SQL_INDICES} AND x.paciente_id = ? ORDER BY x.coletado_em DESC, x.id DESC LIMIT ${TETO}`,
          [est, paciente],
        )
      ).map((r) => indiceDe(r, fuso)),
    );
  }

  apachesDoPeriodo(c: ContextoEscores, de: string, ate: string): Promise<IndiceUtiRegistrado[]> {
    return this.ler(c, async (l, est, fuso) =>
      (
        await l.consultar(
          `${SQL_INDICES} AND x.indice = 'apache2' AND x.situacao = 'validado' AND x.coletado_em >= ? AND x.coletado_em < ?
            ORDER BY x.coletado_em, x.id LIMIT ${TETO}`,
          [
            est,
            instanteDe(de.slice(0, 10), fuso),
            new Date(instanteDe(ate.slice(0, 10), fuso).getTime() + 86_400_000),
          ],
        )
      ).map((r) => indiceDe(r, fuso)),
    );
  }

  vinculo(c: ContextoEscores, login: string): Promise<VinculoAssistencial | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT po.id, oc.codigo_cbo, pr.situacao
           FROM usuario u
           JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
                AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
                AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
           JOIN profissional pr ON pr.id = v.profissional_id
           JOIN profissional_ocupacao po ON po.profissional_id = pr.id AND po.ativo AND po.excluido_em IS NULL
           JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
          WHERE u.login = ? AND u.excluido_em IS NULL ORDER BY po.principal DESC, po.id LIMIT 1`,
        [est, login.trim().toLowerCase()],
      );
      return r
        ? {
            vinculo: num(r['id']),
            codigoCbo: texto(r['codigo_cbo']),
            conselhoAtivo: r['situacao'] === 'ativo',
          }
        : null;
    });
  }

  registroParaEstorno(c: ContextoEscores, origem: string, id: number): Promise<RegistroParaEstorno | null> {
    if (origem === 'indiceUti')
      return this.ler(c, async (l, est, fuso) => {
        const r = await l.uma(`${SQL_INDICES} AND x.id = ?`, [est, id]);
        if (!r) return null;
        const x = indiceDe(r, fuso);
        return {
          id,
          paciente: x.paciente,
          usuario: x.registradoPor,
          escala: x.indice,
          gatilho: null,
          quando: x.coletadoEm,
          estornado: x.estorno !== null,
        };
      });
    if (origem === 'classificacao')
      return this.ler(c, async (l, est, fuso) => {
        const r = await l.uma(
          `SELECT x.id, x.paciente_id, x.instrumento, x.situacao, x.criado_em, ${LOGIN_DE('x.criado_por')} AS login
             FROM classificacao_paciente x WHERE x.estabelecimento_id = ? AND x.id = ? AND x.excluido_em IS NULL`,
          [est, id],
        );
        if (!r) return null;
        return {
          id,
          paciente: num(r['paciente_id']),
          usuario: texto(r['login']),
          escala: texto(r['instrumento']),
          gatilho: null,
          quando: civilDe(r['criado_em'], fuso) ?? '',
          estornado: r['situacao'] === 'estornada',
        };
      });
    if (origem !== 'escore') return Promise.resolve(null);
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SQL_ESCORES} AND a.id = ?`, [est, id]);
      if (!r) return null;
      const interp = lerJson<{ gatilho?: string }>(r['interpretacao']);
      return {
        id,
        paciente: num(r['paciente_id']),
        usuario: texto(r['login']),
        escala: texto(r['escala']),
        gatilho: interp?.gatilho ?? null,
        quando: (civilDe(r['aplicado_em'], fuso) ?? '').slice(0, 16),
        estornado: r['situacao'] === 'inativada',
      };
    });
  }

  decisoesProfilaxia(c: ContextoEscores, escores: readonly number[]): Promise<DecisaoProfilaxiaRegistrada[]> {
    if (escores.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT av.aplicacao_escala_id AS escore, d.*, ${LOGIN_DE('d.usuario_id')} AS login
           FROM profilaxia_tev_decisao d JOIN profilaxia_tev_avaliacao av ON av.id = d.profilaxia_tev_avaliacao_id
          WHERE av.estabelecimento_id = ? AND av.excluido_em IS NULL AND av.situacao = 'registrada'
            AND av.aplicacao_escala_id IN (${marcadores(escores.length)})
          ORDER BY av.aplicacao_escala_id, d.ocorrido_em, d.id`,
        [est, ...escores],
      );
      const porEscore = new Map<number, Linha[]>();
      for (const r of rs) {
        const k = num(r['escore']);
        porEscore.set(k, [...(porEscore.get(k) ?? []), r]);
      }
      return [...porEscore].map(([escore, linhas]): DecisaoProfilaxiaRegistrada => {
        const historico = historicoDe(linhas, fuso).map(({ autor: _a, ...h }) => h);
        const v = historico.at(-1)!;
        const ultima = [...historico].reverse().find((y) => y.decisao !== 'anulada') ?? v;
        return {
          escore,
          decisao: ultima.decisao === 'prescrita' ? 'prescrita' : 'nao-prescrita',
          motivo: v.decisao === 'anulada' ? ultima.motivo : v.motivo,
          usuario: v.usuario,
          em: v.em,
          anulada: v.decisao === 'anulada',
          historico,
        };
      });
    });
  }

  // ── Contenção ─────────────────────────────────────────────────────────────────────────────────────────────

  contencoes(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; unidade?: string; desde: string; ate?: string; abertas?: boolean },
  ): Promise<ContencaoRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros = ['c.inicio_em >= ?'];
      const p: unknown[] = [est, instanteDe(f.desde, fuso)];
      if (f.ate) {
        filtros.push('c.inicio_em <= ?');
        p.push(instanteDe(f.ate, fuso));
      }
      if (f.atendimentos) {
        if (f.atendimentos.length === 0) return [];
        filtros.push(`c.atendimento_id IN (${marcadores(f.atendimentos.length)})`);
        p.push(...f.atendimentos);
      }
      if (f.abertas) filtros[0] = "(c.inicio_em >= ? OR c.situacao IN ('ativa', 'vencida'))";
      let rs = await l.consultar(
        `${SQL_CONTENCAO} AND ${filtros.join(' AND ')} ORDER BY c.inicio_em, c.id LIMIT ?`,
        [...p, TETO],
      );
      if (f.unidade !== undefined) rs = rs.filter((r) => r['unidade'] === f.unidade);
      if (f.abertas)
        rs = rs.filter(
          (r) => ['ativa', 'vencida'].includes(texto(r['situacao'])) && r['renovada_por'] === null,
        );
      return this.comHorarios(l, rs, fuso);
    });
  }

  private async comHorarios(l: Leitor, rs: Linha[], fuso: string): Promise<ContencaoRegistrada[]> {
    const ids = rs.map((r) => num(r['id']));
    const horarios = new Map<number, HorarioContencao[]>();
    if (ids.length > 0) {
      const hs = await l.consultar(
        `SELECT a.*, ${LOGIN_DO_PROFISSIONAL('a.profissional_id', 'c.estabelecimento_id')} AS login
           FROM contencao_paciente_avaliacao a JOIN contencao_paciente c ON c.id = a.contencao_paciente_id
          WHERE a.contencao_paciente_id IN (${marcadores(ids.length)}) AND a.excluido_em IS NULL
          ORDER BY a.contencao_paciente_id, a.previsto_em`,
        ids,
      );
      const avaliacoes = hs.map((h) => num(h['id']));
      const adendos = new Map<number, AdendoChecagemLido[]>();
      if (avaliacoes.length > 0)
        for (const a of await l.consultar(
          `SELECT d.*, ${LOGIN_DE('d.usuario_id')} AS login FROM contencao_paciente_avaliacao_adendo d
            WHERE d.contencao_paciente_avaliacao_id IN (${marcadores(avaliacoes.length)}) ORDER BY d.ocorrido_em, d.id`,
          avaliacoes,
        )) {
          const k = num(a['contencao_paciente_avaliacao_id']);
          const dados =
            lerJson<{ achados?: Record<string, string>; observacao?: string | null }>(a['dados']) ?? {};
          const achados = dados.achados ?? {};
          adendos.set(k, [
            ...(adendos.get(k) ?? []),
            {
              achados,
              alterado: Object.values(achados).includes('alterado'),
              observacao: dados.observacao ?? null,
              motivo: texto(a['texto']),
              usuario: texto(a['login']),
              em: civilDe(a['ocorrido_em'], fuso) ?? '',
            },
          ]);
        }
      for (const h of hs) {
        const k = num(h['contencao_paciente_id']);
        const achados = Object.fromEntries(ACHADOS.map((a) => [a, texto(h[`achado_${a}`]) || 'normal']));
        horarios.set(k, [
          ...(horarios.get(k) ?? []),
          {
            id: num(h['id']),
            previsto: (civilDe(h['previsto_em'], fuso) ?? '').slice(0, 16),
            checagem:
              h['situacao'] === 'realizada'
                ? {
                    achados,
                    alterado: Object.values(achados).includes('alterado'),
                    observacao: textoOuNulo(h['observacao']),
                    usuario: texto(h['login']),
                    feitaEm: (civilDe(h['avaliado_em'], fuso) ?? '').slice(0, 16),
                    adendos: adendos.get(num(h['id'])) ?? [],
                  }
                : null,
          },
        ]);
      }
    }
    return rs.map((r) => {
      const situacao = texto(r['situacao']);
      return {
        id: num(r['id']),
        paciente: num(r['paciente_id']),
        atendimento: num(r['atendimento_id']),
        unidade: textoOuNulo(r['unidade']),
        motivo: MOTIVO_TELA.get(texto(r['motivo'])) ?? texto(r['motivo']),
        justificativa: texto(r['indicacao']),
        tipo: texto(r['tipo']),
        membros: Object.entries(MEMBROS)
          .filter(([, col]) => booleano(r[col]))
          .map(([m]) => m),
        prazoHoras: num(r['prazo_horas']),
        intervaloMinutos: num(r['intervalo_checagem_minutos']),
        inicio: (civilDe(r['inicio_em'], fuso) ?? '').slice(0, 16),
        anterior: numOuNulo(r['anterior_contencao_paciente_id']),
        renovadaPor: numOuNulo(r['renovada_por']),
        renovadaEm: r['renovada_em'] ? (civilDe(r['renovada_em'], fuso) ?? '').slice(0, 16) : null,
        prescritor: texto(r['prescritor']),
        criadoEm: civilDe(r['criado_em'], fuso) ?? '',
        encerramento:
          situacao === 'retirada' || situacao === 'inativada'
            ? {
                tipo: situacao === 'retirada' ? ('retirada' as const) : ('inativacao' as const),
                motivo: texto(r['motivo_retirada']),
                usuario: texto(r['retirada_por']),
                em: (civilDe(r['retirada_em'], fuso) ?? '').slice(0, 16),
              }
            : null,
        horarios: horarios.get(num(r['id'])) ?? [],
      };
    });
  }

  async contencao(c: ContextoEscores, id: number): Promise<ContencaoParaGravar | null> {
    const [x] = await this.ler(c, async (l, est, fuso) =>
      this.comHorarios(l, await l.consultar(`${SQL_CONTENCAO} AND c.id = ?`, [est, id]), fuso),
    );
    if (!x) return null;
    return {
      id: x.id,
      paciente: x.paciente,
      atendimento: x.atendimento,
      unidade: x.unidade,
      inicio: x.inicio,
      prazoHoras: x.prazoHoras,
      intervaloMinutos: x.intervaloMinutos,
      prescritor: x.prescritor,
      encerramento: x.encerramento ? { tipo: x.encerramento.tipo, em: x.encerramento.em } : null,
      renovadaPor: x.renovadaPor,
      renovadaEm: x.renovadaEm ?? null,
    };
  }

  pacientesDia(
    c: ContextoEscores,
    unidade: string,
    de: string,
    ate: string,
  ): Promise<{ pacientesDia: number; diasFechados: number }> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COALESCE(SUM(f.pacientes_dia), 0) AS pd, COUNT(*) AS dias
           FROM fechamento_censo f JOIN unidade_internacao u ON u.id = f.unidade_internacao_id
          WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao = 'fechado' AND u.codigo = ?
            AND f.data_referencia BETWEEN ? AND ?`,
        [est, unidade, de.slice(0, 10), ate.slice(0, 10)],
      );
      return { pacientesDia: num(r?.['pd']), diasFechados: num(r?.['dias']) };
    });
  }

  // ── Time de Resposta Rápida ───────────────────────────────────────────────────────────────────────────────

  acionamentosTrr(
    c: ContextoEscores,
    f: { unidade?: string; desde: string; ate?: string },
  ): Promise<AcionamentoTrrRegistrado[]> {
    return this.ler(c, async (l, est, fuso) => {
      const p: unknown[] = [est, instanteDe(f.desde, fuso)];
      let filtro = 't.acionado_em >= ?';
      if (f.ate) {
        filtro += ' AND t.acionado_em <= ?';
        p.push(instanteDe(f.ate, fuso));
      }
      const rs = await l.consultar(`${SQL_TRR} AND ${filtro} ORDER BY t.acionado_em, t.id LIMIT ?`, [
        ...p,
        TETO,
      ]);
      const lidos = rs.filter((r) => f.unidade === undefined || r['unidade'] === f.unidade);
      const ids = lidos.map((r) => num(r['id']));
      const eventos =
        ids.length > 0 ? eventosTrrDe(await l.consultar(SQL_EVENTOS_TRR(ids.length), ids), fuso) : new Map();
      return lidos.map((r) => ({ ...trrDe(r, fuso), eventos: eventos.get(num(r['id'])) ?? [] }));
    });
  }

  escoresComTrr(c: ContextoEscores, escores: readonly number[]): Promise<Set<number>> {
    if (escores.length === 0) return Promise.resolve(new Set());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT DISTINCT aplicacao_escala_id FROM acionamento_resposta_rapida
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'inativado'
            AND aplicacao_escala_id IN (${marcadores(escores.length)})`,
        [est, ...escores],
      );
      return new Set(rs.map((r) => num(r['aplicacao_escala_id'])));
    });
  }

  versoesPcr(
    c: ContextoEscores,
    f: { id?: number; atendimentos?: readonly number[]; unidade?: string; desde?: string; ate?: string },
  ): Promise<VersaoPcrRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.id !== undefined) {
        filtros.push('x.id = ?');
        p.push(f.id);
      } else if (f.atendimentos) {
        if (f.atendimentos.length === 0) return [];
        filtros.push(`x.atendimento_id IN (${marcadores(f.atendimentos.length)})`);
        p.push(...f.atendimentos);
      } else {
        if (f.desde) {
          filtros.push('x.colapso_em >= ?');
          p.push(instanteDe(f.desde, fuso));
        }
        if (f.ate) {
          filtros.push('x.colapso_em < ?');
          p.push(instanteDe(f.ate, fuso));
        }
        if (f.unidade) {
          filtros.push('u.codigo = ?');
          p.push(f.unidade);
        }
      }
      const rs = await l.consultar(
        `SELECT x.*, u.codigo AS unidade, ${LOGIN_DE('x.criado_por')} AS login, ${LOGIN_DE('x.alterado_por')} AS alterado_login
           FROM parada_cardiorrespiratoria_ficha x LEFT JOIN unidade_internacao u ON u.id = x.unidade_internacao_id
          WHERE x.estabelecimento_id = ? AND x.excluido_em IS NULL ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
          ORDER BY x.colapso_em DESC, x.numero_versao DESC, x.id DESC LIMIT ${TETO}`,
        p,
      );
      return rs.map((r): VersaoPcrRegistrada => ({
        id: num(r['id']),
        paciente: num(r['paciente_id']),
        atendimento: num(r['atendimento_id']),
        unidade: textoOuNulo(r['unidade']),
        uti: booleano(r['em_uti']),
        trr: numOuNulo(r['acionamento_resposta_rapida_id']),
        anterior: numOuNulo(r['anterior_ficha_id']),
        versao: num(r['numero_versao']),
        situacao: r['situacao'] === 'finalizada' ? 'finalizada' : 'rascunho',
        colapsoEm: (civilDe(r['colapso_em'], fuso) ?? '').slice(0, 16),
        dados: typeof r['dados'] === 'string' ? r['dados'] : JSON.stringify(r['dados']),
        autor: texto(r['login']),
        criadoEm: civilDe(r['criado_em'], fuso) ?? '',
        motivo: textoOuNulo(r['motivo_correcao']),
        inativacao: booleano(r['inativada'])
          ? {
              motivo: texto(r['motivo_inativacao']),
              usuario: texto(r['alterado_login']),
              em: (civilDe(r['alterado_em'], fuso) ?? '').slice(0, 16),
            }
          : null,
      }));
    });
  }

  acionamentosDosEscores(c: ContextoEscores, escores: readonly number[]) {
    if (escores.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT id, aplicacao_escala_id, acionado_em, situacao FROM acionamento_resposta_rapida
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND aplicacao_escala_id IN (${marcadores(escores.length)})`,
        [est, ...escores],
      );
      return rs.map((r) => ({
        escore: num(r['aplicacao_escala_id']),
        trr: num(r['id']),
        acionadoEm: (civilDe(r['acionado_em'], fuso) ?? '').slice(0, 16),
        inativo: r['situacao'] === 'inativado',
      }));
    });
  }

  censo(
    c: ContextoEscores,
    de: string,
    ate: string,
  ): Promise<{ porSetor: { setor: string; pacientesDia: number }[]; diasFechados: number }> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT u.codigo, SUM(f.pacientes_dia) AS pd, COUNT(DISTINCT f.data_referencia) AS dias
           FROM fechamento_censo f JOIN unidade_internacao u ON u.id = f.unidade_internacao_id
          WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL AND f.situacao = 'fechado'
            AND f.data_referencia BETWEEN ? AND ?
          GROUP BY u.codigo ORDER BY u.codigo`,
        [est, de.slice(0, 10), ate.slice(0, 10)],
      );
      return {
        porSetor: rs.map((r) => ({ setor: texto(r['codigo']), pacientesDia: num(r['pd']) })),
        diasFechados: rs.reduce((m, r) => Math.max(m, num(r['dias'])), 0),
      };
    });
  }

  // ── Protocolo gerenciado do internado ─────────────────────────────────────────────────────────────────────

  protocolosInternados(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; escores?: readonly number[]; desde?: string; ate?: string },
  ): Promise<ProtocoloInternadoRegistrado[]> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.atendimentos) {
        if (f.atendimentos.length === 0) return [];
        filtros.push(`ip.atendimento_id IN (${marcadores(f.atendimentos.length)})`);
        p.push(...f.atendimentos);
      }
      if (f.escores) return [];
      if (f.desde) {
        filtros.push('ip.horario_zero_em >= ?');
        p.push(instanteDe(f.desde, fuso));
      }
      if (f.ate) {
        filtros.push('ip.horario_zero_em <= ?');
        p.push(instanteDe(f.ate, fuso));
      }
      return this.lerProtocolos(l, est, fuso, filtros, p);
    });
  }

  private async lerProtocolos(l: Leitor, _est: number, fuso: string, filtros: string[], p: unknown[]) {
    const rs = await l.consultar(
      `SELECT ip.*, pg.tipo, ${LOGIN_DE('ip.criado_por')} AS login,
              ${UNIDADE_NO_INSTANTE('ip.atendimento_id', 'ip.horario_zero_em')} AS unidade,
              ${UTI_NO_INSTANTE('ip.atendimento_id', 'ip.horario_zero_em')} AS uti
         FROM inclusao_protocolo_paciente ip JOIN protocolo_gerenciado pg ON pg.id = ip.protocolo_gerenciado_id
        WHERE ip.estabelecimento_id = ? AND ip.excluido_em IS NULL ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
        ORDER BY ip.horario_zero_em, ip.id LIMIT ?`,
      [...p, TETO],
    );
    const ids = rs.map((r) => num(r['id']));
    const eventos = new Map<number, ProtocoloInternadoRegistrado['eventos']>();
    if (ids.length > 0) {
      const es = await l.consultar(
        `SELECT e.*, ${LOGIN_DE('e.usuario_id')} AS login FROM inclusao_protocolo_evento e
          WHERE e.inclusao_protocolo_paciente_id IN (${marcadores(ids.length)}) ORDER BY e.ocorrido_em, e.id`,
        ids,
      );
      for (const e of es) {
        const d =
          lerJson<{
            tipo?: string;
            codigo?: string;
            situacao?: string;
            quando?: string | null;
            prazoEm?: string | null;
          }>(e['dados']) ?? {};
        const k = num(e['inclusao_protocolo_paciente_id']);
        const tipo = (['meta', 'checklist', 'encerramento', 'inativacao'] as const).find((t) => t === d.tipo);
        if (!tipo) continue;
        eventos.set(k, [
          ...(eventos.get(k) ?? []),
          {
            id: num(e['id']),
            tipo,
            codigo: d.codigo ?? '',
            situacao: d.situacao ?? '',
            quando: d.quando ?? null,
            prazoEm: d.prazoEm ?? null,
            motivo: textoOuNulo(e['justificativa']),
            por: texto(e['login']),
            em: civilDe(e['ocorrido_em'], fuso) ?? '',
          },
        ]);
      }
    }
    return rs.map((r): ProtocoloInternadoRegistrado => {
      const regra =
        lerJson<{
          origem?: string;
          escore?: number | null;
          criterios?: string[];
          observacao?: string | null;
        }>(r['regra_avaliada']) ?? {};
      const tipo = texto(r['tipo']);
      return {
        id: num(r['id']),
        paciente: num(r['paciente_id']),
        atendimento: num(r['atendimento_id']),
        unidade: textoOuNulo(r['unidade']),
        local: booleano(r['uti']) ? 'uti' : 'internacao',
        tipo: tipo === 'avc' || tipo === 'tev' ? tipo : 'sepse',
        gerenciado: num(r['protocolo_gerenciado_id']),
        origem: regra.origem === 'news2' ? 'news2' : 'suspeita',
        escore: regra.escore ?? null,
        criterios: regra.criterios ?? [],
        observacao: regra.observacao ?? null,
        reconhecidoEm: (civilDe(r['horario_zero_em'], fuso) ?? '').slice(0, 16),
        incluidoEm: civilDe(r['criado_em'], fuso) ?? '',
        incluidoPor: texto(r['login']),
        eventos: eventos.get(num(r['id'])) ?? [],
      };
    });
  }

  async protocoloInternado(c: ContextoEscores, id: number): Promise<ProtocoloInternadoRegistrado | null> {
    const [x] = await this.ler(c, (l, est, fuso) =>
      this.lerProtocolos(l, est, fuso, ['ip.id = ?'], [est, id]),
    );
    return x ?? null;
  }

  // ── Lesão de pele ─────────────────────────────────────────────────────────────────────────────────────────

  lesoes(
    c: ContextoEscores,
    f: { id?: number; atendimentos?: readonly number[]; desde?: string; ate?: string },
  ): Promise<LesaoRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.id !== undefined) {
        filtros.push('lp.id = ?');
        p.push(f.id);
      }
      if (f.atendimentos) {
        if (f.atendimentos.length === 0) return [];
        filtros.push(`lp.atendimento_id IN (${marcadores(f.atendimentos.length)})`);
        p.push(...f.atendimentos);
      }
      if (f.desde) {
        filtros.push('lp.identificada_em >= ?');
        p.push(instanteDe(f.desde, fuso));
      }
      if (f.ate) {
        filtros.push('lp.identificada_em <= ?');
        p.push(instanteDe(f.ate, fuso));
      }
      const rs = await l.consultar(
        `SELECT lp.*, ${LOGIN_DO_PROFISSIONAL('lp.responsavel_profissional_id', 'lp.estabelecimento_id')} AS autor,
                ${LOGIN_DE('lp.alterado_por')} AS alterado_login,
                ${UNIDADE_NO_INSTANTE('lp.atendimento_id', 'lp.identificada_em')} AS unidade,
                ${UTI_NO_INSTANTE('lp.atendimento_id', 'lp.identificada_em')} AS uti
           FROM lesao_pele_paciente lp
          WHERE lp.estabelecimento_id = ? AND lp.excluido_em IS NULL ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
          ORDER BY lp.identificada_em, lp.id LIMIT ?`,
        [...p, TETO],
      );
      const ids = rs.map((r) => num(r['id']));
      const avals = new Map<number, Linha[]>();
      if (ids.length > 0) {
        const as = await l.consultar(
          `SELECT a.*, ${LOGIN_DO_PROFISSIONAL('a.profissional_id', 'lp.estabelecimento_id')} AS autor,
                  ${LOGIN_DE('a.alterado_por')} AS alterado_login
             FROM lesao_pele_avaliacao a JOIN lesao_pele_paciente lp ON lp.id = a.lesao_pele_paciente_id
            WHERE a.lesao_pele_paciente_id IN (${marcadores(ids.length)}) AND a.excluido_em IS NULL
            ORDER BY a.lesao_pele_paciente_id, a.sequencia DESC`,
          ids,
        );
        for (const a of as) {
          const k = num(a['lesao_pele_paciente_id']);
          avals.set(k, [...(avals.get(k) ?? []), a]);
        }
      }
      const dadosDe = (a: Linha) => {
        const d = a['dados'] ?? a['observacao'];
        return d === null || d === undefined ? '' : typeof d === 'string' ? d : JSON.stringify(d);
      };
      const minuto = (v: unknown) => (civilDe(v, fuso) ?? '').slice(0, 16);
      return rs.map((r): LesaoRegistrada => {
        const as = avals.get(num(r['id'])) ?? [];
        const fichas = as.filter((a) => a['tipo_avaliacao'] === 'ficha');
        const fotos = as.filter((a) => a['tipo_avaliacao'] === 'foto');
        const curativos = as
          .filter((a) => a['tipo_avaliacao'] !== 'ficha' && a['tipo_avaliacao'] !== 'foto')
          .reverse();
        const inativacao = (origem: 'lesao' | 'curativo' | 'foto', x: Linha) => ({
          origem,
          registro: num(x['id']),
          tipo: 'inativacao' as const,
          desfecho: null,
          em: minuto(x['alterado_em']),
          motivo: textoOuNulo(x['motivo_inativacao']),
          usuario: texto(x['alterado_login']),
          criadoEm: civilDe(x['alterado_em'], fuso) ?? '',
        });
        const eventos: LesaoRegistrada['eventos'][number][] = [];
        if (texto(r['situacao']) === 'encerrada')
          eventos.push({
            origem: 'lesao',
            registro: num(r['id']),
            tipo: 'encerramento',
            desfecho: textoOuNulo(r['desfecho']),
            em: minuto(r['encerrada_em']),
            motivo: textoOuNulo(r['observacao_encerramento']),
            usuario: texto(r['autor']),
            criadoEm: civilDe(r['encerrada_em'], fuso) ?? '',
          });
        for (const a of curativos) if (booleano(a['inativada'])) eventos.push(inativacao('curativo', a));
        for (const a of fotos) if (booleano(a['inativada'])) eventos.push(inativacao('foto', a));
        if (booleano(r['inativada'])) eventos.push(inativacao('lesao', r));
        return {
          id: num(r['id']),
          paciente: num(r['paciente_id']),
          atendimento: num(r['atendimento_id']),
          unidade: textoOuNulo(r['unidade']),
          uti: booleano(r['uti']),
          autor: texto(r['autor']),
          criadoEm: civilDe(r['criado_em'], fuso) ?? '',
          versoes: fichas.map((a, i) => ({
            id: num(a['id']),
            versao: fichas.length - i,
            anterior: i + 1 < fichas.length ? num(fichas[i + 1]!['id']) : null,
            situacao: booleano(a['finalizada']) ? ('finalizada' as const) : ('rascunho' as const),
            dados: dadosDe(a),
            motivo: textoOuNulo(a['motivo_correcao']),
            autor: texto(a['autor']),
            criadoEm: civilDe(a['criado_em'], fuso) ?? '',
          })),
          curativos: curativos.map((a) => ({
            id: num(a['id']),
            anterior: numOuNulo(a['corrigida_lesao_pele_avaliacao_id']),
            realizadoEm: minuto(a['realizada_em']),
            dados: dadosDe(a),
            motivo: textoOuNulo(a['motivo_correcao']),
            autor: texto(a['autor']),
            criadoEm: civilDe(a['criado_em'], fuso) ?? '',
          })),
          fotos: fotos.map((a) => ({
            id: num(a['id']),
            curativo: lerJson<{ curativo?: number | null }>(a['dados'])?.curativo ?? null,
            anexo: num(a['anexo_prontuario_id']),
            tiradaEm: minuto(a['realizada_em']),
            usuario: texto(a['autor']),
          })),
          eventos,
        };
      });
    });
  }

  pacientesInternados(c: ContextoEscores, de: string, ate: string): Promise<number> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COUNT(DISTINCT paciente_id) AS n FROM internacao
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
            AND DATE(data_hora_entrada) <= ? AND (data_hora_alta IS NULL OR DATE(data_hora_alta) >= ?)`,
        [est, ate.slice(0, 10), de.slice(0, 10)],
      );
      return num(r?.['n']);
    });
  }

  lesaoDoCurativo(c: ContextoEscores, curativo: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT a.lesao_pele_paciente_id FROM lesao_pele_avaliacao a
           JOIN lesao_pele_paciente lp ON lp.id = a.lesao_pele_paciente_id AND lp.estabelecimento_id = ?
          WHERE a.id = ? AND a.excluido_em IS NULL`,
        [est, curativo],
      );
      return r ? num(r['lesao_pele_paciente_id']) : null;
    });
  }
}

function trrDe(r: Linha, fuso: string): AcionamentoTrrRegistrado {
  const inativo = r['situacao'] === 'inativado';
  return {
    id: num(r['id']),
    paciente: num(r['paciente_id']),
    atendimento: num(r['atendimento_id']),
    unidade: textoOuNulo(r['unidade']),
    uti: booleano(r['uti']),
    origem: r['aplicacao_escala_id'] === null ? 'manual' : 'escore',
    escore: numOuNulo(r['aplicacao_escala_id']),
    alertaEm: r['alerta_em'] ? (civilDe(r['alerta_em'], fuso) ?? '').slice(0, 16) : null,
    acionadoEm: (civilDe(r['acionado_em'], fuso) ?? '').slice(0, 16),
    motivo: textoOuNulo(r['motivo']),
    usuario: texto(r['login']),
    chegadaEm: r['chegada_em'] ? (civilDe(r['chegada_em'], fuso) ?? '').slice(0, 16) : null,
    desfecho: textoOuNulo(r['desfecho']),
    inativacao: inativo
      ? {
          motivo: texto(r['motivo_inativacao']),
          usuario: texto(r['alterado_login']),
          em: civilDe(r['alterado_em'], fuso) ?? '',
        }
      : null,
    escoreEstornado: r['escore_situacao'] === 'inativada',
    eventos: [],
  };
}

/** O gravador dos escores e registros assistenciais sobre a transação do Executor. */
function gravadorEscores(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorEscores {
  const fusoP = fusoDe(tx, est);
  const profissional = () => exigirProfissional(tx, tx.contexto, est);
  const quando = async (t: string) => instanteDe(t, await fusoP);
  const escala = async (codigo: string) => {
    const e = await tx.uma<{ id: number; numero_versao_atual: number; versao: number }>(
      'SELECT id, numero_versao_atual, versao FROM escala_clinica WHERE codigo = ? AND ativo',
      [codigo],
    );
    if (!e)
      throw recusa(
        'cadastro-incompleto',
        `O cadastro das escalas não tem "${codigo}": peça a carga ao administrador.`,
      );
    return e;
  };
  const avisar = async (
    avisos: readonly {
      login: string;
      tipo: string;
      gravidade: string;
      objetoChave: string;
      evento: string;
    }[],
  ) => {
    let n = 0;
    for (const a of avisos) {
      await gravarOutbox(tx, {
        estabelecimento: est,
        ponto: 'enfermagem.aviso.central',
        entidade: 'aviso_central',
        entidadeId: null,
        chave: `aviso:${a.evento}:${a.objetoChave}:${a.login}`.slice(0, 120),
        carga: {
          destinatario: a.login,
          tipo: a.tipo,
          gravidade: a.gravidade,
          evento: a.evento,
          objeto: a.objetoChave,
        },
        usuario: tx.contexto.usuario,
        agora: new Date(),
      });
      n += 1;
    }
    return n;
  };
  /** A internação é deste estabelecimento e do paciente (travada: serializa a classificação do turno). */
  const internacaoDoPaciente = async (reg: number, paciente: number) => {
    const [i] = await tx.consultarParaAtualizar<{ id: number; paciente_id: number }>(
      'SELECT id, paciente_id FROM internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [reg, est],
    );
    if (!i) throw recusa('internacao-inexistente', 'A internação não é deste estabelecimento.');
    if (Number(i.paciente_id) !== paciente)
      throw recusa('registro-de-outro-paciente', 'A internação não é deste paciente.');
    return Number(i.id);
  };
  const unidadeDoCodigo = async (codigo: string) => {
    const u = await tx.uma<{ id: number }>(
      'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
      [est, codigo],
    );
    if (!u) throw recusa('unidade-inexistente', 'A unidade de internação não é deste estabelecimento.');
    return Number(u.id);
  };
  /** O escore de Caprini ou Padua que sugere a profilaxia (travado: serializa a primeira decisão). */
  const escoreDaProfilaxia = async (id: number, paciente: number, exigeSugestao: boolean) => {
    const [e] = await tx.consultarParaAtualizar<Linha>(
      `SELECT a.id, a.paciente_id, a.atendimento_id, a.situacao, a.pontuacao_total, a.interpretacao, a.aplicado_em,
              (SELECT x.codigo FROM escala_clinica x WHERE x.id = a.escala_clinica_id) AS escala
         FROM aplicacao_escala a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
      [id, est],
    );
    if (!e) throw recusa('escore-inexistente', 'O escore não foi encontrado.');
    if (num(e['paciente_id']) !== paciente)
      throw recusa('escore-de-outro-paciente', 'O escore não é deste paciente.');
    const gatilho = lerJson<{ gatilho?: string }>(e['interpretacao'])?.gatilho;
    if (exigeSugestao && (!['caprini', 'padua'].includes(texto(e['escala'])) || gatilho !== 'profilaxia'))
      throw recusa('sem-profilaxia-sugerida', 'Este escore não sugere profilaxia de TEV.');
    if (e['situacao'] === 'inativada')
      throw recusa('escore-estornado', 'O escore foi estornado: não há profilaxia a decidir.');
    return e;
  };
  const avaliacaoDoEscore = async (escore: number) => {
    const a = await tx.uma<{ id: number }>(
      `SELECT id FROM profilaxia_tev_avaliacao WHERE estabelecimento_id = ? AND aplicacao_escala_id = ?
          AND situacao = 'registrada' AND excluido_em IS NULL ORDER BY id LIMIT 1`,
      [est, escore],
    );
    return a ? Number(a.id) : null;
  };
  const historicoDaAvaliacao = async (avaliacao: number) =>
    historicoDe(
      await tx.consultar<Linha>(
        `SELECT d.*, ${LOGIN_DE('d.usuario_id')} AS login FROM profilaxia_tev_decisao d
          WHERE d.profilaxia_tev_avaliacao_id = ? ORDER BY d.ocorrido_em, d.id`,
        [avaliacao],
      ),
      await fusoP,
    );
  const minutoDe = (v: unknown, fuso: string) => (civilDe(v, fuso) ?? '').slice(0, 16);
  const trrTravado = async (id: number) => {
    const [t] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, situacao, acionado_em, paciente_id FROM acionamento_resposta_rapida WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
    );
    if (!t) throw recusa('trr-inexistente', 'O acionamento não foi encontrado.');
    return t;
  };
  /** O último evento do tipo (o vigente se não inativado; a retificação é sempre a linha mais nova). */
  const ultimoEventoTrr = (trr: number, tipo: string) =>
    tx.uma<Linha>(
      `SELECT * FROM acionamento_resposta_rapida_evento WHERE acionamento_resposta_rapida_id = ? AND tipo = ?
          AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
      [trr, tipo],
    );
  /** O evento a corrigir ou inativar: deste estabelecimento, do acionamento ativo, e o vigente do tipo. */
  const eventoTrrVigente = async (id: number) => {
    const ev = await tx.uma<Linha>(
      'SELECT * FROM acionamento_resposta_rapida_evento WHERE id = ? AND excluido_em IS NULL',
      [id],
    );
    if (!ev) throw recusa('evento-inexistente', 'O registro do time não foi encontrado.');
    const t = await trrTravado(num(ev['acionamento_resposta_rapida_id'])).catch(() => {
      throw recusa('evento-inexistente', 'O registro do time não foi encontrado.');
    });
    if (t['situacao'] === 'inativado')
      throw recusa('trr-inativado', 'O acionamento foi inativado (lançado errado).');
    const u = await ultimoEventoTrr(num(t['id']), texto(ev['tipo']));
    if (!u || num(u['id']) !== id || booleano(u['inativado']))
      throw recusa('evento-nao-vigente', 'Este registro já foi corrigido ou inativado: abra o vigente.');
    return { ...u, acionado_em: t['acionado_em'], paciente_id: t['paciente_id'] } as Linha;
  };
  /** As colunas do acionamento espelham os eventos vigentes (chegada, desfecho e a situação). */
  const espelharTrr = async (trr: number) => {
    const t = await trrTravado(trr);
    if (t['situacao'] === 'inativado') return;
    const vigente = async (tipo: string) => {
      const u = await ultimoEventoTrr(trr, tipo);
      return u && !booleano(u['inativado']) ? u : null;
    };
    const chegada = await vigente('chegada');
    const desfecho = await vigente('desfecho');
    await tx.alterar('acionamento_resposta_rapida', trr, num(t['versao']), {
      chegada_em: chegada?.['ocorrido_em'] ?? null,
      desfecho: desfecho?.['desfecho'] ?? null,
      encerrado_em: desfecho ? (desfecho['ocorrido_em'] ?? new Date()) : null,
      situacao: desfecho ? 'encerrado' : chegada ? 'em_atendimento' : 'acionado',
    });
  };
  /** O item do cadastro da lesão pelo código (ativo); o que falta é pedido ao administrador. */
  const doCadastro = async (tabela: string, codigo: string, nome: string) => {
    const r = await tx.uma<{ id: number }>(`SELECT id FROM ${tabela} WHERE codigo = ? AND ativo`, [codigo]);
    if (!r)
      throw recusa(
        'cadastro-incompleto',
        `O cadastro não tem o ${nome} "${codigo}": peça a carga ao administrador.`,
      );
    return Number(r.id);
  };
  const colunasLesao = async (c: {
    tipo: string;
    regiao: string;
    estagio: string | null;
    presenteNaAdmissao: boolean;
    identificadaEm: string;
  }) => ({
    tipo_lesao_pele_id: await doCadastro('tipo_lesao_pele', c.tipo, 'tipo de lesão'),
    regiao_corporal_id: await doCadastro('regiao_corporal', c.regiao, 'região do corpo'),
    estagio_lesao_pele_id: c.estagio
      ? await doCadastro('estagio_lesao_pele', c.estagio, 'estágio da lesão')
      : null,
    presente_na_admissao: c.presenteNaAdmissao,
    identificada_em: await quando(c.identificadaEm),
  });
  const conferirDadosLesao = (dados: string) => {
    if (dados.length > 2000) throw recusa('ficha-grande', 'A ficha passa do tamanho máximo.');
    try {
      JSON.parse(dados);
    } catch {
      throw recusa('dados-invalidos', 'Os campos da ficha chegaram fora do formato JSON.');
    }
  };
  const lesaoTravada = async (id: number) => {
    const [l] = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM lesao_pele_paciente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
    );
    if (!l) throw recusa('lesao-inexistente', 'A lesão não foi encontrada.');
    return l;
  };
  const lesaoAberta = async (id: number) => {
    const l = await lesaoTravada(id);
    if (booleano(l['inativada'])) throw recusa('lesao-inativada', 'A lesão foi inativada (lançada errada).');
    if (l['situacao'] === 'encerrada')
      throw recusa('lesao-encerrada', 'O acompanhamento da lesão foi encerrado.');
    return l;
  };
  /**
   * O estágio atual da lesão é o da última linha lançada (pela sequência), vigente, não inativada e com estágio (ficha,
   * curativo ou reavaliação); sem nenhuma, fica sem estágio. Recalculado a cada curativo, correção e inativação.
   */
  const recalcularEstagioLesao = async (lesao: number) => {
    const l = await lesaoTravada(lesao);
    const u = await tx.uma<Linha>(
      `SELECT estagio_lesao_pele_id FROM lesao_pele_avaliacao
        WHERE lesao_pele_paciente_id = ? AND tipo_avaliacao IN ('ficha', 'curativo', 'reavaliacao') AND vigente
          AND NOT inativada AND estagio_lesao_pele_id IS NOT NULL AND excluido_em IS NULL
        ORDER BY sequencia DESC LIMIT 1`,
      [lesao],
    );
    const estagio = u ? num(u['estagio_lesao_pele_id']) : null;
    if (numOuNulo(l['estagio_lesao_pele_id']) !== estagio)
      await tx.alterar('lesao_pele_paciente', lesao, num(l['versao']), { estagio_lesao_pele_id: estagio });
  };
  /** A sequência seguinte das linhas da lesão (a lesão está travada pela transação). */
  const proximaSequencia = async (lesao: number) =>
    num(
      (
        await tx.uma<Linha>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM lesao_pele_avaliacao WHERE lesao_pele_paciente_id = ?',
          [lesao],
        )
      )?.['n'],
    );
  /** O curativo ou a foto deste estabelecimento (com a lesão travada). */
  const avaliacaoDaLesao = async (id: number, origem: 'curativo' | 'foto') => {
    const a = await tx.uma<Linha>(
      `SELECT a.*, lp.paciente_id FROM lesao_pele_avaliacao a JOIN lesao_pele_paciente lp ON lp.id = a.lesao_pele_paciente_id
        WHERE a.id = ? AND lp.estabelecimento_id = ? AND a.excluido_em IS NULL
          AND ${origem === 'foto' ? "a.tipo_avaliacao = 'foto'" : "a.tipo_avaliacao IN ('curativo', 'reavaliacao')"}`,
      [id, est],
    );
    if (!a)
      throw recusa(
        origem === 'foto' ? 'foto-inexistente' : 'curativo-inexistente',
        origem === 'foto' ? 'A foto não foi encontrada.' : 'O curativo não foi encontrado.',
      );
    await lesaoTravada(num(a['lesao_pele_paciente_id']));
    const [k] = await tx.consultarParaAtualizar<Linha>('SELECT * FROM lesao_pele_avaliacao WHERE id = ?', [
      id,
    ]);
    return { ...k, paciente_id: a['paciente_id'] } as Linha;
  };
  /** Programa a reavaliação (a mesma chave do paciente e da escala é reconhecida: devolve a já programada). */
  const programar = async (r: {
    paciente: number;
    reg: number | null;
    escala: string;
    motivo: string;
    chave: string;
    devidaEm: string;
    prazoEm: string;
    observacao?: string | null;
  }): Promise<{ id: number; nova: boolean }> => {
    const chave = chaveReavaliacao(r.paciente, r.escala, r.chave);
    const ja = await tx.uma<{ id: number }>(
      'SELECT id FROM reavaliacao_escala WHERE estabelecimento_id = ? AND chave = ? AND excluido_em IS NULL',
      [est, chave],
    );
    if (ja) return { id: Number(ja.id), nova: false };
    const devida = await quando(r.devidaEm);
    const prazo = await quando(r.prazoEm);
    if (prazo.getTime() < devida.getTime())
      throw recusa('prazo-invalido', 'O prazo da reavaliação não pode ser anterior à hora devida.');
    const motivo = MOTIVO_REAVALIACAO_BANCO[r.motivo];
    if (!motivo) throw recusa('motivo-invalido', 'O motivo da reavaliação não é conhecido.');
    const id = await tx.incluir('reavaliacao_escala', {
      estabelecimento_id: est,
      paciente_id: r.paciente,
      internacao_id: r.reg === null ? null : await internacaoDoPaciente(r.reg, r.paciente),
      escala_clinica_id: Number((await escala(r.escala)).id),
      motivo,
      chave,
      devida_em: devida,
      prazo_em: prazo,
      situacao: 'pendente',
      observacao: r.observacao?.trim().slice(0, 300) || null,
    });
    return { id, nova: true };
  };
  const contencaoTravada = async (id: number) => {
    const [c] = await tx.consultarParaAtualizar<Linha>(
      'SELECT id, versao, situacao, inicio_em, vence_em FROM contencao_paciente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [id, est],
    );
    if (!c) throw recusa('contencao-inexistente', 'A ordem de contenção não foi encontrada.');
    return c;
  };
  return {
    async registrarEscore(r) {
      // Os ids vêm da tela: o atendimento é deste estabelecimento e do paciente do escore (e de cada sinal).
      await conferirAtendimento(tx, est, r.escore.atendimento ?? null, r.escore.paciente);
      for (const s of r.sinais) {
        if (s.paciente !== r.escore.paciente)
          throw recusa('sinal-de-outro-paciente', 'Os sinais do escore são do mesmo paciente.');
        if (s.atendimento !== null && s.atendimento !== r.escore.atendimento)
          await conferirAtendimento(tx, est, s.atendimento, s.paciente);
      }
      const prof = await profissional();
      let afericao: number | null = null;
      const sinais: number[] = [];
      for (const s of r.sinais) {
        const pv = await tx.uma<{ id: number }>('SELECT id FROM parametro_vital WHERE codigo = ? AND ativo', [
          s.tipo,
        ]);
        if (!pv) throw recusa('cadastro-incompleto', `O cadastro dos parâmetros vitais não tem "${s.tipo}".`);
        afericao ??= await tx.incluir('afericao', {
          estabelecimento_id: est,
          paciente_id: s.paciente,
          atendimento_id: s.atendimento,
          profissional_id: prof,
          aferido_em: await quando(s.horaReal),
          fonte: s.origemOffline ? 'dispositivo' : 'manual',
          finalizada: true,
        });
        sinais.push(
          await tx.incluir('afericao_valor', {
            afericao_id: afericao,
            sequencia: sinais.length + 1,
            parametro_vital_id: Number(pv.id),
            valor_numerico: s.valor,
            nivel_alerta: s.foraDaFaixa ? 'atencao' : 'normal',
          }),
        );
      }
      const e = r.escore;
      if (afericao === null && e.sinalVital)
        afericao = await afericaoDoSinal(tx, est, e.sinalVital, e.paciente);
      const esc = await escala(e.escala);
      // Até as colunas do pedido (faixa, gatilho, versão da regra), a interpretação guarda só esses quatro campos, que
      // cabem na coluna; nunca um JSON cortado. Os cuidados decididos vão aos dados da trilha da gravação.
      const interpretacao = JSON.stringify({
        faixa: e.faixa,
        gatilho: e.gatilho,
        versaoRegra: e.versaoRegra,
        suspeitaInfeccao: e.suspeitaInfeccao,
      });
      if (interpretacao.length > 300)
        throw recusa(
          'interpretacao-longa',
          'A faixa do escore passa do tamanho guardado: confira a regra da escala.',
        );
      if (r.cuidados.length > 0) anotacao.dados = { ...(anotacao.dados ?? {}), cuidados: r.cuidados };
      const id = await tx.incluir('aplicacao_escala', {
        estabelecimento_id: est,
        paciente_id: e.paciente,
        atendimento_id: e.atendimento,
        escala_clinica_id: Number(esc.id),
        afericao_id: afericao,
        profissional_id: prof,
        aplicado_em: await quando(e.aferidoEm),
        situacao: 'finalizada',
        pontuacao_total: e.total,
        interpretacao,
      });
      const variaveis = await tx.consultar<{ id: number; identificador: string }>(
        'SELECT id, identificador FROM escala_clinica_variavel WHERE escala_clinica_id = ? AND excluido_em IS NULL AND ativo',
        [Number(esc.id)],
      );
      const porId = new Map(variaveis.map((v) => [String(v.identificador), Number(v.id)]));
      let seq = 0;
      for (const [k, pontos] of Object.entries(e.itens)) {
        const v = porId.get(k);
        if (v === undefined)
          throw recusa(
            'cadastro-incompleto',
            `A escala "${e.escala}" não tem a variável "${k}" no cadastro.`,
          );
        await tx.incluir('aplicacao_escala_item', {
          aplicacao_escala_id: id,
          sequencia: ++seq,
          escala_clinica_variavel_id: v,
          pontos,
        });
      }
      // O escore cumpre as reavaliações pendentes da escala já devidas na hora da aferição.
      if (r.cumprir) {
        const feito = await quando(r.cumprir.quando);
        const pendentes = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
          `SELECT r.id, r.versao FROM reavaliacao_escala r JOIN escala_clinica e ON e.id = r.escala_clinica_id
            WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND e.codigo = ? AND r.situacao = 'pendente'
              AND r.devida_em <= ? AND r.excluido_em IS NULL`,
          [est, e.paciente, r.cumprir.escala, feito],
        );
        for (const p of pendentes)
          await tx.alterar('reavaliacao_escala', Number(p.id), Number(p.versao), {
            situacao: 'cumprida',
            cumprida_em: feito,
            aplicacao_escala_id: id,
          });
      }
      // As reavaliações programadas pelo escore (NEWS2 de 5 ou mais: mudança de quadro); a chave repetida é ignorada.
      // O escore, os sinais e os avisos nunca são recusados por causa delas: a escala que falta no cadastro deixa o
      // pedido na fila de saída (enfermagem.reavaliacao.sem-cadastro), para o administrador carregar a escala.
      for (const p of r.programar) {
        const chave = p.chave(id);
        const existe = await tx.uma('SELECT id FROM escala_clinica WHERE codigo = ? AND ativo', [p.escala]);
        if (existe) {
          await programar({ ...p, chave });
          continue;
        }
        await gravarOutbox(tx, {
          estabelecimento: est,
          ponto: 'enfermagem.reavaliacao.sem-cadastro',
          entidade: 'aplicacao_escala',
          entidadeId: id,
          chave: `reavaliacao:${p.escala}:${chave}`.slice(0, 120),
          carga: {
            escore: id,
            paciente: p.paciente,
            internacao: p.reg,
            escala: p.escala,
            motivo: p.motivo,
            chave,
          },
          usuario: tx.contexto.usuario,
          agora: new Date(),
        });
      }
      const avisos = await avisar(r.avisos.map((a) => a(id)));
      return { id, sinais, avisos };
    },
    async programarReavaliacao(r) {
      const p = await programar(r);
      if (!p.nova) throw recusa('ja-programada', 'Esta reavaliação já está programada para o paciente.');
      return p.id;
    },
    async dispensarReavaliacao(d) {
      const [r] = await tx.consultarParaAtualizar<{
        id: number;
        versao: number;
        situacao: string;
        paciente_id: number;
      }>(
        'SELECT id, versao, situacao, paciente_id FROM reavaliacao_escala WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [d.id, est],
      );
      if (!r) throw recusa('nao-encontrado', 'A reavaliação não existe neste estabelecimento.');
      if (r.situacao !== 'pendente')
        throw recusa('reavaliacao-encerrada', 'Esta reavaliação já foi cumprida ou dispensada.');
      const motivo = d.motivo.trim();
      if (!motivo) throw recusa('motivo-obrigatorio', 'A dispensa exige o motivo.');
      await tx.alterar('reavaliacao_escala', Number(r.id), Number(r.versao), {
        situacao: 'dispensada',
        cumprida_em: await quando(d.quando),
        motivo_dispensa: motivo.slice(0, 300),
      });
      return { paciente: Number(r.paciente_id) };
    },
    async publicarRegra(p) {
      const esc = await escala(p.escala);
      const numero = Number(esc.numero_versao_atual) + 1;
      const agora = new Date();
      await tx.executar(
        'UPDATE escala_clinica_versao SET vigencia_fim = ? WHERE escala_clinica_id = ? AND vigencia_fim IS NULL',
        [agora, Number(esc.id)],
      );
      const id = await tx.incluir('escala_clinica_versao', {
        escala_clinica_id: Number(esc.id),
        numero_versao: numero,
        vigencia_inicio: agora,
        operacao: 'inclusao',
        dados: JSON.stringify({ faixas: p.faixas, impressao: p.impressao, notas: p.notas }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
      });
      await tx.alterar('escala_clinica', Number(esc.id), Number(esc.versao), { numero_versao_atual: numero });
      return { id, versao: numero };
    },
    async classificar(x) {
      const reg = await internacaoDoPaciente(x.reg, x.paciente);
      const unidade = await unidadeDoCodigo(x.unidade);
      const ja = await tx.uma(
        `SELECT id FROM classificacao_paciente WHERE estabelecimento_id = ? AND paciente_id = ? AND internacao_id = ?
            AND data_referencia = ? AND turno = ? AND instrumento = ? AND situacao = 'valida' AND excluido_em IS NULL`,
        [est, x.paciente, reg, x.data.slice(0, 10), x.turno, x.instrumento],
      );
      if (ja)
        throw recusa(
          'ja-classificado',
          'Este paciente já foi classificado por este instrumento neste turno.',
        );
      // A versão do instrumento vai à trilha da gravação (a tabela guarda os itens, o total e a categoria).
      anotacao.dados = { ...(anotacao.dados ?? {}), versaoInstrumento: x.versao };
      return tx.incluir('classificacao_paciente', {
        estabelecimento_id: est,
        paciente_id: x.paciente,
        internacao_id: reg,
        unidade_internacao_id: unidade,
        data_referencia: x.data.slice(0, 10),
        turno: x.turno,
        instrumento: x.instrumento,
        itens: JSON.stringify(x.itens),
        total: x.total,
        categoria: x.categoria.slice(0, 30),
        horas_24h: x.horas24h,
        situacao: 'valida',
      });
    },
    async registrarIndice(x) {
      // A mortalidade estimada (fração) é guardada em percentual com duas casas: a precisão da fração de quatro casas.
      return tx.incluir('indice_gravidade_uti', {
        estabelecimento_id: est,
        paciente_id: x.paciente,
        internacao_id: x.reg === null ? null : await internacaoDoPaciente(x.reg, x.paciente),
        indice: x.indice,
        variaveis: JSON.stringify({ valores: x.variaveis, configuracao: x.impressaoConfig }),
        pontuacao: x.pontuacao,
        categoria_diagnostica: x.categoria,
        tipo_admissao: x.tipoAdmissao?.slice(0, 20) ?? null,
        mortalidade_estimada: x.mortalidade === null ? null : Math.round(x.mortalidade * 10_000) / 100,
        coletado_em: await quando(x.coletadoEm),
        situacao: 'registrado',
      });
    },
    async estornarRegistro(r) {
      if (r.origem !== 'escore') {
        const tabela = r.origem === 'classificacao' ? 'classificacao_paciente' : 'indice_gravidade_uti';
        const estornada = r.origem === 'classificacao' ? 'estornada' : 'estornado';
        const [x] = await tx.consultarParaAtualizar<{
          id: number;
          versao: number;
          situacao: string;
          paciente_id: number;
        }>(
          `SELECT id, versao, situacao, paciente_id FROM ${tabela} WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [r.id, est],
        );
        if (!x) throw recusa('registro-inexistente', 'O registro não foi encontrado.');
        if (Number(x.paciente_id) !== r.paciente)
          throw recusa('registro-de-outro-paciente', 'O registro não é deste paciente.');
        if (x.situacao === estornada) throw recusa('registro-ja-estornado', 'O registro já foi estornado.');
        const motivo = r.motivo.trim();
        if (!motivo) throw recusa('motivo-obrigatorio', 'O estorno exige o motivo.');
        await tx.alterar(tabela, r.id, Number(x.versao), {
          situacao: estornada,
          ...(r.origem === 'classificacao' ? { motivo_estorno: motivo.slice(0, 300) } : {}),
        });
        anotacao.motivo = motivo;
        anotacao.dados = { estorno: { tipo: r.tipo } };
        return r.id;
      }
      const [a] = await tx.consultarParaAtualizar<{ id: number; versao: number; situacao: string }>(
        'SELECT id, versao, situacao FROM aplicacao_escala WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.id, est],
      );
      if (!a) throw recusa('registro-inexistente', 'O escore não foi encontrado.');
      if (a.situacao === 'inativada') throw recusa('registro-estornado', 'O escore já foi estornado.');
      const motivo = r.motivo.trim();
      if (!motivo) throw recusa('motivo-obrigatorio', 'O estorno exige o motivo.');
      await tx.alterar('aplicacao_escala', r.id, Number(a.versao), { situacao: 'inativada' });
      // A reavaliação cumprida por este escore fica (a baixa é histórica) e volta numa linha nova: cumprida pelo escore
      // válido seguinte da mesma escala, aferido depois da hora devida, ou pendente outra vez.
      const cumpridas = await tx.consultar<Linha>(
        `SELECT r.*, e.codigo AS escala FROM reavaliacao_escala r JOIN escala_clinica e ON e.id = r.escala_clinica_id
          WHERE r.estabelecimento_id = ? AND r.aplicacao_escala_id = ? AND r.situacao = 'cumprida' AND r.excluido_em IS NULL`,
        [est, r.id],
      );
      for (const c of cumpridas) {
        const sub = await tx.uma<{ id: number; aplicado_em: Date }>(
          `SELECT id, aplicado_em FROM aplicacao_escala WHERE estabelecimento_id = ? AND paciente_id = ?
              AND escala_clinica_id = ? AND id <> ? AND situacao = 'finalizada' AND aplicado_em >= ? AND excluido_em IS NULL
            ORDER BY aplicado_em, id LIMIT 1`,
          [est, c['paciente_id'], c['escala_clinica_id'], r.id, c['devida_em']],
        );
        await tx.incluir('reavaliacao_escala', {
          estabelecimento_id: est,
          paciente_id: c['paciente_id'],
          internacao_id: c['internacao_id'],
          escala_clinica_id: c['escala_clinica_id'],
          motivo: c['motivo'],
          chave: chaveReavaliacao(
            num(c['paciente_id']),
            texto(c['escala']),
            `${texto(c['chave'])}:r${num(c['id'])}`,
          ),
          devida_em: c['devida_em'],
          prazo_em: c['prazo_em'],
          situacao: sub ? 'cumprida' : 'pendente',
          cumprida_em: sub ? sub.aplicado_em : null,
          aplicacao_escala_id: sub ? Number(sub.id) : null,
          observacao: c['observacao'] ?? null,
        });
      }
      // Até a coluna motivo_inativacao do pedido, o motivo, o alerta reavaliado e o escore mantido ficam na trilha.
      anotacao.motivo = motivo;
      anotacao.dados = { estorno: { tipo: r.tipo, alerta: r.alerta, escoreMantem: r.escoreMantem } };
      return r.id;
    },
    async decidirProfilaxia(d) {
      const e = await escoreDaProfilaxia(d.escore, d.paciente, true);
      const motivo = d.motivo?.trim() || null;
      if (d.decisao === 'nao-prescrita' && !motivo)
        throw recusa('motivo-obrigatorio', 'A profilaxia não prescrita exige o motivo.');
      const av = await avaliacaoDoEscore(d.escore);
      if (av !== null) {
        // Depois da anulação, a nova decisão entra como retificação (a anulada fica no histórico).
        const h = await historicoDaAvaliacao(av);
        if (h.at(-1)?.decisao !== 'anulada')
          throw recusa('profilaxia-ja-decidida', 'A profilaxia deste escore já foi decidida.');
        return tx.incluir('profilaxia_tev_decisao', {
          profilaxia_tev_avaliacao_id: av,
          operacao: 'retificacao',
          decisao: DECISAO_BANCO(d.decisao),
          justificativa: 'Nova decisão depois da anulação da anterior.',
          dados: JSON.stringify({
            decisao: d.decisao,
            motivo: d.decisao === 'nao-prescrita' ? motivo : null,
          }),
          ocorrido_em: new Date(),
          usuario_id: tx.contexto.usuario,
        });
      }
      const faixa = lerJson<{ faixa?: string }>(e['interpretacao'])?.faixa ?? '';
      const escala = texto(e['escala']);
      // A regra (perfil, risco e profilaxia indicada) é do domínio; faixa desconhecida é recusada, nunca presumida.
      const regra = avaliacaoTevDoEscore(escala, faixa);
      if (!regra.ok) throw recusa(regra.codigo, regra.mensagem);
      const sugerida = regra.avaliacao;
      const avaliacao = await tx.incluir('profilaxia_tev_avaliacao', {
        estabelecimento_id: est,
        paciente_id: num(e['paciente_id']),
        atendimento_id: num(e['atendimento_id']),
        profissional_id: await profissional(),
        avaliado_em: e['aplicado_em'],
        perfil: sugerida.perfil,
        escala,
        aplicacao_escala_id: d.escore,
        pontuacao: numOuNulo(e['pontuacao_total']),
        risco_tev: sugerida.risco,
        profilaxia_indicada: sugerida.indicada,
        metodo_mecanico: sugerida.mecanico,
        situacao: 'registrada',
      });
      return tx.incluir('profilaxia_tev_decisao', {
        profilaxia_tev_avaliacao_id: avaliacao,
        operacao: 'decisao',
        decisao: DECISAO_BANCO(d.decisao),
        justificativa: d.decisao === 'nao-prescrita' ? motivo!.slice(0, 500) : null,
        dados: JSON.stringify({ decisao: d.decisao, motivo: d.decisao === 'nao-prescrita' ? motivo : null }),
        ocorrido_em: new Date(),
        usuario_id: tx.contexto.usuario,
      });
    },
    async retificarProfilaxia(r) {
      await escoreDaProfilaxia(r.escore, r.paciente, false);
      const av = await avaliacaoDoEscore(r.escore);
      const h = av === null ? [] : await historicoDaAvaliacao(av);
      const v = h.at(-1);
      if (av === null || !v)
        throw recusa('profilaxia-nao-decidida', 'A profilaxia deste escore ainda não foi decidida.');
      if (v.decisao === 'anulada')
        throw recusa(
          'profilaxia-anulada',
          'A decisão foi anulada: a pendência está aberta para uma nova decisão.',
        );
      if (v.autor !== tx.contexto.usuario)
        throw recusa('so-o-autor', 'Só quem decidiu corrige a decisão (fato novo, com a justificativa).');
      const motivo = r.decisao === 'nao-prescrita' ? r.motivo?.trim() || null : null;
      if (r.decisao === 'nao-prescrita' && !motivo)
        throw recusa('motivo-obrigatorio', 'A profilaxia não prescrita exige o motivo.');
      if (r.decisao === v.decisao && motivo === v.motivo)
        throw recusa('sem-mudanca', 'Nada mudou em relação à decisão vigente.');
      const justificativa = r.justificativa.replace(/\s+/g, ' ').trim();
      if (!justificativa) throw recusa('motivo-obrigatorio', 'A correção da decisão exige a justificativa.');
      return tx.incluir('profilaxia_tev_decisao', {
        profilaxia_tev_avaliacao_id: av,
        operacao: 'retificacao',
        // A anulação guarda na coluna a decisão anulada (o CHECK do modelo); o contrato vai em `dados`.
        decisao: DECISAO_BANCO(r.decisao === 'anulada' ? v.decisao : r.decisao),
        justificativa: justificativa.slice(0, 500),
        dados: JSON.stringify({ decisao: r.decisao, motivo }),
        ocorrido_em: new Date(),
        usuario_id: tx.contexto.usuario,
      });
    },
    async prescreverContencao(o) {
      const prof = await profissional();
      const inicio = await quando(o.inicio);
      if (o.anterior !== null) {
        const a = await contencaoTravada(o.anterior);
        if (!['ativa', 'vencida'].includes(texto(a['situacao'])))
          throw recusa('contencao-encerrada', 'A ordem anterior já foi retirada, renovada ou inativada.');
        await tx.alterar('contencao_paciente', o.anterior, num(a['versao']), { situacao: 'renovada' });
      }
      const membros = Object.fromEntries(
        Object.entries(MEMBROS).map(([m, col]) => [col, o.membros.includes(m)]),
      );
      const id = await tx.incluir('contencao_paciente', {
        estabelecimento_id: est,
        atendimento_id: o.atendimento,
        paciente_id: o.paciente,
        prescritor_profissional_id: prof,
        motivo: MOTIVO_BANCO[o.motivo] ?? o.motivo,
        indicacao: o.justificativa,
        tipo: o.tipo,
        ...membros,
        prazo_horas: o.prazoHoras,
        intervalo_checagem_minutos: o.intervaloMinutos,
        inicio_em: inicio,
        vence_em: new Date(inicio.getTime() + o.prazoHoras * 3_600_000),
        anterior_contencao_paciente_id: o.anterior,
        situacao: 'ativa',
      });
      let seq = 0;
      for (const h of o.horarios)
        await tx.incluir('contencao_paciente_avaliacao', {
          contencao_paciente_id: id,
          sequencia: ++seq,
          previsto_em: await quando(h),
          situacao: 'pendente',
        });
      return id;
    },
    async checarContencao(x) {
      const c = await contencaoTravada(x.contencao);
      if (!['ativa', 'vencida'].includes(texto(c['situacao'])))
        throw recusa('contencao-encerrada', 'A ordem de contenção já foi encerrada.');
      const [h] = await tx.consultarParaAtualizar<{ id: number; versao: number; situacao: string }>(
        `SELECT id, versao, situacao FROM contencao_paciente_avaliacao
          WHERE contencao_paciente_id = ? AND previsto_em = ? AND excluido_em IS NULL`,
        [x.contencao, await quando(x.previsto)],
      );
      if (!h) throw recusa('horario-inexistente', 'O horário da checagem não é desta ordem.');
      if (h.situacao === 'realizada') throw recusa('horario-ja-checado', 'Este horário já foi checado.');
      await tx.alterar('contencao_paciente_avaliacao', Number(h.id), Number(h.versao), {
        avaliado_em: new Date(),
        profissional_id: await profissional(),
        ...Object.fromEntries(ACHADOS.map((a) => [`achado_${a}`, x.achados[a] ?? null])),
        situacao: 'realizada',
        observacao: x.observacao,
      });
      return Number(h.id);
    },
    async adendoChecagemContencao(x) {
      const h = await tx.uma<{ id: number; situacao: string; profissional_id: number | null }>(
        `SELECT a.id, a.situacao, a.profissional_id FROM contencao_paciente_avaliacao a
           JOIN contencao_paciente c ON c.id = a.contencao_paciente_id
          WHERE a.contencao_paciente_id = ? AND c.estabelecimento_id = ? AND a.previsto_em = ? AND a.excluido_em IS NULL`,
        [x.contencao, est, await quando(x.previsto)],
      );
      if (!h || h.situacao !== 'realizada')
        throw recusa('checagem-inexistente', 'Este horário ainda não foi checado: não há o que corrigir.');
      if (Number(h.profissional_id) !== (await profissional()))
        throw recusa(
          'so-o-autor',
          'Só quem registrou a checagem faz o adendo (correção do próprio registro).',
        );
      const motivo = x.motivo.trim();
      if (!motivo) throw recusa('motivo-obrigatorio', 'O adendo exige o motivo.');
      return tx.incluir('contencao_paciente_avaliacao_adendo', {
        contencao_paciente_avaliacao_id: Number(h.id),
        texto: motivo.slice(0, 2000),
        dados: JSON.stringify({ achados: x.achados, observacao: x.observacao }),
        ocorrido_em: new Date(),
        usuario_id: tx.contexto.usuario,
      });
    },
    async encerrarContencao(x) {
      const c = await contencaoTravada(x.contencao);
      if (!['ativa', 'vencida'].includes(texto(c['situacao'])))
        throw recusa('contencao-encerrada', 'A ordem de contenção já foi encerrada.');
      await tx.alterar('contencao_paciente', x.contencao, num(c['versao']), {
        situacao: x.tipo === 'retirada' ? 'retirada' : 'inativada',
        retirada_em: new Date(),
        retirada_profissional_id: await profissional(),
        motivo_retirada: x.motivo.slice(0, 300),
      });
      return x.contencao;
    },
    avisar: async (avisos) =>
      avisar(
        avisos.map((a) => ({
          login: a.login,
          tipo: a.tipo,
          gravidade: a.gravidade,
          objetoChave: a.objetoChave,
          evento: a.evento,
        })),
      ),
    async acionarTrr(a) {
      const alerta = a.escore
        ? await tx.uma<{ aplicado_em: Date }>(
            'SELECT aplicado_em FROM aplicacao_escala WHERE id = ? AND estabelecimento_id = ?',
            [a.escore, est],
          )
        : null;
      if (a.escore && !alerta) throw recusa('escore-inexistente', 'O escore do alerta não foi encontrado.');
      const id = await tx.incluir('acionamento_resposta_rapida', {
        estabelecimento_id: est,
        paciente_id: a.paciente,
        atendimento_id: a.atendimento,
        aplicacao_escala_id: a.escore,
        motivo: a.motivo ?? (a.escore ? null : 'Acionamento manual'),
        alerta_em: alerta?.aplicado_em ?? null,
        acionado_em: await quando(a.acionadoEm),
        acionado_por_usuario_id: tx.contexto.usuario,
        situacao: 'acionado',
      });
      return { id, alertaEm: alerta ? (civilDe(alerta.aplicado_em, await fusoP) ?? '').slice(0, 16) : null };
    },
    async eventoTrr(x) {
      const t = await trrTravado(x.trr);
      if (t['situacao'] === 'inativado')
        throw recusa('trr-inativado', 'O acionamento foi inativado (lançado errado).');
      const em = await quando(x.em);
      const fuso = await fusoP;
      if (minutoDe(em, fuso) < minutoDe(t['acionado_em'], fuso))
        throw recusa('antes-do-acionamento', 'A hora é anterior ao acionamento do time.');
      if (x.tipo === 'desfecho' && !x.desfecho)
        throw recusa('desfecho-obrigatorio', 'O desfecho do atendimento do time é obrigatório.');
      const u = await ultimoEventoTrr(x.trr, x.tipo);
      if (u && !booleano(u['inativado']))
        throw recusa(
          'evento-ja-registrado',
          x.tipo === 'chegada' ? 'A chegada do time já foi registrada.' : 'O desfecho já foi registrado.',
        );
      const id = await tx.incluir('acionamento_resposta_rapida_evento', {
        acionamento_resposta_rapida_id: x.trr,
        tipo: x.tipo,
        ocorrido_em: em,
        desfecho: x.tipo === 'desfecho' ? x.desfecho : null,
        inativado: false,
      });
      await espelharTrr(x.trr);
      return id;
    },
    async gravarFichaPcr(f) {
      try {
        JSON.parse(f.dados);
      } catch {
        throw recusa('dados-invalidos', 'Os campos da ficha da parada chegaram fora do formato JSON.');
      }
      await conferirAtendimento(tx, est, f.atendimento, f.paciente);
      let versao = 1;
      let unidade: number | null = f.unidade ? await unidadeDoCodigo(f.unidade) : null;
      let uti = f.uti;
      let motivo: string | null = null;
      if (f.anterior !== null) {
        const [a] = await tx.consultarParaAtualizar<Linha>(
          'SELECT * FROM parada_cardiorrespiratoria_ficha WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [f.anterior, est],
        );
        if (!a) throw recusa('pcr-inexistente', 'A ficha da parada não foi encontrada.');
        if (num(a['atendimento_id']) !== f.atendimento)
          throw recusa('pcr-de-outro-atendimento', 'A ficha é de outro atendimento.');
        if (num(a['criado_por']) !== tx.contexto.usuario)
          throw recusa('so-o-autor', 'Só o autor da ficha a continua ou corrige.');
        if (booleano(a['inativada']))
          throw recusa('pcr-inativada', 'A ficha foi inativada (lançada errada): relance uma ficha nova.');
        if (
          await tx.uma('SELECT id FROM parada_cardiorrespiratoria_ficha WHERE anterior_ficha_id = ?', [
            f.anterior,
          ])
        )
          throw recusa('versao-desatualizada', 'Há uma versão mais nova da ficha: abra a versão atual.');
        if (a['situacao'] === 'finalizada') {
          motivo = (f.motivo ?? '').replace(/\s+/g, ' ').trim();
          if (motivo.length < 10)
            throw recusa('motivo-obrigatorio', 'A correção da ficha finalizada exige a justificativa.');
          if (f.situacao !== 'finalizada')
            throw recusa(
              'correcao-finaliza',
              'A correção da ficha finalizada é gravada finalizada (a ficha não volta a rascunho).',
            );
        }
        versao = num(a['numero_versao']) + 1;
        unidade = numOuNulo(a['unidade_internacao_id']);
        uti = booleano(a['em_uti']);
      } else if (f.trr !== null) {
        const [t] = await tx.consultarParaAtualizar<Linha>(
          `SELECT t.id, t.atendimento_id, t.situacao,
                  (SELECT o.unidade_internacao_id FROM ocupacao_leito o JOIN internacao i ON i.id = o.internacao_id
                    WHERE i.atendimento_id = t.atendimento_id AND o.excluido_em IS NULL AND o.data_hora_inicio <= t.acionado_em
                    ORDER BY o.data_hora_inicio DESC LIMIT 1) AS unidade_internacao_id,
                  ${UTI_NO_INSTANTE('t.atendimento_id', 't.acionado_em')} AS em_uti
             FROM acionamento_resposta_rapida t WHERE t.id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL`,
          [f.trr, est],
        );
        if (!t || num(t['atendimento_id']) !== f.atendimento)
          throw recusa('trr-de-outro-atendimento', 'O acionamento do time é de outro atendimento.');
        if (t['situacao'] === 'inativado')
          throw recusa('trr-inativado', 'O acionamento foi inativado (lançado errado).');
        const aberta = await tx.uma(
          `SELECT p.id FROM parada_cardiorrespiratoria_ficha p
            WHERE p.acionamento_resposta_rapida_id = ? AND NOT p.inativada AND p.excluido_em IS NULL
              AND NOT EXISTS (SELECT 1 FROM parada_cardiorrespiratoria_ficha s WHERE s.anterior_ficha_id = p.id)`,
          [f.trr],
        );
        if (aberta)
          throw recusa('pcr-ja-aberta', 'Este acionamento já tem a ficha da parada: abra a ficha existente.');
        unidade = numOuNulo(t['unidade_internacao_id']) ?? unidade;
        uti = t['em_uti'] === null ? uti : booleano(t['em_uti']);
      }
      const id = await tx.incluir('parada_cardiorrespiratoria_ficha', {
        estabelecimento_id: est,
        paciente_id: f.paciente,
        atendimento_id: f.atendimento,
        acionamento_resposta_rapida_id: f.trr,
        anterior_ficha_id: f.anterior,
        numero_versao: versao,
        situacao: f.situacao,
        colapso_em: await quando(f.colapsoEm),
        unidade_internacao_id: unidade,
        em_uti: uti,
        dados: f.dados,
        motivo_correcao: motivo?.slice(0, 500) ?? null,
        inativada: false,
      });
      return { id, versao };
    },
    async retificarEventoTrr(x) {
      const ev = await eventoTrrVigente(x.evento);
      if (num(ev['criado_por']) !== tx.contexto.usuario)
        throw recusa('so-o-autor', 'Só quem registrou corrige (versão nova com o motivo).');
      const fuso = await fusoP;
      const em = x.em ? await quando(x.em) : (ev['ocorrido_em'] as Date);
      const minuto = minutoDe(em, fuso);
      if (minuto < minutoDe(ev['acionado_em'], fuso))
        throw recusa('antes-do-acionamento', 'A hora é anterior ao acionamento do time.');
      if (minuto > x.agora.slice(0, 16)) throw recusa('hora-no-futuro', 'A hora corrigida é do futuro.');
      const tipo = ev['tipo'] === 'desfecho' ? 'desfecho' : 'chegada';
      const desfecho = tipo === 'desfecho' ? (x.desfecho ?? textoOuNulo(ev['desfecho'])) : null;
      if (minuto === minutoDe(ev['ocorrido_em'], fuso) && desfecho === textoOuNulo(ev['desfecho']))
        throw recusa('sem-mudanca', 'Nada mudou em relação ao registro vigente.');
      const motivo = x.motivo.replace(/\s+/g, ' ').trim();
      if (!motivo) throw recusa('motivo-obrigatorio', 'A correção exige o motivo.');
      const trr = num(ev['acionamento_resposta_rapida_id']);
      const id = await tx.incluir('acionamento_resposta_rapida_evento', {
        acionamento_resposta_rapida_id: trr,
        tipo,
        ocorrido_em: em,
        desfecho,
        anterior_evento_id: num(ev['id']),
        motivo: motivo.slice(0, 500),
        inativado: false,
      });
      await espelharTrr(trr);
      return { id, trr, tipo };
    },
    async inativarTrr(x) {
      if (x.origem === 'evento') {
        const ev = await eventoTrrVigente(x.id);
        if (num(ev['criado_por']) !== tx.contexto.usuario)
          throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
        const motivo = x.motivo.trim();
        if (!motivo) throw recusa('motivo-obrigatorio', 'A inativação exige o motivo.');
        await tx.alterar('acionamento_resposta_rapida_evento', x.id, num(ev['versao']), {
          inativado: true,
          motivo_inativacao: motivo.slice(0, 300),
        });
        await espelharTrr(num(ev['acionamento_resposta_rapida_id']));
        return { id: x.id, paciente: num(ev['paciente_id']) };
      }
      if (x.origem === 'pcr') {
        const [p] = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, versao, paciente_id, criado_por, inativada FROM parada_cardiorrespiratoria_ficha WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [x.id, est],
        );
        if (!p) throw recusa('pcr-inexistente', 'A ficha da parada não foi encontrada.');
        if (
          await tx.uma('SELECT id FROM parada_cardiorrespiratoria_ficha WHERE anterior_ficha_id = ?', [x.id])
        )
          throw recusa('versao-desatualizada', 'Há uma versão mais nova da ficha: abra a versão atual.');
        if (num(p['criado_por']) !== tx.contexto.usuario)
          throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
        if (booleano(p['inativada'])) throw recusa('ja-inativado', 'O registro já foi inativado.');
        const motivo = x.motivo.trim();
        if (!motivo) throw recusa('motivo-obrigatorio', 'A inativação exige o motivo.');
        await tx.alterar('parada_cardiorrespiratoria_ficha', x.id, num(p['versao']), {
          inativada: true,
          motivo_inativacao: motivo.slice(0, 300),
        });
        return { id: x.id, paciente: num(p['paciente_id']) };
      }
      const [t] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, situacao, paciente_id FROM acionamento_resposta_rapida WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.id, est],
      );
      if (!t) throw recusa('trr-inexistente', 'O acionamento não foi encontrado.');
      if (t['situacao'] === 'inativado') throw recusa('trr-inativado', 'O acionamento já foi inativado.');
      await tx.alterar('acionamento_resposta_rapida', x.id, num(t['versao']), {
        situacao: 'inativado',
        motivo_inativacao: x.motivo.slice(0, 300),
      });
      return { id: x.id, paciente: num(t['paciente_id']) };
    },
    async registrarLesao(r) {
      conferirDadosLesao(r.dados);
      await conferirAtendimento(tx, est, r.atendimento, r.paciente);
      const prof = await profissional();
      const col = await colunasLesao(r.colunas);
      const id = await tx.incluir('lesao_pele_paciente', {
        estabelecimento_id: est,
        paciente_id: r.paciente,
        atendimento_id: r.atendimento,
        ...col,
        responsavel_profissional_id: prof,
        situacao: r.situacao === 'finalizada' ? 'em_acompanhamento' : 'rascunho',
        inativada: false,
      });
      const idVersao = await tx.incluir('lesao_pele_avaliacao', {
        lesao_pele_paciente_id: id,
        sequencia: 1,
        tipo_avaliacao: 'ficha',
        realizada_em: new Date(),
        profissional_id: prof,
        estagio_lesao_pele_id: col.estagio_lesao_pele_id,
        dados: r.dados,
        finalizada: r.situacao === 'finalizada',
        vigente: true,
        inativada: false,
      });
      return { id, versao: 1, idVersao };
    },
    async versaoLesao(v) {
      const l = await lesaoAberta(v.lesao);
      const prof = await profissional();
      if (num(l['responsavel_profissional_id']) !== prof)
        throw recusa('so-o-autor', 'Só quem registrou a ficha pode corrigi-la.');
      const fichas = await tx.consultar<Linha>(
        `SELECT id, versao, finalizada FROM lesao_pele_avaliacao
          WHERE lesao_pele_paciente_id = ? AND tipo_avaliacao = 'ficha' AND excluido_em IS NULL ORDER BY sequencia DESC`,
        [v.lesao],
      );
      const atual = fichas[0];
      if (!atual || num(atual['id']) !== v.anterior)
        throw recusa('versao-desatualizada', 'Há uma versão mais nova da ficha: abra a versão atual.');
      let motivo: string | null = null;
      if (booleano(atual['finalizada'])) {
        motivo = (v.motivo ?? '').replace(/\s+/g, ' ').trim();
        if (motivo.length < 10)
          throw recusa('motivo-obrigatorio', 'A correção da ficha finalizada exige a justificativa.');
        if (v.situacao !== 'finalizada')
          throw recusa(
            'correcao-finaliza',
            'A correção da ficha finalizada é gravada finalizada (a ficha não volta a rascunho).',
          );
      }
      conferirDadosLesao(v.dados);
      const col = await colunasLesao(v.colunas);
      await tx.alterar('lesao_pele_paciente', v.lesao, num(l['versao']), {
        ...col,
        situacao: v.situacao === 'finalizada' ? 'em_acompanhamento' : texto(l['situacao']),
      });
      await tx.alterar('lesao_pele_avaliacao', num(atual['id']), num(atual['versao']), { vigente: false });
      const id = await tx.incluir('lesao_pele_avaliacao', {
        lesao_pele_paciente_id: v.lesao,
        sequencia: await proximaSequencia(v.lesao),
        tipo_avaliacao: 'ficha',
        realizada_em: new Date(),
        profissional_id: prof,
        estagio_lesao_pele_id: col.estagio_lesao_pele_id,
        dados: v.dados,
        finalizada: v.situacao === 'finalizada',
        vigente: true,
        // A correção da ficha finalizada aponta a versão corrigida, com a justificativa (CHECK do modelo).
        corrigida_lesao_pele_avaliacao_id: motivo ? num(atual['id']) : null,
        motivo_correcao: motivo?.slice(0, 500) ?? null,
        inativada: false,
      });
      return { id, versao: fichas.length + 1, paciente: num(l['paciente_id']) };
    },
    async curativoLesao(c) {
      const l = await lesaoAberta(c.lesao);
      const realizada = await quando(c.realizadoEm);
      if (realizada < (l['identificada_em'] as Date))
        throw recusa('curativo-antes-da-lesao', 'O curativo é anterior à identificação da lesão.');
      conferirDadosLesao(c.dados);
      const estagio = c.estagio
        ? await doCadastro('estagio_lesao_pele', c.estagio, 'estágio da lesão')
        : null;
      const id = await tx.incluir('lesao_pele_avaliacao', {
        lesao_pele_paciente_id: c.lesao,
        sequencia: await proximaSequencia(c.lesao),
        tipo_avaliacao: 'curativo',
        realizada_em: realizada,
        profissional_id: await profissional(),
        estagio_lesao_pele_id: estagio,
        dados: c.dados,
        finalizada: true,
        vigente: true,
        inativada: false,
      });
      await recalcularEstagioLesao(c.lesao);
      return { id, paciente: num(l['paciente_id']) };
    },
    async corrigirCurativoLesao(c) {
      const motivo = c.motivo.replace(/\s+/g, ' ').trim();
      if (motivo.length < 10)
        throw recusa('motivo-obrigatorio', 'A correção do curativo exige a justificativa.');
      const k = await avaliacaoDaLesao(c.anterior, 'curativo');
      if (num(k['profissional_id']) !== (await profissional()))
        throw recusa('so-o-autor', 'Só quem registrou o curativo pode corrigi-lo.');
      if (booleano(k['inativada']))
        throw recusa('curativo-inativado', 'O curativo foi inativado (lançado errado).');
      if (!booleano(k['vigente']))
        throw recusa('curativo-desatualizado', 'O curativo já foi corrigido: abra a versão atual.');
      const lesao = num(k['lesao_pele_paciente_id']);
      const l = await lesaoAberta(lesao);
      const realizada = await quando(c.realizadoEm);
      if (realizada < (l['identificada_em'] as Date))
        throw recusa('curativo-antes-da-lesao', 'O curativo é anterior à identificação da lesão.');
      conferirDadosLesao(c.dados);
      const estagio = c.estagio
        ? await doCadastro('estagio_lesao_pele', c.estagio, 'estágio da lesão')
        : null;
      await tx.alterar('lesao_pele_avaliacao', c.anterior, num(k['versao']), { vigente: false });
      const id = await tx.incluir('lesao_pele_avaliacao', {
        lesao_pele_paciente_id: lesao,
        sequencia: await proximaSequencia(lesao),
        tipo_avaliacao: texto(k['tipo_avaliacao']),
        realizada_em: realizada,
        profissional_id: num(k['profissional_id']),
        estagio_lesao_pele_id: estagio,
        dados: c.dados,
        finalizada: true,
        vigente: true,
        corrigida_lesao_pele_avaliacao_id: c.anterior,
        motivo_correcao: motivo.slice(0, 300),
        inativada: false,
      });
      // A correção do estágio (ou a retirada dele) volta à lesão: o estágio atual é recalculado das linhas vigentes.
      await recalcularEstagioLesao(lesao);
      return { id, lesao, paciente: num(l['paciente_id']) };
    },
    async fotoLesao(f) {
      const l = await lesaoAberta(f.lesao);
      if (f.curativo !== null) {
        const k = await avaliacaoDaLesao(f.curativo, 'curativo');
        if (num(k['lesao_pele_paciente_id']) !== f.lesao)
          throw recusa('curativo-de-outra-lesao', 'O curativo é de outra lesão.');
        if (booleano(k['inativada']) || !booleano(k['vigente']))
          throw recusa('curativo-nao-vigente', 'O curativo foi corrigido ou inativado: abra o vigente.');
      }
      const anexo = await tx.uma(
        'SELECT id FROM anexo_prontuario WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL',
        [f.anexo, est, num(l['paciente_id'])],
      );
      if (!anexo) throw recusa('anexo-inexistente', 'A imagem não é um anexo do prontuário deste paciente.');
      if (
        await tx.uma(
          "SELECT id FROM lesao_pele_avaliacao WHERE anexo_prontuario_id = ? AND tipo_avaliacao = 'foto' AND excluido_em IS NULL",
          [f.anexo],
        )
      )
        throw recusa('foto-ja-vinculada', 'Esta foto já está vinculada a uma lesão.');
      const id = await tx.incluir('lesao_pele_avaliacao', {
        lesao_pele_paciente_id: f.lesao,
        sequencia: await proximaSequencia(f.lesao),
        tipo_avaliacao: 'foto',
        realizada_em: await quando(f.tiradaEm),
        profissional_id: await profissional(),
        anexo_prontuario_id: f.anexo,
        dados: JSON.stringify({ curativo: f.curativo }),
        finalizada: true,
        vigente: true,
        inativada: false,
      });
      return { id, paciente: num(l['paciente_id']) };
    },
    async encerrarLesao(x) {
      const l = await lesaoAberta(x.lesao);
      if (l['situacao'] !== 'em_acompanhamento')
        throw recusa('lesao-em-rascunho', 'Finalize a ficha da lesão antes de encerrar o acompanhamento.');
      const em = await quando(x.em);
      if (em < (l['identificada_em'] as Date))
        throw recusa('encerramento-antes-da-lesao', 'O encerramento é anterior à identificação da lesão.');
      const obs = x.observacao ? x.observacao.replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
      await tx.alterar('lesao_pele_paciente', x.lesao, num(l['versao']), {
        situacao: 'encerrada',
        desfecho: x.desfecho,
        encerrada_em: em,
        observacao_encerramento: obs,
      });
      return { id: x.lesao, paciente: num(l['paciente_id']) };
    },
    async inativarLesao(x) {
      const motivo = x.motivo.replace(/\s+/g, ' ').trim();
      if (motivo.length < 10) throw recusa('motivo-obrigatorio', 'Informe o motivo da inativação.');
      const prof = await profissional();
      const inativacao = { inativada: true, motivo_inativacao: motivo.slice(0, 300) };
      if (x.origem === 'lesao') {
        const l = await lesaoTravada(x.id);
        if (booleano(l['inativada'])) throw recusa('ja-inativado', 'O registro já foi inativado.');
        if (num(l['responsavel_profissional_id']) !== prof)
          throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
        const v = await tx.uma<Linha>(
          `SELECT SUM(tipo_avaliacao IN ('curativo', 'reavaliacao') AND vigente) AS curativos,
                  SUM(tipo_avaliacao = 'foto') AS fotos
             FROM lesao_pele_avaliacao WHERE lesao_pele_paciente_id = ? AND NOT inativada AND excluido_em IS NULL`,
          [x.id],
        );
        const curativos = num(v?.['curativos'] ?? 0);
        const fotos = num(v?.['fotos'] ?? 0);
        if (curativos + fotos > 0)
          throw recusa(
            'lesao-com-registros',
            `A lesão tem ${curativos} curativo(s) e ${fotos} foto(s) vigentes: inative-os antes da lesão.`,
          );
        await tx.alterar('lesao_pele_paciente', x.id, num(l['versao']), inativacao);
        return { id: x.id, paciente: num(l['paciente_id']), lesao: x.id };
      }
      const k = await avaliacaoDaLesao(x.id, x.origem);
      if (booleano(k['inativada'])) throw recusa('ja-inativado', 'O registro já foi inativado.');
      if (x.origem === 'curativo' && !booleano(k['vigente']))
        throw recusa('curativo-desatualizado', 'O curativo já foi corrigido: inative a versão atual.');
      if (num(k['profissional_id']) !== prof)
        throw recusa('so-o-autor', 'Só quem lançou inativa o registro (lançamento errado).');
      const lesao = num(k['lesao_pele_paciente_id']);
      if (x.origem === 'curativo') {
        // As versões do curativo (a cadeia das correções) e as fotos vigentes ligadas a qualquer uma delas.
        const versoes = new Set<number>([x.id]);
        for (let a = numOuNulo(k['corrigida_lesao_pele_avaliacao_id']); a !== null && !versoes.has(a);) {
          versoes.add(a);
          const ant = await tx.uma<Linha>(
            'SELECT corrigida_lesao_pele_avaliacao_id FROM lesao_pele_avaliacao WHERE id = ?',
            [a],
          );
          a = ant ? numOuNulo(ant['corrigida_lesao_pele_avaliacao_id']) : null;
        }
        const fotos = (
          await tx.consultar<Linha>(
            `SELECT dados FROM lesao_pele_avaliacao WHERE lesao_pele_paciente_id = ? AND tipo_avaliacao = 'foto'
                AND NOT inativada AND excluido_em IS NULL`,
            [lesao],
          )
        ).filter((f) => versoes.has(Number(lerJson<{ curativo?: number }>(f['dados'])?.curativo))).length;
        if (fotos > 0)
          throw recusa(
            'curativo-com-fotos',
            `O curativo tem ${fotos} foto(s) vigente(s): inative a(s) ${fotos} foto(s) antes do curativo.`,
          );
      }
      await tx.alterar('lesao_pele_avaliacao', x.id, num(k['versao']), inativacao);
      // O estágio lançado errado sai da lesão: volta ao da última linha vigente com estágio.
      if (x.origem === 'curativo') await recalcularEstagioLesao(lesao);
      return { id: x.id, paciente: num(k['paciente_id']), lesao };
    },
    async incluirProtocoloInternado(p) {
      if (p.origem === 'news2' && (p.escore === null || p.tipo !== 'sepse'))
        throw recusa('escore-obrigatorio', 'O alerta do NEWS2 abre o protocolo de sepse, com o escore.');
      await conferirAtendimento(tx, est, p.atendimento, p.paciente);
      const pg = await tx.uma<{ id: number }>(
        `SELECT id FROM protocolo_gerenciado WHERE id = ? AND tipo = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
            AND excluido_em IS NULL`,
        [p.gerenciado, p.tipo, est],
      );
      if (!pg)
        throw recusa('protocolo-inexistente', 'A definição do protocolo gerenciado não foi encontrada.');
      // As inclusões do atendimento são travadas: uma aberta por tipo (a inativada ou encerrada não conta).
      const abertas = await tx.consultarParaAtualizar<{
        id: number;
        tipo: string;
        escore: unknown;
        situacao: string;
      }>(
        `SELECT ip.id, g.tipo, JSON_VALUE(ip.regra_avaliada, '$.escore') AS escore, ip.situacao,
                (SELECT COUNT(*) FROM inclusao_protocolo_evento e WHERE e.inclusao_protocolo_paciente_id = ip.id
                  AND JSON_VALUE(e.dados, '$.tipo') = 'inativacao') AS inativada
           FROM inclusao_protocolo_paciente ip JOIN protocolo_gerenciado g ON g.id = ip.protocolo_gerenciado_id
          WHERE ip.estabelecimento_id = ? AND ip.atendimento_id = ? AND ip.excluido_em IS NULL`,
        [est, p.atendimento],
      );
      if (
        abertas.some(
          (x) =>
            x.tipo === p.tipo &&
            ['sugerido', 'ativo'].includes(x.situacao) &&
            !num((x as unknown as Linha)['inativada']),
        )
      )
        throw recusa('protocolo-ja-aberto', 'O paciente já está neste protocolo neste atendimento.');
      if (p.escore !== null && abertas.some((x) => x.tipo === p.tipo && numOuNulo(x.escore) === p.escore))
        throw recusa('alerta-ja-usado', 'Este alerta do NEWS2 já abriu o protocolo de sepse.');
      const agora = new Date();
      return tx.incluir('inclusao_protocolo_paciente', {
        estabelecimento_id: est,
        protocolo_gerenciado_id: Number(pg.id),
        paciente_id: p.paciente,
        atendimento_id: p.atendimento,
        forma_inclusao: p.origem === 'news2' ? 'alerta_automatico' : 'manual',
        horario_zero_em: await quando(p.reconhecidoEm),
        situacao: 'ativo',
        aceito_por_usuario_id: tx.contexto.usuario,
        aceito_em: agora,
        regra_avaliada: JSON.stringify({
          origem: p.origem,
          escore: p.escore,
          criterios: p.criterios,
          observacao: p.observacao,
        }),
      });
    },
    async eventoProtocoloInternado(x) {
      const [p] = await tx.consultarParaAtualizar<{ id: number; versao: number; situacao: string }>(
        'SELECT id, versao, situacao FROM inclusao_protocolo_paciente WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.protocolo, est],
      );
      if (!p)
        throw recusa('protocolo-inexistente', 'O protocolo do paciente não existe neste estabelecimento.');
      const inativada = await tx.uma(
        "SELECT id FROM inclusao_protocolo_evento WHERE inclusao_protocolo_paciente_id = ? AND JSON_VALUE(dados, '$.tipo') = 'inativacao'",
        [p.id],
      );
      if (inativada)
        throw recusa(
          x.tipoEvento === 'inativacao' ? 'ja-inativado' : 'protocolo-inativado',
          'Esta inclusão foi inativada (lançada por engano): nada mais se registra nela.',
        );
      const encerrada = ['concluido', 'encerrado'].includes(p.situacao);
      if (encerrada && x.tipoEvento === 'encerramento')
        throw recusa('ja-encerrado', 'O protocolo deste paciente já foi encerrado.');
      if (encerrada && (x.tipoEvento === 'meta' || x.tipoEvento === 'checklist'))
        throw recusa('protocolo-encerrado', 'O protocolo deste paciente já foi encerrado.');
      if (
        (x.tipoEvento === 'meta' || x.tipoEvento === 'checklist') &&
        (await tx.uma(
          `SELECT id FROM inclusao_protocolo_evento WHERE inclusao_protocolo_paciente_id = ? AND evento = ?
              AND JSON_VALUE(dados, '$.codigo') = ?`,
          [p.id, x.tipoEvento, x.codigo],
        ))
      )
        throw recusa(
          'ja-registrado',
          'Este item do protocolo já foi registrado. Abra de novo para ver o registro.',
        );
      const motivo = x.motivo?.trim() || null;
      if (x.tipoEvento === 'inativacao' && !motivo)
        throw recusa('motivo-obrigatorio', 'A inativação exige o motivo.');
      const agora = new Date();
      if (x.tipoEvento === 'encerramento')
        await tx.alterar('inclusao_protocolo_paciente', Number(p.id), Number(p.versao), {
          situacao: 'encerrado',
          encerrado_em: x.ocorridoEm ? await quando(x.ocorridoEm) : agora,
          encerrado_por_usuario_id: tx.contexto.usuario,
        });
      const comSegundos = (t: string | null) => (t ? (t.length === 16 ? `${t}:00` : t.slice(0, 19)) : null);
      // A inativação por engano não muda a inclusão (fica visível, com o evento); a saída é o encerramento.
      return tx.incluir('inclusao_protocolo_evento', {
        inclusao_protocolo_paciente_id: Number(p.id),
        operacao: 'inclusao',
        dados: JSON.stringify({
          tipo: x.tipoEvento,
          codigo: x.codigo,
          situacao: x.situacao,
          quando: comSegundos(x.ocorridoEm),
          prazoEm: comSegundos(x.prazoEm),
        }),
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
        evento:
          x.tipoEvento === 'encerramento'
            ? 'saida'
            : x.tipoEvento === 'meta' || x.tipoEvento === 'checklist'
              ? x.tipoEvento
              : 'descarte',
        justificativa: motivo,
      });
    },
    async validarIndice(v) {
      const [i] = await tx.consultarParaAtualizar<{
        id: number;
        versao: number;
        situacao: string;
        paciente_id: number;
      }>(
        'SELECT id, versao, situacao, paciente_id FROM indice_gravidade_uti WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [v.id, est],
      );
      if (!i) throw recusa('nao-encontrado', 'O índice não existe neste estabelecimento.');
      if (i.situacao === 'estornado')
        throw recusa('indice-estornado', 'Este índice foi estornado ou invalidado e não pode ser validado.');
      if (i.situacao !== 'registrado') throw recusa('ja-validado', 'Este índice já foi validado.');
      await tx.alterar('indice_gravidade_uti', Number(i.id), Number(i.versao), {
        situacao: 'validado',
        validado_por_profissional_id: await profissional(),
        validado_em: await quando(v.quando),
      });
      return { paciente: Number(i.paciente_id) };
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEscoresIndisponivel(): PortaEscores {
  return portaIndisponivel<PortaEscores>(METODOS_PORTA_ESCORES);
}
