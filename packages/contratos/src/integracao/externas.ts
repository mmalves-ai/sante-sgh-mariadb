// Central de integrações externas (decisão 53 do dono, 27/11/2026). Cada integração externa do produto tem um modo
// Simulador (padrão, para testes e para o hospital treinar) ou Real. O real pede credenciais, que vão só ao cofre de
// segredos (só na ida: nunca voltam à tela, ao log nem à trilha), e parâmetros não secretos (endereço, versão etc.).
// Quando o real depende da definição de API do fornecedor, a tela mostra o aviso "Passe a definição à equipe de
// desenvolvimento" com a lista do que pedir. Fora de produção o real fica neutralizado: a chave grava, a tela avisa
// e o adaptador segue no simulador (AGENTS.md, regra 6).
//
// Este arquivo é o catálogo tipado: cada função que fala com o mundo de fora tem uma entrada aqui, e o adaptador dela
// pergunta à central (API, modoDaIntegracao) o modo e as credenciais. Nunca lê credencial de cliente do ambiente.
import { z } from 'zod';

export const AREAS_INTEGRACAO_EXTERNA = [
  'faturamento',
  'financeiro',
  'pessoas',
  'fiscal',
  'laboratorio',
  'sus',
  'paciente',
  'cadastro',
  'regulacao',
] as const;
export type AreaIntegracaoExterna = (typeof AREAS_INTEGRACAO_EXTERNA)[number];

export const MODOS_INTEGRACAO_EXTERNA = ['simulador', 'real'] as const;
export type ModoIntegracaoExterna = (typeof MODOS_INTEGRACAO_EXTERNA)[number];

/**
 * Situação mostrada na tela:
 * - simulador: o padrão;
 * - real-incompleto: a chave do real está ligada, mas falta credencial ou parâmetro obrigatório (segue no simulador);
 * - real-neutralizado: o real está completo, mas o ambiente não é produção (segue no simulador);
 * - real-configurado: em produção, falando com o fornecedor;
 * - real-com-falha: em produção, a última chamada ao fornecedor falhou (registrada pelo adaptador).
 */
export const SITUACOES_INTEGRACAO_EXTERNA = [
  'simulador',
  'real-incompleto',
  'real-neutralizado',
  'real-configurado',
  'real-com-falha',
] as const;
export type SituacaoIntegracaoExterna = (typeof SITUACOES_INTEGRACAO_EXTERNA)[number];

export interface CampoCredencialIntegracao {
  /** Identificador do campo (minúsculas e hífen): entra na referência do cofre. */
  readonly id: string;
  readonly rotulo: string;
  readonly ajuda?: string;
}

export interface ParametroIntegracao {
  readonly id: string;
  readonly rotulo: string;
  readonly tipo: 'texto' | 'endereco';
  /** Obrigatório para o real ficar completo. */
  readonly obrigatorio: boolean;
  readonly ajuda?: string;
}

export interface EntradaIntegracaoExterna {
  readonly id: string;
  readonly area: AreaIntegracaoExterna;
  readonly nome: string;
  readonly descricao: string;
  /** As funções do produto que usam a integração (para a tela e para o adaptador). */
  readonly funcoes: readonly string[];
  readonly camposCredencial: readonly CampoCredencialIntegracao[];
  readonly parametros: readonly ParametroIntegracao[];
  /** O real só existe depois que o fornecedor entregar a definição da API (a tela mostra o aviso). */
  readonly dependeDefinicaoFornecedor: boolean;
  /** O que o cliente pede ao fornecedor e passa à equipe de desenvolvimento. */
  readonly oQuePedirAoFornecedor: readonly string[];
}

/** O pedido-padrão ao fornecedor (brief da rodada): cada entrada acrescenta o que é próprio dela. */
export const PEDIDO_PADRAO_FORNECEDOR: readonly string[] = [
  'Manual técnico da integração',
  'Definição da API (WSDL ou OpenAPI) com a versão',
  'Endereços de homologação e de produção',
  'Certificado digital exigido e forma de autenticação',
  'Contato técnico do fornecedor',
];

