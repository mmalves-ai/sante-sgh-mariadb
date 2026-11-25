// Contratos da rede credenciada da operadora própria (M56, etapa 4 de 8, fatia F3; ficha, seções 3, 6, 7 e 8):
// credenciamento do prestador (pessoa física ou jurídica, CNES, município, tipo, natureza, classificação, contratação
// direta ou indireta, disponibilidade, urgência, regime, modelo de remuneração), o contrato escrito com a forma e o mês
// do reajuste (Lei 13.003/2014), o próprio hospital da Rede como prestador (ligado ao convênio que representa a
// operadora no faturamento do hospital), o descredenciamento com substituto, aviso aos beneficiários e prazo, a
// reinclusão e os movimentos da rede que vão ao RPS da ANS (inclusão, alteração, exclusão, reinclusão).
// Os dados ficam em SGH_OPE_PRESTADOR e SGH_OPE_PRESTADOR_MOV (scripts 0568 e 0569); os códigos são os dos domínios do
// banco do estabelecimento, conferidos no servidor contra o domínio lido. Nenhuma escrita em tabela legada (seção 5).
import { z } from 'zod';
import { UFS } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

/** Classificação do estabelecimento na rede (código 1 é a assistência hospitalar). */
export const CLASSIFICACOES_REDE = {
  1: 'Assistência hospitalar',
  2: 'Serviços de alta complexidade',
  3: 'Demais estabelecimentos',
} as const;
export type ClassificacaoRede = keyof typeof CLASSIFICACOES_REDE;
export const CLASSIFICACAO_HOSPITALAR = 1 as const satisfies ClassificacaoRede;

/** Disponibilidade dos serviços do prestador para a operadora. */
export const DISPONIBILIDADES_SERVICO = { 1: 'Total', 2: 'Parcial' } as const;
export type DisponibilidadeServico = keyof typeof DISPONIBILIDADES_SERVICO;

/** Indicador de isenção de ônus do prestador. */
export const ISENCOES_ONUS = { 1: 'Sem informação', 2: 'Sim', 3: 'Não' } as const;
export type IsencaoOnus = keyof typeof ISENCOES_ONUS;

/** Código do tipo de prestador "hospital geral". */
export const TIPO_PRESTADOR_HOSPITAL = 3 as const;
/** Tipos de prestador que admitem pessoa física (consultório médico, consultório dentário, reembolso). */
export const TIPOS_PRESTADOR_PESSOA_FISICA: readonly number[] = [1, 5, 8];
/** Contratação indireta: pela rede de outra operadora, com o registro dela na ANS. */
export const CONTRATACAO_INDIRETA = 2 as const;

/** Movimentos da rede que vão ao RPS da ANS: o código do domínio. */
export const MOVIMENTO_RPS = { inclusao: 1, alteracao: 2, exclusao: 3, reinclusao: 4 } as const;
export type CodigoMovimentoRps = (typeof MOVIMENTO_RPS)[keyof typeof MOVIMENTO_RPS];

/** Prazo mínimo entre o aviso aos beneficiários e o descredenciamento (Lei 9.656/1998, art. 17; RN ANS 585/2023). */
export const DIAS_AVISO_DESCREDENCIAMENTO = 30;

export const PESSOAS_PRESTADOR = ['F', 'J'] as const;
export type PessoaPrestador = (typeof PESSOAS_PRESTADOR)[number];
export const SITUACOES_PRESTADOR = ['credenciado', 'descredenciado'] as const;
export type SituacaoPrestador = (typeof SITUACOES_PRESTADOR)[number];
export const SITUACOES_MOVIMENTO_RPS = ['pendente', 'enviado'] as const;
export type SituacaoMovimentoRps = (typeof SITUACOES_MOVIMENTO_RPS)[number];

/** Campos do credenciamento que o RPS leva: mudar um deles gera o movimento de alteração. */
export const CAMPOS_RPS = [
  'nome',
  'cnes',
  'uf',
  'municipioIbge',
  'tipo',
  'natureza',
  'classificacao',
  'contratacao',
  'operadoraIntermediaria',
  'disponibilidade',
  'urgencia',
] as const;
export type CampoRps = (typeof CAMPOS_RPS)[number];

