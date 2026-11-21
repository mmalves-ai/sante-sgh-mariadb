// Entradas das operações do SADT (M26; ficha, seções 5 e 7), validadas na tela, na API e no executor (o mesmo Zod).
// Vocabulário: o exame é o id do exame lançado, com a chave natural de 7 campos lida pela tela
// (data, registro, conta, atendimento, ato, exame e sequência) e o carimbo da última
// alteração (controle otimista); o atendimento é o ID do cabeçalho; o profissional é o vínculo × CBO (o conselho vem
// dele); o exame do catálogo é o ID do cadastro de exames. Data e hora gravadas vêm do relógio do banco.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_ESTADO_AMOSTRA, CODIGOS_MOTIVO_REJEICAO, CODIGOS_SETOR_SADT } from './vocabulario.js';

const id = z.number().int().positive().max(2_147_483_647);
/** Id longo (exame lançado, resultado): inteiro seguro. */
const idDouble = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const smallint = z.number().int().min(0).max(32_767);
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const maiusculas = (max: number) =>
  textoCp1252(max)
    .overwrite((t) => t.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR'))
    .pipe(textoCp1252(max));
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
/** Carimbo lido pela tela (DATA_HORA_ULTIMA_ATUALIZACAO, ISO até os segundos). */
const versao = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'Versão lida inválida.');
/** O motivo e a justificativa (vão à trilha e à versão do resultado). */
export const esquemaMotivoSadt = textoCp1252(200)
  .overwrite((t) => t.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(5, 'Escreva o motivo (ao menos 5 caracteres).'));

/** A chave natural de 7 colunas do exame, como a tela leu (índice único do legado). */
export const esquemaChaveExame = z
  .object({
    data: dataIso,
    reg: id,
    conta: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    atend: z.enum(['I', 'E']),
    ato: smallint,
    exame: z.string().min(1).max(4),
    sequencia: smallint,
  })
  .strict();
export type ChaveExame = z.infer<typeof esquemaChaveExame>;

/** O exame lançado como a tela leu: ID, chave de 7 colunas e o carimbo (controle otimista). */
export const esquemaExameLido = z
  .object({ id: idDouble, chave: esquemaChaveExame, versao: versao.nullable() })
  .strict();
export type ExameLido = z.infer<typeof esquemaExameLido>;

// ── sadt.abrirRequisicao ──────────────────────────────────────────────────────────────────────────────

export const esquemaAbrirRequisicao = z
  .object({
    /** O cabeçalho do atendimento (aberto no novo ou no outro sistema). */
    atendimento: id,
    /** Profissional que pede (vínculo × CBO) quando é do hospital; senão o médico externo do cadastro. */
    solicitante: id.optional(),
    medicoExterno: id.optional(),
    /** Médico emissor da requisição (o executante do setor). */
    emissor: id,
    guia: livre(20).optional(),
    senhaConvenio: livre(20).optional(),
    dataAutorizacao: dataIso.optional(),
    dataRequisicao: dataIso.optional(),
  })
  .strict()
  .refine((e) => e.solicitante !== undefined || e.medicoExterno !== undefined, {
    path: ['solicitante'],
    message: 'Informe o médico solicitante.',
  });
export type AbrirRequisicaoEntrada = z.infer<typeof esquemaAbrirRequisicao>;

// ── sadt.receberSolicitacao ───────────────────────────────────────────────────────────────────────────

export const esquemaReceberSolicitacao = z
  .object({
    exames: z.array(esquemaExameLido).min(1).max(40),
    /** Executante do setor (vínculo × CBO; o conselho vem dele). */
    executante: id,
    /** Prestador do setor (cadastro de prestadores de serviço do ato). */
    prestador: id,
    /** Local de execução do setor (o padrão do parâmetro do setor). */
    local: smallint,
  })
  .strict();
export type ReceberSolicitacaoEntrada = z.infer<typeof esquemaReceberSolicitacao>;