const ENDERECO: ParametroIntegracao = {
  id: 'endereco',
  rotulo: 'Endereço do serviço',
  tipo: 'endereco',
  obrigatorio: true,
};
const VERSAO: ParametroIntegracao = {
  id: 'versao',
  rotulo: 'Versão da API',
  tipo: 'texto',
  obrigatorio: false,
};
const USUARIO: CampoCredencialIntegracao = { id: 'usuario', rotulo: 'Usuário' };
const SENHA: CampoCredencialIntegracao = { id: 'senha', rotulo: 'Senha' };
const CERTIFICADO: CampoCredencialIntegracao = {
  id: 'certificado',
  rotulo: 'Certificado digital (A1, em base64)',
  ajuda: 'O arquivo do certificado convertido em texto; a senha do certificado vai no campo próprio.',
};
const SENHA_CERTIFICADO: CampoCredencialIntegracao = {
  id: 'senha-certificado',
  rotulo: 'Senha do certificado',
};
const pedir = (...extras: string[]): readonly string[] => [...PEDIDO_PADRAO_FORNECEDOR, ...extras];

export const CATALOGO_INTEGRACOES_EXTERNAS: readonly EntradaIntegracaoExterna[] = [
  {
    id: 'operadora-tiss-webservice',
    area: 'faturamento',
    nome: 'Operadora de plano de saúde (webservice TISS)',
    descricao:
      'Troca on-line com a operadora pelo padrão TISS: elegibilidade do beneficiário, solicitação de autorização, ' +
      'comunicação de internação e de alta e envio do lote de guias.',
    funcoes: ['elegibilidade', 'autorizacao', 'comunicacao-internacao-alta', 'envio-lote'],
    camposCredencial: [USUARIO, SENHA, CERTIFICADO, SENHA_CERTIFICADO],
    parametros: [
      ENDERECO,
      { id: 'registro-ans', rotulo: 'Registro ANS da operadora', tipo: 'texto', obrigatorio: true },
      { id: 'codigo-prestador', rotulo: 'Código do hospital na operadora', tipo: 'texto', obrigatorio: true },
      { id: 'versao-tiss', rotulo: 'Versão do padrão TISS', tipo: 'texto', obrigatorio: true },
    ],
    dependeDefinicaoFornecedor: true,
    oQuePedirAoFornecedor: pedir(
      'Lista das transações TISS aceitas pelo webservice (elegibilidade, autorização, internação e alta, lote)',
      'Código do prestador e login do portal da operadora',
    ),
  },
  {
    id: 'pix',
    area: 'financeiro',
    nome: 'PIX (banco ou provedor de pagamento)',
    descricao: 'Cobrança por PIX com QR Code, consulta e baixa automática do pagamento pelo aviso do banco.',
    funcoes: ['cobranca-pix', 'baixa-pix'],
    camposCredencial: [
      { id: 'client-id', rotulo: 'Identificador do cliente (client id)' },
      { id: 'client-secret', rotulo: 'Segredo do cliente (client secret)' },
      CERTIFICADO,
      SENHA_CERTIFICADO,
    ],
    parametros: [
      ENDERECO,
      {
        id: 'endereco-token',
        rotulo: 'Endereço do token OAuth2 do provedor',
        tipo: 'endereco',
        obrigatorio: true,
      },
      { id: 'chave-pix', rotulo: 'Chave PIX recebedora', tipo: 'texto', obrigatorio: true },
      { id: 'provedor', rotulo: 'Banco ou provedor', tipo: 'texto', obrigatorio: true },
    ],
    dependeDefinicaoFornecedor: false,
    oQuePedirAoFornecedor: pedir(
      'Credenciais da API PIX do banco (padrão do Banco Central) e o cadastro do aviso',
    ),
  },
  {
    id: 'esocial',
    area: 'pessoas',
    nome: 'eSocial',
    descricao: 'Envio dos eventos trabalhistas ao eSocial e consulta do recibo.',
    funcoes: ['envio-eventos-esocial', 'consulta-recibo-esocial'],
    camposCredencial: [CERTIFICADO, SENHA_CERTIFICADO],
    parametros: [
      ENDERECO,
      { id: 'cnpj-empregador', rotulo: 'CNPJ do empregador', tipo: 'texto', obrigatorio: true },
      VERSAO,
    ],
    dependeDefinicaoFornecedor: false,
    oQuePedirAoFornecedor: pedir(
      'Procuração eletrônica, quando o certificado não for o do próprio empregador',
    ),
  },
  {
    id: 'nfse',
    area: 'fiscal',
    nome: 'Nota fiscal de serviço (NFS-e)',
    descricao:
      'Emissão, consulta e cancelamento da nota fiscal de serviço na prefeitura ou no padrão nacional.',
    funcoes: ['emissao-nfse', 'cancelamento-nfse'],
    camposCredencial: [USUARIO, SENHA, CERTIFICADO, SENHA_CERTIFICADO],
    parametros: [
      ENDERECO,
      { id: 'municipio', rotulo: 'Município (código IBGE)', tipo: 'texto', obrigatorio: true },
      { id: 'inscricao-municipal', rotulo: 'Inscrição municipal', tipo: 'texto', obrigatorio: true },
      VERSAO,
    ],
    dependeDefinicaoFornecedor: true,
    oQuePedirAoFornecedor: pedir(
      'Padrão de NFS-e adotado pela prefeitura (nacional ou próprio) e o layout do RPS',
    ),
  },
  {
    id: 'equipamentos-laboratorio',
    area: 'laboratorio',
    nome: 'Equipamentos do laboratório',
    descricao: 'Envio da lista de trabalho e recebimento dos resultados dos analisadores (interfaceamento).',
    funcoes: ['lista-trabalho-equipamento', 'resultado-equipamento'],
    camposCredencial: [{ id: 'chave-acesso', rotulo: 'Chave de acesso do middleware' }],
    parametros: [
      ENDERECO,
      { id: 'protocolo', rotulo: 'Protocolo (ASTM, HL7 ou do fabricante)', tipo: 'texto', obrigatorio: true },
      { id: 'modelo', rotulo: 'Fabricante e modelo do equipamento', tipo: 'texto', obrigatorio: false },
    ],
    dependeDefinicaoFornecedor: true,
    oQuePedirAoFornecedor: pedir(
      'Manual de interfaceamento do equipamento (protocolo, mensagens e códigos dos exames)',
      'Forma de conexão (rede, serial ou middleware do fabricante)',
    ),
  },
  {
    id: 'sus-webservices',
    area: 'sus',
    nome: 'Webservices do SUS (CADSUS, SISREG e outros)',
    descricao: 'Consulta do cartão nacional de saúde e demais serviços do Ministério da Saúde.',
    funcoes: ['consulta-cns', 'servicos-sus'],
    camposCredencial: [USUARIO, SENHA, CERTIFICADO, SENHA_CERTIFICADO],
    parametros: [
      ENDERECO,
      { id: 'cnes', rotulo: 'CNES do estabelecimento', tipo: 'texto', obrigatorio: true },
    ],
    dependeDefinicaoFornecedor: true,
    oQuePedirAoFornecedor: pedir('Termo de adesão e o perfil de acesso liberado pelo gestor do SUS'),
  },
  {
    id: 'push-paciente',
    area: 'paciente',
    nome: 'Notificação no celular do paciente (push)',
    descricao: 'Avisos do portal do paciente pelo serviço de notificação do aplicativo.',
    funcoes: ['aviso-push-paciente'],
    camposCredencial: [{ id: 'chave-servidor', rotulo: 'Chave do servidor de notificações' }],
    parametros: [
      ENDERECO,
      { id: 'aplicativo', rotulo: 'Identificador do aplicativo', tipo: 'texto', obrigatorio: true },
    ],
    dependeDefinicaoFornecedor: false,
    oQuePedirAoFornecedor: pedir('Projeto do aplicativo no serviço de notificações e a chave do servidor'),
  },
  {
    id: 'cnes',
    area: 'cadastro',
    nome: 'CNES (cadastro nacional de estabelecimentos)',
    descricao: 'Consulta e conferência do cadastro do estabelecimento e dos profissionais no CNES oficial.',
    funcoes: ['consulta-cnes', 'conferencia-profissionais-cnes', 'exportacao-profissionais-cnes'],
    camposCredencial: [USUARIO, SENHA],
    parametros: [
      ENDERECO,
      { id: 'cnes', rotulo: 'CNES do estabelecimento', tipo: 'texto', obrigatorio: true },
    ],
    dependeDefinicaoFornecedor: true,
    oQuePedirAoFornecedor: pedir(
      'Acesso ao serviço de consulta do CNES liberado ao estabelecimento',
      'Esquema XML (XSD) e manual de importação de profissionais da versão do sistema do CNES em uso',
    ),
  },
  {
    id: 'regulacao-central',
    area: 'regulacao',
    nome: 'Central de regulação',
    descricao: 'Envio de solicitações de vaga e recebimento das respostas da central de regulação do gestor.',
    funcoes: ['solicitacao-regulacao', 'resposta-regulacao'],
    camposCredencial: [USUARIO, SENHA],
    parametros: [ENDERECO, VERSAO],
    dependeDefinicaoFornecedor: true,
    oQuePedirAoFornecedor: pedir(
      'Sistema de regulação usado pelo gestor (estadual ou municipal) e o perfil do hospital',
    ),
  },
];

