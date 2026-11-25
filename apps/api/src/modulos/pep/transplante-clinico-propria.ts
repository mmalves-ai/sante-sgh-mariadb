// Doação e transplante de órgãos no prontuário (03-PEP L145), no banco próprio do cliente. Regras puras em
// @sgh/dominio-pep (transplante.ts); aqui ficam a leitura (visão por paciente, órgãos, receptores na lista de um
// órgão) e a gravação pelo executor (trilha na mesma transação). Contrato de efeito:
//   - doador: uma linha em `doador_orgao` do estabelecimento da sessão (uma doação em aberto por paciente); a
//     alteração regrava o registro com a versão lida, seguindo os passos da situação (captado, não captado e cancelado
//     encerram e carimbam `fechado_em`); nada é apagado;
//   - antibiótico do doador: linha numerada em `doador_antibiotico`; a alteração só encerra (data de fim);
//   - solução de preservação: linha numerada em `solucao_preservacao_orgao` por órgão, com o profissional da sessão;
//   - receptor: uma inscrição por paciente e órgão na lista em `receptor_transplante`; a alteração muda situação,
//     aptidão (data da mudança), urgência e diálise com a versão lida; o transplante só chega pelo destino;
//   - destino do órgão: `doador_receptor` (oferta do órgão do doador ao receptor) e os passos até o transplante; o
//     transplante muda junto o receptor (situação transplantado, data e doador), na mesma transação;
//   - acompanhamento depois do transplante: linha numerada em `acompanhamento_pos_transplante`.
// Leituras e gravações só do estabelecimento da sessão. Sem gatilho; nada apagado.
import {
  CONSENTIMENTOS_DOACAO,
  conferirAcompanhamento,
  conferirAntibioticoDoador,
  conferirDestino,
  conferirDoadorOrgao,
  conferirPreservacao,
  conferirReceptor,
  conferirTransicaoDestino,
  conferirTransicaoDoador,
  conferirTransicaoReceptor,
  acompanhamentoEmDestaque,
  type DadosDoadorOrgao,
  diasDoTransplante,
  doadorEncerrado,
  type FalhaTransplante,
  pendenciasDoador,
  SITUACOES_DESTINO_ORGAO,
  SITUACOES_DOADOR_ORGAO,
  SITUACOES_RECEPTOR,
  type SituacaoDestinoOrgao,
  type SituacaoDoadorOrgao,
  type SituacaoReceptor,
  TIPOS_ACOMPANHAMENTO_TRANSPLANTE,
  TIPOS_DIALISE,
  TIPOS_DOADOR_ORGAO,
  TIPOS_PERFUSAO,
  type TipoAcompanhamentoTransplante,
  type TipoDoadorOrgao,
  type ConsentimentoDoacao,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Operacao,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const dataDe = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const iso = (v: unknown): string | null => dataDe(v)?.toISOString() ?? null;
/** DATE do banco como "aaaa-mm-dd" (o driver pode devolver Date à meia-noite local ou texto). */
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const hojeLocal = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

const id = z.number().int().positive();
const versao = z.number().int().positive();
const texto = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => (s.trim() ? s.trim() : null))
    .nullable()
    .optional();
const momento = z.string().datetime({ offset: true }).nullable().optional();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

export const esquemaDoador = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    paciente: id,
    atendimento: id.nullable().optional(),
    tipo: z.enum(TIPOS_DOADOR_ORGAO),
    situacao: z.enum(SITUACOES_DOADOR_ORGAO).default('em_avaliacao'),
    consentimento: z.enum(CONSENTIMENTOS_DOACAO).default('pendente'),
    consentimentoEm: momento,
    responsavelConsentimento: texto(150),
    parentesco: id.nullable().optional(),
    registroCentral: texto(30),
    causaInternacao: texto(100),
    causaMorte: texto(100),
    morteEncefalicaEm: momento,
    internadoEm: momento,
    diasTerapiaIntensiva: z.number().int().min(0).max(3650).nullable().optional(),
    pesoKg: decimal(0, 1000),
    alturaCm: decimal(0, 1000),
    pressaoArterial: texto(20),
    frequenciaCardiaca: z.number().int().min(0).max(400).nullable().optional(),
    saturacao: decimal(0, 1000),
    teveParadaCardiaca: z.boolean().default(false),
    paradaDescricao: texto(100),
    aminasVasoativas: texto(100),
    cirurgiasPrevias: texto(200),
    nutricao: texto(200),
    diagnosticoDiferencial: texto(200),
    captacaoEm: momento,
    meioLocomocao: texto(30),
    procedimentoInicioEm: momento,
    procedimentoFimEm: momento,
    clampeamentoEm: momento,
    tipoPerfusao: z.enum(TIPOS_PERFUSAO).nullable().optional(),
    observacao: texto(2000),
  })
  .strict()
  .refine((x) => (x.id === undefined) === (x.versao === undefined), {
    message: 'A alteração leva o id e a versão lida.',
    path: ['versao'],
  });
export type EntradaDoador = z.infer<typeof esquemaDoador>;

export const esquemaAntibiotico = z
  .object({
    doador: id,
    id: id.optional(),
    versao: versao.optional(),
    descricao: z.string().max(100).default(''),
    antimicrobiano: id.nullable().optional(),
    inicio: data.optional(),
    fim: data.nullable().optional(),
  })
  .strict()
  .refine((x) => (x.id ? x.versao !== undefined && x.fim : x.inicio), {
    message: 'Inclusão leva o início; o encerramento leva id, versão e fim.',
    path: ['inicio'],
  });
export type EntradaAntibiotico = z.infer<typeof esquemaAntibiotico>;

export const esquemaPreservacao = z
  .object({
    doador: id,
    orgao: id,
    receptor: id.nullable().optional(),
    nomeSolucao: z.string().max(150),
    marca: texto(100),
    lote: texto(30),
    validade: data.nullable().optional(),
    volumeMl: z.number().max(100_000).nullable().optional(),
    aplicadaEm: z.string().datetime({ offset: true }),
    observacao: texto(1000),
  })
  .strict();
export type EntradaPreservacao = z.infer<typeof esquemaPreservacao>;

