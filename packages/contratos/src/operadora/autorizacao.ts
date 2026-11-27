// Contratos da autorização de guias e da auditoria médica da operadora própria (M56, etapa 5 de 8, fatia F4; ficha,
// seções 1, 3, 6, 7 e 8; cap-07 §7.4): o lado oposto do TISS do hospital. O prestador credenciado pede a autorização
// (consulta, SP/SADT, ambulatório ou internação, com os procedimentos da terminologia TUSS, o CID, a indicação clínica e
// o profissional solicitante); a operadora dá o número de protocolo na hora do pedido, com o prazo de resposta pelo
// caráter do atendimento; as críticas automáticas (elegibilidade, segmentação do plano, carências, cobertura parcial
// temporária, prestador fora da rede ou sem o regime) saem antes da decisão; o auditor designado pela diretoria da
// operadora (médico ou enfermeiro, com o conselho) pede complemento, decide (autoriza no todo ou em parte, com a senha e
// a validade; nega com a crítica, o fundamento e o parecer) ou abre a junta para a divergência técnica com o
// profissional; a guia pode ser cancelada com o motivo. Os dados ficam em SGH_OPE_AUTORIZACAO, _ITEM e _EVT e a
// designação dos auditores em SGH_OPE_AUDITOR (scripts 0958 e 0959); os códigos (tipo de guia, origem do atendimento,
// crítica) são os dos domínios do banco do estabelecimento, conferidos no servidor contra o domínio lido. Nenhuma
// escrita em tabela legada (seção 5).
import { z } from 'zod';
import { UFS } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';

/** Caráter do atendimento (TISS): eletivo ou urgência e emergência. */
export const CARATERES_ATENDIMENTO = { E: 'Eletivo', U: 'Urgência ou emergência' } as const;
export type CaraterAtendimento = keyof typeof CARATERES_ATENDIMENTO;
export const CODIGOS_CARATER_GUIA = ['E', 'U'] as const;

/** Tipo de guia: o código do domínio do banco. */
export const TIPO_GUIA = { ambulatorio: 1, consulta: 2, internacao: 3, sadt: 4 } as const;

/** Tipo de internação (TISS, tabela de domínio 57). */
export const TIPOS_INTERNACAO = {
  1: 'Clínica',
  2: 'Cirúrgica',
  3: 'Obstétrica',
  4: 'Pediátrica',
  5: 'Psiquiátrica',
} as const;
export type TipoInternacao = keyof typeof TIPOS_INTERNACAO;
export const INTERNACAO_OBSTETRICA = 3 as const;

/** Tabela do item pedido (TISS, terminologia 87): só a 22 (procedimentos) é conferida na terminologia TUSS do banco. */
export const TABELAS_ITEM_GUIA = {
  22: 'Procedimentos e eventos em saúde',
  19: 'Materiais e órteses, próteses e materiais especiais',
  20: 'Medicamentos',
  18: 'Diárias, taxas e gases medicinais',
} as const;
export type TabelaItemGuia = keyof typeof TABELAS_ITEM_GUIA;
export const TABELA_PROCEDIMENTOS = 22 as const;

/** Conselho do profissional solicitante (TISS, tabela de domínio 26, os da assistência). */
export const CONSELHOS_PROFISSIONAIS = [
  'CRM',
  'CRO',
  'COREN',
  'CRF',
  'CRFA',
  'CREFITO',
  'CRN',
  'CRP',
] as const;
export type ConselhoProfissional = (typeof CONSELHOS_PROFISSIONAIS)[number];

/** Categoria do auditor designado (com o conselho da categoria). */
export const CATEGORIAS_AUDITOR = {
  medico: { rotulo: 'Médico auditor', conselho: 'CRM' },
  enfermeiro: { rotulo: 'Enfermeiro auditor', conselho: 'COREN' },
} as const;
export type CategoriaAuditor = keyof typeof CATEGORIAS_AUDITOR;
export const CODIGOS_CATEGORIA_AUDITOR = Object.keys(CATEGORIAS_AUDITOR) as CategoriaAuditor[];