export type IdIntegracaoExterna = (typeof CATALOGO_INTEGRACOES_EXTERNAS)[number]['id'];

export function entradaIntegracaoExterna(id: string): EntradaIntegracaoExterna | null {
  return CATALOGO_INTEGRACOES_EXTERNAS.find((e) => e.id === id) ?? null;
}

// ── referência no cofre ─────────────────────────────────────────────────────────────────────────────

const REF_COFRE = /^cofre:integracao\/([A-Za-z0-9_-]{1,64})\/([a-z0-9-]{1,60})\/([a-z0-9-]{1,40})$/;

/** A referência da credencial no cofre, presa ao cliente, à integração e ao campo do catálogo. */
export function referenciaCofreIntegracao(cliente: string, integracao: string, campo: string): string {
  const r = `cofre:integracao/${cliente}/${integracao}/${campo}`;
  if (!lerReferenciaCofreIntegracao(r))
    throw new Error('Cliente, integração ou campo inválido para o cofre.');
  return r;
}

export function lerReferenciaCofreIntegracao(
  r: string,
): { cliente: string; integracao: string; campo: string } | null {
  const m = REF_COFRE.exec(r);
  if (!m) return null;
  const e = entradaIntegracaoExterna(m[2]!);
  if (!e || !e.camposCredencial.some((c) => c.id === m[3])) return null;
  return { cliente: m[1]!, integracao: m[2]!, campo: m[3]! };
}

