// Porta da enfermagem beira-leito sobre o banco do cliente (MariaDB, pelo @sgh/nucleo): a linha do tempo do turno
// (horario_administracao da prescrição vigente, com a situação pela categoria de situacao_checagem), o histórico do
// horário (horario_administracao_evento), os internados da unidade (ocupacao_leito ativa), os sinais vitais (afericao e
// afericao_valor), a passagem de plantão (passagem_turno e passagem_turno_paciente) e o vínculo de enfermagem da conta
// (usuario_vinculo_profissional → profissional_ocupacao). A checagem, o aprazamento e o estorno são operações do
// Executor (operacoes.ts); as demais gravações vão por gravação direta do Executor (gravacao-direta.ts).
// Toda leitura filtra o estabelecimento da sessão e os registros excluídos.
// Melhoria: horas no fuso do estabelecimento; o horário é lido pela categoria da situação (sem letras gravadas); o
// sinal vital é uma aferição com o parâmetro do cadastro (sem tabela à parte); a retificação do sinal é uma linha nova
// de afericao_valor na mesma aferição (a anterior fica guardada, marcada como substituída, e nunca muda de valor), com
// a trava otimista pela versão lida na tela e a justificativa na trilha; a passagem de plantão grava o SBAR por
// paciente, o turno pelo cadastro (turno_padrao) e trava a recusa do mesmo profissional (CHECK do banco).
// Melhoria: o sinal vital e a nota do plantão só se ligam a atendimento deste estabelecimento e do mesmo paciente.
// Provisório até o pedido de DDL do lote 02-04: a ligação da retificação com a anterior e a justificativa em colunas
// (afericao_valor.retifica_afericao_valor_id e motivo_retificacao), a data de referência do plantão
// (passagem_turno.data_referencia) e o SBAR em colunas (hoje o SBAR vai como JSON em observacao_enfermagem).
// Os eventos da infusão contínua vão ao evento do horário (velocidade e volume em colunas; o código do contrato nos
// dados); o aparelho da beira do leito guarda só o resumo do identificador; o conflito de sincronização é um por chave.
// Todos os eventos da infusão contínua (início, pausa, retomada, troca de bolsa, velocidade e fim) vão ao evento do
// horário; a resposta de extensão do formulário (sinal vital, mapa corporal ou anexo) grava em
// registro_assistencial_extensao, ligada a um registro assistencial do mesmo estabelecimento e paciente (o reenvio da
// mesma chave atualiza a resposta, sem duplicar).
import { createHash } from 'node:crypto';
import type { EventoInfusao as EventoInfusaoContrato } from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  erroConflitoVersao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import {
  booleano,
  civilDe,
  estabelecimentoDe,
  exigirProfissional,
  fusoDe,
  instanteDe,
  LOGIN_DE,
  localNoFuso,
  marcadores,
  num,
  numOuNulo,
  profissionalDoLogin,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import { internadosEmCache } from './cache-internados.js';
import { type AnotacaoGravacao, conferirAtendimento, gravacaoDireta } from './gravacao-direta.js';
import { LETRA_DA_CATEGORIA, letraDaSituacao, OPERACOES_ENFERMAGEM } from './operacoes.js';
import {
  type ContextoEnfermagem,
  type GravadorSghEnfermagem,
  METODOS_PORTA_ENFERMAGEM,
  type PortaEnfermagem,
} from './porta.js';
import type {
  AparelhoBeiraLeito,
  AprazamentoRegistrado,
  ConflitoSincronizacao,
  EventoInfusao,
  AtoChecagem,
  EventoHistoricoHorario,
  ExtrasContingencia,
  HorarioEnfermagem,
  Internado,
  PassagemPlantao,
  SinalParaRetificar,
  SinalVitalRegistrado,
  TipoHorario,
  UnidadeComInternados,
  VinculoEnfermagem,
} from './tipos.js';

/** O identificador do aparelho nunca é guardado: só o resumo dele com o estabelecimento. */
const hashDoAparelho = (est: number, identificador: string) =>
  createHash('sha256').update(`${est}:${identificador.trim()}`).digest('hex');

const TIPO_CONFLITO_BANCO = { suspenso: 'suspenso', jaChecado: 'ja_checado', mudou: 'mudou' } as const;
const TIPO_CONFLITO_CONTRATO: Readonly<Record<string, ConflitoSincronizacao['tipo']>> = {
  suspenso: 'suspenso',
  ja_checado: 'jaChecado',
  mudou: 'mudou',
};

/** O evento da infusão contínua (contrato) → evento do horário no banco; sem par, aguarda o CHECK ampliado. */
const EVENTO_INFUSAO_BANCO: Readonly<Record<string, string>> = {
  inicio: 'infusao_inicio',
  pausa: 'infusao_pausa',
  retomada: 'infusao_retomada',
  trocaBolsa: 'infusao_troca_bolsa',
  velocidade: 'infusao_velocidade',
  fim: 'infusao_termino',
} satisfies Readonly<Record<EventoInfusaoContrato, string>>;

/** Componente da resposta de extensão do formulário: contrato → banco. */
const COMPONENTE_EXTENSAO_BANCO = {
  sinalVital: 'sinal_vital',
  mapaCorporal: 'mapa_corporal',
  anexo: 'anexo',
} as const;

const SQL_APARELHOS = `
  SELECT a.id, a.nome, u.codigo AS unidade, a.tipo, a.ativo, a.ultimo_sincronismo_em,
         (SELECT u2.login FROM usuario u2 WHERE u2.id = a.criado_por) AS login
    FROM aparelho_beira_leito a JOIN unidade_internacao u ON u.id = a.unidade_internacao_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

function aparelhoDe(r: Record<string, unknown>, fuso: string): AparelhoBeiraLeito {
  return {
    id: num(r['id']),
    nome: texto(r['nome']),
    unidade: texto(r['unidade']),
    tipo: texto(r['tipo']) as AparelhoBeiraLeito['tipo'],
    ativo: booleano(r['ativo']),
    ultimoSincronismo: civilDe(r['ultimo_sincronismo_em'], fuso)?.slice(0, 16) ?? null,
    cadastradoPor: texto(r['login']),
  };
}

/** O mínimo do núcleo que a porta usa. */
export type NucleoEnfermagem = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;

/** Teto de linhas do histórico de um horário. */
const TETO_HISTORICO = 200;
/** Teto de sinais lidos de um paciente numa janela. */
const TETO_SINAIS = 2_000;

const TIPO_DA_CATEGORIA: Readonly<Record<string, TipoHorario>> = {
  medicamento: 'medicamento',
  solucao: 'solucao',
  dieta: 'dieta',
  cuidado: 'cuidado',
  ventilacao: 'ventilacao',
  oxigenoterapia: 'ventilacao',
  hemocomponente: 'hemoterapia',
  material: 'material',
};

const NOME_PACIENTE = `CASE WHEN p.usa_nome_social AND p.nome_social IS NOT NULL THEN p.nome_social ELSE pf.nome END`;

const SQL_INTERNADOS = `
  SELECT i.paciente_id, i.atendimento_id, p.numero_prontuario, ${NOME_PACIENTE} AS nome, l.codigo AS leito,
         u.codigo AS unidade,
         EXISTS (SELECT 1 FROM alergia_paciente a
                  WHERE a.paciente_id = i.paciente_id AND a.ativa AND a.excluido_em IS NULL
                    AND a.tipo_registro IN ('alergia', 'intolerancia')) AS alergia
    FROM ocupacao_leito o
    JOIN internacao i ON i.id = o.internacao_id AND i.excluido_em IS NULL
    JOIN leito_hospitalar l ON l.id = o.leito_hospitalar_id
    JOIN unidade_internacao u ON u.id = o.unidade_internacao_id
    JOIN paciente p ON p.id = i.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao = 'ativa' AND o.data_hora_fim IS NULL
     AND i.situacao IN ('ativa', 'alta_medica')`;

const SQL_HORARIOS = `
  SELECT h.id, h.prescricao_item_id, h.prescricao_id, h.atendimento_id, h.previsto_em, h.situacao_checagem_em,
         h.suspenso, sc.categoria, h.quantidade_administrada, h.codigo_barras, h.situacao_aprazamento_id,
         (SELECT po.id FROM profissional_ocupacao po
           WHERE po.profissional_id = h.administrado_por_profissional_id AND po.excluido_em IS NULL
           ORDER BY po.principal DESC, po.id LIMIT 1) AS ocupacao_checagem,
         t.categoria AS tipo_categoria, pi.descricao, pi.se_necessario, pi.quantidade AS quantidade_item,
         pi.observacao_enfermagem, pi.dias_tratamento, v.sigla AS via, up.sigla AS unidade_dose,
         pm.dose, pm.item_prescritivel_id AS produto, pm.velocidade_infusao,
         (pm.ficha_antimicrobiano_id IS NOT NULL OR pm.dose_extra_antimicrobiano) AS antimicrobiano,
         EXISTS (SELECT 1 FROM administracao_dupla_checagem d
                  WHERE d.horario_administracao_id = h.id AND d.excluido_em IS NULL) AS dupla,
         EXISTS (SELECT 1 FROM prescricao_item_glicemia g
                  WHERE g.prescricao_item_id = pi.id AND g.excluido_em IS NULL) AS glicemia
    FROM horario_administracao h
    JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
    JOIN prescricao_item pi ON pi.id = h.prescricao_item_id
    JOIN tipo_item_prescricao t ON t.id = pi.tipo_item_prescricao_id
    LEFT JOIN prescricao_item_medicamento pm ON pm.prescricao_item_id = pi.id AND pm.excluido_em IS NULL
    LEFT JOIN via_de_uso v ON v.id = pi.via_de_uso_id
    LEFT JOIN unidade_prescricao up ON up.id = COALESCE(pm.unidade_prescricao_id, pi.unidade_prescricao_id)
   WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL`;

// A versão do sinal é a posição dele na cadeia de retificações (as linhas substituídas do mesmo parâmetro na mesma
// aferição); a anterior é a última substituída antes dele; a justificativa é o motivo gravado na trilha da retificação.
const COLUNAS_SINAL = `
  SELECT v.id, a.paciente_id, a.atendimento_id, pv.codigo, v.valor_numerico, pv.unidade, v.nivel_alerta,
         a.aferido_em, v.excluido_em,
         (SELECT COUNT(*) FROM afericao_valor o WHERE o.afericao_id = v.afericao_id
           AND o.parametro_vital_id = v.parametro_vital_id AND o.sequencia < v.sequencia
           AND o.excluido_em IS NOT NULL) + 1 AS versao,
         (SELECT o.id FROM afericao_valor o WHERE o.afericao_id = v.afericao_id
           AND o.parametro_vital_id = v.parametro_vital_id AND o.sequencia < v.sequencia
           AND o.excluido_em IS NOT NULL ORDER BY o.sequencia DESC LIMIT 1) AS anterior,
         (SELECT t.motivo FROM trilha_auditoria t WHERE t.entidade = 'afericao_valor' AND t.entidade_id = v.id
           AND t.motivo IS NOT NULL ORDER BY t.id DESC LIMIT 1) AS justificativa,
         ${LOGIN_DE('COALESCE(v.criado_por, a.criado_por)')} AS login
    FROM afericao a`;
const SQL_SINAIS = `${COLUNAS_SINAL}
    JOIN afericao_valor v ON v.afericao_id = a.id AND v.excluido_em IS NULL AND NOT v.nao_aferido
    JOIN parametro_vital pv ON pv.id = v.parametro_vital_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;
/** O sinal pelo id, vigente ou já substituído por uma retificação (excluido_em preenchido). */
const SQL_SINAL_QUALQUER = `${COLUNAS_SINAL}
    JOIN afericao_valor v ON v.afericao_id = a.id AND NOT v.nao_aferido
    JOIN parametro_vital pv ON pv.id = v.parametro_vital_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

function contextoDe(c: ContextoNucleo): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'enfermagem').slice(0, 64),
  };
}

const foraDaFaixa = (nivel: unknown) => ['atencao', 'critico', 'fora_faixa_plausivel'].includes(texto(nivel));


export class PortaEnfermagemPropria implements PortaEnfermagem {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoEnfermagem,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoNucleo, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = estabelecimentoDe(c);
    return this.nucleo.lerSomente(contextoDe(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoEnfermagem, op: string): Promise<LiberacaoGravacao> {
    const operacao = OPERACOES_ENFERMAGEM[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, { ...contextoDe(c), chaveIdempotencia: 'consulta.liberacao' });
  }

  async executar(c: ContextoEnfermagem, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_ENFERMAGEM[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida na enfermagem.');
    const r = await this.executor.executar(operacao, c.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  gravarSgh<T>(
    c: ContextoEnfermagem,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghEnfermagem) => Promise<T>,
  ): Promise<T> {
    return gravacaoDireta(this.executor, c, {
      nome: 'enfermagem.gravacao-direta',
      tabelas: [
        'afericao',
        'afericao_valor',
        'passagem_turno',
        'passagem_turno_paciente',
        'horario_administracao_evento',
        'aparelho_beira_leito',
        'conflito_sincronizacao_checagem',
      ],
      trilha,
      gravador: (tx, est, an) => gravadorEnfermagem(tx, est, an),
      fn,
    });
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoEnfermagem): Promise<string> {
    return this.ler(c, async (_l, _est, fuso) => localNoFuso(new Date(), fuso));
  }

  unidades(c: ContextoEnfermagem): Promise<UnidadeComInternados[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT u.codigo, u.descricao,
                (SELECT COUNT(*) FROM ocupacao_leito o
                  WHERE o.unidade_internacao_id = u.id AND o.excluido_em IS NULL AND o.situacao = 'ativa'
                    AND o.data_hora_fim IS NULL) AS internados
           FROM unidade_internacao u
          WHERE u.estabelecimento_id = ? AND u.excluido_em IS NULL AND u.ativo
          ORDER BY u.descricao, u.id`,
        [est],
      );
      return rs.map((r) => ({
        unidade: texto(r['codigo']),
        nome: texto(r['descricao']),
        internados: num(r['internados']),
      }));
    });
  }

  internados(c: ContextoEnfermagem, unidade: string): Promise<Internado[]> {
    return internadosEmCache(c, unidade, () =>
      this.ler(c, async (l, est) =>
        (await l.consultar(`${SQL_INTERNADOS} AND u.codigo = ? ORDER BY l.codigo, i.id`, [est, unidade])).map(
          internadoDe,
        ),
      ),
    );
  }

  internado(c: ContextoEnfermagem, atendimento: number): Promise<Internado | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_INTERNADOS} AND i.atendimento_id = ? LIMIT 1`, [est, atendimento]);
      return r ? internadoDe(r) : null;
    });
  }

  horarios(
    c: ContextoEnfermagem,
    o: { atendimentos: readonly number[]; inicio: string; fim: string; teto: number },
  ): Promise<{ itens: HorarioEnfermagem[]; cortada: boolean }> {
    if (o.atendimentos.length === 0) return Promise.resolve({ itens: [], cortada: false });
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_HORARIOS} AND h.atendimento_id IN (${marcadores(o.atendimentos.length)})
           AND h.previsto_em >= ? AND h.previsto_em < ? ORDER BY h.previsto_em, h.id LIMIT ?`,
        [est, ...o.atendimentos, instanteDe(o.inicio, fuso), instanteDe(o.fim, fuso), o.teto + 1],
      );
      const itens = await this.comFaixas(l, rs.slice(0, o.teto), fuso);
      return { itens, cortada: rs.length > o.teto };
    });
  }

  horario(c: ContextoEnfermagem, id: number): Promise<HorarioEnfermagem | null> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(`${SQL_HORARIOS} AND h.id = ?`, [est, id]);
      return (await this.comFaixas(l, rs, fuso))[0] ?? null;
    });
  }

  /** As faixas da escala de glicemia de cada item (prescricao_item_glicemia). */
  private async comFaixas(l: Leitor, rs: Linha[], fuso: string): Promise<HorarioEnfermagem[]> {
    const itens = [
      ...new Set(rs.filter((r) => booleano(r['glicemia'])).map((r) => num(r['prescricao_item_id']))),
    ];
    const faixas = new Map<number, HorarioEnfermagem['faixasGlicemia'][number][]>();
    if (itens.length > 0) {
      const fs = await l.consultar(
        `SELECT g.id, g.prescricao_item_id, g.glicemia_minima, g.glicemia_maxima, g.dose, up.sigla,
                g.item_prescritivel_id
           FROM prescricao_item_glicemia g LEFT JOIN unidade_prescricao up ON up.id = g.unidade_prescricao_id
          WHERE g.prescricao_item_id IN (${marcadores(itens.length)}) AND g.excluido_em IS NULL
          ORDER BY g.prescricao_item_id, g.glicemia_minima`,
        itens,
      );
      for (const f of fs) {
        const k = num(f['prescricao_item_id']);
        const lista = faixas.get(k) ?? [];
        lista.push({
          id: num(f['id']),
          de: num(f['glicemia_minima']),
          ate: f['glicemia_maxima'] === null ? 9999 : num(f['glicemia_maxima']),
          dose: numOuNulo(f['dose']),
          unidade: textoOuNulo(f['sigla']),
          produto: numOuNulo(f['item_prescritivel_id']),
        });
        faixas.set(k, lista);
      }
    }
    return rs.map((r) => horarioDe(r, fuso, faixas.get(num(r['prescricao_item_id'])) ?? []));
  }

  faixasDoHorario(
    c: ContextoEnfermagem,
    h: Pick<HorarioEnfermagem, 'id' | 'item' | 'previsto'>,
  ): Promise<{ id: number; situacao: string; faixa: number }[]> {
    // A faixa da escala é marcada no próprio horário pela checagem (o evento guarda a faixa): sem horários-filhos.
    void c;
    void h;
    return Promise.resolve([]);
  }

  historico(
    c: ContextoEnfermagem,
    id: number,
  ): Promise<{ eventos: EventoHistoricoHorario[]; cortado: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT e.ocorrido_em, e.evento, e.situacao_aprazamento_id, e.motivo, sc.categoria,
                (SELECT po.id FROM profissional_ocupacao po WHERE po.profissional_id = e.profissional_id
                  AND po.excluido_em IS NULL ORDER BY po.principal DESC, po.id LIMIT 1) AS ocupacao
           FROM horario_administracao_evento e
           JOIN horario_administracao h ON h.id = e.horario_administracao_id
           LEFT JOIN situacao_checagem sc ON sc.id = e.situacao_checagem_id
          WHERE h.id = ? AND h.estabelecimento_id = ? AND h.excluido_em IS NULL
          ORDER BY e.ocorrido_em, e.id LIMIT ?`,
        [id, est, TETO_HISTORICO + 1],
      );
      const eventos = rs.slice(0, TETO_HISTORICO).map((r) => {
        const extrato = ['aprazamento', 'reaprazamento', 'conferencia', 'etiqueta_impressa'].includes(
          texto(r['evento']),
        );
        return {
          quando: civilDe(r['ocorrido_em'], fuso) ?? '',
          origem: extrato ? ('extrato' as const) : ('historico' as const),
          situacao:
            r['categoria'] === null ? 'P' : letraDaSituacao(r['categoria'], r['evento'] === 'suspensao'),
          aprazamento: numOuNulo(r['situacao_aprazamento_id']),
          cbo: numOuNulo(r['ocupacao']),
          justificativa: textoOuNulo(r['motivo']),
        };
      });
      return { eventos, cortado: rs.length > TETO_HISTORICO };
    });
  }

  situacoes(c: ContextoEnfermagem, ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT h.id, h.suspenso, sc.categoria FROM horario_administracao h
           JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
          WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND h.id IN (${marcadores(ids.length)})`,
        [est, ...ids],
      );
      return new Map(rs.map((r) => [num(r['id']), letraDaSituacao(r['categoria'], r['suspenso'])]));
    });
  }

  mudancas(
    c: ContextoEnfermagem,
    o: { inicio: string; fim: string; desde: string },
  ): Promise<{ id: number; situacao: string; quando: string }[]> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT h.id, h.suspenso, sc.categoria, MAX(e.ocorrido_em) AS quando
           FROM horario_administracao_evento e
           JOIN horario_administracao h ON h.id = e.horario_administracao_id
           JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id
          WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL AND e.criado_em > ?
            AND h.previsto_em >= ? AND h.previsto_em < ?
          GROUP BY h.id, h.suspenso, sc.categoria ORDER BY quando LIMIT 5000`,
        [est, instanteDe(o.desde, fuso), instanteDe(o.inicio, fuso), instanteDe(o.fim, fuso)],
      );
      return rs.map((r) => ({
        id: num(r['id']),
        situacao: letraDaSituacao(r['categoria'], r['suspenso']),
        quando: civilDe(r['quando'], fuso) ?? '',
      }));
    });
  }

  vinculos(c: ContextoEnfermagem, login: string): Promise<VinculoEnfermagem[]> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT po.id, oc.codigo_cbo
           FROM usuario u
           JOIN usuario_vinculo_profissional v ON v.usuario_id = u.id AND v.estabelecimento_id = ?
                AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
                AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
           JOIN profissional_ocupacao po ON po.profissional_id = v.profissional_id AND po.ativo
                AND po.excluido_em IS NULL
           JOIN ocupacao_cbo oc ON oc.id = po.ocupacao_cbo_id
          WHERE u.login = ? AND u.excluido_em IS NULL
          ORDER BY po.principal DESC, po.id`,
        [est, login.trim().toLowerCase()],
      );
      return rs.map((r) => ({ cbo: num(r['id']), codigo: texto(r['codigo_cbo']) }));
    });
  }

  nomesVinculos(c: ContextoEnfermagem, cbos: readonly number[]): Promise<Map<number, string>> {
    if (cbos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l) => {
      // O profissional é da rede inteira (cadastro único de pessoas): sem filtro de estabelecimento.
      const rs = await l.consultar(
        `SELECT po.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome
           FROM profissional_ocupacao po
           JOIN profissional pr ON pr.id = po.profissional_id
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE po.id IN (${marcadores(cbos.length)})`,
        [...cbos],
      );
      return new Map(rs.map((r) => [num(r['id']), texto(r['nome'])]));
    });
  }

  laboratorio(
    c: ContextoEnfermagem,
    o: { paciente: number; de: string; ate: string },
  ): Promise<{ exame: string; nome: string; valor: number; quando: string }[]> {
    // Os resultados do laboratório são do módulo de exames (onda seguinte): a porta ainda não os lê.
    void c;
    void o;
    return Promise.resolve([]);
  }

  regrasHorario(
    c: ContextoEnfermagem,
  ): Promise<{ regras: RegraHorarioDaPorta[]; porBloco: ReadonlyMap<string, number> }> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT doses_por_dia, ordem_dose, horario FROM horario_padrao_dose
          WHERE estabelecimento_id = ? AND ativo AND grade_horario_unidade_id IS NULL
          ORDER BY doses_por_dia, ordem_dose`,
        [est],
      );
      if (rs.length === 0) return { regras: [], porBloco: new Map() };
      const grade = new Map<number, string[]>();
      for (const r of rs) {
        const k = num(r['doses_por_dia']);
        grade.set(k, [...(grade.get(k) ?? []), texto(r['horario']).slice(0, 5)]);
      }
      return {
        regras: [
          {
            id: est,
            tipoAtendimento: 'internacao',
            horarioInicial: null,
            considerar: null,
            padrao: true,
            grade,
          },
        ],
        porBloco: new Map(),
      };
    });
  }

  atos(c: ContextoEnfermagem, horarios: readonly number[]): Promise<AtoChecagem[]> {
    if (horarios.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT e.id, e.horario_administracao_id, e.evento, e.ocorrido_em, e.criado_em, e.quantidade_administrada,
                e.motivo, e.dados, sc.categoria, ${LOGIN_DE('e.usuario_id')} AS login
           FROM horario_administracao_evento e
           JOIN horario_administracao h ON h.id = e.horario_administracao_id
           LEFT JOIN situacao_checagem sc ON sc.id = e.situacao_checagem_id
          WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL
            AND e.evento IN ('checagem', 'nao_administrado', 'estorno')
            AND e.horario_administracao_id IN (${marcadores(horarios.length)})
          ORDER BY e.horario_administracao_id, e.ocorrido_em, e.id`,
        [est, ...horarios],
      );
      return rs.map((r) => atoDe(r, fuso));
    });
  }

  eventosInfusao(c: ContextoNucleo, horarios: readonly number[]): Promise<EventoInfusao[]> {
    if (horarios.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT e.id, e.horario_administracao_id, JSON_UNQUOTE(JSON_EXTRACT(e.dados, '$.infusao')) AS evento,
                e.velocidade_ml_h, e.volume_infundido_ml, e.ocorrido_em, ${LOGIN_DE('e.usuario_id')} AS login
           FROM horario_administracao_evento e JOIN horario_administracao h ON h.id = e.horario_administracao_id
          WHERE h.estabelecimento_id = ? AND e.horario_administracao_id IN (${marcadores(horarios.length)})
            AND e.evento LIKE 'infusao\\_%'
          ORDER BY e.ocorrido_em, e.id`,
        [est, ...horarios],
      );
      return rs.map((r) => ({
        id: num(r['id']),
        horario: num(r['horario_administracao_id']),
        evento: texto(r['evento']),
        velocidadeMlH: numOuNulo(r['velocidade_ml_h']),
        volumeInfundidoMl: numOuNulo(r['volume_infundido_ml']),
        horaReal: (civilDe(r['ocorrido_em'], fuso) ?? '').slice(0, 16),
        usuario: texto(r['login']),
      }));
    });
  }

  sinais(
    c: ContextoEnfermagem,
    o: { paciente: number; de: string; ate: string },
  ): Promise<{ itens: SinalVitalRegistrado[]; cortada: boolean }> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `${SQL_SINAIS} AND a.paciente_id = ? AND a.aferido_em >= ? AND a.aferido_em <= ?
          ORDER BY a.aferido_em, v.id LIMIT ?`,
        [est, o.paciente, instanteDe(o.de, fuso), instanteDe(o.ate, fuso), TETO_SINAIS + 1],
      );
      return {
        itens: rs.slice(0, TETO_SINAIS).map((r) => sinalDe(r, fuso)),
        cortada: rs.length > TETO_SINAIS,
      };
    });
  }

  sinalPorId(c: ContextoEnfermagem, id: number): Promise<SinalParaRetificar | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma(`${SQL_SINAL_QUALQUER} AND v.id = ?`, [est, id]);
      if (!r) return null;
      const s = sinalDe(r, fuso);
      return {
        id: s.id,
        paciente: s.paciente,
        atendimento: s.atendimento,
        horario: null,
        tipo: s.tipo,
        unidade: s.unidade,
        metodo: null,
        horaReal: s.horaReal,
        versao: s.versao,
        substituido: r['excluido_em'] !== null && r['excluido_em'] !== undefined,
      };
    });
  }

  ultimosSinais(c: ContextoEnfermagem, pacientes: readonly number[]): Promise<Map<number, string>> {
    if (pacientes.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT a.paciente_id, MAX(a.aferido_em) AS quando FROM afericao a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.paciente_id IN (${marcadores(pacientes.length)})
          GROUP BY a.paciente_id`,
        [est, ...pacientes],
      );
      return new Map(rs.map((r) => [num(r['paciente_id']), civilDe(r['quando'], fuso) ?? '']));
    });
  }

  aprazamentos(
    c: ContextoEnfermagem,
    horarios: readonly number[],
  ): Promise<Map<number, AprazamentoRegistrado>> {
    if (horarios.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT e.horario_administracao_id, e.evento, e.previsto_anterior_em, e.previsto_novo_em, e.motivo,
                ${LOGIN_DE('e.usuario_id')} AS login
           FROM horario_administracao_evento e
           JOIN horario_administracao h ON h.id = e.horario_administracao_id
          WHERE h.estabelecimento_id = ? AND h.excluido_em IS NULL
            AND e.evento IN ('aprazamento', 'reaprazamento', 'suspensao')
            AND e.horario_administracao_id IN (${marcadores(horarios.length)})
          ORDER BY e.ocorrido_em, e.id`,
        [est, ...horarios],
      );
      const m = new Map<number, AprazamentoRegistrado>();
      for (const r of rs) {
        const ev = texto(r['evento']);
        m.set(num(r['horario_administracao_id']), {
          horario: num(r['horario_administracao_id']),
          acao: ev === 'aprazamento' ? 'aprazar' : ev === 'reaprazamento' ? 'reaprazar' : 'suprimir',
          proposto: civilDe(r['previsto_anterior_em'], fuso) ?? '',
          confirmado: civilDe(r['previsto_novo_em'], fuso),
          motivo: textoOuNulo(r['motivo']),
          usuario: texto(r['login']),
        });
      }
      return m;
    });
  }

  conflitos(c: ContextoNucleo, o: { abertos: boolean }): Promise<ConflitoSincronizacao[]> {
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT k.id, k.horario_administracao_id, k.paciente_id, k.chave_ato, k.tipo, sc.categoria,
                k.desfecho_tentado, k.ocorrido_em, a.nome AS aparelho, k.criado_em, k.resolucao, k.resolvido_em,
                k.observacao, ${LOGIN_DE('k.criado_por')} AS login, ${LOGIN_DE('k.resolvido_por_usuario_id')} AS resolvido_login
           FROM conflito_sincronizacao_checagem k
           LEFT JOIN situacao_checagem sc ON sc.id = k.situacao_encontrada_id
           LEFT JOIN aparelho_beira_leito a ON a.id = k.aparelho_beira_leito_id
          WHERE k.estabelecimento_id = ? AND k.excluido_em IS NULL ${o.abertos ? 'AND k.resolvido_em IS NULL' : ''}
          ORDER BY k.ocorrido_em DESC, k.id DESC LIMIT 500`,
        [est],
      );
      return rs.map((r) => ({
        id: num(r['id']),
        horario: num(r['horario_administracao_id']),
        paciente: num(r['paciente_id']),
        chave: texto(r['chave_ato']),
        tipo: TIPO_CONFLITO_CONTRATO[texto(r['tipo'])] ?? 'mudou',
        situacaoEncontrada: r['tipo'] === 'suspenso' ? 'S' : letraDaSituacao(r['categoria'], false),
        desfechoTentado: texto(r['desfecho_tentado']),
        horaReal: (civilDe(r['ocorrido_em'], fuso) ?? '').slice(0, 16),
        dispositivo: textoOuNulo(r['aparelho']),
        usuario: texto(r['login']),
        registradoEm: (civilDe(r['criado_em'], fuso) ?? '').slice(0, 16),
        resolucao: textoOuNulo(r['resolucao']),
        resolvidoPor: textoOuNulo(r['resolvido_login']),
        resolvidoEm: civilDe(r['resolvido_em'], fuso)?.slice(0, 16) ?? null,
        observacao: textoOuNulo(r['observacao']),
      }));
    });
  }

  passagens(c: ContextoEnfermagem, o: { unidade?: string; id?: number }): Promise<PassagemPlantao[]> {
    return this.ler(c, async (l, est, fuso) => {
      const filtros: string[] = [];
      const params: unknown[] = [est];
      if (o.id !== undefined) {
        filtros.push('pt.id = ?');
        params.push(o.id);
      }
      if (o.unidade !== undefined) {
        filtros.push('u.codigo = ?');
        params.push(o.unidade);
      }
      const rs = await l.consultar(
        `SELECT pt.id, u.codigo AS unidade, pt.situacao, pt.iniciada_em, pt.aceita_em, pt.motivo_recusa,
                pt.cancelada_em, pt.motivo_cancelamento, pt.observacao_geral, tp.codigo AS turno,
                tp.hora_inicio, tp.hora_fim,
                ${LOGIN_DE('pt.criado_por')} AS passado_por,
                (SELECT us.login FROM usuario_vinculo_profissional vp JOIN usuario us ON us.id = vp.usuario_id
                  WHERE vp.profissional_id = pt.recebe_profissional_id AND vp.estabelecimento_id = pt.estabelecimento_id
                    AND vp.excluido_em IS NULL ORDER BY vp.vigencia_inicio DESC LIMIT 1) AS recebedor,
                ${LOGIN_DE('pt.alterado_por')} AS alterado_por
           FROM passagem_turno pt
           JOIN unidade_internacao u ON u.id = pt.unidade_internacao_id
           LEFT JOIN turno_padrao tp ON tp.id = pt.turno_padrao_id
          WHERE pt.estabelecimento_id = ? AND pt.excluido_em IS NULL AND pt.categoria = 'enfermagem'
            ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
          ORDER BY pt.iniciada_em DESC, pt.id DESC LIMIT 100`,
        params,
      );
      const ids = rs.map((r) => num(r['id']));
      const notas = new Map<number, PassagemPlantao['notas']>();
      if (ids.length > 0) {
        const ns = await l.consultar(
          `SELECT passagem_turno_id, atendimento_id, paciente_id, observacao_enfermagem, pendencias
             FROM passagem_turno_paciente
            WHERE passagem_turno_id IN (${marcadores(ids.length)}) AND excluido_em IS NULL
            ORDER BY passagem_turno_id, sequencia`,
          ids,
        );
        for (const n of ns) {
          const sbar = lerJson<Record<string, string | null>>(n['observacao_enfermagem']) ?? {};
          const k = num(n['passagem_turno_id']);
          notas.set(k, [
            ...(notas.get(k) ?? []),
            {
              atendimento: num(n['atendimento_id']),
              paciente: num(n['paciente_id']),
              situacao: sbar['situacao'] ?? null,
              historia: sbar['historia'] ?? null,
              avaliacao: sbar['avaliacao'] ?? null,
              recomendacao: sbar['recomendacao'] ?? null,
              pendencias: lerJson<PassagemPlantao['notas'][number]['pendencias']>(n['pendencias']) ?? [],
            },
          ]);
        }
      }
      return rs.map((r) => {
        const situacao = texto(r['situacao']);
        const passadoEm = civilDe(r['iniciada_em'], fuso) ?? '';
        return {
          id: num(r['id']),
          unidade: texto(r['unidade']),
          turno: r['turno'] === 'noturno' ? 'noturno' : 'diurno',
          data: dataDoTurno(passadoEm, textoOuNulo(r['hora_inicio']), textoOuNulo(r['hora_fim'])),
          passadoPor: texto(r['passado_por']),
          recebedor: texto(r['recebedor']),
          situacao:
            situacao === 'aceita' || situacao === 'recusada' || situacao === 'cancelada'
              ? situacao
              : ('aguardandoAceite' as const),
          passadoEm: civilDe(r['iniciada_em'], fuso) ?? '',
          respondidoEm: civilDe(r['aceita_em'], fuso),
          observacao: textoOuNulo(r['motivo_recusa']) ?? textoOuNulo(r['observacao_geral']),
          cancelamento:
            situacao === 'cancelada'
              ? {
                  motivo: texto(r['motivo_cancelamento']),
                  por: texto(r['alterado_por']),
                  em: civilDe(r['cancelada_em'], fuso) ?? '',
                }
              : null,
          notas: [...(notas.get(num(r['id'])) ?? [])],
        };
      });
    });
  }

  dispositivos(c: ContextoNucleo): Promise<AparelhoBeiraLeito[]> {
    return this.ler(c, async (l, est, fuso) =>
      (await l.consultar(`${SQL_APARELHOS} ORDER BY a.nome, a.id`, [est])).map((r) => aparelhoDe(r, fuso)),
    );
  }

  dispositivoAutorizado(c: ContextoNucleo, identificador: string): Promise<AparelhoBeiraLeito | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = await l.uma<Record<string, unknown>>(
        `${SQL_APARELHOS} AND a.ativo AND a.identificador_hash = ?`,
        [est, hashDoAparelho(est, identificador)],
      );
      return r ? aparelhoDe(r, fuso) : null;
    });
  }

  extrasContingencia(
    c: ContextoEnfermagem,
    o: {
      unidade: string;
      pacientes: readonly number[];
      atendimentos: readonly number[];
      prescricoes: readonly number[];
    },
  ): Promise<ExtrasContingencia> {
    return this.ler(c, async (l) => {
      const alergias = new Map<number, string[]>();
      if (o.pacientes.length > 0) {
        // A alergia é do paciente na rede inteira (vale em qualquer estabelecimento).
        const rs = await l.consultar(
          `SELECT a.paciente_id, COALESCE(a.descricao_livre, al.descricao) AS nome
             FROM alergia_paciente a LEFT JOIN alergeno al ON al.id = a.alergeno_id
            WHERE a.paciente_id IN (${marcadores(o.pacientes.length)}) AND a.ativa AND a.excluido_em IS NULL
              AND a.tipo_registro IN ('alergia', 'intolerancia')
            ORDER BY a.paciente_id, a.id`,
          [...o.pacientes],
        );
        for (const r of rs) {
          const k = num(r['paciente_id']);
          alergias.set(k, [...(alergias.get(k) ?? []), texto(r['nome'])]);
        }
      }
      return { alergias, problemas: [], justificativas: [], amostras: [], limpezas: [], naoLidos: [] };
    });
  }
}

