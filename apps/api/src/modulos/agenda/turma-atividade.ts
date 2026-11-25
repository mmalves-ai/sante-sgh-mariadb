// Agenda de grupos e turmas (02-AGE linha 50) sobre turma_atividade, turma_escala, turma_profissional,
// turma_fonte_pagadora, turma_encontro, turma_participante e turma_presenca. A regra é do domínio (@sgh/dominio-agenda:
// validarTurma, validarEscala, gerarEncontros, decidirInscricao, decidirSaida, decidirPromocao, validarPresenca,
// validarCancelamentoEncontro, frequencia); aqui ficam a leitura, a contagem sob trava e as gravações pelo executor
// (trilha na mesma transação). Nada se apaga: profissional retirado ganha fim de vigência, fonte retirada ganha
// excluido_em, encontro cancelado fica com o motivo, participação encerrada fica com a data e o motivo. Cada inscrição é
// uma participação própria (linha nova ao voltar quem saiu; migração 05_AGE/92): a encerrada guarda as presenças dela e a
// frequência de cada participação conta só os encontros dela.
import {
  decidirInscricao,
  decidirPromocao,
  decidirSaida,
  type FonteDaTurma,
  frequencia,
  gerarEncontros,
  SAIDAS_PARTICIPANTE,
  SITUACOES_PRESENCA,
  type SituacaoEncontro,
  type SituacaoParticipante,
  type SituacaoPresenca,
  validarCancelamentoEncontro,
  validarEscala,
  validarPresenca,
  validarTurma,
} from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { lerDiasSemExpediente } from './dias-sem-expediente-leitor.js';
import { instanteDe, localDe, type NucleoAgenda } from './porta-propria.js';

const num = (v: unknown): number => Number(v);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const bool = (v: unknown) => v === true || Number(v) === 1;
const horaCurta = (v: unknown) => String(v).slice(0, 5);
const instante = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

const dataTexto = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const horaTexto = z.string().regex(/^\d{2}:\d{2}$/, 'Hora no formato HH:MM.');
const id = z.number().int().positive();
const idOuNulo = id.nullable();
const textoLivre = (max: number) => z.string().max(max).nullable();

export const esquemaSalvarTurma = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    codigo: z.string().min(1).max(30),
    descricao: z.string().min(1).max(150),
    tipo: id,
    itemAgendavel: id,
    setorFuncional: id,
    localFisico: idOuNulo,
    dataInicio: dataTexto,
    dataFim: dataTexto.nullable(),
    vagas: z.number().int().min(1).max(999),
    vagasEncaixe: z.number().int().min(0).max(999),
    exigeAcompanhante: z.boolean(),
    permiteAcompanhante: z.boolean(),
    exigeIndicacaoMedica: z.boolean(),
    idadeMinimaAnos: z.number().int().min(0).max(130).nullable(),
    idadeMaximaAnos: z.number().int().min(0).max(130).nullable(),
    sexo: idOuNulo,
    ativo: z.boolean(),
    profissionais: z.array(z.object({ profissional: id, principal: z.boolean() }).strict()).max(30),
    fontes: z
      .array(
        z
          .object({ fontePagadora: id, plano: idOuNulo, limite: z.number().int().min(1).max(999).nullable() })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .refine((e) => e.id === undefined || e.versao !== undefined, {
    message: 'Informe a versão da turma que está sendo alterada.',
    path: ['versao'],
  });
export type EntradaSalvarTurma = z.infer<typeof esquemaSalvarTurma>;

export const esquemaSalvarEscala = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    turma: id,
    diaSemana: z.number().int().min(1).max(7),
    horaInicio: horaTexto,
    horaFim: horaTexto,
    inclusiveFeriado: z.boolean(),
    vigenciaInicio: dataTexto,
    vigenciaFim: dataTexto.nullable(),
    ativo: z.boolean(),
  })
  .strict()
  .refine((e) => e.id === undefined || e.versao !== undefined, {
    message: 'Informe a versão da escala que está sendo alterada.',
    path: ['versao'],
  });
export type EntradaSalvarEscala = z.infer<typeof esquemaSalvarEscala>;

export const esquemaGerarEncontros = z.object({ turma: id, de: dataTexto, ate: dataTexto }).strict();
export type EntradaGerarEncontros = z.infer<typeof esquemaGerarEncontros>;

export const esquemaCancelarEncontro = z
  .object({ encontro: id, versao: id, motivo: z.string().max(500) })
  .strict();
export type EntradaCancelarEncontro = z.infer<typeof esquemaCancelarEncontro>;

export const esquemaInscrever = z
  .object({
    turma: id,
    paciente: id,
    fontePagadora: id,
    plano: idOuNulo,
    indicacaoProfissional: idOuNulo,
    acompanhante: z.boolean(),
    encaixe: z.boolean(),
    observacao: textoLivre(2000),
  })
  .strict();
export type EntradaInscrever = z.infer<typeof esquemaInscrever>;

export const esquemaSair = z
  .object({ participante: id, versao: id, saida: z.enum(SAIDAS_PARTICIPANTE), motivo: textoLivre(500) })
  .strict();
export type EntradaSair = z.infer<typeof esquemaSair>;