export const esquemaReceptor = z
  .object({
    id: id.optional(),
    versao: versao.optional(),
    paciente: id,
    orgao: id,
    cadastradoEm: data,
    numeroRegistroCentral: texto(30),
    numeroCadastroNacional: texto(30),
    situacao: z.enum(SITUACOES_RECEPTOR).default('ativo'),
    apto: z.boolean().default(true),
    motivoAptidao: texto(500),
    urgencia: z.boolean().default(false),
    centroHemodialise: texto(100),
    tipoDialise: z.enum(TIPOS_DIALISE).nullable().optional(),
    tipoAcessoDialise: texto(40),
    outrosResultados: texto(500),
  })
  .strict()
  .refine((x) => (x.id === undefined) === (x.versao === undefined), {
    message: 'A alteração leva o id e a versão lida.',
    path: ['versao'],
  });
export type EntradaReceptor = z.infer<typeof esquemaReceptor>;

export const esquemaDestino = z.union([
  z
    .object({
      doador: id,
      receptor: id,
      orgao: id,
      doadorVivoParente: z.boolean().default(false),
      parentesco: id.nullable().optional(),
      observacao: texto(500),
    })
    .strict(),
  z
    .object({
      id,
      versao,
      situacao: z.enum(SITUACOES_DESTINO_ORGAO),
      transplantadoEm: data.nullable().optional(),
      observacao: texto(500),
    })
    .strict(),
]);
export type EntradaDestino = z.infer<typeof esquemaDestino>;

export const esquemaAcompanhamento = z
  .object({
    receptor: id,
    atendimento: id.nullable().optional(),
    observadoEm: data,
    tipo: z.enum(TIPOS_ACOMPANHAMENTO_TRANSPLANTE).default('sintoma'),
    descricao: z.string().max(500),
  })
  .strict();
export type EntradaAcompanhamento = z.infer<typeof esquemaAcompanhamento>;

export const ESQUEMAS_TRANSPLANTE = {
  doador: esquemaDoador,
  antibiotico: esquemaAntibiotico,
  preservacao: esquemaPreservacao,
  receptor: esquemaReceptor,
  destino: esquemaDestino,
  acompanhamento: esquemaAcompanhamento,
} as const;
export type GravacaoTransplante = keyof typeof ESQUEMAS_TRANSPLANTE;

export interface NucleoTransplante {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}
export interface ContextoTransplante {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoTransplante = ContextoTransplante & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};
export interface ResultadoTransplante {
  readonly id: number;
  readonly versao: number;
  readonly [campo: string]: number | string;
}

type Ref = { readonly id: number; readonly descricao: string };
export interface DoacaoLida {
  readonly id: number;
  readonly versao: number;
  readonly tipo: string;
  readonly situacao: string;
  readonly encerrada: boolean;
  readonly consentimento: string;
  readonly consentimentoEm: string | null;
  readonly responsavelConsentimento: string | null;
  readonly parentesco: Ref | null;
  readonly registroCentral: string | null;
  readonly causaInternacao: string | null;
  readonly causaMorte: string | null;
  readonly morteEncefalicaEm: string | null;
  readonly internadoEm: string | null;
  readonly diasTerapiaIntensiva: number | null;
  readonly pesoKg: number | null;
  readonly alturaCm: number | null;
  readonly pressaoArterial: string | null;
  readonly frequenciaCardiaca: number | null;
  readonly saturacao: number | null;
  readonly teveParadaCardiaca: boolean;
  readonly paradaDescricao: string | null;
  readonly aminasVasoativas: string | null;
  readonly cirurgiasPrevias: string | null;
  readonly nutricao: string | null;
  readonly diagnosticoDiferencial: string | null;
  readonly captacaoEm: string | null;
  readonly meioLocomocao: string | null;
  readonly procedimentoInicioEm: string | null;
  readonly procedimentoFimEm: string | null;
  readonly clampeamentoEm: string | null;
  readonly tipoPerfusao: string | null;
  readonly observacao: string | null;
  readonly fechadoEm: string | null;
  readonly pendencias: readonly FalhaTransplante[];
  readonly antibioticos: readonly {
    id: number;
    versao: number;
    sequencia: number;
    descricao: string;
    inicio: string | null;
    fim: string | null;
  }[];
  readonly preservacoes: readonly {
    id: number;
    sequencia: number;
    orgao: Ref;
    receptor: number | null;
    nomeSolucao: string;
    marca: string | null;
    lote: string | null;
    validade: string | null;
    volumeMl: number | null;
    aplicadaEm: string | null;
    responsavel: string | null;
  }[];
  readonly destinos: readonly DestinoLido[];
}
export interface DestinoLido {
  readonly id: number;
  readonly versao: number;
  readonly doador: number;
  readonly receptor: number;
  readonly prontuarioReceptor: string | null;
  readonly prontuarioDoador: string | null;
  readonly orgao: Ref;
  readonly situacao: string;
  readonly doadorVivoParente: boolean;
  readonly observacao: string | null;
}
export interface InscricaoLida {
  readonly id: number;
  readonly versao: number;
  readonly orgao: Ref;
  readonly cadastradoEm: string | null;
  readonly situacao: string;
  readonly naLista: boolean;
  readonly apto: boolean;
  readonly motivoAptidao: string | null;
  readonly aptidaoAlteradaEm: string | null;
  readonly urgencia: boolean;
  readonly numeroRegistroCentral: string | null;
  readonly numeroCadastroNacional: string | null;
  readonly transplantadoEm: string | null;
  readonly doador: number | null;
  readonly centroHemodialise: string | null;
  readonly tipoDialise: string | null;
  readonly tipoAcessoDialise: string | null;
  readonly outrosResultados: string | null;
  readonly acompanhamentos: readonly {
    id: number;
    sequencia: number;
    observadoEm: string | null;
    dias: number | null;
    tipo: string;
    descricao: string;
    destaque: boolean;
    profissional: string | null;
  }[];
  readonly destinos: readonly DestinoLido[];
}
export interface TransplanteDoPaciente {
  readonly doacoes: readonly DoacaoLida[];
  readonly inscricoes: readonly InscricaoLida[];
}
export interface OpcoesTransplante {
  readonly orgaos: readonly {
    id: number;
    codigo: string;
    descricao: string;
    tipo: string;
    quantidadePorDoador: number;
  }[];
  readonly parentescos: readonly Ref[];
}
export interface ReceptorNaLista {
  readonly id: number;
  readonly paciente: number;
  readonly prontuario: string | null;
  readonly cadastradoEm: string | null;
  readonly situacao: string;
  readonly apto: boolean;
  readonly urgencia: boolean;
  readonly numeroRegistroCentral: string | null;
}