// ── respostas e pedidos da API ───────────────────────────────────────────────────────────────────

const idIntegracao = z
  .string()
  .refine((v) => entradaIntegracaoExterna(v) !== null, { message: 'Integração desconhecida.' });

export interface IntegracaoExternaLida {
  readonly id: string;
  readonly modo: ModoIntegracaoExterna;
  readonly situacao: SituacaoIntegracaoExterna;
  readonly parametros: Readonly<Record<string, string>>;
  /** Só "definida ou não" (nulo: cofre indisponível). Nunca o valor. */
  readonly credenciais: readonly { readonly campo: string; readonly definida: boolean | null }[];
  readonly faltam: readonly string[];
  readonly versao: number | null;
  readonly alteradoEm: string | null;
  readonly alteradoPor: string | null;
  readonly ultimaFalhaEm: string | null;
  readonly ultimaFalha: string | null;
}

export interface PainelIntegracoesExternas {
  /** Fora de produção o real fica neutralizado: o adaptador segue no simulador. */
  readonly producao: boolean;
  readonly cofreDisponivel: boolean;
  readonly integracoes: readonly IntegracaoExternaLida[];
}

export const esquemaIntegracaoExternaLida: z.ZodType<IntegracaoExternaLida> = z.object({
  id: z.string(),
  modo: z.enum(MODOS_INTEGRACAO_EXTERNA),
  situacao: z.enum(SITUACOES_INTEGRACAO_EXTERNA),
  parametros: z.record(z.string(), z.string()),
  credenciais: z.array(z.object({ campo: z.string(), definida: z.boolean().nullable() })),
  faltam: z.array(z.string()),
  versao: z.number().int().positive().nullable(),
  alteradoEm: z.string().nullable(),
  alteradoPor: z.string().nullable(),
  ultimaFalhaEm: z.string().nullable(),
  ultimaFalha: z.string().nullable(),
});