/** Situação do pedido de autorização na operadora (a análise; a vida da guia depois dela vai às contas médicas). */
export const SITUACOES_AUTORIZACAO = [
  'em-analise',
  'pendente',
  'em-junta',
  'autorizada',
  'parcial',
  'negada',
  'cancelada',
] as const;
export type SituacaoAutorizacao = (typeof SITUACOES_AUTORIZACAO)[number];
/** As situações em que a operadora ainda deve a resposta (o prazo corre). */
export const SITUACOES_EM_ABERTO: readonly SituacaoAutorizacao[] = ['em-analise', 'pendente', 'em-junta'];

export const SITUACOES_ITEM_GUIA = ['pendente', 'autorizado', 'parcial', 'negado'] as const;
export type SituacaoItemGuia = (typeof SITUACOES_ITEM_GUIA)[number];

/** O que aconteceu com o pedido (SGH_OPE_AUTORIZACAO_EVT, só de inclusão). */
export const EVENTOS_AUTORIZACAO = [
  'registro',
  'complemento-pedido',
  'complemento-resposta',
  'junta-aberta',
  'junta-concluida',
  'decisao',
  'cancelamento',
] as const;
export type EventoAutorizacao = (typeof EVENTOS_AUTORIZACAO)[number];

/** Prazo de resposta: imediato (urgência), padrão ou o das internações eletivas e da alta complexidade. */
export const TIPOS_PRAZO = ['imediato', 'padrao', 'complexo'] as const;
export type TipoPrazo = (typeof TIPOS_PRAZO)[number];

export const DECISOES_AUTORIZACAO = ['autorizar', 'negar'] as const;
export type DecisaoAutorizacao = (typeof DECISOES_AUTORIZACAO)[number];

/** Itens por pedido (a guia TISS de SP/SADT tem até 5 por folha; a operadora aceita o pedido inteiro até este teto). */
export const MAXIMO_ITENS_GUIA = 30;

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const texto = (max: number, min: number, msg: string) =>
  textoCp1252(max)
    .overwrite((t) => t.trim())
    .pipe(z.string().min(min, msg));
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const codigo = z.number().int().min(1).max(32_767);
const id = z.number().int().min(1);

/** O profissional que pede (o solicitante da guia TISS): nome, conselho, número e UF do conselho. */
export const esquemaProfissionalSolicitante = z
  .object({
    nome: livre(120).pipe(z.string().min(3, 'Informe o nome do profissional solicitante.')),
    conselho: z.enum(CONSELHOS_PROFISSIONAIS),
    numero: z
      .string()
      .trim()
      .regex(/^\d{1,15}$/, 'O número do conselho tem só dígitos.'),
    uf: z.enum(UFS),
  })
  .strict();
export type ProfissionalSolicitante = z.infer<typeof esquemaProfissionalSolicitante>;

export const esquemaItemPedidoAutorizacao = z
  .object({
    tabela: z.union([z.literal(22), z.literal(19), z.literal(20), z.literal(18)]),
    /** Código do item na tabela (TUSS de procedimentos: 8 dígitos). */
    codigo: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z.-]{1,12}$/, 'Informe o código do item.')
      .overwrite((c) => c.replace(/[.-]/g, '')),
    /** Descrição (obrigatória fora da tabela 22; na 22 vem da terminologia TUSS do banco). */
    descricao: livre(150).nullable(),
    quantidade: z.number().int().min(1).max(999),
  })
  .strict();
export type ItemPedido = z.infer<typeof esquemaItemPedidoAutorizacao>;

export const esquemaInternacaoPedido = z
  .object({
    tipo: z.number().int().min(1).max(5),
    diarias: z.number().int().min(1).max(365),
    admissaoPrevista: dataIso,
  })
  .strict();
export type InternacaoPedido = z.infer<typeof esquemaInternacaoPedido>;

