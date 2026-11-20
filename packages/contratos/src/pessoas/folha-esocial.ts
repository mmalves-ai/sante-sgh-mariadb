// eSocial: eventos de tabela e não periódicos, transmissor único e conciliação (M53-F5; ficha do M53, seções 1, 4, 6 a 8,
// regras 1, 2, 3 e 9; cap-07 §7.1 e §7.1.5). O Sante SGH gera os eventos de tabela (S-1000 empregador, S-1005
// estabelecimento, S-1010 rubricas, S-1020 lotação tributária) e os não periódicos do trabalhador (S-2200 admissão, S-2205
// alteração cadastral, S-2206 alteração contratual, S-2230 afastamento, S-2299 desligamento, S-2300/S-2399 trabalhador
// sem vínculo e S-3000 exclusão), valida cada um no XSD oficial do leiaute vigente (regra 9), monta lotes e os entrega ao
// coletor fora de `producao` (regra 3). Há um só transmissor por empregador (a raiz do CNPJ): o Sante SGH ou o sistema
// externo; os eventos de autônomo do repasse entram na conciliação do mesmo empregador (regra 1). As pendências que o
// outro sistema acumulou nunca são enviadas nem apagadas: o painel só as conta (regra 2).
//
// Dado pessoal: a ficha do eSocial do vínculo (nascimento, sexo, endereço…) e o XML dos eventos do trabalhador (CPF,
// nome) ficam cifrados no banco; as listas trazem só vínculo (ID), matrícula, evento, datas e situação.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

/** Chave de liberação da transmissão ao eSocial (SGH_CFG_LIBERACAO; desligada, com o certificado como pré-requisito). */
export const CHAVE_PESSOAS_ESOCIAL = 'pessoas.esocial';

const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const id = z.coerce.number().int().positive();
const smallint = z.coerce.number().int().min(0).max(32_767);
const digitos = (n: number, rotulo: string) =>
  z.string().regex(new RegExp(`^\\d{${n}}$`), `${rotulo}: ${n} dígitos.`);
/** CNPJ de 14 posições (o alfanumérico de 2026 incluído: 12 letras ou dígitos e 2 dígitos verificadores). */
const cnpj = z.string().regex(/^[A-Z0-9]{12}\d{2}$/, 'CNPJ com 14 posições.');
const motivo = textoCp1252(200).pipe(z.string().trim().min(5, 'Informe o motivo (ao menos 5 letras).'));

// ── Leiaute e catálogo de eventos ─────────────────────────────────────────────────────────────────────────────

/**
 * Versões de leiaute com o XSD oficial versionado no repositório (pasta `xsd/<versão>` do domínio, conferida por
 * SHA-256). A versão em uso é parâmetro do empregador (DP-47), nunca constante do código.
 */
export const LEIAUTES_ESOCIAL = ['v_S_01_03_00'] as const;
export type LeiauteEsocial = (typeof LEIAUTES_ESOCIAL)[number];

/** Grupo do evento (o mesmo do lote do eSocial: 1 tabela, 2 não periódicos, 3 periódicos). */
export const GRUPOS_EVENTO_ESOCIAL = ['tabela', 'nao-periodico', 'periodico'] as const;
export type GrupoEventoEsocial = (typeof GRUPOS_EVENTO_ESOCIAL)[number];
export const NUMERO_GRUPO_ESOCIAL: Readonly<Record<GrupoEventoEsocial, 1 | 2 | 3>> = {
  tabela: 1,
  'nao-periodico': 2,
  periodico: 3,
};

export const EVENTOS_TABELA_ESOCIAL = ['S-1000', 'S-1005', 'S-1010', 'S-1020'] as const;
export type EventoTabelaEsocial = (typeof EVENTOS_TABELA_ESOCIAL)[number];
export const EVENTOS_TRABALHADOR_ESOCIAL = [
  'S-2200',
  'S-2205',
  'S-2206',
  'S-2230',
  'S-2299',
  'S-2300',
  'S-2399',
] as const;
export type EventoTrabalhadorEsocial = (typeof EVENTOS_TRABALHADOR_ESOCIAL)[number];
/**
 * Periódicos (M53-F6): S-1200 remuneração do trabalhador, S-1210 pagamentos de rendimentos, S-1298 reabertura e S-1299
 * fechamento dos eventos periódicos do período de apuração.
 */