export const esquemaPresenca = z
  .object({
    encontro: id,
    registros: z
      .array(
        z
          .object({
            participante: id,
            situacao: z.enum(SITUACOES_PRESENCA),
            justificativa: textoLivre(500),
            acompanhante: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();
export type EntradaPresenca = z.infer<typeof esquemaPresenca>;

export interface TurmaResumo {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: string;
  readonly dataInicio: string;
  readonly dataFim: string | null;
  readonly vagas: number;
  readonly vagasEncaixe: number;
  readonly ocupadas: number;
  readonly espera: number;
  readonly proximoEncontro: string | null;
  readonly ativo: boolean;
}
export interface EncontroLido {
  readonly id: number;
  readonly versao: number;
  readonly data: string;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly situacao: SituacaoEncontro;
  readonly motivoCancelamento: string | null;
  readonly presencas: number;
}
export interface ParticipanteLido {
  readonly id: number;
  readonly versao: number;
  readonly paciente: number;
  readonly nome: string;
  readonly prontuario: number | null;
  readonly fontePagadora: string;
  readonly situacao: SituacaoParticipante;
  readonly posicaoEspera: number | null;
  readonly inscritoEm: string;
  readonly desligadoEm: string | null;
  readonly motivoDesligamento: string | null;
  readonly frequencia: number | null;
}
export interface TurmaDetalhe {
  readonly turma: Omit<EntradaSalvarTurma, 'versao'> & { id: number; versao: number };
  readonly escalas: (EntradaSalvarEscala & { id: number; versao: number })[];
  readonly encontros: EncontroLido[];
  readonly participantes: ParticipanteLido[];
}
export interface PresencaDoEncontro {
  readonly encontro: EncontroLido;
  readonly participantes: {
    readonly participante: number;
    readonly nome: string;
    readonly situacao: SituacaoPresenca | null;
    readonly justificativa: string | null;
    readonly acompanhante: boolean;
  }[];
}
export interface ParticipacaoDoPaciente {
  readonly participacao: number;
  readonly turma: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly situacao: SituacaoParticipante;
  readonly posicaoEspera: number | null;
  readonly inscritoEm: string;
  readonly desligadoEm: string | null;
  readonly frequencia: number | null;
  readonly proximoEncontro: string | null;
}
export interface OpcaoTurma {
  readonly id: number;
  readonly nome: string;
}
export interface OpcoesTurma {
  readonly tipo: OpcaoTurma[];
  readonly itemAgendavel: OpcaoTurma[];
  readonly setorFuncional: OpcaoTurma[];
  readonly profissional: OpcaoTurma[];
  readonly fontePagadora: OpcaoTurma[];
  /** Planos das fontes, para escolher o plano aceito e o do paciente (filtrados pela fonte na tela). */
  readonly plano: (OpcaoTurma & { readonly fontePagadora: number })[];
  readonly sexo: OpcaoTurma[];
}

export interface ContextoTurmas {
  readonly hospital: string;
  readonly login: string;
}
type ContextoGravacaoTurmas = ContextoTurmas & {
  correlacao: string;
  chaveIdempotencia: string;
  enderecoIp?: string;
};

const nomeData = (fuso: string, v: unknown) => {
  const l = localDe(fuso, instante(v));
  return `${l.data} ${l.hora}`;
};
const situacaoPresencaDe = (v: unknown) => String(v) as SituacaoPresenca;

export class TurmasAtividadePropria {
  private readonly executor: Executor;
  private readonly turmaOp = definirOperacao<EntradaSalvarTurma, { turma: number }>({
    nome: 'agenda.turma_atividade_salvar',
    tabelas: ['turma_atividade', 'turma_profissional', 'turma_fonte_pagadora'],
    entrada: esquemaSalvarTurma as unknown as z.ZodType<EntradaSalvarTurma>,
    gravar: (tx, e, ctx) => this.gravarTurma(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'turma_atividade', id: r.turma }),
  });
  private readonly escalaOp = definirOperacao<EntradaSalvarEscala, { escala: number }>({
    nome: 'agenda.turma_escala_salvar',
    tabelas: ['turma_escala'],
    entrada: esquemaSalvarEscala as unknown as z.ZodType<EntradaSalvarEscala>,
    gravar: (tx, e, ctx) => this.gravarEscala(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'turma_escala', id: r.escala }),
  });
  private readonly gerarOp = definirOperacao<
    EntradaGerarEncontros,
    { turma: number; gerados: number; existentes: number; feriados: number }
  >({
    nome: 'agenda.turma_encontros_gerar',
    tabelas: ['turma_encontro'],
    entrada: esquemaGerarEncontros,
    gravar: (tx, e, ctx) => this.gravarEncontros(tx, e, ctx),
    alvo: (e) => ({ tabela: 'turma_atividade', id: e.turma }),
  });
  private readonly cancelarOp = definirOperacao<EntradaCancelarEncontro, { encontro: number }>({
    nome: 'agenda.turma_encontro_cancelar',
    tabelas: ['turma_encontro'],
    entrada: esquemaCancelarEncontro,
    gravar: (tx, e, ctx) => this.gravarCancelamento(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'turma_encontro', id: r.encontro }),
  });
  private readonly inscreverOp = definirOperacao<
    EntradaInscrever,
    { participante: number; situacao: string; posicaoEspera: number | null; aviso: string | null }
  >({
    nome: 'agenda.turma_participante_inscrever',
    tabelas: ['turma_participante'],
    entrada: esquemaInscrever,
    gravar: (tx, e, ctx) => this.gravarInscricao(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'turma_participante', id: r.participante }),
  });
  private readonly sairOp = definirOperacao<
    EntradaSair,
    { participante: number; promovido: number | null; promovidos: number }
  >({
    nome: 'agenda.turma_participante_sair',
    tabelas: ['turma_participante'],
    entrada: esquemaSair,
    gravar: (tx, e, ctx) => this.gravarSaida(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'turma_participante', id: r.participante }),
  });
  private readonly presencaOp = definirOperacao<EntradaPresenca, { encontro: number; registradas: number }>({
    nome: 'agenda.turma_presenca_registrar',
    tabelas: ['turma_presenca', 'turma_encontro', 'turma_participante'],
    entrada: esquemaPresenca,
    gravar: (tx, e, ctx) => this.gravarPresenca(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'turma_encontro', id: r.encontro }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private async quem(
    c: ContextoTurmas,
  ): Promise<{ estabelecimento: number; fuso: string; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'turma-atividade' }, async (l) => {
      const e = await l.uma(
        'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [c.hospital],
      );
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return {
        estabelecimento: num(e['id']),
        fuso: String(e['fuso_horario'] || 'America/Sao_Paulo'),
        usuario: u ? num(u['id']) : null,
      };
    });
  }

  private hojeEm(fuso: string): string {
    return localDe(fuso, this.agora()).data;
  }

  private ler<T>(est: number, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'turma-atividade', estabelecimento: est },
      fn,
    );
  }

  /** Turmas da unidade com a ocupação, a espera e o próximo encontro. */
  async listar(c: ContextoTurmas): Promise<TurmaResumo[]> {
    const q = await this.quem(c);
    const agora = this.agora();
    return this.ler(q.estabelecimento, async (l) => {
      const linhas = await l.consultar(
        `SELECT t.id, t.versao, t.codigo, t.descricao, tt.descricao AS tipo, t.data_inicio, t.data_fim, t.vagas,
                t.vagas_encaixe, t.ativo,
                (SELECT COUNT(*) FROM turma_participante p WHERE p.turma_atividade_id = t.id AND p.excluido_em IS NULL
                    AND p.situacao IN ('inscrito','ativo')) AS ocupadas,
                (SELECT COUNT(*) FROM turma_participante p WHERE p.turma_atividade_id = t.id AND p.excluido_em IS NULL
                    AND p.situacao = 'em_espera') AS espera,
                (SELECT MIN(x.inicio) FROM turma_encontro x WHERE x.turma_atividade_id = t.id AND x.excluido_em IS NULL
                    AND x.situacao = 'previsto' AND x.inicio >= ?) AS proximo
           FROM turma_atividade t JOIN tipo_turma_atividade tt ON tt.id = t.tipo_turma_atividade_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL
          ORDER BY t.ativo DESC, t.descricao LIMIT 500`,
        [agora, q.estabelecimento],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        tipo: String(x['tipo']),
        dataInicio: dataIso(x['data_inicio']) ?? '',
        dataFim: dataIso(x['data_fim']),
        vagas: num(x['vagas']),
        vagasEncaixe: num(x['vagas_encaixe']),
        ocupadas: num(x['ocupadas']),
        espera: num(x['espera']),
        proximoEncontro: x['proximo'] ? nomeData(q.fuso, x['proximo']) : null,
        ativo: bool(x['ativo']),
      }));
    });
  }

  /** A turma com escala, profissionais, fontes, encontros (30 dias para trás e 120 à frente) e participantes. */
  async detalhe(c: ContextoTurmas, turma: number): Promise<TurmaDetalhe> {
    const q = await this.quem(c);
    const agora = this.agora();
    return this.ler(q.estabelecimento, async (l) => {
      const t = await l.uma(
        `SELECT * FROM turma_atividade WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [turma, q.estabelecimento],
      );
      if (!t) throw new ErroOperacao(404, 'turma-inexistente', 'Turma', 'A turma não existe nesta unidade.');
      const profissionais = (
        await l.consultar(
          `SELECT profissional_id, principal FROM turma_profissional
            WHERE turma_atividade_id = ? AND excluido_em IS NULL AND vigencia_fim IS NULL ORDER BY principal DESC, id`,
          [turma],
        )
      ).map((x) => ({ profissional: num(x['profissional_id']), principal: bool(x['principal']) }));
      const fontes = (
        await l.consultar(
          `SELECT fonte_pagadora_id, plano_fonte_pagadora_id, limite_marcacoes FROM turma_fonte_pagadora
            WHERE turma_atividade_id = ? AND excluido_em IS NULL ORDER BY id`,
          [turma],
        )
      ).map((x) => ({
        fontePagadora: num(x['fonte_pagadora_id']),
        plano: numOuNulo(x['plano_fonte_pagadora_id']),
        limite: numOuNulo(x['limite_marcacoes']),
      }));
      const escalas = (
        await l.consultar(
          `SELECT id, versao, dia_semana, hora_inicio, hora_fim, inclui_feriado, vigencia_inicio, vigencia_fim, ativo
             FROM turma_escala WHERE turma_atividade_id = ? ORDER BY ativo DESC, dia_semana, hora_inicio`,
          [turma],
        )
      ).map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        turma,
        diaSemana: num(x['dia_semana']),
        horaInicio: horaCurta(x['hora_inicio']),
        horaFim: horaCurta(x['hora_fim']),
        inclusiveFeriado: bool(x['inclui_feriado']),
        vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
        vigenciaFim: dataIso(x['vigencia_fim']),
        ativo: bool(x['ativo']),
      }));
      const encontros = (
        await l.consultar(
          `SELECT e.id, e.versao, e.inicio, e.fim, e.situacao, e.motivo_cancelamento,
                  (SELECT COUNT(*) FROM turma_presenca p WHERE p.turma_encontro_id = e.id AND p.excluido_em IS NULL) AS presencas
             FROM turma_encontro e
            WHERE e.turma_atividade_id = ? AND e.excluido_em IS NULL
              AND e.inicio BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND DATE_ADD(?, INTERVAL 120 DAY)
            ORDER BY e.inicio LIMIT 300`,
          [turma, agora, agora],
        )
      ).map((x) => this.encontroDe(q.fuso, x));
      const parts = await l.consultar(
        `SELECT p.id, p.versao, p.paciente_id, COALESCE(NULLIF(pf.nome_social, ''), pf.nome) AS nome,
                pa.numero_prontuario, f.nome AS fonte, p.situacao, p.posicao_espera, p.inscrito_em, p.desligado_em,
                p.motivo_desligamento
           FROM turma_participante p
           JOIN paciente pa ON pa.id = p.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           JOIN fonte_pagadora f ON f.id = p.fonte_pagadora_id
          WHERE p.turma_atividade_id = ? AND p.excluido_em IS NULL
          ORDER BY FIELD(p.situacao, 'ativo', 'inscrito', 'em_espera', 'concluido', 'desistente', 'desligado'),
                   p.posicao_espera, nome, p.inscrito_em DESC
          LIMIT 1000`,
        [turma],
      );
      const freq = await this.frequencias(
        l,
        parts.map((x) => num(x['id'])),
      );
      return {
        turma: {
          id: num(t['id']),
          versao: num(t['versao']),
          codigo: String(t['codigo']),
          descricao: String(t['descricao']),
          tipo: num(t['tipo_turma_atividade_id']),
          itemAgendavel: num(t['item_agendavel_id']),
          setorFuncional: num(t['setor_funcional_id']),
          localFisico: numOuNulo(t['local_fisico_id']),
          dataInicio: dataIso(t['data_inicio']) ?? '',
          dataFim: dataIso(t['data_fim']),
          vagas: num(t['vagas']),
          vagasEncaixe: num(t['vagas_encaixe']),
          exigeAcompanhante: bool(t['exige_acompanhante']),
          permiteAcompanhante: bool(t['permite_acompanhante']),
          exigeIndicacaoMedica: bool(t['exige_indicacao_medica']),
          idadeMinimaAnos: numOuNulo(t['idade_minima_anos']),
          idadeMaximaAnos: numOuNulo(t['idade_maxima_anos']),
          sexo: numOuNulo(t['sexo_id']),
          ativo: bool(t['ativo']),
          profissionais,
          fontes,
        },
        escalas,
        encontros,
        participantes: parts.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          paciente: num(x['paciente_id']),
          nome: String(x['nome']),
          prontuario: numOuNulo(x['numero_prontuario']),
          fontePagadora: String(x['fonte']),
          situacao: String(x['situacao']) as SituacaoParticipante,
          posicaoEspera: numOuNulo(x['posicao_espera']),
          inscritoEm: dataIso(x['inscrito_em']) ?? '',
          desligadoEm: dataIso(x['desligado_em']),
          motivoDesligamento: textoOuNulo(x['motivo_desligamento']),
          frequencia: freq.get(num(x['id'])) ?? null,
        })),
      };
    });
  }

  private encontroDe(fuso: string, x: Linha): EncontroLido {
    const i = localDe(fuso, instante(x['inicio']));
    const f = localDe(fuso, instante(x['fim']));
    return {
      id: num(x['id']),
      versao: num(x['versao']),
      data: i.data,
      horaInicio: i.hora,
      horaFim: f.hora,
      situacao: String(x['situacao']) as SituacaoEncontro,
      motivoCancelamento: textoOuNulo(x['motivo_cancelamento']),
      presencas: num(x['presencas'] ?? 0),
    };
  }

  private async frequencias(
    l: Pick<Leitor, 'consultar'>,
    participantes: number[],
  ): Promise<Map<number, number | null>> {
    const m = new Map<number, number | null>();
    if (participantes.length === 0) return m;
    const linhas = await l.consultar(
      `SELECT turma_participante_id, situacao FROM turma_presenca
        WHERE excluido_em IS NULL AND turma_participante_id IN (${participantes.map(() => '?').join(', ')})`,
      participantes,
    );
    const por = new Map<number, SituacaoPresenca[]>();
    for (const x of linhas) {
      const k = num(x['turma_participante_id']);
      por.set(k, [...(por.get(k) ?? []), situacaoPresencaDe(x['situacao'])]);
    }
    for (const p of participantes) m.set(p, frequencia(por.get(p) ?? []));
    return m;
  }

  /** O encontro com os participantes que ocupam vaga e a presença já registrada. */
  async presencaDoEncontro(c: ContextoTurmas, encontro: number): Promise<PresencaDoEncontro> {
    const q = await this.quem(c);
    return this.ler(q.estabelecimento, async (l) => {
      const e = await l.uma(
        `SELECT e.id, e.versao, e.inicio, e.fim, e.situacao, e.motivo_cancelamento, e.turma_atividade_id
           FROM turma_encontro e JOIN turma_atividade t ON t.id = e.turma_atividade_id
          WHERE e.id = ? AND t.estabelecimento_id = ? AND e.excluido_em IS NULL`,
        [encontro, q.estabelecimento],
      );
      if (!e) throw new ErroOperacao(404, 'encontro-inexistente', 'Encontro', 'O encontro não existe.');
      const linhas = await l.consultar(
        `SELECT p.id, COALESCE(NULLIF(pf.nome_social, ''), pf.nome) AS nome, x.situacao AS presenca,
                x.justificativa, x.acompanhante_presente
           FROM turma_participante p
           JOIN paciente pa ON pa.id = p.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
           LEFT JOIN turma_presenca x ON x.turma_participante_id = p.id AND x.turma_encontro_id = ? AND x.excluido_em IS NULL
          WHERE p.turma_atividade_id = ? AND p.excluido_em IS NULL
            AND (p.situacao IN ('inscrito','ativo') OR x.id IS NOT NULL)
          ORDER BY nome LIMIT 1000`,
        [encontro, num(e['turma_atividade_id'])],
      );
      return {
        encontro: this.encontroDe(q.fuso, { ...e, presencas: linhas.filter((x) => x['presenca']).length }),
        participantes: linhas.map((x) => ({
          participante: num(x['id']),
          nome: String(x['nome']),
          situacao: x['presenca'] ? situacaoPresencaDe(x['presenca']) : null,
          justificativa: textoOuNulo(x['justificativa']),
          acompanhante: bool(x['acompanhante_presente']),
        })),
      };
    });
  }

  /** Visão por paciente: as turmas do paciente com a situação, a frequência e o próximo encontro. */
  async doPaciente(c: ContextoTurmas, paciente: number): Promise<ParticipacaoDoPaciente[]> {
    const q = await this.quem(c);
    const agora = this.agora();
    return this.ler(q.estabelecimento, async (l) => {
      const linhas = await l.consultar(
        `SELECT p.id, t.id AS turma, t.codigo, t.descricao, p.situacao, p.posicao_espera, p.inscrito_em, p.desligado_em,
                (SELECT MIN(x.inicio) FROM turma_encontro x WHERE x.turma_atividade_id = t.id AND x.excluido_em IS NULL
                    AND x.situacao = 'previsto' AND x.inicio >= ?) AS proximo
           FROM turma_participante p JOIN turma_atividade t ON t.id = p.turma_atividade_id
          WHERE p.paciente_id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL
          ORDER BY p.inscrito_em DESC, p.id DESC LIMIT 200`,
        [agora, paciente, q.estabelecimento],
      );
      const freq = await this.frequencias(
        l,
        linhas.map((x) => num(x['id'])),
      );
      return linhas.map((x) => ({
        participacao: num(x['id']),
        turma: num(x['turma']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        situacao: String(x['situacao']) as SituacaoParticipante,
        posicaoEspera: numOuNulo(x['posicao_espera']),
        inscritoEm: dataIso(x['inscrito_em']) ?? '',
        desligadoEm: dataIso(x['desligado_em']),
        frequencia: freq.get(num(x['id'])) ?? null,
        proximoEncontro: x['proximo'] ? nomeData(q.fuso, x['proximo']) : null,
      }));
    });
  }

  /** Opções dos combos da tela. */
  async opcoes(c: ContextoTurmas): Promise<OpcoesTurma> {
    const q = await this.quem(c);
    return this.ler(q.estabelecimento, async (l) => {
      const lista = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      return {
        tipo: await lista(
          'SELECT id, descricao AS nome FROM tipo_turma_atividade WHERE ativo ORDER BY descricao LIMIT 200',
        ),
        itemAgendavel: await lista(
          'SELECT id, descricao AS nome FROM item_agendavel WHERE excluido_em IS NULL ORDER BY descricao LIMIT 500',
        ),
        setorFuncional: await lista(
          'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 500',
          [q.estabelecimento],
        ),
        profissional: await lista(
          `SELECT p.id, COALESCE(NULLIF(p.nome_exibicao, ''), pf.nome) AS nome
             FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL ORDER BY nome LIMIT 1000`,
        ),
        fontePagadora: await lista(
          'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 500',
        ),
        plano: (
          await l.consultar(
            `SELECT id, descricao AS nome, fonte_pagadora_id FROM plano_fonte_pagadora
              WHERE excluido_em IS NULL ORDER BY descricao LIMIT 3000`,
          )
        ).map((x) => ({
          id: num(x['id']),
          nome: String(x['nome']),
          fontePagadora: num(x['fonte_pagadora_id']),
        })),
        sexo: await lista('SELECT id, descricao AS nome FROM sexo WHERE ativo ORDER BY descricao'),
      };
    });
  }

  private async contexto(c: ContextoGravacaoTurmas): Promise<ContextoOperacao> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        'Gravar na turma exige uma conta de usuário do cliente (o responsável fica no registro).',
      );
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  private async rodar<E, S extends Record<string, unknown>>(
    op: Parameters<Executor['executar']>[0],
    c: ContextoGravacaoTurmas,
    entrada: E,
  ): Promise<{ resultado: S; repetida: boolean }> {
    const r = await this.executor.executar(op, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado as S, repetida: r.repetida };
  }

  salvarTurma(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<unknown, { turma: number }>(this.turmaOp, c, e);
  }
  salvarEscala(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<unknown, { escala: number }>(this.escalaOp, c, e);
  }
  gerarEncontros(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<unknown, { turma: number; gerados: number; existentes: number; feriados: number }>(
      this.gerarOp,
      c,
      e,
    );
  }
  cancelarEncontro(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<unknown, { encontro: number }>(this.cancelarOp, c, e);
  }
  inscrever(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<
      unknown,
      { participante: number; situacao: string; posicaoEspera: number | null; aviso: string | null }
    >(this.inscreverOp, c, e);
  }
  sair(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<unknown, { participante: number; promovido: number | null; promovidos: number }>(
      this.sairOp,
      c,
      e,
    );
  }
  registrarPresenca(c: ContextoGravacaoTurmas, e: unknown) {
    return this.rodar<unknown, { encontro: number; registradas: number }>(this.presencaOp, c, e);
  }

  // ── Gravações ──────────────────────────────────────────────────────────────────────────────────────

  private async fusoDe(tx: TxOperacao, est: number): Promise<string> {
    const e = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    return String(e?.['fuso_horario'] || 'America/Sao_Paulo');
  }

  /** A turma da unidade, travada (FOR UPDATE): a contagem de vagas e a geração ficam serializadas. */
  private async travarTurma(tx: TxOperacao, turma: number, est: number): Promise<Linha> {
    const [t] = await tx.consultarParaAtualizar(
      `SELECT id, versao, data_inicio, data_fim, vagas, vagas_encaixe, idade_minima_anos, idade_maxima_anos, sexo_id,
              exige_indicacao_medica, exige_acompanhante, permite_acompanhante, local_fisico_id, ativo
         FROM turma_atividade WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [turma, est],
      { teto: 1 },
    );
    if (!t) throw new ErroOperacao(404, 'turma-inexistente', 'Turma', 'A turma não existe nesta unidade.');
    return t;
  }

  private async conferirCadastro(tx: TxOperacao, est: number, e: EntradaSalvarTurma): Promise<void> {
    const falta = (campo: string) =>
      recusa('cadastro-inexistente', 'Um item escolhido não existe ou não é desta unidade.', {
        campos: [campo],
      });
    if (!(await tx.uma('SELECT id FROM tipo_turma_atividade WHERE id = ? AND ativo', [e.tipo])))
      throw falta('tipo');
    if (
      !(await tx.uma('SELECT id FROM item_agendavel WHERE id = ? AND excluido_em IS NULL', [e.itemAgendavel]))
    )
      throw falta('itemAgendavel');
    if (
      !(await tx.uma(
        'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.setorFuncional, est],
      ))
    )
      throw falta('setorFuncional');
    if (
      e.localFisico !== null &&
      !(await tx.uma(
        'SELECT id FROM local_fisico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.localFisico, est],
      ))
    )
      throw falta('localFisico');
    if (e.sexo !== null && !(await tx.uma('SELECT id FROM sexo WHERE id = ?', [e.sexo]))) throw falta('sexo');
    for (const p of e.profissionais)
      if (
        !(await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [p.profissional]))
      )
        throw falta('profissionais');
    for (const f of e.fontes) {
      if (
        !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [
          f.fontePagadora,
        ]))
      )
        throw falta('fontes');
      if (
        f.plano !== null &&
        !(await tx.uma(
          'SELECT id FROM plano_fonte_pagadora WHERE id = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL',
          [f.plano, f.fontePagadora],
        ))
      )
        throw falta('fontes');
    }
  }

  private async gravarTurma(
    tx: TxOperacao,
    e: EntradaSalvarTurma,
    ctx: ContextoOperacao,
  ): Promise<{ turma: number }> {
    const est = Number(ctx.estabelecimento);
    const rv = validarTurma(e);
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    await this.conferirCadastro(tx, est, e);
    const repetido = await tx.uma(
      'SELECT id FROM turma_atividade WHERE estabelecimento_id = ? AND codigo = ? AND id <> ?',
      [est, e.codigo.trim(), e.id ?? 0],
    );
    if (repetido)
      throw recusa('turma-codigo-repetido', 'Já existe uma turma com este código na unidade.', {
        campos: ['codigo'],
      });
    const valores = {
      codigo: e.codigo.trim(),
      descricao: e.descricao.trim(),
      tipo_turma_atividade_id: e.tipo,
      item_agendavel_id: e.itemAgendavel,
      setor_funcional_id: e.setorFuncional,
      local_fisico_id: e.localFisico,
      data_inicio: e.dataInicio,
      data_fim: e.dataFim,
      vagas: e.vagas,
      vagas_encaixe: e.vagasEncaixe,
      exige_acompanhante: e.exigeAcompanhante,
      permite_acompanhante: e.permiteAcompanhante,
      exige_indicacao_medica: e.exigeIndicacaoMedica,
      idade_minima_anos: e.idadeMinimaAnos,
      idade_maxima_anos: e.idadeMaximaAnos,
      sexo_id: e.sexo,
      ativo: e.ativo,
    };
    let turma: number;
    if (e.id) {
      await this.travarTurma(tx, e.id, est);
      await tx.alterar('turma_atividade', e.id, e.versao!, valores);
      turma = e.id;
    } else {
      turma = await tx.incluir('turma_atividade', {
        estabelecimento_id: est,
        liberada_em: e.ativo ? this.agora() : null,
        ...valores,
      });
    }
    const hoje = this.hojeEm(await this.fusoDe(tx, est));
    // Profissionais: o retirado ganha fim de vigência (histórico de quem conduziu); o novo entra com vigência de hoje.
    const atuais = await tx.consultar(
      `SELECT id, versao, profissional_id, principal, vigencia_inicio FROM turma_profissional
        WHERE turma_atividade_id = ? AND excluido_em IS NULL AND vigencia_fim IS NULL`,
      [turma],
    );
    for (const a of atuais) {
      const novo = e.profissionais.find((p) => p.profissional === num(a['profissional_id']));
      if (!novo) {
        const inicio = dataIso(a['vigencia_inicio']) ?? hoje;
        await tx.alterar('turma_profissional', num(a['id']), num(a['versao']), {
          vigencia_fim: inicio > hoje ? inicio : hoje,
        });
      } else if (novo.principal !== bool(a['principal']))
        await tx.alterar('turma_profissional', num(a['id']), num(a['versao']), { principal: novo.principal });
    }
    for (const p of e.profissionais) {
      if (atuais.some((a) => num(a['profissional_id']) === p.profissional)) continue;
      const hojeRetirado = await tx.uma(
        `SELECT id, versao FROM turma_profissional
          WHERE turma_atividade_id = ? AND profissional_id = ? AND vigencia_inicio = ?`,
        [turma, p.profissional, hoje],
      );
      if (hojeRetirado)
        await tx.alterar('turma_profissional', num(hojeRetirado['id']), num(hojeRetirado['versao']), {
          vigencia_fim: null,
          principal: p.principal,
          excluido_em: null,
          excluido_por: null,
        });
      else
        await tx.incluir('turma_profissional', {
          turma_atividade_id: turma,
          profissional_id: p.profissional,
          principal: p.principal,
          vigencia_inicio: hoje,
        });
    }
    // Fontes pagadoras aceitas: a retirada ganha excluido_em; a que volta é reativada.
    const fontes = await tx.consultar(
      `SELECT id, versao, fonte_pagadora_id, plano_fonte_pagadora_id, limite_marcacoes, excluido_em
         FROM turma_fonte_pagadora WHERE turma_atividade_id = ?`,
      [turma],
    );
    const chave = (f: number, pl: number | null) => `${f}-${pl ?? ''}`;
    const pedidas = new Map(e.fontes.map((f) => [chave(f.fontePagadora, f.plano), f]));
    const vistas = new Set<string>();
    for (const f of fontes) {
      const k = chave(num(f['fonte_pagadora_id']), numOuNulo(f['plano_fonte_pagadora_id']));
      const p = pedidas.get(k);
      const ativa = f['excluido_em'] === null || f['excluido_em'] === undefined;
      if (p && !vistas.has(k)) {
        vistas.add(k);
        if (!ativa || numOuNulo(f['limite_marcacoes']) !== p.limite)
          await tx.alterar('turma_fonte_pagadora', num(f['id']), num(f['versao']), {
            limite_marcacoes: p.limite,
            excluido_em: null,
            excluido_por: null,
          });
      } else if (ativa)
        await tx.alterar('turma_fonte_pagadora', num(f['id']), num(f['versao']), {
          excluido_em: this.agora(),
          excluido_por: ctx.usuario,
        });
    }
    for (const [k, f] of pedidas)
      if (!vistas.has(k))
        await tx.incluir('turma_fonte_pagadora', {
          turma_atividade_id: turma,
          fonte_pagadora_id: f.fontePagadora,
          plano_fonte_pagadora_id: f.plano,
          limite_marcacoes: f.limite,
        });
    return { turma };
  }

  private async gravarEscala(
    tx: TxOperacao,
    e: EntradaSalvarEscala,
    ctx: ContextoOperacao,
  ): Promise<{ escala: number }> {
    const est = Number(ctx.estabelecimento);
    const rv = validarEscala(e);
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    await this.travarTurma(tx, e.turma, est);
    const conflito = await tx.uma(
      `SELECT id FROM turma_escala WHERE turma_atividade_id = ? AND dia_semana = ? AND ativo AND id <> ?
          AND hora_inicio < ? AND hora_fim > ?
          AND vigencia_inicio <= COALESCE(?, '9999-12-31') AND COALESCE(vigencia_fim, '9999-12-31') >= ?`,
      [e.turma, e.diaSemana, e.id ?? 0, e.horaFim, e.horaInicio, e.vigenciaFim, e.vigenciaInicio],
    );
    if (e.ativo && conflito)
      throw recusa('escala-sobreposta', 'A turma já tem encontro neste dia e horário na mesma vigência.', {
        campos: ['horaInicio'],
      });
    const valores = {
      dia_semana: e.diaSemana,
      hora_inicio: e.horaInicio,
      hora_fim: e.horaFim,
      inclui_feriado: e.inclusiveFeriado,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo,
    };
    if (e.id) {
      const x = await tx.uma('SELECT id FROM turma_escala WHERE id = ? AND turma_atividade_id = ?', [
        e.id,
        e.turma,
      ]);
      if (!x) throw new ErroOperacao(404, 'escala-inexistente', 'Escala', 'A escala não existe nesta turma.');
      await tx.alterar('turma_escala', e.id, e.versao!, valores);
      return { escala: e.id };
    }
    return { escala: await tx.incluir('turma_escala', { turma_atividade_id: e.turma, ...valores }) };
  }

  private async gravarEncontros(
    tx: TxOperacao,
    e: EntradaGerarEncontros,
    ctx: ContextoOperacao,
  ): Promise<{ turma: number; gerados: number; existentes: number; feriados: number }> {
    const est = Number(ctx.estabelecimento);
    const fuso = await this.fusoDe(tx, est);
    const t = await this.travarTurma(tx, e.turma, est);
    const escalas = (
      await tx.consultar(
        `SELECT id, dia_semana, hora_inicio, hora_fim, inclui_feriado, vigencia_inicio, vigencia_fim, ativo
           FROM turma_escala WHERE turma_atividade_id = ?`,
        [e.turma],
      )
    ).map((x) => ({
      id: num(x['id']),
      diaSemana: num(x['dia_semana']),
      horaInicio: horaCurta(x['hora_inicio']),
      horaFim: horaCurta(x['hora_fim']),
      inclusiveFeriado: bool(x['inclui_feriado']),
      vigenciaInicio: dataIso(x['vigencia_inicio']) ?? '',
      vigenciaFim: dataIso(x['vigencia_fim']),
      ativo: bool(x['ativo']),
    }));
    const existentes = (
      await tx.consultar('SELECT inicio FROM turma_encontro WHERE turma_atividade_id = ?', [e.turma])
    ).map((x) => {
      const l = localDe(fuso, instante(x['inicio']));
      return { data: l.data, horaInicio: l.hora };
    });
    const feriados = await lerDiasSemExpediente(tx, est, e.de, e.ate);
    const g = gerarEncontros({
      de: e.de,
      ate: e.ate,
      turma: {
        dataInicio: dataIso(t['data_inicio']) ?? '',
        dataFim: dataIso(t['data_fim']),
        ativo: bool(t['ativo']),
      },
      escalas,
      feriados,
      existentes,
    });
    if (!g.ok) throw recusa(g.codigo, g.mensagem, g.campo ? { campos: [g.campo] } : undefined);
    const condutor = await tx.uma(
      `SELECT profissional_id FROM turma_profissional
        WHERE turma_atividade_id = ? AND principal AND vigencia_fim IS NULL AND excluido_em IS NULL LIMIT 1`,
      [e.turma],
    );
    for (const x of g.encontros)
      await tx.incluir('turma_encontro', {
        turma_atividade_id: e.turma,
        turma_escala_id: x.escala,
        inicio: instanteDe(fuso, x.data, x.horaInicio),
        fim: instanteDe(fuso, x.data, x.horaFim),
        local_fisico_id: numOuNulo(t['local_fisico_id']),
        condutor_profissional_id: condutor ? num(condutor['profissional_id']) : null,
        situacao: 'previsto',
      });
    return { turma: e.turma, gerados: g.encontros.length, existentes: g.existentes, feriados: g.feriados };
  }

  private async travarEncontro(tx: TxOperacao, encontro: number, est: number): Promise<Linha> {
    const [x] = await tx.consultarParaAtualizar(
      `SELECT e.id, e.versao, e.situacao, e.inicio, e.turma_atividade_id, t.permite_acompanhante
         FROM turma_encontro e JOIN turma_atividade t ON t.id = e.turma_atividade_id
        WHERE e.id = ? AND t.estabelecimento_id = ? AND e.excluido_em IS NULL`,
      [encontro, est],
      { teto: 1 },
    );
    if (!x)
      throw new ErroOperacao(404, 'encontro-inexistente', 'Encontro', 'O encontro não existe nesta unidade.');
    return x;
  }

  private async gravarCancelamento(
    tx: TxOperacao,
    e: EntradaCancelarEncontro,
    ctx: ContextoOperacao,
  ): Promise<{ encontro: number }> {
    const x = await this.travarEncontro(tx, e.encontro, Number(ctx.estabelecimento));
    const rv = validarCancelamentoEncontro(String(x['situacao']) as SituacaoEncontro, e.motivo);
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    await tx.alterar('turma_encontro', e.encontro, e.versao, {
      situacao: 'cancelado',
      motivo_cancelamento: e.motivo.trim(),
    });
    return { encontro: e.encontro };
  }

  private async gravarInscricao(
    tx: TxOperacao,
    e: EntradaInscrever,
    ctx: ContextoOperacao,
  ): Promise<{ participante: number; situacao: string; posicaoEspera: number | null; aviso: string | null }> {
    const est = Number(ctx.estabelecimento);
    const t = await this.travarTurma(tx, e.turma, est);
    const hoje = this.hojeEm(await this.fusoDe(tx, est));
    const pac = await tx.uma(
      `SELECT pf.data_nascimento, pf.sexo_id FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE p.id = ?`,
      [e.paciente],
    );
    if (!pac) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
    if (
      !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [e.fontePagadora]))
    )
      throw recusa('fonte-inexistente', 'A fonte pagadora não existe.', { campos: ['fontePagadora'] });
    if (
      e.indicacaoProfissional !== null &&
      !(await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
        e.indicacaoProfissional,
      ]))
    )
      throw recusa('profissional-inexistente', 'O profissional que indicou não existe.', {
        campos: ['indicacaoProfissional'],
      });
    const vigente = await tx.uma(
      `SELECT id FROM turma_participante
        WHERE turma_atividade_id = ? AND paciente_id = ? AND excluido_em IS NULL
          AND situacao IN ('em_espera','inscrito','ativo')`,
      [e.turma, e.paciente],
    );
    if (vigente)
      throw recusa('paciente-ja-na-turma', 'O paciente já está nesta turma (inscrito ou na espera).');
    const participacoes = await this.participacoesVigentes(tx, e.turma);
    const ocupam = participacoes.filter((x) => x.situacao !== 'em_espera');
    const fontes = await this.fontesComUso(tx, e.turma, ocupam);
    const d = decidirInscricao({
      hoje,
      turma: {
        ativo: bool(t['ativo']),
        dataFim: dataIso(t['data_fim']),
        vagas: num(t['vagas']),
        vagasEncaixe: num(t['vagas_encaixe']),
        idadeMinimaAnos: numOuNulo(t['idade_minima_anos']),
        idadeMaximaAnos: numOuNulo(t['idade_maxima_anos']),
        sexo: numOuNulo(t['sexo_id']),
        exigeIndicacaoMedica: bool(t['exige_indicacao_medica']),
        exigeAcompanhante: bool(t['exige_acompanhante']),
      },
      paciente: { nascimento: dataIso(pac['data_nascimento']), sexo: numOuNulo(pac['sexo_id']) },
      fontePagadora: e.fontePagadora,
      plano: e.plano,
      indicacaoProfissional: e.indicacaoProfissional,
      acompanhanteInformado: e.acompanhante,
      encaixe: e.encaixe,
      fontes,
      ocupadas: ocupam.length,
      ultimaPosicaoEspera: Math.max(0, ...participacoes.map((x) => x.posicaoEspera ?? 0)),
    });
    if (!d.ok) throw recusa(d.codigo, d.mensagem, d.campo ? { campos: [d.campo] } : undefined);
    // Cada inscrição é uma participação própria: quem saiu e volta ganha linha nova; a encerrada fica como está.
    const participante = await tx.incluir('turma_participante', {
      turma_atividade_id: e.turma,
      paciente_id: e.paciente,
      fonte_pagadora_id: e.fontePagadora,
      plano_fonte_pagadora_id: e.plano,
      indicacao_profissional_id: e.indicacaoProfissional,
      situacao: d.situacao,
      posicao_espera: d.posicaoEspera,
      inscrito_em: this.agora(),
      observacao: e.observacao?.trim() || null,
    });
    return {
      participante,
      situacao: d.situacao,
      posicaoEspera: d.posicaoEspera,
      aviso: d.alertas.length > 0 ? d.alertas.join(' ') : null,
    };
  }

  private async gravarSaida(
    tx: TxOperacao,
    e: EntradaSair,
    ctx: ContextoOperacao,
  ): Promise<{ participante: number; promovido: number | null; promovidos: number }> {
    const est = Number(ctx.estabelecimento);
    const p = await tx.uma(
      `SELECT p.id, p.turma_atividade_id, p.situacao FROM turma_participante p
         JOIN turma_atividade t ON t.id = p.turma_atividade_id
        WHERE p.id = ? AND t.estabelecimento_id = ? AND p.excluido_em IS NULL`,
      [e.participante, est],
    );
    if (!p)
      throw new ErroOperacao(404, 'participante-inexistente', 'Participante', 'A participação não existe.');
    const turma = num(p['turma_atividade_id']);
    await this.travarTurma(tx, turma, est);
    const atual = String(p['situacao']) as SituacaoParticipante;
    const rv = decidirSaida(atual, e.saida, e.motivo);
    if (rv) throw recusa(rv.codigo, rv.mensagem, rv.campo ? { campos: [rv.campo] } : undefined);
    await tx.alterar('turma_participante', e.participante, e.versao, {
      situacao: e.saida,
      desligado_em: this.agora(),
      motivo_desligamento: e.motivo?.trim() || null,
      posicao_espera: null,
    });
    if (atual === 'em_espera') return { participante: e.participante, promovido: null, promovidos: 0 };
    // Vaga liberada: sobe da espera quem couber numa vaga regular e no limite da fonte (regra no domínio).
    const t = await tx.uma('SELECT vagas FROM turma_atividade WHERE id = ?', [turma]);
    const participacoes = await this.participacoesVigentes(tx, turma);
    const ocupam = participacoes.filter((x) => x.situacao !== 'em_espera');
    const sobem = decidirPromocao({
      vagas: num(t?.['vagas']),
      ocupadas: ocupam.length,
      fontes: await this.fontesComUso(tx, turma, ocupam),
      espera: participacoes.filter((x) => x.situacao === 'em_espera'),
    });
    for (const x of sobem)
      await tx.alterar('turma_participante', x.id, x.versao, { situacao: 'inscrito', posicao_espera: null });
    return {
      participante: e.participante,
      promovido: sobem[0]?.id ?? null,
      promovidos: sobem.length,
    };
  }

  /** Participações vigentes da turma (na espera, inscritas e ativas), lidas depois da trava da turma. */
  private async participacoesVigentes(tx: TxOperacao, turma: number) {
    return (
      await tx.consultar(
        `SELECT id, versao, fonte_pagadora_id, plano_fonte_pagadora_id, situacao, posicao_espera FROM turma_participante
          WHERE turma_atividade_id = ? AND excluido_em IS NULL AND situacao IN ('em_espera','inscrito','ativo')`,
        [turma],
      )
    ).map((x) => ({
      id: num(x['id']),
      versao: num(x['versao']),
      fontePagadora: num(x['fonte_pagadora_id']),
      plano: numOuNulo(x['plano_fonte_pagadora_id']),
      situacao: String(x['situacao']) as SituacaoParticipante,
      posicaoEspera: numOuNulo(x['posicao_espera']),
    }));
  }

  /** Fontes aceitas pela turma com as participações que ocupam vaga por fonte (a regra sem plano conta a fonte toda). */
  private async fontesComUso(
    tx: TxOperacao,
    turma: number,
    ocupam: readonly { fontePagadora: number; plano: number | null }[],
  ): Promise<FonteDaTurma[]> {
    return (
      await tx.consultar(
        `SELECT fonte_pagadora_id, plano_fonte_pagadora_id, limite_marcacoes FROM turma_fonte_pagadora
          WHERE turma_atividade_id = ? AND excluido_em IS NULL`,
        [turma],
      )
    ).map((f) => {
      const fonte = num(f['fonte_pagadora_id']);
      const plano = numOuNulo(f['plano_fonte_pagadora_id']);
      return {
        fontePagadora: fonte,
        plano,
        limite: numOuNulo(f['limite_marcacoes']),
        usadas: ocupam.filter((x) => x.fontePagadora === fonte && (plano === null || x.plano === plano))
          .length,
      };
    });
  }

  private async gravarPresenca(
    tx: TxOperacao,
    e: EntradaPresenca,
    ctx: ContextoOperacao,
  ): Promise<{ encontro: number; registradas: number }> {
    const x = await this.travarEncontro(tx, e.encontro, Number(ctx.estabelecimento));
    const turma = num(x['turma_atividade_id']);
    const agora = this.agora();
    if (new Set(e.registros.map((r) => r.participante)).size !== e.registros.length)
      throw recusa('presenca-repetida', 'O mesmo participante aparece duas vezes.');
    for (const r of e.registros) {
      const p = await tx.uma(
        `SELECT id, versao, situacao FROM turma_participante
          WHERE id = ? AND turma_atividade_id = ? AND excluido_em IS NULL`,
        [r.participante, turma],
      );
      if (!p)
        throw recusa('participante-fora', 'O participante não é desta turma.', { campos: ['registros'] });
      const ja = await tx.uma(
        `SELECT id, versao FROM turma_presenca WHERE turma_encontro_id = ? AND turma_participante_id = ?`,
        [e.encontro, r.participante],
      );
      const rv = validarPresenca({
        encontro: { situacao: String(x['situacao']) as SituacaoEncontro, inicio: instante(x['inicio']) },
        agora,
        // Correção de presença já registrada vale também para quem saiu depois do encontro.
        participante: { situacao: ja ? 'ativo' : (String(p['situacao']) as SituacaoParticipante) },
        situacao: r.situacao,
        justificativa: r.justificativa,
        acompanhantePresente: r.acompanhante,
        permiteAcompanhante: bool(x['permite_acompanhante']),
      });
      if (rv) throw recusa(rv.codigo, rv.mensagem, { campos: ['registros'] });
      const valores = {
        situacao: r.situacao,
        justificativa: r.situacao === 'presente' ? null : r.justificativa?.trim() || null,
        acompanhante_presente: r.acompanhante,
        registrado_em: agora,
      };
      if (ja) await tx.alterar('turma_presenca', num(ja['id']), num(ja['versao']), valores);
      else
        await tx.incluir('turma_presenca', {
          turma_encontro_id: e.encontro,
          turma_participante_id: r.participante,
          ...valores,
        });
      if (r.situacao === 'presente' && p['situacao'] === 'inscrito')
        await tx.alterar('turma_participante', r.participante, num(p['versao']), { situacao: 'ativo' });
    }
    if (x['situacao'] === 'previsto')
      await tx.alterar('turma_encontro', e.encontro, num(x['versao']), { situacao: 'realizado' });
    return { encontro: e.encontro, registradas: e.registros.length };
  }
}