/** O pedido de autorização registrado pela operadora (a origem diz por onde chegou). */
export const esquemaRegistrarAutorizacao = z
  .object({
    carteirinha: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(z.string().length(16, 'A carteirinha tem 16 dígitos.')),
    /** Prestador credenciado que pede (ID da rede da operadora). */
    prestador: id,
    /** Prestador que executa, quando é outro (ID da rede). */
    executante: id.nullable(),
    tipoGuia: codigo,
    carater: z.enum(CODIGOS_CARATER_GUIA),
    /** Procedimento de alta complexidade (prazo das internações eletivas). */
    altaComplexidade: z.boolean(),
    origem: codigo,
    /** A guia principal (internação autorizada) de um pedido de SP/SADT ou de prorrogação. */
    guiaPrincipal: id.nullable(),
    /** CID-10 (obrigatório na internação). */
    cid: z
      .string()
      .trim()
      .transform((v) => v.replace(/\./g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z]\d{2,3}$/, 'O CID-10 é uma letra e 2 ou 3 dígitos (por exemplo, J18.9).'))
      .nullable(),
    indicacaoClinica: texto(1000, 10, 'Descreva a indicação clínica (10 caracteres ou mais).'),
    profissional: esquemaProfissionalSolicitante,
    internacao: esquemaInternacaoPedido.nullable(),
    itens: z.array(esquemaItemPedidoAutorizacao).min(1, 'Inclua ao menos um item.').max(MAXIMO_ITENS_GUIA),
  })
  .strict();
export type RegistrarAutorizacaoEntrada = z.infer<typeof esquemaRegistrarAutorizacao>;

const comVersao = { versao: z.number().int().min(1) };

export const esquemaPedirComplemento = z
  .object({ ...comVersao, pedido: texto(1000, 10, 'Diga o que falta (10 caracteres ou mais).') })
  .strict();
export type PedirComplementoEntrada = z.infer<typeof esquemaPedirComplemento>;

export const esquemaResponderComplemento = z
  .object({
    ...comVersao,
    resposta: texto(1000, 10, 'Registre o que o prestador enviou (10 caracteres ou mais).'),
  })
  .strict();
export type ResponderComplementoEntrada = z.infer<typeof esquemaResponderComplemento>;

const esquemaQuantidadeDecidida = z
  .object({ item: id, quantidadeAutorizada: z.number().int().min(0).max(999) })
  .strict();

/** A decisão do auditor (ou a da junta, na conclusão dela). */
const camposDecisao = {
  decisao: z.enum(DECISOES_AUTORIZACAO),
  /** Na autorização: a quantidade de cada item (0 nega o item). Na negativa, ignorado (todos negados). */
  itens: z.array(esquemaQuantidadeDecidida).max(MAXIMO_ITENS_GUIA),
  /** Diárias autorizadas (internação). */
  diariasAutorizadas: z.number().int().min(1).max(365).nullable(),
  /** Crítica da autorização (domínio da operadora), obrigatória na negativa e na autorização parcial. */
  critica: codigo.nullable(),
  /** Cláusula contratual ou dispositivo legal que justifica a negativa ou o corte. */
  fundamento: livre(400).nullable(),
  parecer: texto(2000, 10, 'Escreva o parecer (10 caracteres ou mais).'),
};

export const esquemaDecidirAutorizacao = z.object({ ...comVersao, ...camposDecisao }).strict();
export type DecidirAutorizacaoEntrada = z.infer<typeof esquemaDecidirAutorizacao>;

/** Junta para a divergência técnica com o profissional solicitante (o desempatador é médico). */
export const esquemaAbrirJunta = z
  .object({
    ...comVersao,
    divergencia: texto(1000, 10, 'Descreva a divergência (10 caracteres ou mais).'),
    desempatador: z
      .object({
        nome: livre(120).pipe(z.string().min(3, 'Informe o nome do desempatador.')),
        crm: z
          .string()
          .trim()
          .regex(/^\d{1,15}$/, 'O CRM tem só dígitos.'),
        uf: z.enum(UFS),
      })
      .strict(),
    /** Data em que o profissional solicitante e o beneficiário foram avisados da junta. */
    notificadosEm: dataIso,
  })
  .strict();
export type AbrirJuntaEntrada = z.infer<typeof esquemaAbrirJunta>;

export const esquemaConcluirJunta = z
  .object({
    ...comVersao,
    parecerDesempatador: texto(1000, 10, 'Registre o parecer do desempatador (10 caracteres ou mais).'),
    ...camposDecisao,
  })
  .strict();
export type ConcluirJuntaEntrada = z.infer<typeof esquemaConcluirJunta>;

export const esquemaCancelarAutorizacao = z
  .object({ ...comVersao, motivo: texto(200, 10, 'Descreva o motivo (10 caracteres ou mais).') })
  .strict();
export type CancelarAutorizacaoEntrada = z.infer<typeof esquemaCancelarAutorizacao>;