export const EVENTOS_PERIODICOS_ESOCIAL = ['S-1200', 'S-1210', 'S-1298', 'S-1299'] as const;
export type EventoPeriodicoEsocial = (typeof EVENTOS_PERIODICOS_ESOCIAL)[number];
/**
 * Saúde e segurança do trabalhador (W0-06): S-2210 comunicação de acidente de trabalho, gerado do acidente do SESMT
 * (original, retificação com indRetif 2 e recibo, ou exclusão pelo S-3000), nunca pela geração avulsa.
 */
export const EVENTOS_SST_ESOCIAL = ['S-2210'] as const;
export type EventoSstEsocial = (typeof EVENTOS_SST_ESOCIAL)[number];
export const EVENTOS_ESOCIAL = [
  ...EVENTOS_TABELA_ESOCIAL,
  ...EVENTOS_PERIODICOS_ESOCIAL,
  ...EVENTOS_TRABALHADOR_ESOCIAL,
  ...EVENTOS_SST_ESOCIAL,
  'S-3000',
] as const;
export type EventoEsocial = (typeof EVENTOS_ESOCIAL)[number];

export interface DefinicaoEventoEsocial {
  readonly codigo: EventoEsocial;
  readonly grupo: GrupoEventoEsocial;
  /** O elemento do evento no XML (e o nome do arquivo XSD). */
  readonly raiz: string;
  readonly rotulo: string;
}

/** Os eventos gerados pelo Sante SGH (tabela e não periódicos na F5; periódicos e fechamento na F6). */
export const CATALOGO_EVENTOS_ESOCIAL: readonly DefinicaoEventoEsocial[] = [
  { codigo: 'S-1000', grupo: 'tabela', raiz: 'evtInfoEmpregador', rotulo: 'Informações do empregador' },
  { codigo: 'S-1005', grupo: 'tabela', raiz: 'evtTabEstab', rotulo: 'Estabelecimentos' },
  { codigo: 'S-1010', grupo: 'tabela', raiz: 'evtTabRubrica', rotulo: 'Rubricas' },
  { codigo: 'S-1020', grupo: 'tabela', raiz: 'evtTabLotacao', rotulo: 'Lotações tributárias' },
  { codigo: 'S-1200', grupo: 'periodico', raiz: 'evtRemun', rotulo: 'Remuneração do trabalhador' },
  { codigo: 'S-1210', grupo: 'periodico', raiz: 'evtPgtos', rotulo: 'Pagamentos de rendimentos' },
  { codigo: 'S-1298', grupo: 'periodico', raiz: 'evtReabreEvPer', rotulo: 'Reabertura dos periódicos' },
  { codigo: 'S-1299', grupo: 'periodico', raiz: 'evtFechaEvPer', rotulo: 'Fechamento dos periódicos' },
  { codigo: 'S-2200', grupo: 'nao-periodico', raiz: 'evtAdmissao', rotulo: 'Admissão' },
  { codigo: 'S-2205', grupo: 'nao-periodico', raiz: 'evtAltCadastral', rotulo: 'Alteração cadastral' },
  { codigo: 'S-2206', grupo: 'nao-periodico', raiz: 'evtAltContratual', rotulo: 'Alteração contratual' },
  { codigo: 'S-2230', grupo: 'nao-periodico', raiz: 'evtAfastTemp', rotulo: 'Afastamento temporário' },
  { codigo: 'S-2299', grupo: 'nao-periodico', raiz: 'evtDeslig', rotulo: 'Desligamento' },
  {
    codigo: 'S-2300',
    grupo: 'nao-periodico',
    raiz: 'evtTSVInicio',
    rotulo: 'Trabalhador sem vínculo: início',
  },
  {
    codigo: 'S-2399',
    grupo: 'nao-periodico',
    raiz: 'evtTSVTermino',
    rotulo: 'Trabalhador sem vínculo: término',
  },
  { codigo: 'S-2210', grupo: 'nao-periodico', raiz: 'evtCAT', rotulo: 'Comunicação de acidente de trabalho' },
  { codigo: 'S-3000', grupo: 'nao-periodico', raiz: 'evtExclusao', rotulo: 'Exclusão de evento' },
];