const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const codigo = z.number().int().min(1).max(32_767);
const soDigitosOuLetras = (max: number) =>
  z
    .string()
    .max(max + 6)
    .overwrite((t) => t.replace(/[.\-/\s]/g, '').toUpperCase());

/** Contrato escrito com o prestador (Lei 13.003/2014): número, vigência, forma e mês do reajuste anual. */
export const esquemaContratoPrestador = z
  .object({
    numero: livre(30).pipe(z.string().min(1, 'Informe o número do contrato.')),
    inicio: dataIso,
    fim: dataIso.nullable(),
    formaReajuste: codigo,
    mesReajuste: z.number().int().min(1).max(12),
  })
  .strict();
export type ContratoPrestador = z.infer<typeof esquemaContratoPrestador>;

/** O que o credenciamento e a alteração têm em comum (o documento e a pessoa não mudam depois de credenciado). */
const camposPrestador = {
  nome: livre(120).pipe(z.string().min(3, 'Informe o nome ou a razão social.')),
  nomeFantasia: livre(120).nullable(),
  /** CNES: 7 dígitos (obrigatório para pessoa jurídica). */
  cnes: soDigitosOuLetras(7).nullable(),
  uf: z.enum(UFS),
  /** Código IBGE do município (7 dígitos; os dois primeiros são os da UF). */
  municipioIbge: z.number().int().min(1_000_000).max(9_999_999),
  tipo: codigo,
  natureza: codigo,
  classificacao: codigo,
  contratacao: codigo,
  /** Registro na ANS da operadora intermediária (6 dígitos), só na contratação indireta. */
  operadoraIntermediaria: soDigitosOuLetras(6).nullable(),
  disponibilidade: codigo,
  isencaoOnus: codigo,
  /** Atende urgência e emergência. */
  urgencia: z.boolean(),
  regime: codigo,
  remuneracao: codigo,
  contrato: esquemaContratoPrestador,
  /** O próprio hospital da Rede como prestador da operadora (regra 3: o hospital fatura para ela por TISS). */
  ehOHospital: z.boolean(),
  /** Código do estabelecimento da Rede (só quando é o próprio hospital). */
  estabelecimento: z
    .string()
    .regex(/^[a-z][a-z0-9]{1,9}$/)
    .nullable(),
  /** Convênio que representa a operadora no faturamento do hospital (só leitura do cadastro de convênios). */
  convenio: idBanco.nullable(),
} as const;

export const esquemaCredenciarPrestador = z
  .object({
    pessoa: z.enum(PESSOAS_PRESTADOR),
    /** CPF (11) ou CNPJ (14; o alfanumérico da Receita Federal também), com ou sem pontuação. */
    documento: soDigitosOuLetras(14).pipe(z.string().min(11, 'Informe o CPF ou o CNPJ.')),
    ...camposPrestador,
  })
  .strict();
export type CredenciarPrestadorEntrada = z.infer<typeof esquemaCredenciarPrestador>;

export const esquemaAlterarPrestador = z
  .object({
    /** A versão vista na tela (outra pessoa pode ter alterado: 409). */
    versao: z.number().int().min(1),
    ...camposPrestador,
  })
  .strict();
export type AlterarPrestadorEntrada = z.infer<typeof esquemaAlterarPrestador>;

/** O tipo do motivo do descredenciamento (registro próprio da saída, com o aviso e o substituto). */
export const TIPOS_MOTIVO_DESCREDENCIAMENTO = [
  'pedido_prestador',
  'iniciativa_operadora',
  'qualidade',
  'fraude',
  'encerramento_atividade',
  'outro',
] as const;
export type TipoMotivoDescredenciamento = (typeof TIPOS_MOTIVO_DESCREDENCIAMENTO)[number];

export const esquemaDescredenciarPrestador = z
  .object({
    versao: z.number().int().min(1),
    motivo: livre(200).pipe(z.string().min(10, 'Descreva o motivo (10 caracteres ou mais).')),
    /** Data em que o prestador deixa a rede. */
    efetivoEm: dataIso,
    /** Data do aviso aos beneficiários (pelo menos 30 dias antes). */
    avisoBeneficiariosEm: dataIso,
    /** Prestador equivalente que substitui (ID); null só com a autorização da ANS para reduzir a rede hospitalar. */
    substituto: z.number().int().min(1).nullable(),
    /** Número do processo de autorização da ANS (redução da rede hospitalar sem substituto). */
    autorizacaoAns: livre(40).nullable(),
    /** O tipo do motivo (C2-118); sem ele, a saída fica como iniciativa da operadora. */
    tipoMotivo: z.enum(TIPOS_MOTIVO_DESCREDENCIAMENTO).optional(),
  })
  .strict();