export const esquemaDesignarAuditor = z
  .object({
    operadora: id,
    login: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9._-]{2,31}$/, 'Informe o usuário do auditor.'),
    nome: livre(120).pipe(z.string().min(3, 'Informe o nome do auditor.')),
    categoria: z.enum(['medico', 'enfermeiro']),
    numero: z
      .string()
      .trim()
      .regex(/^\d{1,15}$/, 'O número do conselho tem só dígitos.'),
    uf: z.enum(UFS),
    inicio: dataIso,
  })
  .strict();
export type DesignarAuditorEntrada = z.infer<typeof esquemaDesignarAuditor>;

/**
 * Encerrar (ou trocar) o auditor. W0-10: com pedidos em análise sob a responsabilidade dele, o encerramento exige
 * `redistribuirPara` (outra designação ativa da mesma operadora, que assume os pedidos); sem ela, 409
 * `auditor-com-autorizacoes` com a contagem e os protocolos.
 */
export const esquemaEncerrarAuditor = z
  .object({
    ...comVersao,
    motivo: texto(200, 10, 'Descreva o motivo (10 caracteres ou mais).'),
    redistribuirPara: id.nullable().optional(),
  })
  .strict();
export type EncerrarAuditorEntrada = z.infer<typeof esquemaEncerrarAuditor>;

/** W0-10: alterar os dados da designação ativa (o usuário e a operadora não mudam: trocar o auditor é encerrar e designar). */
/** O nome do auditor é o do cadastro do profissional (muda lá, com a trilha dele); a alteração troca a categoria ou o
 * profissional pela inscrição no conselho, e o motivo vai para a trilha da operação. */
export const esquemaAlterarAuditor = esquemaDesignarAuditor
  .pick({ categoria: true, numero: true, uf: true })
  .extend({ ...comVersao, motivo: texto(200, 10, 'Descreva o motivo (10 caracteres ou mais).') })
  .strict();
export type AlterarAuditorEntrada = z.infer<typeof esquemaAlterarAuditor>;

export const esquemaFiltroAutorizacoes = z.object({
  /** Protocolo (20 dígitos), senha (16), carteirinha (16 dígitos) ou trecho do nome do beneficiário. */
  busca: z.string().trim().min(1).max(60).optional(),
  situacao: z.enum(SITUACOES_AUTORIZACAO).optional(),
  /** Só as em aberto com o prazo de resposta vencido. */
  vencidas: z
    .enum(['sim'])
    .transform(() => true)
    .optional(),
  prestador: z.coerce.number().int().min(1).optional(),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroAutorizacoes = z.infer<typeof esquemaFiltroAutorizacoes>;

export const esquemaBuscaProcedimento = z.object({
  busca: z.string().trim().min(2).max(60),
});

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

const esquemaOpcao = z.object({ codigo: z.number().int(), rotulo: z.string() });

export const esquemaAuditorOperadora = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  login: z.string(),
  nome: z.string(),
  categoria: z.enum(['medico', 'enfermeiro']),
  conselho: z.string(),
  numero: z.string(),
  uf: z.string(),
  inicio: z.string(),
  fim: z.string().nullable(),
  situacao: z.enum(['ativo', 'encerrado']),
  motivoEncerramento: z.string().nullable(),
  versao: z.number().int(),
  /** W0-10: os pedidos em análise sob a responsabilidade dele (o encerramento exige a redistribuição). */
  emAnalise: z.number().int().default(0),
});
export type AuditorOperadora = z.infer<typeof esquemaAuditorOperadora>;

export const esquemaApoioAutorizacoes = z.object({
  dominios: z.object({
    tipoGuia: z.array(esquemaOpcao),
    origem: z.array(esquemaOpcao),
    /** Críticas da autorização (domínio editável da operadora); `extraContrato` marca as fora do contrato. */
    critica: z.array(esquemaOpcao.extend({ extraContrato: z.boolean() })),
    situacaoGuia: z.array(esquemaOpcao),
  }),
  operadoras: z.array(z.object({ id: z.number().int(), nome: z.string(), registroAns: z.string() })),
  /** Prestadores credenciados da rede (solicitante e executante). */
  prestadores: z.array(
    z.object({
      id: z.number().int(),
      nome: z.string(),
      tipo: z.number().int(),
      regime: z.number().int(),
      municipioIbge: z.number().int(),
      uf: z.string(),
    }),
  ),
  /** A designação vigente de quem está na tela (null: não é auditor designado). */
  auditor: esquemaAuditorOperadora.nullable(),
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  podeRegistrar: z.boolean(),
  podeDecidir: z.boolean(),
  podeDesignar: z.boolean(),
  hoje: dataIso,
  /** Os parâmetros que a tela mostra (dias úteis de cada prazo e os dias de validade da senha). */
  parametros: z.object({
    diasUteisPadrao: z.number().int(),
    diasUteisComplexo: z.number().int(),
    diasValidadeSenha: z.number().int(),
  }),
});
export type ApoioAutorizacoes = z.infer<typeof esquemaApoioAutorizacoes>;