export const definicaoEventoEsocial = (codigo: EventoEsocial): DefinicaoEventoEsocial =>
  CATALOGO_EVENTOS_ESOCIAL.find((e) => e.codigo === codigo)!;

export const OPERACOES_TABELA_ESOCIAL = ['inclusao', 'alteracao', 'exclusao'] as const;
export type OperacaoTabelaEsocial = (typeof OPERACOES_TABELA_ESOCIAL)[number];

/**
 * A vida do evento: `gerado` (montado, ainda não conferido), `invalido` (o XSD recusou: erros guardados), `validado`
 * (pronto para lote), `em-lote`, `enviado` (entregue ao coletor ou ao eSocial), `aceito` (com recibo), `rejeitado`
 * (com o código e a descrição do retorno), `excluido` (um S-3000 aceito o anulou), `descartado` (desistência antes do
 * envio, com motivo) e `substituido` (uma retificação aceita o trocou).
 */
export const SITUACOES_EVENTO_ESOCIAL = [
  'gerado',
  'invalido',
  'validado',
  'em-lote',
  'enviado',
  'aceito',
  'rejeitado',
  'excluido',
  'descartado',
  'substituido',
] as const;
export type SituacaoEventoEsocial = (typeof SITUACOES_EVENTO_ESOCIAL)[number];

/** Para onde o lote vai: o coletor local (fora de `producao`, regra 3) ou o eSocial (produção restrita ou produção). */
export const AMBIENTES_ESOCIAL = ['coletor', 'producao-restrita', 'producao'] as const;
export type AmbienteEsocial = (typeof AMBIENTES_ESOCIAL)[number];

export const SITUACOES_LOTE_ESOCIAL = ['montado', 'enviado', 'processado', 'cancelado'] as const;
export type SituacaoLoteEsocial = (typeof SITUACOES_LOTE_ESOCIAL)[number];

/** Teto do lote do eSocial (50 eventos do mesmo grupo e do mesmo empregador). */
export const TETO_EVENTOS_LOTE_ESOCIAL = 50;

// ── Empregador: transmissor e parâmetros dos eventos de tabela ────────────────────────────────────────────────

/** Quem transmite o eSocial do empregador (regra 1: um só por raiz de CNPJ). */
export const TRANSMISSORES_ESOCIAL = ['sante', 'externo'] as const;
export type TransmissorEsocial = (typeof TRANSMISSORES_ESOCIAL)[number];

export const esquemaEmpregadorEsocial = z
  .object({
    empresa: smallint,
    /** Início da vigência (AAAA-MM); a correção é uma vigência nova. */
    inicio: competencia,
    transmissor: z.enum(TRANSMISSORES_ESOCIAL),
    leiaute: z.enum(LEIAUTES_ESOCIAL),
    /** Classificação tributária (tabela 8). */
    classTrib: digitos(2, 'Classificação tributária'),
    indCoop: z.number().int().min(0).max(3).nullable(),
    indConstr: z.number().int().min(0).max(1).nullable(),
    /** Desoneração da folha: 0 não aplicável, 1 empresa enquadrada, 2 município enquadrado. */
    indDesFolha: z.number().int().min(0).max(2),
    /** Opção pelo registro eletrônico de empregados: 0 não, 1 sim. */
    indOptRegEletron: z.number().int().min(0).max(1),
    /** CNAE preponderante do estabelecimento (7 dígitos). */
    cnaePrep: digitos(7, 'CNAE'),
    /** Alíquota do RAT: 1, 2 ou 3. */
    aliqRat: z.number().int().min(1).max(3),
    /** FAP em décimos de milésimo (1,0000 = 10000), de 0,5000 a 2,0000. */
    fap: z.number().int().min(5_000).max(20_000),
    /** Código da lotação tributária do empregador (D-LOTACAO-536: uma por empregador). */
    codLotacao: textoCp1252(30).pipe(
      z
        .string()
        .trim()
        .min(1)
        .regex(/^\S(.*\S)?$/),
    ),
    fpas: digitos(3, 'FPAS'),
    codTercs: digitos(4, 'Código de terceiros'),
    /** Identificador da tabela de rubricas no eSocial (até 8 posições). */
    ideTabRubr: textoCp1252(8).pipe(z.string().trim().min(1)),
    /** CNPJ do sindicato da categoria (padrão dos vínculos celetistas). */
    cnpjSindicato: cnpj.nullable(),
    /** De-para do motivo de afastamento do cadastro (ID) para o código do eSocial (tabela 18). */
    motivosAfastamento: z.record(z.string().regex(/^\d+$/), digitos(2, 'Motivo de afastamento')),
  })
  .strict();