export type DescredenciarPrestadorEntrada = z.infer<typeof esquemaDescredenciarPrestador>;

export const esquemaReincluirPrestador = z
  .object({
    versao: z.number().int().min(1),
    motivo: livre(200).pipe(z.string().min(10, 'Descreva o motivo (10 caracteres ou mais).')),
    contrato: esquemaContratoPrestador,
  })
  .strict();
export type ReincluirPrestadorEntrada = z.infer<typeof esquemaReincluirPrestador>;

/** Cursor da lista: o nome em maiúsculas e o ID da última linha (base64url). */
export const FORMATO_CURSOR_PRESTADOR = /^[A-Za-z0-9_-]{4,400}$/;

export const esquemaFiltroPrestadores = z.object({
  /** Trecho do nome, o CPF/CNPJ ou o CNES. */
  busca: z.string().trim().min(1).max(60).optional(),
  situacao: z.enum(SITUACOES_PRESTADOR).optional(),
  tipo: z.coerce.number().int().min(1).max(32_767).optional(),
  apos: z.string().regex(FORMATO_CURSOR_PRESTADOR).optional(),
});
export type FiltroPrestadores = z.infer<typeof esquemaFiltroPrestadores>;

export const esquemaFiltroMovimentosRps = z.object({
  situacao: z.enum(SITUACOES_MOVIMENTO_RPS).optional(),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroMovimentosRps = z.infer<typeof esquemaFiltroMovimentosRps>;

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

const esquemaOpcao = z.object({ codigo: z.number().int(), rotulo: z.string() });
export type OpcaoDominioRede = z.infer<typeof esquemaOpcao>;

export const esquemaApoioRede = z.object({
  dominios: z.object({
    tipo: z.array(esquemaOpcao),
    natureza: z.array(esquemaOpcao),
    classificacao: z.array(esquemaOpcao),
    contratacao: z.array(esquemaOpcao),
    disponibilidade: z.array(esquemaOpcao),
    isencaoOnus: z.array(esquemaOpcao),
    regime: z.array(esquemaOpcao),
    remuneracao: z.array(esquemaOpcao),
    formaReajuste: z.array(esquemaOpcao),
    movimento: z.array(esquemaOpcao),
  }),
  convenios: z.array(
    z.object({ codigo: z.number().int(), nome: z.string(), registroAns: z.number().int().nullable() }),
  ),
  estabelecimentos: z.array(z.object({ codigo: z.string(), nome: z.string() })),
  /** A fatia vale (chave do módulo e da rede ligadas) e o motivo quando não vale. */
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  /** Pode gravar (permissão de editar e a fatia ligada). */
  podeEditar: z.boolean(),
  hoje: dataIso,
});
export type ApoioRede = z.infer<typeof esquemaApoioRede>;

export const esquemaPrestadorResumo = z.object({
  id: z.number().int(),
  pessoa: z.enum(PESSOAS_PRESTADOR),
  /** CNPJ por inteiro; CPF mascarado na lista (só os 5 últimos dígitos). */
  documento: z.string(),
  nome: z.string(),
  cnes: z.string().nullable(),
  uf: z.string(),
  municipioIbge: z.number().int(),
  tipo: z.number().int(),
  classificacao: z.number().int(),
  hospitalar: z.boolean(),
  ehOHospital: z.boolean(),
  estabelecimento: z.string().nullable(),
  situacao: z.enum(SITUACOES_PRESTADOR),
  situacaoEm: z.string(),
  /**
   * A saída da rede agendada (descredenciamento com data futura, AAAA-MM-DD): até ela o prestador segue credenciado
   * (atende, conta na rede e aparece como credenciado); null quando não há saída agendada.
   */
  saidaEm: z.string().nullable(),
  contratoFim: z.string().nullable(),
  versao: z.number().int(),
});
export type PrestadorResumo = z.infer<typeof esquemaPrestadorResumo>;

export const esquemaPrestadores = z.object({
  itens: z.array(esquemaPrestadorResumo),
  proxima: z.string().nullable(),
  /** Contagens da empresa (credenciados, descredenciados, hospitalares, saídas agendadas, movimentos do RPS pendentes). */
  totais: z.object({
    credenciados: z.number().int(),
    descredenciados: z.number().int(),
    hospitalares: z.number().int(),
    /** Credenciados com a saída da rede agendada (contam entre os credenciados até a data). */
    saidasAgendadas: z.number().int(),
    rpsPendentes: z.number().int(),
  }),
});
export type Prestadores = z.infer<typeof esquemaPrestadores>;

export const esquemaMovimentoRps = z.object({
  id: z.number().int(),
  prestador: z.number().int(),
  prestadorNome: z.string(),
  movimento: z.number().int(),
  /** Campos do RPS mudados (só na alteração). */
  campos: z.array(z.string()),
  motivo: z.string().nullable(),
  situacao: z.enum(SITUACOES_MOVIMENTO_RPS),
  registradoEm: z.string(),
  registradoPor: z.string(),
});
export type MovimentoRps = z.infer<typeof esquemaMovimentoRps>;
export const esquemaMovimentosRps = z.object({
  itens: z.array(esquemaMovimentoRps),
  proxima: z.number().int().nullable(),
});
export type MovimentosRps = z.infer<typeof esquemaMovimentosRps>;

export const esquemaPrestadorDetalhe = z.object({
  id: z.number().int(),
  pessoa: z.enum(PESSOAS_PRESTADOR),
  documento: z.string(),
  nome: z.string(),
  nomeFantasia: z.string().nullable(),
  cnes: z.string().nullable(),
  uf: z.string(),
  municipioIbge: z.number().int(),
  tipo: z.number().int(),
  natureza: z.number().int(),
  classificacao: z.number().int(),
  contratacao: z.number().int(),
  operadoraIntermediaria: z.string().nullable(),
  disponibilidade: z.number().int(),
  isencaoOnus: z.number().int(),
  urgencia: z.boolean(),
  regime: z.number().int(),
  remuneracao: z.number().int(),
  contrato: esquemaContratoPrestador,
  ehOHospital: z.boolean(),
  estabelecimento: z.string().nullable(),
  convenio: z.number().int().nullable(),
  situacao: z.enum(SITUACOES_PRESTADOR),
  situacaoEm: z.string(),
  /**
   * A saída da rede agendada (descredenciamento com data futura, AAAA-MM-DD): até ela o prestador segue credenciado
   * (atende, conta na rede e aparece como credenciado); null quando não há saída agendada.
   */
  saidaEm: z.string().nullable(),
  motivoSituacao: z.string().nullable(),
  substituto: z.number().int().nullable(),
  avisoBeneficiariosEm: z.string().nullable(),
  autorizacaoAns: z.string().nullable(),
  hospitalar: z.boolean(),
  versao: z.number().int(),
  criadoEm: z.string(),
  criadoPor: z.string(),
  alteradoEm: z.string(),
  alteradoPor: z.string(),
  movimentos: z.array(esquemaMovimentoRps),
});
export type PrestadorDetalhe = z.infer<typeof esquemaPrestadorDetalhe>;

export const esquemaResultadoRede = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  versao: z.number().int(),
  /** Movimento do RPS registrado (null: a alteração não muda o que vai ao RPS). */
  movimento: z.number().int().nullable(),
  mensagem: z.string(),
  avisos: z.array(z.string()),
});
export type ResultadoRede = z.infer<typeof esquemaResultadoRede>;