export const esquemaProcedimentoTuss = z.object({
  codigo: z.string(),
  nome: z.string(),
  vigente: z.boolean(),
});
export type ProcedimentoTuss = z.infer<typeof esquemaProcedimentoTuss>;
export const esquemaProcedimentosTuss = z.object({ itens: z.array(esquemaProcedimentoTuss) });

export const esquemaAutorizacaoResumo = z.object({
  id: z.number().int(),
  protocolo: z.string(),
  beneficiarioNome: z.string(),
  carteirinha: z.string(),
  prestador: z.number().int(),
  prestadorNome: z.string(),
  tipoGuia: z.number().int(),
  carater: z.enum(CODIGOS_CARATER_GUIA),
  situacao: z.enum(SITUACOES_AUTORIZACAO),
  solicitadaEm: z.string(),
  prazoEm: z.string(),
  /** Em aberto com o prazo vencido (pelo relógio do banco). */
  vencida: z.boolean(),
  senha: z.string().nullable(),
  versao: z.number().int(),
});
export type AutorizacaoResumo = z.infer<typeof esquemaAutorizacaoResumo>;

export const esquemaAutorizacoes = z.object({
  itens: z.array(esquemaAutorizacaoResumo),
  proxima: z.number().int().nullable(),
  totais: z.object({
    emAnalise: z.number().int(),
    pendentes: z.number().int(),
    emJunta: z.number().int(),
    vencidas: z.number().int(),
    decididasHoje: z.number().int(),
  }),
});
export type Autorizacoes = z.infer<typeof esquemaAutorizacoes>;

export const esquemaItemAutorizacao = z.object({
  id: z.number().int(),
  ordem: z.number().int(),
  tabela: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  quantidadeSolicitada: z.number().int(),
  quantidadeAutorizada: z.number().int().nullable(),
  situacao: z.enum(SITUACOES_ITEM_GUIA),
});
export type ItemAutorizacao = z.infer<typeof esquemaItemAutorizacao>;

export const esquemaEventoAutorizacao = z.object({
  id: z.number().int(),
  evento: z.enum(EVENTOS_AUTORIZACAO),
  situacao: z.enum(SITUACOES_AUTORIZACAO),
  texto: z.string().nullable(),
  em: z.string(),
  por: z.string(),
});
export type EventoAutorizacaoLido = z.infer<typeof esquemaEventoAutorizacao>;

/** Uma crítica automática: bloqueia a autorização ou só avisa o auditor; a crítica do domínio que corresponde. */
export const esquemaCriticaAutomatica = z.object({
  codigo: z.string(),
  bloqueia: z.boolean(),
  critica: z.number().int().nullable(),
  texto: z.string(),
});
export type CriticaAutomatica = z.infer<typeof esquemaCriticaAutomatica>;