export const esquemaPainelIntegracoesExternas: z.ZodType<PainelIntegracoesExternas> = z.object({
  producao: z.boolean(),
  cofreDisponivel: z.boolean(),
  integracoes: z.array(esquemaIntegracaoExternaLida),
});

/** Parâmetros não secretos: só os do catálogo, texto curto, sem quebra de linha. */
export const esquemaConfigurarIntegracaoExterna = z
  .object({
    integracao: idIntegracao,
    parametros: z.record(
      z.string(),
      z
        .string()
        .max(500)
        .regex(/^[^\r\n]*$/),
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    const e = entradaIntegracaoExterna(v.integracao);
    for (const k of Object.keys(v.parametros))
      if (!e?.parametros.some((p) => p.id === k))
        ctx.addIssue({ code: 'custom', message: `Parâmetro desconhecido: ${k}.`, path: ['parametros', k] });
  });
export type PedidoConfigurarIntegracaoExterna = z.infer<typeof esquemaConfigurarIntegracaoExterna>;

/** A credencial vai só na ida, com a senha de novo (crítica). */
export const esquemaGuardarCredencialIntegracao = z
  .object({
    integracao: idIntegracao,
    campo: z.string().min(1).max(40),
    valor: z.string().min(1).max(20_000),
    senha: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    const e = entradaIntegracaoExterna(v.integracao);
    if (!e?.camposCredencial.some((c) => c.id === v.campo))
      ctx.addIssue({ code: 'custom', message: 'Campo de credencial desconhecido.', path: ['campo'] });
  });
export type PedidoGuardarCredencialIntegracao = z.infer<typeof esquemaGuardarCredencialIntegracao>;

/** Ligar ou desligar o real: senha de novo e justificativa (trilha). */
export const esquemaDefinirModoIntegracao = z
  .object({
    integracao: idIntegracao,
    modo: z.enum(MODOS_INTEGRACAO_EXTERNA),
    justificativa: z.string().trim().min(10).max(500),
    senha: z.string().min(1).max(200),
  })
  .strict();
export type PedidoDefinirModoIntegracao = z.infer<typeof esquemaDefinirModoIntegracao>;

export interface ResultadoIntegracaoExterna {
  readonly integracao: IntegracaoExternaLida;
  /** O real foi pedido fora de produção: gravado, mas o adaptador segue no simulador. */
  readonly neutralizado: boolean;
}
export const esquemaResultadoIntegracaoExterna: z.ZodType<ResultadoIntegracaoExterna> = z.object({
  integracao: esquemaIntegracaoExternaLida,
  neutralizado: z.boolean(),
});

/**
 * O estado da integração na tela da função que a usa (decisão 53): o selo "Simulador", o aviso de real neutralizado
 * fora de produção e, quando o real depende da definição do fornecedor, o aviso para passá-la à equipe de
 * desenvolvimento. `transmite`: a função entrega pela integração agora; sem isso, o registro é à mão.
 */
export interface EstadoIntegracaoNaFuncao {
  readonly integracao: string;
  readonly modo: ModoIntegracaoExterna;
  readonly neutralizado: boolean;
  readonly transmite: boolean;
  readonly dependeDefinicaoFornecedor: boolean;
}
export const esquemaEstadoIntegracaoNaFuncao: z.ZodType<EstadoIntegracaoNaFuncao> = z.object({
  integracao: z.string(),
  modo: z.enum(MODOS_INTEGRACAO_EXTERNA),
  neutralizado: z.boolean(),
  transmite: z.boolean(),
  dependeDefinicaoFornecedor: z.boolean(),
});