/** Rotas e permissões da fatia F3 (a chave `operadora.rede`, que só vale com a do módulo, é exigida em todas). */
export const ROTAS_OPERADORA_F3 = {
  apoio: { caminho: 'operadora/rede/apoio', permissao: 'operadora.prestador.ler' },
  prestadores: { caminho: 'operadora/prestadores', permissao: 'operadora.prestador.ler' },
  prestador: { caminho: 'operadora/prestadores/:id', permissao: 'operadora.prestador.ler' },
  credenciar: { caminho: 'operadora/prestadores', permissao: 'operadora.prestador.editar' },
  alterar: { caminho: 'operadora/prestadores/:id/alterar', permissao: 'operadora.prestador.editar' },
  descredenciar: {
    caminho: 'operadora/prestadores/:id/descredenciar',
    permissao: 'operadora.prestador.editar',
  },
  reincluir: { caminho: 'operadora/prestadores/:id/reincluir', permissao: 'operadora.prestador.editar' },
  movimentos: { caminho: 'operadora/rede/movimentos', permissao: 'operadora.prestador.ler' },
} as const;

/** Chave de liberação da fatia (CHAVES_FATIA_OPERADORA, recurso `rede`). */
export const CHAVE_OPERADORA_REDE = 'operadora.rede' as const;