export const esquemaAutorizacaoDetalhe = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  protocolo: z.string(),
  beneficiario: z.object({
    id: z.number().int(),
    nome: z.string(),
    carteirinha: z.string(),
    nascimento: z.string(),
    sexo: z.string(),
    plano: z.string(),
    segmentacao: z.string().nullable(),
  }),
  prestador: z.object({ id: z.number().int(), nome: z.string() }),
  executante: z.object({ id: z.number().int(), nome: z.string() }).nullable(),
  guiaPrincipal: z.object({ id: z.number().int(), protocolo: z.string() }).nullable(),
  tipoGuia: z.number().int(),
  carater: z.enum(CODIGOS_CARATER_GUIA),
  altaComplexidade: z.boolean(),
  origem: z.number().int(),
  cid: z.string().nullable(),
  cidNome: z.string().nullable(),
  indicacaoClinica: z.string(),
  profissional: esquemaProfissionalSolicitante,
  internacao: z
    .object({
      tipo: z.number().int(),
      diarias: z.number().int(),
      diariasAutorizadas: z.number().int().nullable(),
      admissaoPrevista: z.string(),
    })
    .nullable(),
  situacao: z.enum(SITUACOES_AUTORIZACAO),
  /** A situação da guia que vale para as contas médicas: autorizada ou cancelada; null em análise. */
  situacaoGuia: z.number().int().nullable(),
  solicitadaEm: z.string(),
  prazoTipo: z.enum(TIPOS_PRAZO),
  prazoEm: z.string(),
  vencida: z.boolean(),
  complementoPedido: z.string().nullable(),
  complementoResposta: z.string().nullable(),
  junta: z
    .object({
      divergencia: z.string(),
      desempatador: z.string(),
      crm: z.string(),
      uf: z.string(),
      notificadosEm: z.string(),
      parecer: z.string().nullable(),
    })
    .nullable(),
  decisao: z
    .object({
      em: z.string(),
      por: z.string(),
      auditor: z.string(),
      critica: z.number().int().nullable(),
      fundamento: z.string().nullable(),
      parecer: z.string(),
    })
    .nullable(),
  senha: z.string().nullable(),
  senhaValidade: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  itens: z.array(esquemaItemAutorizacao),
  eventos: z.array(esquemaEventoAutorizacao),
  /** As críticas automáticas na data de hoje (elegibilidade, segmentação, carências, rede). */
  criticas: z.array(esquemaCriticaAutomatica),
  /** O comunicado da negativa ao beneficiário (motivo, cláusula ou dispositivo e o parecer), para entregar. */
  comunicado: z.string().nullable(),
  versao: z.number().int(),
  /** W0-10: os anexos das respostas do prestador ao complemento (sem o conteúdo; o download pela rota `anexo`). */
  anexos: z
    .array(
      z.object({
        id: z.number().int(),
        evento: z.number().int(),
        nome: z.string(),
        tipo: z.string(),
        tamanho: z.number().int(),
        sha256: z.string(),
      }),
    )
    .default([]),
  /** C2-122: as críticas gravadas no pedido (critica_pedido_autorizacao), com a liberação manual e a justificativa. */
  criticasGravadas: z
    .array(
      z.object({
        sequencia: z.number().int(),
        codigo: z.string().nullable(),
        descricao: z.string(),
        forma: z.string(),
        em: z.string(),
        liberada: z.boolean(),
        liberadaEm: z.string().nullable(),
        liberadaPor: z.string().nullable(),
        justificativa: z.string().nullable(),
      }),
    )
    .default([]),
  /** C2-122: a negativa formal emitida na decisão (negativa_cobertura, RN 395), com a entrega ao beneficiário. */
  negativa: z
    .object({
      numero: z.string(),
      fundamento: z.string(),
      clausula: z.string().nullable(),
      descricao: z.string(),
      situacao: z.string(),
      emitidaEm: z.string(),
      prazoEntregaEm: z.string().nullable(),
      meioEntrega: z.string().nullable(),
      entregueEm: z.string().nullable(),
    })
    .nullable()
    .default(null),
});
export type AutorizacaoDetalhe = z.infer<typeof esquemaAutorizacaoDetalhe>;

export const esquemaResultadoAutorizacao = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  situacao: z.enum(SITUACOES_AUTORIZACAO),
  protocolo: z.string(),
  senha: z.string().nullable(),
  mensagem: z.string(),
  avisos: z.array(z.string()),
});
export type ResultadoAutorizacao = z.infer<typeof esquemaResultadoAutorizacao>;

export const esquemaAuditores = z.object({ itens: z.array(esquemaAuditorOperadora) });
export type AuditoresOperadora = z.infer<typeof esquemaAuditores>;
export const esquemaResultadoAuditor = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  mensagem: z.string(),
});
export type ResultadoAuditor = z.infer<typeof esquemaResultadoAuditor>;