export type EmpregadorEsocial = z.infer<typeof esquemaEmpregadorEsocial>;

export interface EmpregadorEsocialLido extends EmpregadorEsocial {
  readonly id: number;
  readonly criadoPor: string;
  readonly criadoEm: string;
}

// ── Ficha do eSocial do vínculo (dado pessoal: cifrada no banco) ───────────────────────────────────────────────

export const esquemaEnderecoEsocial = z
  .object({
    tipoLogradouro: textoCp1252(4).nullable(),
    logradouro: textoCp1252(100).pipe(z.string().trim().min(1)),
    numero: textoCp1252(10).pipe(z.string().trim().min(1)),
    complemento: textoCp1252(30).nullable(),
    bairro: textoCp1252(90).nullable(),
    cep: digitos(8, 'CEP'),
    /** Código do município do IBGE (7 dígitos). */
    municipio: digitos(7, 'Município'),
    uf: z.string().regex(/^[A-Z]{2}$/, 'UF com 2 letras.'),
  })
  .strict();
export type EnderecoEsocial = z.infer<typeof esquemaEnderecoEsocial>;

export const esquemaEstagioEsocial = z
  .object({
    /** O obrigatório, N não obrigatório. */
    natureza: z.enum(['O', 'N']),
    nivel: z.number().int().min(1).max(9).nullable(),
    terminoPrevisto: data,
    cnpjInstituicao: cnpj,
  })
  .strict();