/**
 * Textos das recusas e dos avisos da rede credenciada (os códigos das regras de @sgh/dominio-operadora e das
 * gravações): o mesmo texto na API e na tela.
 */
export const MENSAGENS_REDE: Readonly<Record<string, string>> = {
  'documento-invalido': 'O CPF ou o CNPJ não confere (dígitos verificadores).',
  'pessoa-incompativel-com-tipo':
    'Pessoa física só como consultório médico, consultório dentário ou prestador de reembolso.',
  'cnes-obrigatorio': 'Informe o CNES do estabelecimento (obrigatório para pessoa jurídica).',
  'cnes-invalido': 'O CNES tem 7 dígitos.',
  'municipio-fora-da-uf': 'O código do município do IBGE não é da UF informada.',
  'dominio-invalido': 'Escolha uma opção da lista.',
  'intermediaria-obrigatoria':
    'Na contratação indireta, informe o registro na ANS da operadora intermediária.',
  'intermediaria-invalida': 'O registro da operadora na ANS tem 6 dígitos.',
  'intermediaria-so-na-indireta': 'A operadora intermediária só vale na contratação indireta.',
  'contrato-fim-antes-do-inicio': 'O fim do contrato não pode ser antes do início.',
  'hospital-sem-estabelecimento': 'Escolha o estabelecimento da Rede que é este prestador.',
  'estabelecimento-so-do-hospital':
    'O estabelecimento da Rede só vale quando o prestador é o próprio hospital.',
  'hospital-pessoa-juridica': 'O próprio hospital é credenciado como pessoa jurídica.',
  'estabelecimento-fora-da-rede': 'O estabelecimento não é da Rede.',
  'convenio-inexistente': 'O convênio escolhido não existe no cadastro de convênios do hospital.',
  'documento-ja-credenciado': 'Este CPF ou CNPJ já está na rede da operadora.',
  'hospital-ja-na-rede': 'Este estabelecimento da Rede já está credenciado como prestador da operadora.',
  'prestador-desatualizado':
    'O prestador mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  'prestador-em-edicao':
    'Outra pessoa está gravando este prestador agora. Abra de novo e confira antes de gravar.',
  'ja-descredenciado': 'O prestador já está descredenciado.',
  'efetivo-no-passado': 'A data do descredenciamento é de hoje em diante.',
  'aviso-no-futuro': 'O aviso aos beneficiários já tem de ter sido dado (hoje ou antes).',
  'prazo-do-aviso': 'O descredenciamento só vale 30 dias depois do aviso aos beneficiários.',
  'substituto-obrigatorio':
    'Prestador hospitalar só sai da rede com um substituto equivalente ou com a autorização da ANS para reduzir a rede.',
  'substituto-ele-mesmo': 'O substituto tem de ser outro prestador.',
  'substituto-inexistente': 'O substituto não está na rede da operadora.',
  'substituto-descredenciado': 'O substituto não está credenciado. Escolha outro prestador equivalente.',
  'substituto-nao-hospitalar': 'O substituto de um prestador hospitalar tem de ser hospitalar.',
  'substituto-outra-uf': 'O substituto tem de atender na mesma UF.',
  'substituto-outro-municipio':
    'O substituto atende em outro município: confira a equivalência antes do aviso aos beneficiários.',
  'reducao-autorizada': 'Redução da rede hospitalar com a autorização da ANS informada.',
  'so-descredenciado': 'Só o prestador descredenciado ou com a saída da rede agendada pode ser reincluído.',
  'so-credenciado':
    'Só o prestador credenciado e sem saída da rede agendada pode ser alterado. Para mudar os dados, reinclua-o antes.',
  'saida-ja-agendada': 'A saída deste prestador da rede já está agendada.',
  'substituto-com-saida-agendada':
    'O substituto também tem a saída da rede agendada. Escolha outro prestador equivalente.',
};