/** A regra de horário que a porta devolve (a grade padrão por doses do estabelecimento). */
type RegraHorarioDaPorta = Awaited<ReturnType<PortaEnfermagem['regrasHorario']>>['regras'][number];

function lerJson<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return null;
  }
}

function internadoDe(r: Linha): Internado {
  return {
    paciente: num(r['paciente_id']),
    atendimento: num(r['atendimento_id']),
    numero: num(r['numero_prontuario']),
    nome: texto(r['nome']),
    leito: texto(r['leito']),
    unidade: texto(r['unidade']),
    alergia: booleano(r['alergia']),
  };
}

function horarioDe(r: Linha, fuso: string, faixas: HorarioEnfermagem['faixasGlicemia']): HorarioEnfermagem {
  const categoria = texto(r['tipo_categoria']);
  const tipo: TipoHorario = booleano(r['glicemia']) ? 'glicemia' : (TIPO_DA_CATEGORIA[categoria] ?? 'outro');
  const velocidade = numOuNulo(r['velocidade_infusao']);
  return {
    id: num(r['id']),
    item: num(r['prescricao_item_id']),
    prescricao: num(r['prescricao_id']),
    atendimento: num(r['atendimento_id']),
    previsto: civilDe(r['previsto_em'], fuso) ?? '',
    situacao: letraDaSituacao(r['categoria'], r['suspenso']),
    checadoEm: ['administrado', 'nao_administrado', 'administrado_parcial', 'recusado_paciente'].includes(
      texto(r['categoria']),
    )
      ? civilDe(r['situacao_checagem_em'], fuso)
      : null,
    cboChecagem: numOuNulo(r['ocupacao_checagem']),
    quantidade: numOuNulo(r['quantidade_administrada']),
    tipo,
    descricao: texto(r['descricao']),
    dose: numOuNulo(r['dose']) ?? numOuNulo(r['quantidade_item']),
    unidadeDose: textoOuNulo(r['unidade_dose']),
    via: textoOuNulo(r['via']),
    produto: numOuNulo(r['produto']),
    barras: textoOuNulo(r['codigo_barras']),
    seNecessario: booleano(r['se_necessario']),
    altaVigilancia: false,
    antimicrobiano: booleano(r['antimicrobiano']),
    duplaMarcada: booleano(r['dupla']),
    hemocomponente: tipo === 'hemoterapia',
    infusao:
      tipo === 'solucao'
        ? { solucao: num(r['prescricao_item_id']), velocidadeMlH: velocidade, ajustavel: true }
        : null,
    faixasGlicemia: faixas,
    faixa: null,
    procedimento: null,
    aprazamento: numOuNulo(r['situacao_aprazamento_id']),
    numDoses: numOuNulo(r['dias_tratamento']),
    observacaoMedica: textoOuNulo(r['observacao_enfermagem']),
  };
}