/** Rotas e permissões da fatia F4 (a chave `operadora.autorizacao`, que só vale com a do módulo, em todas menos o apoio). */
export const ROTAS_OPERADORA_F4 = {
  apoio: { caminho: 'operadora/autorizacoes/apoio', permissao: 'operadora.autorizacao.ler' },
  procedimentos: { caminho: 'operadora/autorizacoes/procedimentos', permissao: 'operadora.autorizacao.ler' },
  lista: { caminho: 'operadora/autorizacoes', permissao: 'operadora.autorizacao.ler' },
  ficha: { caminho: 'operadora/autorizacoes/:id', permissao: 'operadora.autorizacao.ler' },
  /** W0-10: o anexo de uma resposta do prestador ao complemento (download na ficha). */
  anexo: { caminho: 'operadora/autorizacoes/:id/anexos/:anexo', permissao: 'operadora.autorizacao.ler' },
  registrar: { caminho: 'operadora/autorizacoes', permissao: 'operadora.autorizacao.registrar' },
  pedirComplemento: {
    caminho: 'operadora/autorizacoes/:id/complemento',
    permissao: 'operadora.autorizacao.decidir',
  },
  responderComplemento: {
    caminho: 'operadora/autorizacoes/:id/complemento/resposta',
    permissao: 'operadora.autorizacao.registrar',
  },
  decidir: { caminho: 'operadora/autorizacoes/:id/decisao', permissao: 'operadora.autorizacao.decidir' },
  abrirJunta: { caminho: 'operadora/autorizacoes/:id/junta', permissao: 'operadora.autorizacao.decidir' },
  concluirJunta: {
    caminho: 'operadora/autorizacoes/:id/junta/conclusao',
    permissao: 'operadora.autorizacao.decidir',
  },
  cancelar: { caminho: 'operadora/autorizacoes/:id/cancelar', permissao: 'operadora.autorizacao.registrar' },
  auditores: { caminho: 'operadora/auditores', permissao: 'operadora.auditor.designar' },
  designar: { caminho: 'operadora/auditores', permissao: 'operadora.auditor.designar' },
  encerrar: { caminho: 'operadora/auditores/:id/encerrar', permissao: 'operadora.auditor.designar' },
  alterar: { caminho: 'operadora/auditores/:id/alteracao', permissao: 'operadora.auditor.designar' },
} as const;

/** Chave de liberação da fatia (CHAVES_FATIA_OPERADORA, recurso `autorizacao`). */
export const CHAVE_OPERADORA_AUTORIZACAO = 'operadora.autorizacao' as const;