const recusar = (f: readonly FalhaTransplante[]): void => {
  if (f.length) throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
const naoEncontrado = (o: string) =>
  new ErroOperacao(
    404,
    `${o}-inexistente`,
    'Não encontrado',
    `Registro de ${o} não encontrado neste estabelecimento.`,
  );
const momentoOuNull = (v: string | null | undefined) => (v ? new Date(v) : null);

const COLUNAS_DOADOR: Readonly<Record<string, string>> = {
  atendimento: 'atendimento_id',
  tipo: 'tipo_doador',
  situacao: 'situacao',
  consentimento: 'consentimento_familia',
  consentimentoEm: 'consentimento_em',
  responsavelConsentimento: 'responsavel_consentimento_nome',
  parentesco: 'tipo_parentesco_id',
  registroCentral: 'registro_central_transplante',
  causaInternacao: 'causa_internacao',
  causaMorte: 'causa_morte',
  morteEncefalicaEm: 'morte_encefalica_em',
  internadoEm: 'internado_em',
  diasTerapiaIntensiva: 'dias_terapia_intensiva',
  pesoKg: 'peso_kg',
  alturaCm: 'altura_cm',
  pressaoArterial: 'pressao_arterial',
  frequenciaCardiaca: 'frequencia_cardiaca',
  saturacao: 'saturacao_oxigenio',
  teveParadaCardiaca: 'teve_parada_cardiaca',
  paradaDescricao: 'parada_cardiaca_descricao',
  aminasVasoativas: 'aminas_vasoativas',
  cirurgiasPrevias: 'cirurgias_previas',
  nutricao: 'nutricao',
  diagnosticoDiferencial: 'diagnostico_diferencial',
  captacaoEm: 'captacao_em',
  meioLocomocao: 'meio_locomocao',
  procedimentoInicioEm: 'procedimento_inicio_em',
  procedimentoFimEm: 'procedimento_fim_em',
  clampeamentoEm: 'clampeamento_em',
  tipoPerfusao: 'tipo_perfusao',
  observacao: 'observacao',
};
const MOMENTOS_DOADOR = new Set([
  'consentimentoEm',
  'morteEncefalicaEm',
  'internadoEm',
  'captacaoEm',
  'procedimentoInicioEm',
  'procedimentoFimEm',
  'clampeamentoEm',
]);

const SQL_DESTINO = `SELECT dr.id, dr.versao, dr.doador_orgao_id, dr.receptor_transplante_id, dr.situacao,
       dr.doador_vivo_parente, dr.observacao, o.id AS orgao_id, o.descricao AS orgao,
       pr.numero_prontuario AS prontuario_receptor, pd.numero_prontuario AS prontuario_doador
  FROM doador_receptor dr
  JOIN orgao_transplante o ON o.id = dr.orgao_transplante_id
  JOIN receptor_transplante rt ON rt.id = dr.receptor_transplante_id
  JOIN paciente pr ON pr.id = rt.paciente_id
  JOIN doador_orgao d ON d.id = dr.doador_orgao_id
  JOIN paciente pd ON pd.id = d.paciente_id
 WHERE dr.excluido_em IS NULL`;
const destinoLido = (x: Record<string, unknown>): DestinoLido => ({
  id: num(x['id']),
  versao: num(x['versao']),
  doador: num(x['doador_orgao_id']),
  receptor: num(x['receptor_transplante_id']),
  prontuarioReceptor: txt(x['prontuario_receptor']),
  prontuarioDoador: txt(x['prontuario_doador']),
  orgao: { id: num(x['orgao_id']), descricao: String(x['orgao']) },
  situacao: String(x['situacao']),
  doadorVivoParente: bool(x['doador_vivo_parente']),
  observacao: txt(x['observacao']),
});

export class TransplanteClinicoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly ops: { readonly [K in GravacaoTransplante]: Operacao<unknown, ResultadoTransplante> };

  constructor(
    private readonly nucleo: NucleoTransplante,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    const op = <E>(
      nome: string,
      tabelas: string[],
      entrada: z.ZodType<E>,
      gravar: (tx: TxOperacao, e: E, ctx: ContextoOperacao) => Promise<ResultadoTransplante>,
    ) =>
      definirOperacao<E, ResultadoTransplante>({
        nome,
        tabelas,
        entrada,
        gravar,
        alvo: (_e, r) => ({ tabela: tabelas[0]!, id: r.id }),
      }) as unknown as Operacao<unknown, ResultadoTransplante>;
    this.ops = {
      doador: op(
        'pep.transplante.doador',
        ['doador_orgao'],
        esquemaDoador as z.ZodType<EntradaDoador>,
        (t, e, c) => this.gravarDoador(t, e, c),
      ),
      antibiotico: op(
        'pep.transplante.antibiotico',
        ['doador_antibiotico'],
        esquemaAntibiotico as z.ZodType<EntradaAntibiotico>,
        (t, e, c) => this.gravarAntibiotico(t, e, c),
      ),
      preservacao: op(
        'pep.transplante.preservacao',
        ['solucao_preservacao_orgao'],
        esquemaPreservacao as z.ZodType<EntradaPreservacao>,
        (t, e, c) => this.gravarPreservacao(t, e, c),
      ),
      receptor: op(
        'pep.transplante.receptor',
        ['receptor_transplante'],
        esquemaReceptor as z.ZodType<EntradaReceptor>,
        (t, e, c) => this.gravarReceptor(t, e, c),
      ),
      destino: op(
        'pep.transplante.destino',
        ['doador_receptor', 'receptor_transplante'],
        esquemaDestino as z.ZodType<EntradaDestino>,
        (t, e, c) => this.gravarDestino(t, e, c),
      ),
      acompanhamento: op(
        'pep.transplante.acompanhamento',
        ['acompanhamento_pos_transplante'],
        esquemaAcompanhamento as z.ZodType<EntradaAcompanhamento>,
        (t, e, c) => this.gravarAcompanhamento(t, e, c),
      ),
    };
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>, estabelecimento?: number): Promise<T> {
    return this.nucleo.lerSomente(
      {
        cliente: this.cliente,
        correlacao: 'pep.transplante',
        ...(estabelecimento ? { estabelecimento } : {}),
      },
      fn,
    );
  }

  private quem(c: ContextoTransplante) {
    return this.ler(async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  pacienteExiste(paciente: number): Promise<boolean> {
    return this.ler(async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /**
   * Os pacientes a que a gravação se refere (o vínculo assistencial é conferido com cada um); null quando o registro
   * não existe. O destino do órgão altera o doador e o receptor (no transplante, a inscrição do receptor muda junto),
   * por isso traz os dois.
   */
  pacientesDaGravacao(
    tipo: GravacaoTransplante,
    e: Record<string, unknown>,
  ): Promise<readonly number[] | null> {
    return this.ler(async (l) => {
      const um = (p: number | null) => (p === null ? null : [p]);
      const doDoador = async (d: unknown) =>
        numOuNull((await l.uma('SELECT paciente_id FROM doador_orgao WHERE id = ?', [d]))?.['paciente_id']);
      const doReceptor = async (r: unknown) =>
        numOuNull(
          (await l.uma('SELECT paciente_id FROM receptor_transplante WHERE id = ?', [r]))?.['paciente_id'],
        );
      switch (tipo) {
        case 'doador':
          return um(e['id'] ? await doDoador(e['id']) : num(e['paciente']));
        case 'receptor':
          return um(e['id'] ? await doReceptor(e['id']) : num(e['paciente']));
        case 'antibiotico':
        case 'preservacao':
          return um(await doDoador(e['doador']));
        case 'acompanhamento':
          return um(await doReceptor(e['receptor']));
        case 'destino': {
          const par = e['doador']
            ? { doador: e['doador'], receptor: e['receptor'] }
            : await l
                .uma('SELECT doador_orgao_id, receptor_transplante_id FROM doador_receptor WHERE id = ?', [
                  e['id'],
                ])
                .then((d) =>
                  d ? { doador: d['doador_orgao_id'], receptor: d['receptor_transplante_id'] } : null,
                );
          if (!par) return null;
          const pd = await doDoador(par.doador);
          const pr = await doReceptor(par.receptor);
          return pd === null || pr === null ? null : [pd, pr];
        }
      }
    });
  }

  /** O paciente doador de uma doação; null quando a doação não existe. */
  pacienteDoDoador(doador: number): Promise<number | null> {
    return this.ler(async (l) =>
      numOuNull(
        (await l.uma('SELECT paciente_id FROM doador_orgao WHERE id = ?', [doador]))?.['paciente_id'],
      ),
    );
  }

  /** Órgãos e tecidos ativos e os parentescos (quem responde pela família; doador vivo aparentado). */
  opcoes(): Promise<OpcoesTransplante> {
    return this.ler(async (l) => ({
      orgaos: (
        await l.consultar(
          `SELECT id, codigo, descricao, tipo, quantidade_por_doador FROM orgao_transplante WHERE ativo = TRUE
            ORDER BY tipo, descricao`,
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        tipo: String(x['tipo']),
        quantidadePorDoador: num(x['quantidade_por_doador']),
      })),
      parentescos: (
        await l.consultar(
          'SELECT id, descricao FROM tipo_parentesco WHERE ativo = TRUE AND proprio_paciente = FALSE ORDER BY descricao',
        )
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) })),
    }));
  }

  /** Receptores do estabelecimento na lista de um órgão (urgência primeiro, depois a antiguidade da inscrição). */
  async receptoresDoOrgao(c: ContextoTransplante, orgao: number): Promise<readonly ReceptorNaLista[]> {
    const q = await this.quem(c);
    return this.ler(
      async (l) =>
        (
          await l.consultar(
            `SELECT rt.id, rt.paciente_id, p.numero_prontuario, rt.cadastrado_em, rt.situacao, rt.apto, rt.urgencia,
                    rt.numero_registro_central
               FROM receptor_transplante rt JOIN paciente p ON p.id = rt.paciente_id
              WHERE rt.estabelecimento_id = ? AND rt.orgao_transplante_id = ? AND rt.excluido_em IS NULL
                AND rt.situacao IN ('ativo','semiativo','suspenso')
              ORDER BY rt.urgencia DESC, rt.cadastrado_em, rt.id`,
            [q.estabelecimento, orgao],
          )
        ).map((x) => ({
          id: num(x['id']),
          paciente: num(x['paciente_id']),
          prontuario: txt(x['numero_prontuario']),
          cadastradoEm: dia(x['cadastrado_em']),
          situacao: String(x['situacao']),
          apto: bool(x['apto']),
          urgencia: bool(x['urgencia']),
          numeroRegistroCentral: txt(x['numero_registro_central']),
        })),
      q.estabelecimento,
    );
  }

  async doPaciente(c: ContextoTransplante, paciente: number): Promise<TransplanteDoPaciente> {
    const q = await this.quem(c);
    return this.ler(async (l) => {
      const doadores = await l.consultar(
        `SELECT d.*, tp.descricao AS parentesco FROM doador_orgao d
           LEFT JOIN tipo_parentesco tp ON tp.id = d.tipo_parentesco_id
          WHERE d.paciente_id = ? AND d.estabelecimento_id = ? AND d.excluido_em IS NULL ORDER BY d.criado_em DESC, d.id DESC`,
        [paciente, q.estabelecimento],
      );
      const idsD = doadores.map((x) => num(x['id']));
      const emD = idsD.map(() => '?').join(',');
      const antib = idsD.length
        ? await l.consultar(
            `SELECT id, versao, doador_orgao_id, sequencia, descricao, data_inicio, data_fim FROM doador_antibiotico
              WHERE doador_orgao_id IN (${emD}) AND excluido_em IS NULL ORDER BY sequencia`,
            idsD,
          )
        : [];
      const pres = idsD.length
        ? await l.consultar(
            `SELECT s.id, s.doador_orgao_id, s.sequencia, s.orgao_transplante_id, o.descricao AS orgao,
                    s.receptor_transplante_id, s.nome_solucao, s.marca, s.lote, s.data_validade, s.volume_ml,
                    s.aplicada_em, pf.nome AS responsavel
               FROM solucao_preservacao_orgao s JOIN orgao_transplante o ON o.id = s.orgao_transplante_id
               LEFT JOIN profissional pr ON pr.id = s.responsavel_profissional_id
               LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE s.doador_orgao_id IN (${emD}) AND s.excluido_em IS NULL ORDER BY s.sequencia`,
            idsD,
          )
        : [];
      const inscr = await l.consultar(
        `SELECT rt.*, o.descricao AS orgao FROM receptor_transplante rt
           JOIN orgao_transplante o ON o.id = rt.orgao_transplante_id
          WHERE rt.paciente_id = ? AND rt.estabelecimento_id = ? AND rt.excluido_em IS NULL
          ORDER BY rt.cadastrado_em DESC, rt.id DESC`,
        [paciente, q.estabelecimento],
      );
      const idsR = inscr.map((x) => num(x['id']));
      const emR = idsR.map(() => '?').join(',');
      const acomp = idsR.length
        ? await l.consultar(
            `SELECT a.id, a.receptor_transplante_id, a.sequencia, a.observado_em, a.tipo, a.descricao,
                    pf.nome AS profissional
               FROM acompanhamento_pos_transplante a
               LEFT JOIN profissional pr ON pr.id = a.registrado_profissional_id
               LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
              WHERE a.receptor_transplante_id IN (${emR}) AND a.excluido_em IS NULL ORDER BY a.sequencia`,
            idsR,
          )
        : [];
      const destinos =
        idsD.length || idsR.length
          ? (
              await l.consultar(
                `${SQL_DESTINO} AND (dr.doador_orgao_id IN (${idsD.length ? emD : 'NULL'})
                    OR dr.receptor_transplante_id IN (${idsR.length ? emR : 'NULL'})) ORDER BY dr.id`,
                [...idsD, ...idsR],
              )
            ).map(destinoLido)
          : [];
      const doacoes: DoacaoLida[] = doadores.map((x) => {
        const did = num(x['id']);
        const situacao = String(x['situacao']) as SituacaoDoadorOrgao;
        return {
          id: did,
          versao: num(x['versao']),
          tipo: String(x['tipo_doador']),
          situacao,
          encerrada: doadorEncerrado(situacao),
          consentimento: String(x['consentimento_familia']),
          consentimentoEm: iso(x['consentimento_em']),
          responsavelConsentimento: txt(x['responsavel_consentimento_nome']),
          parentesco: x['tipo_parentesco_id']
            ? { id: num(x['tipo_parentesco_id']), descricao: String(x['parentesco']) }
            : null,
          registroCentral: txt(x['registro_central_transplante']),
          causaInternacao: txt(x['causa_internacao']),
          causaMorte: txt(x['causa_morte']),
          morteEncefalicaEm: iso(x['morte_encefalica_em']),
          internadoEm: iso(x['internado_em']),
          diasTerapiaIntensiva: numOuNull(x['dias_terapia_intensiva']),
          pesoKg: numOuNull(x['peso_kg']),
          alturaCm: numOuNull(x['altura_cm']),
          pressaoArterial: txt(x['pressao_arterial']),
          frequenciaCardiaca: numOuNull(x['frequencia_cardiaca']),
          saturacao: numOuNull(x['saturacao_oxigenio']),
          teveParadaCardiaca: bool(x['teve_parada_cardiaca']),
          paradaDescricao: txt(x['parada_cardiaca_descricao']),
          aminasVasoativas: txt(x['aminas_vasoativas']),
          cirurgiasPrevias: txt(x['cirurgias_previas']),
          nutricao: txt(x['nutricao']),
          diagnosticoDiferencial: txt(x['diagnostico_diferencial']),
          captacaoEm: iso(x['captacao_em']),
          meioLocomocao: txt(x['meio_locomocao']),
          procedimentoInicioEm: iso(x['procedimento_inicio_em']),
          procedimentoFimEm: iso(x['procedimento_fim_em']),
          clampeamentoEm: iso(x['clampeamento_em']),
          tipoPerfusao: txt(x['tipo_perfusao']),
          observacao: txt(x['observacao']),
          fechadoEm: iso(x['fechado_em']),
          pendencias: pendenciasDoador({
            tipo: String(x['tipo_doador']) as TipoDoadorOrgao,
            situacao,
            consentimento: String(x['consentimento_familia']) as ConsentimentoDoacao,
            morteEncefalicaEm: dataDe(x['morte_encefalica_em']),
            registroCentral: txt(x['registro_central_transplante']),
          }),
          antibioticos: antib
            .filter((a) => num(a['doador_orgao_id']) === did)
            .map((a) => ({
              id: num(a['id']),
              versao: num(a['versao']),
              sequencia: num(a['sequencia']),
              descricao: String(a['descricao']),
              inicio: dia(a['data_inicio']),
              fim: dia(a['data_fim']),
            })),
          preservacoes: pres
            .filter((p) => num(p['doador_orgao_id']) === did)
            .map((p) => ({
              id: num(p['id']),
              sequencia: num(p['sequencia']),
              orgao: { id: num(p['orgao_transplante_id']), descricao: String(p['orgao']) },
              receptor: numOuNull(p['receptor_transplante_id']),
              nomeSolucao: String(p['nome_solucao']),
              marca: txt(p['marca']),
              lote: txt(p['lote']),
              validade: dia(p['data_validade']),
              volumeMl: numOuNull(p['volume_ml']),
              aplicadaEm: iso(p['aplicada_em']),
              responsavel: txt(p['responsavel']),
            })),
          destinos: destinos.filter((d) => d.doador === did),
        };
      });
      const inscricoes: InscricaoLida[] = inscr.map((x) => {
        const rid = num(x['id']);
        const situacao = String(x['situacao']) as SituacaoReceptor;
        const transplantadoEm = dia(x['transplantado_em']);
        return {
          id: rid,
          versao: num(x['versao']),
          orgao: { id: num(x['orgao_transplante_id']), descricao: String(x['orgao']) },
          cadastradoEm: dia(x['cadastrado_em']),
          situacao,
          naLista: ['ativo', 'semiativo', 'suspenso'].includes(situacao),
          apto: bool(x['apto']),
          motivoAptidao: txt(x['motivo_aptidao']),
          aptidaoAlteradaEm: dia(x['aptidao_alterada_em']),
          urgencia: bool(x['urgencia']),
          numeroRegistroCentral: txt(x['numero_registro_central']),
          numeroCadastroNacional: txt(x['numero_cadastro_nacional']),
          transplantadoEm,
          doador: numOuNull(x['doador_orgao_id']),
          centroHemodialise: txt(x['centro_hemodialise']),
          tipoDialise: txt(x['tipo_dialise']),
          tipoAcessoDialise: txt(x['tipo_acesso_dialise']),
          outrosResultados: txt(x['outros_resultados']),
          acompanhamentos: acomp
            .filter((a) => num(a['receptor_transplante_id']) === rid)
            .map((a) => {
              const observadoEm = dia(a['observado_em']);
              const tipo = String(a['tipo']) as TipoAcompanhamentoTransplante;
              return {
                id: num(a['id']),
                sequencia: num(a['sequencia']),
                observadoEm,
                dias: transplantadoEm && observadoEm ? diasDoTransplante(transplantadoEm, observadoEm) : null,
                tipo,
                descricao: String(a['descricao']),
                destaque: acompanhamentoEmDestaque(tipo),
                profissional: txt(a['profissional']),
              };
            }),
          destinos: destinos.filter((d) => d.receptor === rid),
        };
      });
      return { doacoes, inscricoes };
    }, q.estabelecimento);
  }

  async gravar(tipo: GravacaoTransplante, c: ContextoGravacaoTransplante, entrada: unknown) {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.ops[tipo], this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  // ------------------------------------------------------------ gravações (dentro da transação do executor)

  private async profissionalDaSessao(tx: TxOperacao, ctx: ContextoOperacao): Promise<number | null> {
    const p = await tx.uma(
      `SELECT profissional_id FROM usuario_profissional
        WHERE usuario_id = ? AND vigencia_fim IS NULL AND excluido_em IS NULL LIMIT 1`,
      [ctx.usuario],
    );
    return p ? num(p['profissional_id']) : null;
  }

  private async doadorTravado(tx: TxOperacao, doador: number, ctx: ContextoOperacao) {
    const [d] = await tx.consultarParaAtualizar(
      `SELECT id, versao, paciente_id, tipo_doador, situacao, procedimento_inicio_em FROM doador_orgao
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [doador, ctx.estabelecimento],
    );
    if (!d) throw naoEncontrado('doador');
    return d;
  }

  private async receptorTravado(tx: TxOperacao, receptor: number, ctx: ContextoOperacao) {
    const [r] = await tx.consultarParaAtualizar(
      `SELECT id, versao, paciente_id, orgao_transplante_id, situacao, cadastrado_em, transplantado_em
         FROM receptor_transplante WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [receptor, ctx.estabelecimento],
    );
    if (!r) throw naoEncontrado('receptor');
    return r;
  }

  private async conferirAtendimento(
    tx: TxOperacao,
    atendimento: number | null | undefined,
    paciente: number,
    ctx: ContextoOperacao,
  ) {
    if (!atendimento) return;
    const a = await tx.uma('SELECT paciente_id, estabelecimento_id FROM atendimento WHERE id = ?', [
      atendimento,
    ]);
    if (!a || num(a['paciente_id']) !== paciente || num(a['estabelecimento_id']) !== ctx.estabelecimento)
      throw recusa('atendimento-de-outro-paciente', 'O atendimento não é deste paciente nesta unidade.');
  }

  private async proximaSequencia(tx: TxOperacao, sql: string, pai: number): Promise<number> {
    const r = await tx.uma(sql, [pai]);
    return num(r?.['n'] ?? 0) + 1;
  }

  private async gravarDoador(
    tx: TxOperacao,
    e: EntradaDoador,
    ctx: ContextoOperacao,
  ): Promise<ResultadoTransplante> {
    const agora = this.agora();
    const dados: DadosDoadorOrgao = {
      tipo: e.tipo,
      situacao: e.situacao,
      consentimento: e.consentimento,
      consentimentoEm: momentoOuNull(e.consentimentoEm),
      responsavelConsentimento: e.responsavelConsentimento ?? null,
      parentescoId: e.parentesco ?? null,
      morteEncefalicaEm: momentoOuNull(e.morteEncefalicaEm),
      captacaoEm: momentoOuNull(e.captacaoEm),
      procedimentoInicioEm: momentoOuNull(e.procedimentoInicioEm),
      procedimentoFimEm: momentoOuNull(e.procedimentoFimEm),
      clampeamentoEm: momentoOuNull(e.clampeamentoEm),
      saturacao: e.saturacao ?? null,
      pesoKg: e.pesoKg ?? null,
      alturaCm: e.alturaCm ?? null,
      teveParadaCardiaca: e.teveParadaCardiaca,
      paradaDescricao: e.paradaDescricao ?? null,
    };
    const valores: Record<string, unknown> = {};
    for (const [campo, coluna] of Object.entries(COLUNAS_DOADOR)) {
      const v = (e as Record<string, unknown>)[campo];
      valores[coluna] = v === undefined ? null : MOMENTOS_DOADOR.has(campo) && v ? new Date(String(v)) : v;
    }
    valores['fechado_em'] = doadorEncerrado(e.situacao) ? agora : null;
    await this.conferirAtendimento(tx, e.atendimento, e.paciente, ctx);
    if (e.id !== undefined) {
      const atual = await this.doadorTravado(tx, e.id, ctx);
      if (num(atual['paciente_id']) !== e.paciente)
        throw recusa('doador-de-outro-paciente', 'A doação é de outro paciente.');
      const de = String(atual['situacao']) as SituacaoDoadorOrgao;
      const t = conferirTransicaoDoador(de, e.situacao);
      if (t) recusar([t]);
      if (doadorEncerrado(de) && de === e.situacao)
        throw recusa('doacao-encerrada', 'A doação está encerrada e não muda mais.');
      recusar(conferirDoadorOrgao(dados, agora));
      const v = await tx.alterar('doador_orgao', e.id, e.versao!, valores);
      return { id: e.id, versao: v, situacao: e.situacao };
    }
    if (e.situacao !== 'em_avaliacao')
      throw recusa(
        'doacao-comeca-em-avaliacao',
        'A doação nasce em avaliação e segue os passos da situação.',
      );
    recusar(conferirDoadorOrgao(dados, agora));
    await tx.consultarParaAtualizar('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
      e.paciente,
    ]);
    const aberta = await tx.uma(
      `SELECT id FROM doador_orgao WHERE paciente_id = ? AND excluido_em IS NULL
          AND situacao IN ('em_avaliacao','apto','inapto') LIMIT 1`,
      [e.paciente],
    );
    if (aberta) throw recusa('doacao-em-aberto', 'Este paciente já tem uma doação em aberto: continue nela.');
    const novo = await tx.incluir('doador_orgao', {
      ...valores,
      estabelecimento_id: ctx.estabelecimento,
      paciente_id: e.paciente,
      profissional_id: await this.profissionalDaSessao(tx, ctx),
      origem: 'sistema',
    });
    return { id: novo, versao: 1, situacao: e.situacao };
  }

  private async gravarAntibiotico(
    tx: TxOperacao,
    e: EntradaAntibiotico,
    ctx: ContextoOperacao,
  ): Promise<ResultadoTransplante> {
    const d = await this.doadorTravado(tx, e.doador, ctx);
    if (doadorEncerrado(String(d['situacao']) as SituacaoDoadorOrgao) && e.id === undefined)
      throw recusa('doacao-encerrada', 'A doação está encerrada.');
    const hoje = hojeLocal(this.agora());
    if (e.id !== undefined) {
      const a = await tx.uma(
        'SELECT id, descricao, data_inicio, data_fim FROM doador_antibiotico WHERE id = ? AND doador_orgao_id = ?',
        [e.id, e.doador],
      );
      if (!a) throw naoEncontrado('antibiotico');
      if (a['data_fim'] !== null) throw recusa('antibiotico-encerrado', 'O antibiótico já está encerrado.');
      recusar(
        conferirAntibioticoDoador(
          { descricao: String(a['descricao']), inicio: dia(a['data_inicio'])!, fim: e.fim! },
          hoje,
        ),
      );
      const v = await tx.alterar('doador_antibiotico', e.id, e.versao!, { data_fim: e.fim });
      return { id: e.id, versao: v };
    }
    recusar(
      conferirAntibioticoDoador({ descricao: e.descricao, inicio: e.inicio!, fim: e.fim ?? null }, hoje),
    );
    const sequencia = await this.proximaSequencia(
      tx,
      'SELECT MAX(sequencia) AS n FROM doador_antibiotico WHERE doador_orgao_id = ?',
      e.doador,
    );
    const novo = await tx.incluir('doador_antibiotico', {
      doador_orgao_id: e.doador,
      sequencia,
      antimicrobiano_id: e.antimicrobiano ?? null,
      descricao: e.descricao.trim(),
      data_inicio: e.inicio,
      data_fim: e.fim ?? null,
      origem: 'sistema',
    });
    return { id: novo, versao: 1, sequencia };
  }

  private async gravarPreservacao(
    tx: TxOperacao,
    e: EntradaPreservacao,
    ctx: ContextoOperacao,
  ): Promise<ResultadoTransplante> {
    const d = await this.doadorTravado(tx, e.doador, ctx);
    const orgao = await tx.uma('SELECT id FROM orgao_transplante WHERE id = ? AND ativo = TRUE', [e.orgao]);
    if (!orgao) throw recusa('orgao-inexistente', 'Órgão inexistente ou inativo.');
    if (e.receptor) {
      const destino = await tx.uma(
        `SELECT id FROM doador_receptor WHERE doador_orgao_id = ? AND receptor_transplante_id = ?
            AND orgao_transplante_id = ? AND excluido_em IS NULL`,
        [e.doador, e.receptor, e.orgao],
      );
      if (!destino)
        throw recusa('receptor-sem-destino', 'O órgão deste doador não foi destinado a este receptor.');
    }
    recusar(
      conferirPreservacao(
        {
          situacaoDoador: String(d['situacao']) as SituacaoDoadorOrgao,
          aplicadaEm: new Date(e.aplicadaEm),
          validade: e.validade ?? null,
          volumeMl: e.volumeMl ?? null,
          procedimentoInicioEm: dataDe(d['procedimento_inicio_em']),
          nomeSolucao: e.nomeSolucao,
        },
        this.agora(),
      ),
    );
    const sequencia = await this.proximaSequencia(
      tx,
      'SELECT MAX(sequencia) AS n FROM solucao_preservacao_orgao WHERE doador_orgao_id = ?',
      e.doador,
    );
    const novo = await tx.incluir('solucao_preservacao_orgao', {
      doador_orgao_id: e.doador,
      sequencia,
      orgao_transplante_id: e.orgao,
      receptor_transplante_id: e.receptor ?? null,
      nome_solucao: e.nomeSolucao.trim(),
      marca: e.marca ?? null,
      lote: e.lote ?? null,
      data_validade: e.validade ?? null,
      volume_ml: e.volumeMl ?? null,
      aplicada_em: new Date(e.aplicadaEm),
      responsavel_profissional_id: await this.profissionalDaSessao(tx, ctx),
      observacao: e.observacao ?? null,
      origem: 'sistema',
    });
    return { id: novo, versao: 1, sequencia };
  }

  private async gravarReceptor(
    tx: TxOperacao,
    e: EntradaReceptor,
    ctx: ContextoOperacao,
  ): Promise<ResultadoTransplante> {
    const hoje = hojeLocal(this.agora());
    recusar(
      conferirReceptor(
        { cadastradoEm: e.cadastradoEm, apto: e.apto, motivoAptidao: e.motivoAptidao ?? null },
        hoje,
      ),
    );
    const comuns = {
      numero_registro_central: e.numeroRegistroCentral ?? null,
      numero_cadastro_nacional: e.numeroCadastroNacional ?? null,
      situacao: e.situacao,
      apto: e.apto,
      motivo_aptidao: e.motivoAptidao ?? null,
      urgencia: e.urgencia,
      centro_hemodialise: e.centroHemodialise ?? null,
      tipo_dialise: e.tipoDialise ?? null,
      tipo_acesso_dialise: e.tipoAcessoDialise ?? null,
      outros_resultados: e.outrosResultados ?? null,
      retirado_pelo_hospital: e.situacao === 'removido',
    };
    if (e.id !== undefined) {
      const atual = await this.receptorTravado(tx, e.id, ctx);
      if (num(atual['paciente_id']) !== e.paciente || num(atual['orgao_transplante_id']) !== e.orgao)
        throw recusa('inscricao-imutavel', 'Paciente e órgão da inscrição não mudam: faça outra inscrição.');
      const de = String(atual['situacao']) as SituacaoReceptor;
      const t = conferirTransicaoReceptor(de, e.situacao);
      if (t) recusar([t]);
      if (de === e.situacao && !['ativo', 'semiativo', 'suspenso'].includes(de))
        throw recusa('receptor-fora-da-lista', 'A inscrição já saiu da lista e não muda mais.');
      const aptoAntes = await tx.uma(
        'SELECT apto, aptidao_alterada_em FROM receptor_transplante WHERE id = ?',
        [e.id],
      );
      const v = await tx.alterar('receptor_transplante', e.id, e.versao!, {
        ...comuns,
        aptidao_alterada_em:
          aptoAntes && bool(aptoAntes['apto']) !== e.apto
            ? hoje
            : (aptoAntes?.['aptidao_alterada_em'] ?? null),
      });
      return { id: e.id, versao: v, situacao: e.situacao };
    }
    const t = conferirTransicaoReceptor('ativo', e.situacao);
    if (t || !['ativo', 'semiativo', 'suspenso'].includes(e.situacao))
      recusar([t ?? { codigo: 'inscricao-fora-da-lista', mensagem: 'A inscrição nasce na lista.' }]);
    await tx.consultarParaAtualizar('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [
      e.paciente,
    ]);
    const orgao = await tx.uma('SELECT id FROM orgao_transplante WHERE id = ? AND ativo = TRUE', [e.orgao]);
    if (!orgao) throw recusa('orgao-inexistente', 'Órgão inexistente ou inativo.');
    const aberta = await tx.uma(
      `SELECT id FROM receptor_transplante WHERE paciente_id = ? AND orgao_transplante_id = ? AND excluido_em IS NULL
          AND situacao IN ('ativo','semiativo','suspenso') LIMIT 1`,
      [e.paciente, e.orgao],
    );
    if (aberta) throw recusa('inscricao-em-aberto', 'O paciente já está na lista deste órgão.');
    const novo = await tx.incluir('receptor_transplante', {
      ...comuns,
      estabelecimento_id: ctx.estabelecimento,
      paciente_id: e.paciente,
      orgao_transplante_id: e.orgao,
      cadastrado_em: e.cadastradoEm,
      aptidao_alterada_em: e.apto ? null : hoje,
      origem: 'sistema',
    });
    return { id: novo, versao: 1, situacao: e.situacao };
  }

  private async gravarDestino(
    tx: TxOperacao,
    e: EntradaDestino,
    ctx: ContextoOperacao,
  ): Promise<ResultadoTransplante> {
    if ('doador' in e) {
      const d = await this.doadorTravado(tx, e.doador, ctx);
      const r = await this.receptorTravado(tx, e.receptor, ctx);
      recusar(
        conferirDestino({
          pacienteDoador: num(d['paciente_id']),
          pacienteReceptor: num(r['paciente_id']),
          orgao: e.orgao,
          orgaoDoReceptor: num(r['orgao_transplante_id']),
          situacaoDoador: String(d['situacao']) as SituacaoDoadorOrgao,
          tipoDoador: String(d['tipo_doador']) as TipoDoadorOrgao,
          situacaoReceptor: String(r['situacao']) as SituacaoReceptor,
          doadorVivoParente: e.doadorVivoParente,
          parentescoId: e.parentesco ?? null,
        }),
      );
      const repetido = await tx.uma(
        `SELECT id FROM doador_receptor WHERE doador_orgao_id = ? AND receptor_transplante_id = ?
            AND orgao_transplante_id = ?`,
        [e.doador, e.receptor, e.orgao],
      );
      if (repetido) throw recusa('destino-repetido', 'Este órgão do doador já foi ofertado a este receptor.');
      const novo = await tx.incluir('doador_receptor', {
        doador_orgao_id: e.doador,
        receptor_transplante_id: e.receptor,
        orgao_transplante_id: e.orgao,
        doador_vivo_parente: e.doadorVivoParente,
        tipo_parentesco_id: e.parentesco ?? null,
        situacao: 'ofertado',
        observacao: e.observacao ?? null,
      });
      return { id: novo, versao: 1, situacao: 'ofertado' };
    }
    const [dr] = await tx.consultarParaAtualizar(
      `SELECT id, doador_orgao_id, receptor_transplante_id, orgao_transplante_id, situacao, observacao
         FROM doador_receptor WHERE id = ? AND excluido_em IS NULL`,
      [e.id],
    );
    if (!dr) throw naoEncontrado('destino');
    // O doador travado serializa os destinos dele: a contagem do órgão ocupado não corre contra outra gravação.
    const d = await this.doadorTravado(tx, num(dr['doador_orgao_id']), ctx);
    const r = await this.receptorTravado(tx, num(dr['receptor_transplante_id']), ctx);
    const situacaoReceptor = String(r['situacao']) as SituacaoReceptor;
    const ocupados = await tx.uma(
      `SELECT COUNT(*) AS n FROM doador_receptor
        WHERE doador_orgao_id = ? AND orgao_transplante_id = ? AND id <> ? AND excluido_em IS NULL
          AND situacao IN ('aceito','transplantado')`,
      [dr['doador_orgao_id'], dr['orgao_transplante_id'], e.id],
    );
    const orgao = await tx.uma('SELECT quantidade_por_doador FROM orgao_transplante WHERE id = ?', [
      dr['orgao_transplante_id'],
    ]);
    recusar(
      conferirTransicaoDestino(String(dr['situacao']) as SituacaoDestinoOrgao, e.situacao, {
        situacaoDoador: String(d['situacao']) as SituacaoDoadorOrgao,
        situacaoReceptor,
        outrosDestinosOcupados: num(ocupados?.['n'] ?? 0),
        quantidadePorDoador: num(orgao?.['quantidade_por_doador'] ?? 1),
      }),
    );
    const v = await tx.alterar('doador_receptor', e.id, e.versao, {
      situacao: e.situacao,
      observacao: e.observacao ?? txt(dr['observacao']),
    });
    if (e.situacao === 'transplantado' && String(dr['situacao']) !== 'transplantado') {
      const quando = e.transplantadoEm ?? hojeLocal(this.agora());
      if (quando < dia(r['cadastrado_em'])!)
        throw recusa('transplante-antes-inscricao', 'O transplante não pode ser anterior à inscrição.');
      if (quando > hojeLocal(this.agora()))
        throw recusa('transplante-futuro', 'O transplante não pode estar no futuro.');
      const t = conferirTransicaoReceptor(situacaoReceptor, 'transplantado', true);
      if (t) recusar([t]);
      await tx.alterar('receptor_transplante', num(r['id']), num(r['versao']), {
        situacao: 'transplantado',
        transplantado_em: quando,
        doador_orgao_id: num(dr['doador_orgao_id']),
      });
    }
    return { id: e.id, versao: v, situacao: e.situacao };
  }

  private async gravarAcompanhamento(
    tx: TxOperacao,
    e: EntradaAcompanhamento,
    ctx: ContextoOperacao,
  ): Promise<ResultadoTransplante> {
    const r = await this.receptorTravado(tx, e.receptor, ctx);
    recusar(
      conferirAcompanhamento(
        {
          situacaoReceptor: String(r['situacao']) as SituacaoReceptor,
          transplantadoEm: dia(r['transplantado_em']),
          observadoEm: e.observadoEm,
          descricao: e.descricao,
        },
        hojeLocal(this.agora()),
      ),
    );
    await this.conferirAtendimento(tx, e.atendimento, num(r['paciente_id']), ctx);
    const sequencia = await this.proximaSequencia(
      tx,
      'SELECT MAX(sequencia) AS n FROM acompanhamento_pos_transplante WHERE receptor_transplante_id = ?',
      e.receptor,
    );
    const novo = await tx.incluir('acompanhamento_pos_transplante', {
      receptor_transplante_id: e.receptor,
      sequencia,
      atendimento_id: e.atendimento ?? null,
      observado_em: e.observadoEm,
      tipo: e.tipo,
      descricao: e.descricao.trim(),
      registrado_profissional_id: await this.profissionalDaSessao(tx, ctx),
      origem: 'sistema',
    });
    return { id: novo, versao: 1, sequencia };
  }
}