export const esquemaFichaEsocialVinculo = z
  .object({
    sexo: z.enum(['M', 'F']),
    /** Raça e cor (1 branca, 2 preta, 3 parda, 4 amarela, 5 indígena, 6 não informado). */
    racaCor: z.number().int().min(1).max(6),
    estadoCivil: z.number().int().min(1).max(5).nullable(),
    /** Grau de instrução (01 a 12). */
    grauInstrucao: z.string().regex(/^(0[1-9]|1[0-2])$/),
    nomeSocial: textoCp1252(70).nullable(),
    nascimento: data,
    paisNascimento: digitos(3, 'País de nascimento'),
    paisNacionalidade: digitos(3, 'País de nacionalidade'),
    endereco: esquemaEnderecoEsocial,
    /** Categoria do trabalhador (tabela 1: 101 empregado, 901 estagiário…). */
    categoria: digitos(3, 'Categoria'),
    cboCargo: digitos(6, 'CBO').nullable(),
    cboFuncao: digitos(6, 'CBO').nullable(),
    /** Regime de jornada (1 submetido a horário, 2 atividade externa, 3 cargo de confiança, 4 teletrabalho). */
    regimeJornada: z.number().int().min(1).max(4),
    /** 1 urbano, 2 rural. */
    naturezaAtividade: z.number().int().min(1).max(2),
    /** 1 prazo indeterminado, 2 determinado em dias, 3 determinado por fato. */
    tipoContrato: z.number().int().min(1).max(3),
    terminoContrato: data.nullable(),
    /** Tipo de jornada (tabela do leiaute: 2, 3, 4, 5, 6, 7 ou 9). */
    tipoJornada: z
      .number()
      .int()
      .refine((n) => [2, 3, 4, 5, 6, 7, 9].includes(n), 'Tipo de jornada: 2, 3, 4, 5, 6, 7 ou 9.'),
    tempoParcial: z.number().int().min(0).max(3),
    descricaoJornada: textoCp1252(999).pipe(z.string().trim().min(1)),
    tipoAdmissao: z.number().int().min(1).max(7),
    indicativoAdmissao: z.number().int().min(1).max(3),
    /** Sindicato da categoria do vínculo; null usa o do empregador. */
    cnpjSindicato: cnpj.nullable(),
    /** Só do estagiário (categoria 901). */
    estagio: esquemaEstagioEsocial.nullable(),
    /**
     * M53.8 (F7): o NIS (PIS/PASEP/NIT) do trabalhador, 11 dígitos. O eSocial S-1.x identifica o trabalhador só pelo
     * CPF; o NIS é das obrigações anteriores a ele (SEFIP, CAGED e RAIS), que exigem o número. Opcional: as fichas já
     * gravadas não o têm (D-NIS-538).
     */
    nis: digitos(11, 'NIS').nullable().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.tipoContrato === 2 && !f.terminoContrato)
      ctx.addIssue({
        code: 'custom',
        path: ['terminoContrato'],
        message: 'Contrato a prazo exige o término.',
      });
    if (f.categoria === '901' && !f.estagio)
      ctx.addIssue({ code: 'custom', path: ['estagio'], message: 'O estagiário exige os dados do estágio.' });
  });
export type FichaEsocialVinculo = z.infer<typeof esquemaFichaEsocialVinculo>;

export const esquemaRegistrarFichaEsocial = z
  .object({ ficha: esquemaFichaEsocialVinculo, versao: z.number().int().min(0).nullable() })
  .strict();
export type RegistrarFichaEsocialEntrada = z.infer<typeof esquemaRegistrarFichaEsocial>;

export interface FichaEsocialDoVinculo {
  readonly vinculo: number;
  readonly matricula: string | null;
  readonly preenchida: boolean;
  /** A ficha decifrada; null quando não há ficha ou a sessão não tem `pessoas.esocial.gerar` (leitura auditada). */
  readonly ficha: FichaEsocialVinculo | null;
  readonly versao: number | null;
  readonly alteradoPor: string | null;
  readonly alteradoEm: string | null;
}

// ── Pendências de dados que impedem gerar o evento ────────────────────────────────────────────────────────────

/** Um dado que falta para o evento (o evento não é gerado enquanto houver pendência). */
export interface PendenciaEsocial {
  readonly codigo: string;
  readonly mensagem: string;
}

// ── Eventos ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface RetornoEventoEsocial {
  readonly codigo: string;
  readonly descricao: string;
}

export interface EventoEsocialResumo {
  readonly id: number;
  readonly empresa: number;
  readonly evento: EventoEsocial;
  readonly grupo: GrupoEventoEsocial;
  readonly operacao: OperacaoTabelaEsocial | null;
  /** O identificador do evento no eSocial (36 posições). */
  readonly idEsocial: string;
  readonly vinculo: number | null;
  readonly matricula: string | null;
  /** O registro de origem (rubrica, afastamento, rescisão, vigência do salário…) e o tipo dele. */
  readonly origem: string | null;
  readonly referencia: number | null;
  /** A data do fato (admissão, alteração, afastamento, desligamento) ou o início de validade (AAAA-MM). */
  readonly dataReferencia: string;
  readonly situacao: SituacaoEventoEsocial;
  /** Retificação: o evento que este retifica; exclusão: o evento que este exclui. */
  readonly eventoAnterior: number | null;
  readonly lote: number | null;
  readonly recibo: string | null;
  readonly retorno: RetornoEventoEsocial | null;
  readonly leiaute: LeiauteEsocial;
  readonly hashXml: string;
  readonly errosXsd: readonly string[];
  readonly motivo: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly versao: number;
}