function atoDe(r: Linha, fuso: string): AtoChecagem {
  const d = lerJson<Record<string, unknown>>(r['dados']) ?? {};
  const estorno = r['evento'] === 'estorno';
  const avisos = Array.isArray(d['avisos']) ? (d['avisos'] as unknown[]).map(String).join(' | ') : null;
  return {
    id: num(r['id']),
    horario: num(r['horario_administracao_id']),
    tipo: estorno ? 'estorno' : 'checagem',
    situacao: estorno ? 'P' : letraDaSituacao(r['categoria'], false),
    horaReal: civilDe(r['ocorrido_em'], fuso) ?? '',
    gravadoEm: civilDe(r['criado_em'], fuso) ?? '',
    usuario: texto(r['login']),
    quantidade: numOuNulo(r['quantidade_administrada']),
    motivo: estorno ? textoOuNulo(d['motivo']) : textoOuNulo(d['motivo'] ?? null),
    observacao: estorno ? textoOuNulo(r['motivo']) : textoOuNulo(d['observacao'] ?? null),
    pulseiraLida: d['pulseiraLida'] === true,
    motivoSemPulseira: textoOuNulo(d['motivoSemPulseira'] ?? null),
    gtin: textoOuNulo(d['gtin'] ?? null),
    lote: textoOuNulo(d['lote'] ?? null),
    validade: textoOuNulo(d['validade'] ?? null),
    conferente: textoOuNulo(d['conferente'] ?? null),
    dispositivo: textoOuNulo(d['dispositivo'] ?? null),
    origemOffline: d['origemOffline'] === true,
    avisos: avisos || null,
  };
}