// ── sadt.lancarExame ──────────────────────────────────────────────────────────────────────────────────

export const esquemaLancarExame = z
  .object({
    atendimento: id,
    /** O ato dos exames (um ato por lançamento) e o tipo do atendimento (conferidos na transação: a trilha). */
    ato: smallint,
    atend: z.enum(['I', 'E']),
    itens: z
      .array(
        z
          .object({
            /** ID do exame no cadastro de exames. */
            exame: id,
            urgente: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    executante: id,
    prestador: id,
    local: smallint,
    /** Profissional que pediu (vínculo × CBO); sem ele, o solicitante da conta do setor. */
    solicitante: id.optional(),
    /** Data e hora do exame (lançamento retroativo do dia); sem elas, o relógio do banco. */
    dataHora: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    /** Retratos do paciente e do atendimento lidos pela tela (o gatilho confere). */
    retratos: z.object({ htAtendimento: id, htPaciente: id }).strict(),
    /** Confirmação da tela para o alerta de sexo, idade ou repetição (regra 6). */
    confirmarAlertas: z.boolean().default(false),
    /** O intervalo mínimo de repetição em horas (o parâmetro `sadt.repeticaoMinimaHoras` resolvido pela API). */
    repeticaoMinimaHoras: z.number().int().min(0).max(720).default(24),
  })
  .strict();
export type LancarExameEntrada = z.infer<typeof esquemaLancarExame>;

// ── sadt.registrarResultado ───────────────────────────────────────────────────────────────────────────

export const esquemaValorElemento = z
  .object({
    /** Código do elemento do exame (cadastro de elementos). */
    elemento: smallint,
    /** Valor numérico (com as casas do elemento) ou texto da resposta. */
    numerico: z.number().finite().min(-99_999_999_999).max(99_999_999_999).nullable().default(null),
    alfa: livre(2000).nullable().default(null),
    /** Valor absoluto (contagens do hemograma), quando o elemento tem. */
    absoluta: z.number().finite().min(0).max(99_999_999_999).nullable().default(null),
  })
  .strict()
  .refine((v) => v.numerico !== null || (v.alfa !== null && v.alfa !== ''), {
    message: 'Informe o valor do elemento.',
  });
export type ValorElemento = z.infer<typeof esquemaValorElemento>;

export const esquemaRegistrarResultado = z
  .object({
    exame: esquemaExameLido,
    /** Elementos digitados (laboratório) ou nenhum (laudo de imagem e métodos gráficos). */
    elementos: z.array(esquemaValorElemento).max(120).default([]),
    /** Observações livres do resultado (0 a n). */
    observacoes: z
      .array(livre(4000).pipe(z.string().min(1)))
      .max(5)
      .default([]),
    /** Variáveis de fórmula (código da variável → valor). */
    variaveis: z
      .array(z.object({ codigo: id, valor: z.number().finite() }).strict())
      .max(40)
      .default([]),
    /** Laudo de imagem, endoscopia ou métodos gráficos (texto e o HTML do editor). */
    laudo: z
      .object({ texto: livre(30_000).pipe(z.string().min(5)), html: z.string().max(200_000) })
      .strict()
      .optional(),
    /** Médico laudador (vínculo × CBO; privativo de médico nos laudos). */
    emissor: id.optional(),
  })
  .strict()
  .refine((e) => e.elementos.length > 0 || e.laudo !== undefined, {
    path: ['elementos'],
    message: 'Informe os elementos do resultado ou o laudo.',
  });
export type RegistrarResultadoEntrada = z.infer<typeof esquemaRegistrarResultado>;

// ── sadt.liberarExame ─────────────────────────────────────────────────────────────────────────────────

export const esquemaLiberarExame = z
  .object({
    exames: z.array(esquemaExameLido).min(1).max(40),
    /** Responsável técnico habilitado (vínculo × CBO da sessão; o servidor confere). */
    responsavel: id,
    /** A tela mostrou o valor crítico e quem libera confirmou o aviso. */
    confirmarCritico: z.boolean().default(false),
  })
  .strict();
export type LiberarExameEntrada = z.infer<typeof esquemaLiberarExame>;

// ── sadt.retificarResultado ───────────────────────────────────────────────────────────────────────────

export const esquemaRetificarResultado = z
  .object({
    exame: esquemaExameLido,
    motivo: esquemaMotivoSadt,
    elementos: z.array(esquemaValorElemento).max(120).default([]),
    laudo: z
      .object({ texto: livre(30_000).pipe(z.string().min(5)), html: z.string().max(200_000) })
      .strict()
      .optional(),
    responsavel: id,
  })
  .strict()
  .refine((e) => e.elementos.length > 0 || e.laudo !== undefined, {
    path: ['elementos'],
    message: 'Informe o valor corrigido.',
  });
export type RetificarResultadoEntrada = z.infer<typeof esquemaRetificarResultado>;

// ── sadt.emitirLaudo ──────────────────────────────────────────────────────────────────────────────────

export const esquemaEmitirLaudo = z
  .object({
    /** Exames do mesmo atendimento numa impressão (liberados). */
    exames: z.array(idDouble).min(1).max(60),
    /** O código de autenticação (UUID no formato do legado: 36 caracteres, minúsculas), gerado pelo servidor. */
    codigo: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      .optional(),
    /** O resumo SHA-256 do PDF/A emitido (o servidor gera o PDF antes de gravar). */
    hashPdf: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /** Reemissão: gera "2ª via" auditada (regra 11). */
    segundaVia: z.boolean().default(false),
    motivoSegundaVia: esquemaMotivoSadt.optional(),
  })
  .strict()
  .refine((e) => !e.segundaVia || e.motivoSegundaVia !== undefined, {
    path: ['motivoSegundaVia'],
    message: 'Informe o motivo da 2ª via.',
  });
export type EmitirLaudoEntrada = z.infer<typeof esquemaEmitirLaudo>;

// ── sadt.criarOrcamento ───────────────────────────────────────────────────────────────────────────────

export const esquemaCriarOrcamento = z
  .object({
    /** Paciente do cadastro, quando tem; senão o nome como a recepção escreve. */
    paciente: id.optional(),
    nome: maiusculas(70).pipe(z.string().min(3, 'Informe o nome.')),
    convenio: smallint.refine((c) => c > 0, 'Informe o convênio.'),
    /** Setor do orçamento (o legado guarda um orçamento por ato). */
    ato: smallint,
    itens: z
      .array(
        z
          .object({
            exame: z.string().min(1).max(4),
            /** Valor do exame (tabela do convênio; o mesmo tipo numérico do legado: 2 casas). */
            valor: z.number().finite().min(0).max(9_999_999),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    validadeDias: z.number().int().min(1).max(180).default(30),
  })
  .strict();
export type CriarOrcamentoEntrada = z.infer<typeof esquemaCriarOrcamento>;

/** Conversão do orçamento: o atendimento (aberto) que recebe os mesmos exames e valores (regra 13). */
export const esquemaConverterOrcamento = z
  .object({
    orcamento: id,
    atendimento: id,
    executante: id,
    prestador: id,
    local: smallint,
  })
  .strict();
export type ConverterOrcamentoEntrada = z.infer<typeof esquemaConverterOrcamento>;

// ── sadt.registrarVisualizacaoPortal ──────────────────────────────────────────────────────────────────

export const esquemaRegistrarVisualizacaoPortal = z
  .object({
    /** A liberação para visualização (ID). */
    liberacao: id,
    /** IP de quem viu (vai como o portal do outro sistema grava). */
    ip: z.string().min(2).max(50),
    /** Visualização (14, a mais vista) ou download (15) no portal. */
    acao: z.enum(['visualizacao', 'download']).default('visualizacao'),
  })
  .strict();
export type RegistrarVisualizacaoPortalEntrada = z.infer<typeof esquemaRegistrarVisualizacaoPortal>;

// ── Gravações só do novo (SGH_) ───────────────────────────────────────────────────────────────────────

/** Coleta: a amostra com código único, a pulseira lida (internado) e os dois identificadores conferidos. */
export const esquemaColetarAmostra = z
  .object({
    exames: z.array(idDouble).min(1).max(40),
    /** Código da pulseira lido pelo leitor (obrigatório no internado: meta 1 de segurança). */
    pulseira: z.string().trim().max(64).optional(),
    /** A coleta conferiu o nome completo e a data de nascimento com o paciente (dois identificadores). */
    identificadoresConferidos: z.literal(true),
    /** Recipiente (tubo) da amostra, do cadastro de recipientes. */
    recipiente: smallint.optional(),
    estacao: z.string().trim().max(64).optional(),
  })
  .strict();
export type ColetarAmostraEntrada = z.infer<typeof esquemaColetarAmostra>;

export const esquemaMudarEstadoAmostra = z
  .object({
    estado: z.enum(CODIGOS_ESTADO_AMOSTRA),
    motivo: z.enum(CODIGOS_MOTIVO_REJEICAO).optional(),
    detalhe: livre(200).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if ((e.estado === 'rejeitada' || e.estado === 'recoleta') && !e.motivo)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Informe o motivo.' });
    if (e.motivo === 'outro' && !e.detalhe)
      ctx.addIssue({ code: 'custom', path: ['detalhe'], message: 'Descreva o motivo.' });
  });
export type MudarEstadoAmostraEntrada = z.infer<typeof esquemaMudarEstadoAmostra>;

/** Faixa crítica de um elemento (lista do laboratório aprovada pela diretoria clínica; regra 7). */
export const esquemaValorCritico = z
  .object({
    ato: smallint,
    exame: z.string().min(1).max(4),
    elemento: smallint,
    abaixoDe: z.number().finite().nullable(),
    acimaDe: z.number().finite().nullable(),
    /** Prazo de comunicação ao responsável (minutos), antes de subir ao plantonista. */
    prazoMinutos: z.number().int().min(1).max(240),
    /** Quem aprovou na diretoria clínica (papel e o ato da aprovação; nunca nome). */
    aprovacao: livre(120).pipe(z.string().min(5)),
    ativo: z.boolean().default(true),
  })
  .strict()
  .refine((e) => e.abaixoDe !== null || e.acimaDe !== null, {
    path: ['abaixoDe'],
    message: 'Informe ao menos um dos limites.',
  })
  .refine((e) => e.abaixoDe === null || e.acimaDe === null || e.abaixoDe < e.acimaDe, {
    path: ['acimaDe'],
    message: 'O limite de cima tem de ser maior que o de baixo.',
  });
export type ValorCriticoEntrada = z.infer<typeof esquemaValorCritico>;

/** Comunicação do aviso de valor crítico (registra quem comunicou e a quem; a ciência fica no prontuário). */
export const esquemaComunicarAviso = z
  .object({
    canal: z.enum(['painel', 'telefone', 'presencial']),
    destinatario: livre(120).pipe(z.string().min(3)),
    observacao: livre(400).optional(),
  })
  .strict();
export type ComunicarAvisoEntrada = z.infer<typeof esquemaComunicarAviso>;

// ── Portal de resultados (domínio de identidade separado; regra 9) ───────────────────────────────────

/** Paciente: o código do protocolo (impresso na ficha) e a data de nascimento. */
export const esquemaEntrarPortalPaciente = z
  .object({
    protocolo: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{6,16}$/i, 'Código do protocolo inválido.')
      .transform((t) => t.toUpperCase()),
    nascimento: dataIso,
  })
  .strict();
export type EntrarPortalPacienteEntrada = z.infer<typeof esquemaEntrarPortalPaciente>;

/** Médico externo: conselho, UF e número, a senha da conta própria e o código do segundo fator. */
export const esquemaEntrarPortalMedico = z
  .object({
    conselho: z.enum(['CRM']),
    uf: z.string().regex(/^[A-Z]{2}$/),
    numero: z.string().regex(/^\d{1,10}$/),
    senha: z.string().min(10).max(128),
    codigo: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos do aplicativo autenticador.'),
  })
  .strict();
export type EntrarPortalMedicoEntrada = z.infer<typeof esquemaEntrarPortalMedico>;

/** Autocadastro do médico solicitante pelo portal (fica pendente até a aprovação interna). */
export const esquemaAutocadastroMedico = z
  .object({
    nome: maiusculas(70).pipe(z.string().min(5)),
    conselho: z.enum(['CRM']),
    uf: z.string().regex(/^[A-Z]{2}$/),
    numero: z.string().regex(/^\d{1,10}$/),
    email: z.string().trim().toLowerCase().email().max(100),
    senha: z.string().min(10).max(128),
    aceiteTermo: z.literal(true),
  })
  .strict();
export type AutocadastroMedicoEntrada = z.infer<typeof esquemaAutocadastroMedico>;

export const esquemaDecidirAutocadastro = z
  .object({
    decisao: z.enum(['aprovar', 'recusar']),
    /** O médico solicitante do cadastro que a aprovação liga (o conselho validado). */
    solicitante: id.optional(),
    motivo: esquemaMotivoSadt.optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.decisao === 'aprovar' && !e.solicitante)
      ctx.addIssue({ code: 'custom', path: ['solicitante'], message: 'Escolha o médico do cadastro.' });
    if (e.decisao === 'recusar' && !e.motivo)
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Informe o motivo.' });
  });
export type DecidirAutocadastroEntrada = z.infer<typeof esquemaDecidirAutocadastro>;

/** Cadastro do médico solicitante externo (a aprovação sem cadastro: `cadastro.cadastrarSolicitante`). */
export const esquemaCadastrarSolicitante = z
  .object({
    nome: maiusculas(70).pipe(z.string().min(5)),
    /** Conselho (cadastro de conselhos; CRM = 1), UF e número. */
    conselho: smallint,
    uf: z.string().regex(/^[A-Z]{2}$/),
    numero: z.number().int().positive().max(2_147_483_647),
    cbo: id.optional(),
  })
  .strict();
export type CadastrarSolicitanteEntrada = z.infer<typeof esquemaCadastrarSolicitante>;

// ── Filtros das telas ─────────────────────────────────────────────────────────────────────────────────

export const esquemaFiltroExamesSadt = z
  .object({
    setor: z.enum(CODIGOS_SETOR_SADT).optional(),
    data: dataIso.optional(),
    unidade: smallint.optional(),
    situacao: z
      .enum(['aReceber', 'recebidos', 'aDigitar', 'aLiberar', 'liberados', 'aEmitir', 'todos'])
      .default('todos'),
    urgentes: z.boolean().default(false),
    termo: livre(60).optional(),
  })
  .strict();
export type FiltroExamesSadt = z.infer<typeof esquemaFiltroExamesSadt>;

export const esquemaFiltroPeriodoSadt = z
  .object({ inicio: dataIso, fim: dataIso, setor: z.enum(CODIGOS_SETOR_SADT).optional() })
  .strict()
  .refine((f) => f.inicio <= f.fim, { path: ['fim'], message: 'O fim é antes do início.' })
  .refine((f) => (Date.parse(f.fim) - Date.parse(f.inicio)) / 86_400_000 <= 366, {
    path: ['fim'],
    message: 'Período de até 366 dias.',
  });
export type FiltroPeriodoSadt = z.infer<typeof esquemaFiltroPeriodoSadt>;
