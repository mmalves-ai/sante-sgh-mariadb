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
// reavaliações programadas vão ao outbox (enfermagem.reavaliacao.programada) até a tabela do pedido existir.
// Pendências de modelo (pedido do lote 02-04): reavaliações programadas, classificação de pacientes (Fugulin/NAS),
// índices da UTI (APACHE II, SOFA), decisão da profilaxia de TEV sobre o escore, ficha da PCR (Utstein), adendo da
// checagem da contenção, gatilho e versão da regra na aplicação da escala, fotos e eventos da lesão. Lidos vazios e
// gravações recusadas com 'modelo-pendente' até as tabelas existirem.
import { CONFIGURACAO_INDICES_SINTETICA } from '@sgh/dominio-pep';
import { ErroOperacao, type Executor, gravarOutbox, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
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
  ContencaoParaGravar,
  ContencaoRegistrada,
  EscoreRegistrado,
  HorarioContencao,
  InternacaoParaEscore,
  LesaoRegistrada,
  ProtocoloInternadoRegistrado,
  RegistroParaEstorno,
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

const pendente = (o: string) =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Gravação indisponível',
    `${o} aguarda a tabela no modelo do banco próprio: nada foi gravado.`,
  );

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
        'acionamento_resposta_rapida',
        'inclusao_protocolo_paciente',
        'inclusao_protocolo_evento',
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

  reavaliacoes(): Promise<[]> {
    return Promise.resolve([]);
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

  classificacoes(): Promise<[]> {
    return Promise.resolve([]);
  }

  async configuracaoIndices() {
    // Parâmetros dos índices da UTI ainda sem cadastro por estabelecimento (pendência): vale a configuração do domínio.
    return CONFIGURACAO_INDICES_SINTETICA;
  }

  indicesDoPaciente(): Promise<[]> {
    return Promise.resolve([]);
  }

  apachesDoPeriodo(): Promise<[]> {
    return Promise.resolve([]);
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

  decisoesProfilaxia(): Promise<[]> {
    return Promise.resolve([]);
  }

  // ── Contenção ─────────────────────────────────────────────────────────────────────────────────────────────

  contencoes(
    c: ContextoEscores,
    f: { atendimentos?: readonly number[]; unidade?: string; desde: string; ate?: string; abertas?: boolean },
  ): Promise<ContencaoRegistrada[]> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros = ['c.inicio_em >= ?'];
      const p: unknown[] = [est, instanteDe(f.desde, fuso)];
      if (f.ate) { filtros.push('c.inicio_em <= ?'); p.push(instanteDe(f.ate, fuso)); }
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
                    adendos: [],
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
      if (f.ate) { (filtro += ' AND t.acionado_em <= ?'); p.push(instanteDe(f.ate, fuso)); }
      const rs = await l.consultar(`${SQL_TRR} AND ${filtro} ORDER BY t.acionado_em, t.id LIMIT ?`, [
        ...p,
        TETO,
      ]);
      return rs
        .filter((r) => f.unidade === undefined || r['unidade'] === f.unidade)
        .map((r) => trrDe(r, fuso));
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

  versoesPcr(): Promise<[]> {
    return Promise.resolve([]);
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
      if (f.desde) { filtros.push('ip.horario_zero_em >= ?'); p.push(instanteDe(f.desde, fuso)); }
      if (f.ate) { filtros.push('ip.horario_zero_em <= ?'); p.push(instanteDe(f.ate, fuso)); }
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
      if (f.id !== undefined) { filtros.push('lp.id = ?'); p.push(f.id); }
      if (f.atendimentos) {
        if (f.atendimentos.length === 0) return [];
        filtros.push(`lp.atendimento_id IN (${marcadores(f.atendimentos.length)})`);
        p.push(...f.atendimentos);
      }
      if (f.desde) { filtros.push('lp.identificada_em >= ?'); p.push(instanteDe(f.desde, fuso)); }
      if (f.ate) { filtros.push('lp.identificada_em <= ?'); p.push(instanteDe(f.ate, fuso)); }
      const rs = await l.consultar(
        `SELECT lp.*, ${LOGIN_DO_PROFISSIONAL('lp.responsavel_profissional_id', 'lp.estabelecimento_id')} AS autor,
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
          `SELECT a.*, ${LOGIN_DO_PROFISSIONAL('a.profissional_id', 'lp.estabelecimento_id')} AS autor
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
      return rs.map((r): LesaoRegistrada => {
        const as = avals.get(num(r['id'])) ?? [];
        const fichas = as.filter((a) => a['tipo_avaliacao'] === 'ficha');
        const curativos = as.filter((a) => a['tipo_avaliacao'] !== 'ficha').reverse();
        const situacao = texto(r['situacao']);
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
            anterior: numOuNulo(a['corrigida_lesao_pele_avaliacao_id']),
            situacao: booleano(a['finalizada']) ? ('finalizada' as const) : ('rascunho' as const),
            dados: texto(a['observacao']),
            motivo: textoOuNulo(a['motivo_correcao']),
            autor: texto(a['autor']),
            criadoEm: civilDe(a['criado_em'], fuso) ?? '',
          })),
          curativos: curativos.map((a) => ({
            id: num(a['id']),
            anterior: numOuNulo(a['corrigida_lesao_pele_avaliacao_id']),
            realizadoEm: (civilDe(a['realizada_em'], fuso) ?? '').slice(0, 16),
            dados: texto(a['observacao']),
            motivo: textoOuNulo(a['motivo_correcao']),
            autor: texto(a['autor']),
            criadoEm: civilDe(a['criado_em'], fuso) ?? '',
          })),
          fotos: [],
          eventos:
            situacao === 'encerrada'
              ? [
                  {
                    origem: 'lesao',
                    registro: num(r['id']),
                    tipo: 'encerramento',
                    desfecho: textoOuNulo(r['desfecho']),
                    em: (civilDe(r['encerrada_em'], fuso) ?? '').slice(0, 16),
                    motivo: textoOuNulo(r['observacao_encerramento']),
                    usuario: texto(r['autor']),
                    criadoEm: civilDe(r['alterado_em'], fuso) ?? '',
                  },
                ]
              : [],
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
      if (afericao === null && e.sinalVital) afericao = await afericaoDoSinal(tx, est, e.sinalVital, e.paciente);
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
        throw recusa('interpretacao-longa', 'A faixa do escore passa do tamanho guardado: confira a regra da escala.');
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
      // As reavaliações programadas pelo escore (NEWS2 de 5 ou mais: mudança de quadro) vão ao outbox até a tabela
      // reavaliacao_escala do pedido existir; o escore, os sinais e os avisos nunca são recusados por causa delas.
      for (const p of r.programar) {
        const chave = p.chave(id);
        await gravarOutbox(tx, {
          estabelecimento: est,
          ponto: 'enfermagem.reavaliacao.programada',
          entidade: 'aplicacao_escala',
          entidadeId: id,
          chave: `reavaliacao:${p.escala}:${chave}`.slice(0, 120),
          carga: {
            escore: id,
            paciente: p.paciente,
            internacao: p.reg,
            unidade: p.unidade,
            escala: p.escala,
            motivo: p.motivo,
            chave,
            devidaEm: p.devidaEm,
            prazoEm: p.prazoEm,
          },
          usuario: tx.contexto.usuario,
          agora: new Date(),
        });
      }
      const avisos = await avisar(r.avisos.map((a) => a(id)));
      return { id, sinais, avisos };
    },
    programarReavaliacao: async () => {
      throw pendente('A reavaliação programada da escala');
    },
    dispensarReavaliacao: async () => {
      throw pendente('A dispensa da reavaliação');
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
    classificar: async () => {
      throw pendente('A classificação de pacientes (Fugulin e NAS)');
    },
    registrarIndice: async () => {
      throw pendente('O índice de gravidade da UTI');
    },
    async estornarRegistro(r) {
      if (r.origem !== 'escore') throw pendente('O estorno da classificação e do índice da UTI');
      const [a] = await tx.consultarParaAtualizar<{ id: number; versao: number; situacao: string }>(
        'SELECT id, versao, situacao FROM aplicacao_escala WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.id, est],
      );
      if (!a) throw recusa('registro-inexistente', 'O escore não foi encontrado.');
      if (a.situacao === 'inativada') throw recusa('registro-estornado', 'O escore já foi estornado.');
      const motivo = r.motivo.trim();
      if (!motivo) throw recusa('motivo-obrigatorio', 'O estorno exige o motivo.');
      await tx.alterar('aplicacao_escala', r.id, Number(a.versao), { situacao: 'inativada' });
      // Até a coluna motivo_inativacao do pedido, o motivo, o alerta reavaliado e o escore mantido ficam na trilha.
      anotacao.motivo = motivo;
      anotacao.dados = { estorno: { tipo: r.tipo, alerta: r.alerta, escoreMantem: r.escoreMantem } };
      return r.id;
    },
    decidirProfilaxia: async () => {
      throw pendente('A decisão sobre a profilaxia de TEV sugerida pelo escore');
    },
    retificarProfilaxia: async () => {
      throw pendente('A retificação da decisão da profilaxia de TEV');
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
    adendoChecagemContencao: async () => {
      throw pendente('O adendo da checagem da contenção');
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
      const [t] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, situacao, chegada_em FROM acionamento_resposta_rapida WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.trr, est],
      );
      if (!t) throw recusa('trr-inexistente', 'O acionamento não foi encontrado.');
      if (t['situacao'] === 'inativado' || t['situacao'] === 'encerrado')
        throw recusa('trr-encerrado', 'O acionamento já foi encerrado ou inativado.');
      const em = await quando(x.em);
      if (x.tipo === 'chegada') {
        if (t['chegada_em']) throw recusa('trr-chegada', 'A chegada do time já foi registrada.');
        await tx.alterar('acionamento_resposta_rapida', x.trr, num(t['versao']), {
          chegada_em: em,
          situacao: 'em_atendimento',
        });
      } else {
        await tx.alterar('acionamento_resposta_rapida', x.trr, num(t['versao']), {
          encerrado_em: em,
          desfecho: x.desfecho,
          situacao: 'encerrado',
        });
      }
      return x.trr;
    },
    gravarFichaPcr: async () => {
      throw pendente('A ficha da parada cardiorrespiratória (Utstein)');
    },
    retificarEventoTrr: async () => {
      throw pendente('A retificação da chegada ou do desfecho do TRR');
    },
    async inativarTrr(x) {
      if (x.origem !== 'trr') throw pendente('A inativação do evento e da ficha da PCR');
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
    registrarLesao: async () => {
      throw pendente('A ficha da lesão de pele (tipo, região e estágio pelo cadastro)');
    },
    versaoLesao: async () => {
      throw pendente('A versão da ficha da lesão de pele');
    },
    curativoLesao: async () => {
      throw pendente('O curativo da lesão de pele');
    },
    corrigirCurativoLesao: async () => {
      throw pendente('A correção do curativo');
    },
    fotoLesao: async () => {
      throw pendente('A foto da lesão');
    },
    encerrarLesao: async () => {
      throw pendente('O encerramento do acompanhamento da lesão');
    },
    inativarLesao: async () => {
      throw pendente('A inativação da lesão, do curativo ou da foto');
    },
    incluirProtocoloInternado: async () => {
      throw pendente('A inclusão do internado no protocolo gerenciado');
    },
    eventoProtocoloInternado: async () => {
      throw pendente('O evento do protocolo do internado');
    },
    validarIndice: async () => {
      throw pendente('A validação do índice da UTI');
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEscoresIndisponivel(): PortaEscores {
  return portaIndisponivel<PortaEscores>(METODOS_PORTA_ESCORES);
}