export interface DetalheEventoEsocial {
  readonly evento: EventoEsocialResumo;
  /** O XML do evento (só com `pessoas.esocial.gerar`; leitura auditada). */
  readonly xml: string | null;
}

export interface ListaEventosEsocial {
  readonly itens: readonly EventoEsocialResumo[];
  readonly teto: number;
  readonly truncado: boolean;
}

export const esquemaFiltroEventosEsocial = z
  .object({
    empresa: smallint.optional(),
    evento: z.enum(EVENTOS_ESOCIAL).optional(),
    situacao: z.enum(SITUACOES_EVENTO_ESOCIAL).optional(),
    vinculo: id.optional(),
    lote: id.optional(),
    de: data.optional(),
    ate: data.optional(),
  })
  .strict();
export type FiltroEventosEsocial = z.infer<typeof esquemaFiltroEventosEsocial>;

export const esquemaGerarEventosTabela = z
  .object({
    empresa: smallint,
    eventos: z.array(z.enum(EVENTOS_TABELA_ESOCIAL)).min(1).max(4),
    operacao: z.enum(OPERACOES_TABELA_ESOCIAL),
    /** Início da validade (AAAA-MM). */
    inicio: competencia,
    /** S-1010: as rubricas (ID); vazio = todas as ativas da empresa. */
    rubricas: z.array(id).max(2_000).default([]),
    /** false: prévia (nada é gravado). */
    gravar: z.boolean(),
  })
  .strict();
export type GerarEventosTabelaEntrada = z.infer<typeof esquemaGerarEventosTabela>;

export const esquemaGerarEventoTrabalhador = z
  .object({
    evento: z.enum(EVENTOS_TRABALHADOR_ESOCIAL),
    /** O empregador (o vínculo do colaborador não guarda a empresa; a rescisão guarda e é conferida). */
    empresa: smallint,
    vinculo: id,
    /** O registro de origem: afastamento (S-2230), rescisão (S-2299) ou vigência do salário (S-2206). */
    referencia: id.nullable().default(null),
    /** A data da alteração (S-2205 e S-2206 sem vigência de salário). */
    data: data.nullable().default(null),
    /** Retificação de um evento aceito (indRetif = 2, com o recibo dele). */
    retificar: id.nullable().default(null),
    gravar: z.boolean(),
  })
  .strict();
export type GerarEventoTrabalhadorEntrada = z.infer<typeof esquemaGerarEventoTrabalhador>;

export interface EventoGerado {
  readonly evento: EventoEsocial;
  readonly operacao: OperacaoTabelaEsocial | null;
  readonly origem: string | null;
  readonly referencia: number | null;
  readonly dataReferencia: string;
  readonly pendencias: readonly PendenciaEsocial[];
  readonly valido: boolean;
  readonly errosXsd: readonly string[];
  /** O XML (prévia e gravação); null quando há pendência. */
  readonly xml: string | null;
  /** O evento gravado; null na prévia ou com pendência. */
  readonly id: number | null;
}

export interface ResultadoGeracaoEsocial {
  readonly gravado: boolean;
  readonly eventos: readonly EventoGerado[];
}

export const esquemaDescartarEventoEsocial = z.object({ motivo, versao: z.number().int().min(0) }).strict();
export type DescartarEventoEsocialEntrada = z.infer<typeof esquemaDescartarEventoEsocial>;

/** Exclusão (S-3000) de um evento aceito: gera o evento de exclusão, que segue o mesmo caminho de lote e retorno. */
export const esquemaExcluirEventoEsocial = z
  .object({ motivo, versao: z.number().int().min(0), gravar: z.boolean() })
  .strict();
export type ExcluirEventoEsocialEntrada = z.infer<typeof esquemaExcluirEventoEsocial>;

// ── Lotes e retorno ───────────────────────────────────────────────────────────────────────────────────────────