/**
 * A data do turno da passagem (até o pedido da coluna passagem_turno.data_referencia): a data civil da passagem, ou a
 * do dia anterior quando o turno passa da meia-noite e a passagem foi feita antes do fim dele.
 */
export function dataDoTurno(passadoEm: string, inicio: string | null, fim: string | null): string {
  const dia = passadoEm.slice(0, 10);
  if (!dia || !inicio || !fim || fim >= inicio) return dia;
  if (passadoEm.slice(11, 19) >= fim.slice(0, 8)) return dia;
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sinalDe(r: Linha, fuso: string): SinalVitalRegistrado {
  return {
    id: num(r['id']),
    paciente: num(r['paciente_id']),
    atendimento: numOuNulo(r['atendimento_id']),
    horario: null,
    tipo: texto(r['codigo']),
    valor: num(r['valor_numerico']),
    unidade: texto(r['unidade']),
    metodo: null,
    foraDaFaixa: foraDaFaixa(r['nivel_alerta']),
    horaReal: civilDe(r['aferido_em'], fuso) ?? '',
    versao: num(r['versao']),
    anterior: numOuNulo(r['anterior']),
    justificativa:
      r['anterior'] === null || r['anterior'] === undefined ? null : textoOuNulo(r['justificativa']),
    usuario: texto(r['login']),
  };
}

/** O gravador direto sobre a transação do Executor (estabelecimento conferido). */
function gravadorEnfermagem(tx: TxOperacao, est: number, anotacao: AnotacaoGravacao): GravadorSghEnfermagem {
  const fusoP = fusoDe(tx, est);
  const profissional = () => exigirProfissional(tx, tx.contexto, est);
  const aparelhoTravado = async (id: number) => {
    const [d] = await tx.consultarParaAtualizar<Record<string, unknown>>(
      `SELECT id, versao, identificador_hash FROM aparelho_beira_leito
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!d) throw recusa('dispositivo-inexistente', 'O aparelho não foi encontrado.');
    return d;
  };
  const conferirHorarioDoPaciente = async (horario: number, paciente: number) => {
    const h = await tx.uma(
      `SELECT h.id FROM horario_administracao h JOIN atendimento a ON a.id = h.atendimento_id
        WHERE h.id = ? AND h.estabelecimento_id = ? AND a.paciente_id = ?`,
      [horario, est, paciente],
    );
    if (!h) throw recusa('horario-inexistente', 'O horário não é deste paciente neste estabelecimento.');
  };
  const unidadeInternacao = async (codigo: string) => {
    const u = await tx.uma<{ id: number; setor_funcional_id: number | null }>(
      'SELECT id, setor_funcional_id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ? AND excluido_em IS NULL',
      [est, codigo],
    );
    if (!u)
      throw recusa(
        'unidade-inexistente',
        'A unidade de internação não foi encontrada neste estabelecimento.',
      );
    if (u.setor_funcional_id === null)
      throw recusa('cadastro-incompleto', 'A unidade de internação não tem o setor funcional no cadastro.');
    return { id: Number(u.id), setor: Number(u.setor_funcional_id) };
  };
  const passagemTravada = async (id: number) => {
    const [p] = await tx.consultarParaAtualizar<Record<string, unknown>>(
      `SELECT id, versao, situacao, entrega_profissional_id, recebe_profissional_id FROM passagem_turno
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
    );
    if (!p) throw recusa('passagem-inexistente', 'A passagem de plantão não foi encontrada.');
    return p;
  };
  return {
    async gravarSinal(r) {
      await conferirAtendimento(tx, est, r.atendimento, r.paciente);
      const pv = await tx.uma<{ id: number; alerta_minimo: unknown; alerta_maximo: unknown }>(
        'SELECT id, alerta_minimo, alerta_maximo FROM parametro_vital WHERE codigo = ? AND ativo',
        [r.tipo],
      );
      if (!pv)
        throw recusa(
          'cadastro-incompleto',
          `O cadastro dos parâmetros vitais não tem "${r.tipo}": peça a carga ao administrador.`,
        );
      const afericao = await tx.incluir('afericao', {
        estabelecimento_id: est,
        paciente_id: r.paciente,
        atendimento_id: r.atendimento,
        profissional_id: await profissional(),
        aferido_em: instanteDe(r.horaReal, await fusoP),
        fonte: r.origemOffline ? 'dispositivo' : 'manual',
        finalizada: true,
        observacao: r.observacao,
      });
      return tx.incluir('afericao_valor', {
        afericao_id: afericao,
        sequencia: 1,
        parametro_vital_id: Number(pv.id),
        valor_numerico: r.valor,
        nivel_alerta: r.foraDaFaixa ? 'atencao' : 'normal',
      });
    },
    async retificarSinal(r) {
      // A retificação nunca altera o valor gravado: a linha vigente é marcada como substituída e a nova entra na mesma
      // aferição (próxima sequência), com a justificativa e o valor anterior na trilha.
      const [v] = await tx.consultarParaAtualizar<Linha>(
        `SELECT v.id, v.versao, v.afericao_id, v.sequencia, v.parametro_vital_id, v.valor_numerico, v.nivel_alerta,
                v.unidade_medida_id, v.excluido_em,
                (SELECT COUNT(*) FROM afericao_valor o WHERE o.afericao_id = v.afericao_id
                  AND o.parametro_vital_id = v.parametro_vital_id AND o.sequencia < v.sequencia
                  AND o.excluido_em IS NOT NULL) + 1 AS versao_sinal
           FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id
          WHERE v.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL AND NOT v.nao_aferido`,
        [r.id, est],
      );
      if (!v) throw recusa('sinal-inexistente', 'O sinal vital não foi encontrado.');
      if (v['excluido_em'] !== null)
        throw recusa('sinal-ja-retificado', 'Este registro já foi retificado: retifique a versão vigente.');
      if (r.versao !== undefined && num(v['versao_sinal']) !== r.versao) throw erroConflitoVersao(['versao']);
      const justificativa = r.justificativa.trim();
      if (!justificativa) throw recusa('justificativa-obrigatoria', 'A retificação exige a justificativa.');
      await tx.alterar('afericao_valor', num(v['id']), num(v['versao']), {
        excluido_em: new Date(),
        excluido_por: tx.contexto.usuario,
      });
      const seq = await tx.uma<{ n: number }>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS n FROM afericao_valor WHERE afericao_id = ?',
        [num(v['afericao_id'])],
      );
      const novo = await tx.incluir('afericao_valor', {
        afericao_id: num(v['afericao_id']),
        sequencia: num(seq?.n ?? 1),
        parametro_vital_id: num(v['parametro_vital_id']),
        valor_numerico: r.valor,
        unidade_medida_id: numOuNulo(v['unidade_medida_id']),
        nivel_alerta: r.foraDaFaixa ? 'atencao' : 'normal',
      });
      anotacao.motivo = justificativa;
      anotacao.dados = {
        retificacao: {
          anterior: num(v['id']),
          valorAnterior: v['valor_numerico'] === null ? null : Number(v['valor_numerico']),
          alertaAnterior: textoOuNulo(v['nivel_alerta']),
          valorNovo: r.valor,
          versao: num(v['versao_sinal']) + 1,
        },
      };
      return novo;
    },
    async gravarEventoInfusao(r) {
      const evento = EVENTO_INFUSAO_BANCO[r.evento];
      if (!evento)
        throw recusa('evento-infusao-invalido', `O evento "${r.evento}" da infusão contínua não existe.`);
      await conferirHorarioDoPaciente(r.horario, r.paciente);
      return tx.incluir('horario_administracao_evento', {
        horario_administracao_id: r.horario,
        operacao: 'inclusao',
        dados: JSON.stringify({ infusao: r.evento, solucao: r.solucao }),
        ocorrido_em: instanteDe(r.horaReal, await fusoP),
        usuario_id: tx.contexto.usuario,
        evento,
        profissional_id: await profissional(),
        velocidade_ml_h: r.velocidadeMlH,
        volume_infundido_ml: r.volumeMl,
        motivo: r.observacao?.slice(0, 500) ?? null,
      });
    },
    async gravarAprazamento(r) {
      // A operação do aprazamento já gravou o horário e o evento: a confirmação devolve o evento dela.
      const e = await tx.uma<{ id: number }>(
        `SELECT e.id FROM horario_administracao_evento e JOIN horario_administracao h ON h.id = e.horario_administracao_id
          WHERE h.id = ? AND h.estabelecimento_id = ? AND e.evento IN ('aprazamento', 'reaprazamento', 'suspensao')
          ORDER BY e.id DESC LIMIT 1`,
        [r.horario, est],
      );
      if (!e) throw recusa('horario-mudou', 'O aprazamento do horário não foi gravado: nada foi confirmado.');
      return Number(e.id);
    },
    async registrarConflito(r) {
      const chave = r.chave.trim().slice(0, 80);
      const ja = await tx.uma<{ id: number }>(
        'SELECT id FROM conflito_sincronizacao_checagem WHERE estabelecimento_id = ? AND chave_ato = ?',
        [est, chave],
      );
      if (ja) return { id: Number(ja.id), novo: false };
      await conferirHorarioDoPaciente(r.horario, r.paciente);
      const aparelho = r.dispositivo
        ? await tx.uma<{ id: number }>(
            'SELECT id FROM aparelho_beira_leito WHERE estabelecimento_id = ? AND identificador_hash = ? AND excluido_em IS NULL',
            [est, hashDoAparelho(est, r.dispositivo)],
          )
        : null;
      if (r.aparelhoExigido && !aparelho)
        throw recusa(
          'aparelho-nao-autorizado',
          'O aparelho não está autorizado na beira do leito deste estabelecimento.',
        );
      const categoria = Object.entries(LETRA_DA_CATEGORIA).find(([, l]) => l === r.situacaoEncontrada)?.[0];
      const situacao =
        categoria && r.situacaoEncontrada !== 'S'
          ? await tx.uma<{ id: number }>(
              'SELECT id FROM situacao_checagem WHERE categoria = ? AND ativo ORDER BY ordem IS NULL, ordem, id LIMIT 1',
              [categoria],
            )
          : null;
      const id = await tx.incluir('conflito_sincronizacao_checagem', {
        estabelecimento_id: est,
        horario_administracao_id: r.horario,
        paciente_id: r.paciente,
        chave_ato: chave,
        tipo: TIPO_CONFLITO_BANCO[r.tipo],
        situacao_encontrada_id: situacao ? Number(situacao.id) : null,
        desfecho_tentado: r.desfechoTentado.slice(0, 20),
        ocorrido_em: instanteDe(r.horaReal, await fusoP),
        aparelho_beira_leito_id: aparelho ? Number(aparelho.id) : null,
      });
      return { id, novo: true };
    },
    async resolverConflito(r) {
      const [k] = await tx.consultarParaAtualizar<{ id: number; versao: number; resolvido_em: unknown }>(
        `SELECT id, versao, resolvido_em FROM conflito_sincronizacao_checagem
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [r.id, est],
      );
      if (!k || k.resolvido_em !== null)
        throw recusa('conflito-resolvido', 'O conflito não existe ou já foi resolvido.');
      await tx.alterar('conflito_sincronizacao_checagem', r.id, Number(k.versao), {
        resolucao: r.resolucao.slice(0, 30),
        resolvido_por_usuario_id: tx.contexto.usuario,
        resolvido_em: new Date(),
        observacao: r.observacao.slice(0, 500),
      });
      return r.id;
    },
    async passarPlantao(r) {
      const u = await unidadeInternacao(r.unidade);
      const entrega = await profissional();
      const recebe = await profissionalDoLogin(tx, r.recebedor, est);
      if (recebe === null)
        throw recusa(
          'recebedor-invalido',
          'Quem recebe o plantão não tem vínculo de profissional neste estabelecimento.',
        );
      if (recebe === entrega) throw recusa('recebedor-invalido', 'O plantão é passado a outro profissional.');
      const turno = await tx.uma<{ id: number }>('SELECT id FROM turno_padrao WHERE codigo = ? AND ativo', [
        r.turno,
      ]);
      if (!turno)
        throw recusa(
          'cadastro-incompleto',
          `O cadastro dos turnos não tem "${r.turno}": peça a carga ao administrador.`,
        );
      for (const n of r.notas) await conferirAtendimento(tx, est, n.atendimento, n.paciente);
      const id = await tx.incluir('passagem_turno', {
        estabelecimento_id: est,
        setor_funcional_id: u.setor,
        unidade_internacao_id: u.id,
        categoria: 'enfermagem',
        entrega_profissional_id: entrega,
        recebe_profissional_id: recebe,
        iniciada_em: new Date(),
        situacao: 'aguardando_aceite',
        turno_padrao_id: Number(turno.id),
      });
      let seq = 0;
      for (const n of r.notas)
        await tx.incluir('passagem_turno_paciente', {
          passagem_turno_id: id,
          sequencia: ++seq,
          atendimento_id: n.atendimento,
          paciente_id: n.paciente,
          observacao_enfermagem: JSON.stringify({
            situacao: n.situacao,
            historia: n.historia,
            avaliacao: n.avaliacao,
            recomendacao: n.recomendacao,
          }),
          pendencias: JSON.stringify(n.pendencias),
        });
      return id;
    },
    async responderPlantao(r) {
      const p = await passagemTravada(r.id);
      if (p['situacao'] !== 'aguardando_aceite')
        throw recusa('passagem-respondida', 'A passagem já foi respondida ou cancelada.');
      if (num(p['recebe_profissional_id']) !== (await profissional()))
        throw recusa('nao-recebedor', 'Só quem recebe o plantão responde a passagem.');
      await tx.alterar('passagem_turno', r.id, num(p['versao']), {
        situacao: r.aceite ? 'aceita' : 'recusada',
        aceita_em: r.aceite ? new Date() : null,
        motivo_recusa: r.aceite ? null : r.observacao,
      });
      return r.id;
    },
    async cancelarPlantao(r) {
      const p = await passagemTravada(r.id);
      if (p['situacao'] !== 'aguardando_aceite')
        throw recusa('passagem-respondida', 'A passagem já foi respondida: não pode mais ser cancelada.');
      const eu = await profissional();
      if (num(p['entrega_profissional_id']) !== eu)
        throw recusa('nao-autor', 'Só quem passou o plantão cancela a passagem.');
      await tx.alterar('passagem_turno', r.id, num(p['versao']), {
        situacao: 'cancelada',
        cancelada_em: new Date(),
        cancelamento_profissional_id: eu,
        motivo_cancelamento: r.motivo,
      });
      return r.id;
    },
    async gravarDispositivo(r) {
      const u = await unidadeInternacao(r.unidade);
      const hash = hashDoAparelho(est, r.identificador);
      if (
        await tx.uma(
          'SELECT id FROM aparelho_beira_leito WHERE estabelecimento_id = ? AND identificador_hash = ?',
          [est, hash],
        )
      )
        throw recusa('dispositivo-existente', 'Este aparelho já está autorizado.');
      return tx.incluir('aparelho_beira_leito', {
        estabelecimento_id: est,
        unidade_internacao_id: u.id,
        nome: r.nome.trim().slice(0, 80),
        tipo: r.tipo,
        identificador_hash: hash,
        ativo: true,
      });
    },
    async alterarDispositivo(r) {
      const d = await aparelhoTravado(r.id);
      if (!r.motivo || r.motivo.trim().length < 10)
        throw recusa('motivo-obrigatorio', 'Descreva o motivo da alteração do aparelho.');
      await tx.alterar('aparelho_beira_leito', r.id, num(d['versao']), {
        ...(r.ativo !== undefined ? { ativo: r.ativo } : {}),
        ...(r.nome !== undefined ? { nome: r.nome.trim().slice(0, 80) } : {}),
        ...(r.unidade !== undefined
          ? { unidade_internacao_id: (await unidadeInternacao(r.unidade)).id }
          : {}),
        motivo_alteracao: r.motivo.trim().slice(0, 300),
      });
      return r.id;
    },
    async excluirDispositivo(r) {
      const d = await aparelhoTravado(r.id);
      const conflitos = num(
        (
          await tx.uma<{ n: number }>(
            'SELECT COUNT(*) AS n FROM conflito_sincronizacao_checagem WHERE aparelho_beira_leito_id = ? AND excluido_em IS NULL',
            [r.id],
          )
        )?.n ?? 0,
      );
      // As checagens feitas no aparelho guardam o identificador no evento do horário: conferidas pelo resumo.
      const checagens = num(
        (
          await tx.uma<{ n: number }>(
            `SELECT COUNT(*) AS n FROM horario_administracao_evento e
               JOIN horario_administracao h ON h.id = e.horario_administracao_id
              WHERE h.estabelecimento_id = ? AND e.canal_registro = 'beira_leito'
                AND SHA2(CONCAT(?, ':', TRIM(JSON_UNQUOTE(JSON_EXTRACT(e.dados, '$.dispositivo')))), 256) = ?`,
            [est, String(est), texto(d['identificador_hash'])],
          )
        )?.n ?? 0,
      );
      if (checagens + conflitos > 0) {
        const grupos = [
          ...(checagens ? [`${checagens} checagens feitas no aparelho`] : []),
          ...(conflitos ? [`${conflitos} conflitos de sincronização do aparelho`] : []),
        ];
        throw recusa(
          'dispositivo-com-leituras',
          `O aparelho tem ${checagens + conflitos} leitura(s) vinculada(s) (${grupos.join('; ')}): não pode ser excluído. Retire-o do modo beira do leito (inativar).`,
        );
      }
      const v = await tx.alterar('aparelho_beira_leito', r.id, num(d['versao']), {
        motivo_alteracao: r.motivo.trim().slice(0, 300),
      });
      await tx.excluir('aparelho_beira_leito', r.id, v);
      return r.id;
    },
    async marcarSincronismo(r) {
      const [d] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
        `SELECT id, versao FROM aparelho_beira_leito
          WHERE estabelecimento_id = ? AND identificador_hash = ? AND ativo AND excluido_em IS NULL`,
        [est, hashDoAparelho(est, r.identificador)],
      );
      if (!d) return false;
      await tx.alterar('aparelho_beira_leito', Number(d.id), Number(d.versao), {
        ultimo_sincronismo_em: new Date(),
      });
      return true;
    },
    async registrarEstornoPedido(r) {
      // A operação do estorno já gravou o evento com o motivo: o pedido devolve o evento dela.
      const e = await tx.uma<{ id: number }>(
        `SELECT e.id FROM horario_administracao_evento e JOIN horario_administracao h ON h.id = e.horario_administracao_id
          WHERE h.id = ? AND h.estabelecimento_id = ? AND e.evento = 'estorno' ORDER BY e.id DESC LIMIT 1`,
        [r.horario, est],
      );
      if (!e) throw recusa('horario-mudou', 'O estorno do horário não foi gravado.');
      return Number(e.id);
    },
    async gravarRespostaExt(r) {
      const componente = COMPONENTE_EXTENSAO_BANCO[r.componente];
      if (!componente) throw recusa('componente-invalido', 'O componente da resposta de extensão não existe.');
      const chave = r.chave.trim().slice(0, 80);
      if (!chave) throw recusa('chave-obrigatoria', 'A resposta de extensão exige a chave do item.');
      if (r.valor === null && r.referencia === null)
        throw recusa('resposta-vazia', 'A resposta de extensão exige o valor ou o registro ligado.');
      const registro = await tx.uma<{ id: number }>(
        `SELECT id FROM registro_assistencial
          WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL`,
        [r.registro, est, r.paciente],
      );
      if (!registro)
        throw recusa(
          'registro-inexistente',
          'O registro do formulário não foi encontrado para este paciente neste estabelecimento: nada foi gravado.',
        );
      const [ja] = await tx.consultarParaAtualizar<{ id: number; versao: number }>(
        `SELECT id, versao FROM registro_assistencial_extensao
          WHERE registro_assistencial_id = ? AND componente = ? AND chave = ? AND excluido_em IS NULL`,
        [r.registro, componente, chave],
      );
      if (ja) {
        await tx.alterar('registro_assistencial_extensao', Number(ja.id), Number(ja.versao), {
          valor: r.valor,
          referencia_id: r.referencia,
        });
        return Number(ja.id);
      }
      return tx.incluir('registro_assistencial_extensao', {
        registro_assistencial_id: r.registro,
        componente,
        chave,
        valor: r.valor,
        referencia_id: r.referencia,
      });
    },
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaEnfermagemIndisponivel(): PortaEnfermagem {
  return portaIndisponivel<PortaEnfermagem>(METODOS_PORTA_ENFERMAGEM);
}