/** Textos das recusas, das críticas e dos avisos da autorização: o mesmo texto na API e na tela. */
export const MENSAGENS_AUTORIZACAO: Readonly<Record<string, string>> = {
  'dominio-invalido': 'Escolha uma opção da lista.',
  'carteirinha-invalida': 'A carteirinha não confere (16 dígitos com o verificador).',
  'beneficiario-inexistente': 'Nenhum beneficiário da operadora com esta carteirinha.',
  'prestador-inexistente': 'O prestador não está na rede da operadora.',
  'executante-inexistente': 'O prestador executante não está na rede da operadora.',
  'internacao-obrigatoria': 'Na guia de internação, informe o tipo, as diárias e a admissão prevista.',
  'internacao-so-na-guia-de-internacao': 'Tipo de internação e diárias só na guia de internação.',
  'cid-obrigatorio': 'Na internação, informe o CID-10.',
  'cid-inexistente': 'O CID-10 informado não está na tabela de CID do estabelecimento.',
  'consulta-um-item': 'A guia de consulta tem um procedimento, com quantidade 1.',
  'procedimento-inexistente':
    'Há código de procedimento que não está na terminologia TUSS do estabelecimento.',
  'procedimento-fora-de-vigencia': 'Há código de procedimento fora da vigência na terminologia TUSS.',
  'codigo-tuss-invalido': 'O código de procedimento da terminologia TUSS tem 8 dígitos.',
  'descricao-obrigatoria': 'Descreva o item de material, medicamento, diária ou taxa.',
  'item-repetido': 'O mesmo item foi pedido duas vezes: some as quantidades numa linha.',
  'guia-principal-inexistente': 'A guia principal não é uma internação autorizada deste beneficiário.',
  'guia-principal-so-sadt-ou-internacao':
    'A guia principal vale para o pedido de SP/SADT ou de prorrogação de internação.',
  'admissao-no-passado': 'A admissão prevista da internação eletiva é de hoje em diante.',
  'autorizacao-desatualizada':
    'O pedido mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  'autorizacao-em-edicao':
    'Outra pessoa está gravando este pedido agora. Abra de novo e confira antes de gravar.',
  'situacao-nao-permite': 'Esta ação não vale na situação atual do pedido.',
  'auditor-nao-designado':
    'Você não está designado como auditor desta operadora. A diretoria da operadora designa os auditores.',
  'negativa-so-medico':
    'Negar ou cortar o pedido é do médico auditor. O enfermeiro auditor autoriza por inteiro ou leva o pedido ao médico.',
  'junta-so-medico': 'A junta para a divergência técnica é aberta pelo médico auditor.',
  'critica-bloqueante':
    'O pedido tem crítica que impede a autorização (veja as críticas). Negue com o motivo ou peça complemento.',
  'critica-obrigatoria': 'Escolha a crítica que justifica a negativa ou o corte.',
  'alcada-fora-da-vigencia':
    'A sua alçada de autorizador não está vigente. A diretoria da operadora renova a alçada.',
  'alcada-nao-autoriza':
    'A sua alçada não autoriza guia nem procedimento. Leve o pedido a quem tem a alçada.',
  'alcada-nao-nega': 'A sua alçada não nega item. Leve a negativa ou o corte a quem tem a alçada.',
  'alcada-nao-prorroga':
    'A sua alçada não autoriza prorrogação de internação. Leve o pedido a quem tem a alçada.',
  'alcada-valor-acima': 'O valor autorizado passa do limite da sua alçada. Leve o pedido à alçada superior.',
  'fundamento-obrigatorio':
    'Informe a cláusula do contrato ou o dispositivo legal que justifica a negativa ou o corte.',
  'quantidade-acima-do-pedido': 'A quantidade autorizada não pode passar da pedida.',
  'itens-da-decisao': 'Informe a quantidade autorizada de cada item do pedido.',
  'nada-autorizado': 'Nenhum item ficou autorizado: use "Negar".',
  'diarias-obrigatorias': 'Informe as diárias autorizadas da internação.',
  'diarias-acima-do-pedido': 'As diárias autorizadas não podem passar das pedidas.',
  'notificacao-no-futuro':
    'O aviso da junta ao profissional e ao beneficiário já tem de ter sido dado (hoje ou antes).',
  'desempatador-e-o-solicitante': 'O desempatador não pode ser o profissional que pediu.',
  'auditor-ja-designado': 'Este usuário já está designado como auditor desta operadora.',
  'auditor-inexistente': 'A designação não existe nesta operadora.',
  'auditor-ja-encerrado': 'A designação já está encerrada.',
  'auditor-desatualizado':
    'A designação mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
  'auditor-com-autorizacoes':
    'Este auditor responde por pedidos em análise. Escolha o auditor que assume esses pedidos antes de encerrar.',
  'redistribuicao-invalida':
    'Escolha outro auditor ativo da mesma operadora para assumir os pedidos em análise.',
  'numero-em-uso': 'O número gerado já existe: tente de novo.',
  'operadora-inexistente': 'A operadora não está cadastrada neste estabelecimento.',
  'inicio-no-futuro-distante': 'O início da designação é de hoje ou de até 30 dias à frente.',
  // Críticas automáticas.
  'beneficiario-inelegivel': 'O beneficiário não está elegível na data.',
  'produto-nao-e-plano':
    'O produto do beneficiário é cartão de desconto: não é plano de saúde e não tem autorização.',
  'fora-da-segmentacao':
    'O plano do beneficiário não cobre este tipo de atendimento (segmentação assistencial).',
  'obstetricia-a-conferir':
    'O plano é ambulatorial e hospitalar: confira no contrato se ele inclui a obstetrícia.',
  'em-carencia': 'O beneficiário está em carência para este atendimento.',
  'urgencia-em-carencia':
    'Urgência durante a carência do plano: a cobertura fica limitada às primeiras 12 horas, em regime ambulatorial.',
  'cpt-vigente':
    'O beneficiário está na cobertura parcial temporária: confira se o CID é de doença ou lesão preexistente declarada.',
  'prestador-fora-da-rede': 'O prestador não está credenciado na rede da operadora.',
  'prestador-suspenso': 'O prestador está suspenso na rede da operadora.',
  'prestador-sem-regime':
    'O contrato do prestador não tem o regime deste atendimento (ambulatorial ou hospitalar).',
  'prazo-vencido': 'O prazo de resposta ao prestador está vencido.',
};