export interface LoteEsocial {
  readonly id: number;
  readonly empresa: number;
  readonly grupo: GrupoEventoEsocial;
  readonly ambiente: AmbienteEsocial;
  readonly situacao: SituacaoLoteEsocial;
  readonly quantidade: number;
  readonly protocolo: string | null;
  readonly enviadoPor: string | null;
  readonly enviadoEm: string | null;
  readonly criadoPor: string;
  readonly criadoEm: string;
  readonly versao: number;
}

export interface ListaLotesEsocial {
  readonly itens: readonly LoteEsocial[];
  readonly teto: number;
  readonly truncado: boolean;
}

export const esquemaFiltroLotesEsocial = z
  .object({ empresa: smallint.optional(), situacao: z.enum(SITUACOES_LOTE_ESOCIAL).optional() })
  .strict();
export type FiltroLotesEsocial = z.infer<typeof esquemaFiltroLotesEsocial>;

export const esquemaMontarLoteEsocial = z
  .object({ empresa: smallint, eventos: z.array(id).min(1).max(TETO_EVENTOS_LOTE_ESOCIAL) })
  .strict();
export type MontarLoteEsocialEntrada = z.infer<typeof esquemaMontarLoteEsocial>;

export const esquemaEnviarLoteEsocial = z.object({ versao: z.number().int().min(0) }).strict();
export type EnviarLoteEsocialEntrada = z.infer<typeof esquemaEnviarLoteEsocial>;

export const esquemaCancelarLoteEsocial = z.object({ motivo, versao: z.number().int().min(0) }).strict();
export type CancelarLoteEsocialEntrada = z.infer<typeof esquemaCancelarLoteEsocial>;

/** O recibo do eSocial (1.N.19 dígitos). */
export const RECIBO_ESOCIAL = /^1\.\d\.\d{19}$/;

/** O retorno do processamento do lote, evento a evento (do coletor ou do eSocial). */
export const esquemaRetornoLoteEsocial = z
  .object({
    versao: z.number().int().min(0),
    protocolo: textoCp1252(40).nullable(),
    eventos: z
      .array(
        z
          .object({
            evento: id,
            aceito: z.boolean(),
            recibo: z.string().regex(RECIBO_ESOCIAL, 'Recibo no formato 1.N.19 dígitos.').nullable(),
            codigo: textoCp1252(10).pipe(z.string().trim().min(1)),
            descricao: textoCp1252(400).pipe(z.string().trim().min(1)),
          })
          .strict()
          .superRefine((e, ctx) => {
            if (e.aceito && !e.recibo)
              ctx.addIssue({ code: 'custom', path: ['recibo'], message: 'Evento aceito exige o recibo.' });
          }),
      )
      .min(1)
      .max(TETO_EVENTOS_LOTE_ESOCIAL),
  })
  .strict();
export type RetornoLoteEsocialEntrada = z.infer<typeof esquemaRetornoLoteEsocial>;

export interface DetalheLoteEsocial {
  readonly lote: LoteEsocial;
  readonly eventos: readonly EventoEsocialResumo[];
}

// ── Pendências do outro sistema (regra 2: só contagem) ────────────────────────────────────────────────────────

export interface PendenciasLegadoEsocial {
  readonly total: number;
  readonly porEvento: readonly {
    readonly evento: string;
    readonly rotulo: string;
    readonly grupo: GrupoEventoEsocial | null;
    readonly quantidade: number;
    readonly porAno: readonly { readonly ano: number; readonly quantidade: number }[];
  }[];
}

// ── Conciliação do transmissor único (regra 1) ────────────────────────────────────────────────────────────────

/** Situação de cada linha da conciliação. */
export const SITUACOES_LINHA_CONCILIACAO = [
  'conciliado',
  'dois-transmissores',
  'repasse-no-periodico',
  'repasse-no-externo',
  'so-contagem',
  'sem-transmissor',
] as const;
export type SituacaoLinhaConciliacao = (typeof SITUACOES_LINHA_CONCILIACAO)[number];

export interface LinhaConciliacaoEsocial {
  readonly evento: string;
  readonly rotulo: string;
  /** Eventos do Sante SGH na competência (enviados ou aceitos). */
  readonly sante: number;
  /** Eventos que o sistema externo informou (null: não informado). */
  readonly externo: number | null;
  /** Recibos de autônomo do repasse na competência (entram nos periódicos do mesmo transmissor). */
  readonly repasse: number;
  /** Pendências acumuladas pelo outro sistema (nunca enviadas). */
  readonly pendenciaLegado: number;
  readonly situacao: SituacaoLinhaConciliacao;
}

export interface ConciliacaoEsocial {
  readonly empresa: number;
  readonly competencia: string;
  readonly transmissor: TransmissorEsocial | null;
  /** Outras empresas com a mesma raiz de CNPJ (o mesmo empregador no eSocial). */
  readonly mesmaRaiz: readonly number[];
  readonly linhas: readonly LinhaConciliacaoEsocial[];
  readonly situacao: 'conciliada' | 'divergente' | 'sem-transmissor';
  readonly conferida: {
    readonly por: string;
    readonly em: string;
    readonly observacao: string | null;
    readonly situacao: 'conciliada' | 'divergente' | 'sem-transmissor';
  } | null;
}

export const esquemaFiltroConciliacaoEsocial = z.object({ empresa: smallint, competencia }).strict();
export type FiltroConciliacaoEsocial = z.infer<typeof esquemaFiltroConciliacaoEsocial>;

export const esquemaConferirConciliacaoEsocial = z
  .object({
    empresa: smallint,
    competencia,
    /** Quantidade que o sistema externo informou, por evento (enquanto ele transmitir). */
    externo: z.record(z.string().regex(/^S-\d{4}$/), z.number().int().min(0).max(1_000_000)).default({}),
    observacao: textoCp1252(400).nullable().default(null),
  })
  .strict();
export type ConferirConciliacaoEsocialEntrada = z.infer<typeof esquemaConferirConciliacaoEsocial>;

// ── Apoio da tela ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ItemDominioEsocial {
  readonly codigo: string;
  readonly rotulo: string;
}

export interface ApoioEsocial {
  /** A data de hoje no relógio do servidor (AAAA-MM-DD): as competências que a tela oferece. */
  readonly hoje: string;
  readonly empresas: readonly {
    readonly codigo: number;
    readonly rotulo: string;
    readonly temCnpj: boolean;
  }[];
  readonly eventos: readonly DefinicaoEventoEsocial[];
  readonly leiautes: readonly LeiauteEsocial[];
  /** A versão vigente de cada evento no catálogo oficial do banco (o importador de catálogos a atualiza). */
  readonly leiauteCatalogo: readonly {
    readonly evento: string;
    /** O nome oficial do evento no catálogo do banco (null quando o catálogo não o traz). */
    readonly nome: string | null;
    readonly versao: string;
    readonly inicio: string;
  }[];
  readonly motivosAfastamento: readonly ItemDominioEsocial[];
  readonly categorias: readonly ItemDominioEsocial[];
  readonly transmissao: {
    readonly chaveLigada: boolean;
    readonly ambiente: AmbienteEsocial;
    /** O lote pode ser enviado agora (ao coletor fora de `producao`). */
    readonly podeEnviar: boolean;
    readonly motivo: string | null;
  };
  readonly acoes: { readonly gerar: boolean; readonly transmitir: boolean };
}

// ── Recusas ───────────────────────────────────────────────────────────────────────────────────────────────────

export const RECUSAS_ESOCIAL = [
  'empregador-sem-parametros',
  'empregador-sem-cnpj',
  'transmissor-externo',
  'dois-transmissores',
  'vinculo-sem-esocial',
  'evento-nao-serve-ao-vinculo',
  'referencia-obrigatoria',
  'referencia-invalida',
  'situacao-invalida',
  'evento-sem-recibo',
  'lote-misto',
  'lote-vazio',
  'evento-fora-do-lote',
  'envio-desligado',
  'transmissor-real-indisponivel',
  'ficha-sem-chave',
] as const;
export type RecusaEsocial = (typeof RECUSAS_ESOCIAL)[number];
