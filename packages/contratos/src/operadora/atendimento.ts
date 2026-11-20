// Contratos do atendimento ao beneficiário com protocolo e do portal do prestador credenciado da operadora própria
// (M56, etapa 8 de 8, fatia F7; ficha, seções 1, 3, 6 e 7; cap-07 §7.4; cap-08 §8.3.5):
//   - todo contato do beneficiário (ou de quem o representa) com a operadora recebe, na hora, o número de protocolo de
//     20 dígitos (o registro da operadora na ANS, a data e a sequência, a mesma sequência da autorização de guias: o
//     número não se repete entre os dois); a natureza da demanda (assistencial ou não) dá o prazo da resposta
//     conclusiva, em dias úteis, imediato na urgência e no pedido de cancelamento do contrato; a ouvidoria (a reanálise
//     de uma resposta, ou a demanda direta) e a notificação de intermediação preliminar da ANS (NIP) têm prazos próprios;
//   - a resposta tem a conclusão (favorável, parcial, desfavorável ou informativa) e, quando nega no todo ou em parte, o
//     fundamento (cláusula do contrato ou dispositivo legal); o beneficiário pode pedir a resposta por escrito, que sai
//     no prazo em horas contado da resposta; só a ouvidoria prorroga o prazo, uma vez, com o motivo acordado;
//   - o portal do prestador: a conta de acesso é da operadora (identidade própria em SGH_OPE_PORTAL_ACESSO, nunca usuário
//     interno), ligada a um prestador da rede, com as funções que o credenciamento libera (PFPORTALOPCAO), ativada com o
//     código de uso único, a senha própria e o segundo fator; o prestador consulta e pede autorizações, cancela o pedido
//     dele e consulta protocolos, sempre só os dele.
// Os dados ficam em SGH_OPE_PROTOCOLO, _EVT e SGH_OPE_PORTAL_ACESSO (scripts 0960 e 0961). Nenhuma escrita em tabela
// legada (seção 5); SPORIGEM_ATEND, PFPORTALOPCAO e PFTPATEND são só lidos.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  esquemaElegibilidade,
  esquemaFiltroElegibilidade,
  MOTIVOS_INELEGIBILIDADE,
} from './beneficiarios.js';

// ── Vocabulário ──────────────────────────────────────────────────────────────────────────────────

/** Instância do protocolo: o atendimento (SAC), a ouvidoria (reanálise ou demanda direta) e a NIP da ANS. */
export const INSTANCIAS_PROTOCOLO = ['atendimento', 'ouvidoria', 'nip'] as const;
export type InstanciaProtocolo = (typeof INSTANCIAS_PROTOCOLO)[number];
export const ROTULOS_INSTANCIA_PROTOCOLO: Readonly<Record<InstanciaProtocolo, string>> = {
  atendimento: 'Atendimento ao beneficiário',
  ouvidoria: 'Ouvidoria',
  nip: 'Notificação da ANS (NIP)',
};

/** Natureza da demanda; as três primeiras são assistenciais (cobertura), as outras não assistenciais. */
export const NATUREZAS_PROTOCOLO = [
  'cobertura',
  'reembolso',
  'reclamacao-assistencial',
  'informacao',
  'cadastro',
  'financeiro',
  'cancelamento',
  'reclamacao-administrativa',
] as const;
export type NaturezaProtocolo = (typeof NATUREZAS_PROTOCOLO)[number];
export const NATUREZAS_ASSISTENCIAIS: readonly NaturezaProtocolo[] = [
  'cobertura',
  'reembolso',
  'reclamacao-assistencial',
];
export const ROTULOS_NATUREZA_PROTOCOLO: Readonly<Record<NaturezaProtocolo, string>> = {
  cobertura: 'Cobertura de procedimento ou serviço',
  reembolso: 'Reembolso',
  'reclamacao-assistencial': 'Reclamação sobre atendimento à saúde',
  informacao: 'Informação',
  cadastro: 'Cadastro',
  financeiro: 'Mensalidade e cobrança',
  cancelamento: 'Cancelamento do contrato',
  'reclamacao-administrativa': 'Reclamação administrativa',
};

/** Classe da demanda (dá o prazo): assistencial ou não assistencial. */
export const CLASSES_PROTOCOLO = ['assistencial', 'nao-assistencial'] as const;
export type ClasseProtocolo = (typeof CLASSES_PROTOCOLO)[number];

/** Canal do contato. */
export const CANAIS_PROTOCOLO = ['telefone', 'presencial', 'eletronico', 'portal-prestador', 'ans'] as const;
export type CanalProtocolo = (typeof CANAIS_PROTOCOLO)[number];
export const ROTULOS_CANAL_PROTOCOLO: Readonly<Record<CanalProtocolo, string>> = {
  telefone: 'Telefone',
  presencial: 'Presencial',
  eletronico: 'Site, aplicativo ou e-mail',
  'portal-prestador': 'Portal do prestador',
  ans: 'ANS',
};

/** Quem fez o contato. */
export const SOLICITANTES_PROTOCOLO = ['beneficiario', 'representante', 'prestador', 'ans', 'outro'] as const;
export type SolicitanteProtocolo = (typeof SOLICITANTES_PROTOCOLO)[number];
export const ROTULOS_SOLICITANTE_PROTOCOLO: Readonly<Record<SolicitanteProtocolo, string>> = {
  beneficiario: 'O próprio beneficiário',
  representante: 'Representante do beneficiário',
  prestador: 'Prestador da rede',
  ans: 'ANS',
  outro: 'Outra pessoa (sem vínculo com a operadora)',
};

export const SITUACOES_PROTOCOLO_OPE = [
  'aberto',
  'em-analise',
  'respondido',
  'encerrado',
  'cancelado',
] as const;
export type SituacaoProtocoloOpe = (typeof SITUACOES_PROTOCOLO_OPE)[number];
export const SITUACOES_PROTOCOLO_OPE_EM_ABERTO: readonly SituacaoProtocoloOpe[] = ['aberto', 'em-analise'];
export const ROTULOS_SITUACAO_PROTOCOLO: Readonly<Record<SituacaoProtocoloOpe, string>> = {
  aberto: 'Aberto',
  'em-analise': 'Em análise',
  respondido: 'Respondido',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};

/** Conclusão da resposta. */
export const CONCLUSOES_PROTOCOLO = ['favoravel', 'parcial', 'desfavoravel', 'informativa'] as const;
export type ConclusaoProtocolo = (typeof CONCLUSOES_PROTOCOLO)[number];
export const ROTULOS_CONCLUSAO_PROTOCOLO: Readonly<Record<ConclusaoProtocolo, string>> = {
  favoravel: 'Favorável ao beneficiário',
  parcial: 'Favorável em parte',
  desfavoravel: 'Desfavorável ao beneficiário',
  informativa: 'Informação prestada',
};

/** Meio da resposta e da resposta por escrito. */
export const MEIOS_RESPOSTA_PROTOCOLO = [
  'telefone',
  'presencial',
  'email',
  'correspondencia',
  'portal',
] as const;
export type MeioRespostaProtocolo = (typeof MEIOS_RESPOSTA_PROTOCOLO)[number];
export const MEIOS_ESCRITOS_PROTOCOLO: readonly MeioRespostaProtocolo[] = [
  'email',
  'correspondencia',
  'portal',
];
export const ROTULOS_MEIO_RESPOSTA: Readonly<Record<MeioRespostaProtocolo, string>> = {
  telefone: 'Telefone',
  presencial: 'Presencial',
  email: 'E-mail',
  correspondencia: 'Correspondência',
  portal: 'Portal',
};

/** Tipo do prazo da resposta conclusiva. */
export const TIPOS_PRAZO_PROTOCOLO = [
  'imediato',
  'assistencial',
  'complexo',
  'nao-assistencial',
  'ouvidoria',
  'nip-assistencial',
  'nip-nao-assistencial',
] as const;
export type TipoPrazoProtocolo = (typeof TIPOS_PRAZO_PROTOCOLO)[number];

export const EVENTOS_PROTOCOLO = [
  'registro',
  'analise',
  'interacao',
  'prorrogacao',
  'resposta',
  'escrita-pedida',
  'escrita-enviada',
  'encerramento',
  'cancelamento',
  'reanalise',
] as const;
export type EventoProtocolo = (typeof EVENTOS_PROTOCOLO)[number];

/** Funções do portal que o credenciamento pode liberar (PFPORTALOPCAO; D-PORTAL-FUNCOES-568). */
export const FUNCOES_PORTAL_LIBERAVEIS = [1, 2, 3, 7] as const;
export type FuncaoPortalLiberavel = (typeof FUNCOES_PORTAL_LIBERAVEIS)[number];
export const FUNCAO_PORTAL = { solicitar: 1, cancelar: 2, consultar: 3, protocolo: 7 } as const;

export const SITUACOES_ACESSO_PORTAL = ['pendente', 'ativo', 'encerrado'] as const;
export type SituacaoAcessoPortal = (typeof SITUACOES_ACESSO_PORTAL)[number];

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────

const texto = (max: number, min: number, msg: string) =>
  textoCp1252(max)
    .overwrite((t) => t.trim())
    .pipe(z.string().min(min, msg));
const id = z.number().int().min(1);
const comVersao = { versao: z.number().int().min(1) };
const carteirinha = z
  .string()
  .trim()
  .regex(/^\d{16}$/, 'A carteirinha tem 16 dígitos.');

export const esquemaRegistrarProtocoloOpe = z
  .object({
    operadora: id,
    instancia: z.enum(INSTANCIAS_PROTOCOLO),
    natureza: z.enum(NATUREZAS_PROTOCOLO),
    canal: z.enum(CANAIS_PROTOCOLO),
    /** Origem do atendimento (SPORIGEM_ATEND), conferida no domínio do banco. */
    origem: z.number().int().min(1).max(32_767),
    solicitante: z.enum(SOLICITANTES_PROTOCOLO),
    /** Carteirinha do beneficiário (obrigatória, menos na informação pedida por quem não é beneficiário). */
    carteirinha: carteirinha.optional(),
    /** Nome de quem fez o contato quando não é o próprio beneficiário. */
    solicitanteNome: texto(120, 3, 'Informe o nome de quem fez o contato.').optional(),
    /** Pedido de autorização a que a demanda de cobertura se refere. */
    autorizacao: id.optional(),
    /** Protocolo de origem da reanálise pela ouvidoria. */
    origemProtocolo: id.optional(),
    /** Número da demanda da NIP na ANS. */
    numeroNip: z
      .string()
      .trim()
      .regex(/^\d{6,30}$/, 'O número da demanda da ANS tem só dígitos (6 a 30).')
      .optional(),
    urgente: z.boolean().default(false),
    altaComplexidade: z.boolean().default(false),
    assunto: texto(200, 5, 'Descreva o assunto (5 caracteres ou mais).'),
    relato: texto(2000, 10, 'Registre o relato do contato (10 caracteres ou mais).'),
    /** O beneficiário pediu a resposta por escrito já no contato. */
    escritaPedida: z.boolean().default(false),
  })
  .strict();
export type RegistrarProtocoloOpeEntrada = z.infer<typeof esquemaRegistrarProtocoloOpe>;

export const esquemaAnalisarProtocolo = z.object({ ...comVersao }).strict();
export type AnalisarProtocoloEntrada = z.infer<typeof esquemaAnalisarProtocolo>;

export const esquemaInteracaoProtocolo = z
  .object({ ...comVersao, texto: texto(1000, 5, 'Descreva o contato (5 caracteres ou mais).') })
  .strict();
export type InteracaoProtocoloEntrada = z.infer<typeof esquemaInteracaoProtocolo>;

export const esquemaProrrogarProtocolo = z
  .object({
    ...comVersao,
    /** Novo prazo (AAAA-MM-DD), até o limite em dias úteis da ouvidoria. */
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.'),
    motivo: texto(400, 10, 'Registre o motivo acordado com o beneficiário (10 caracteres ou mais).'),
  })
  .strict();
export type ProrrogarProtocoloEntrada = z.infer<typeof esquemaProrrogarProtocolo>;

export const esquemaResponderProtocolo = z
  .object({
    ...comVersao,
    conclusao: z.enum(CONCLUSOES_PROTOCOLO),
    resposta: texto(4000, 20, 'Escreva a resposta conclusiva (20 caracteres ou mais).'),
    fundamento: texto(400, 5, 'Informe a cláusula do contrato ou o dispositivo legal.').optional(),
    meio: z.enum(MEIOS_RESPOSTA_PROTOCOLO),
  })
  .strict();
export type ResponderProtocoloEntrada = z.infer<typeof esquemaResponderProtocolo>;

export const esquemaPedirEscritaProtocolo = z.object({ ...comVersao }).strict();

export const esquemaEnviarEscritaProtocolo = z
  .object({ ...comVersao, meio: z.enum(['email', 'correspondencia', 'portal']) })
  .strict();
export type EnviarEscritaProtocoloEntrada = z.infer<typeof esquemaEnviarEscritaProtocolo>;

export const esquemaEncerrarProtocolo = z.object({ ...comVersao }).strict();

export const esquemaCancelarProtocolo = z
  .object({ ...comVersao, motivo: texto(200, 10, 'Descreva o motivo (10 caracteres ou mais).') })
  .strict();
export type CancelarProtocoloEntrada = z.infer<typeof esquemaCancelarProtocolo>;

export const esquemaReanaliseProtocolo = z
  .object({
    ...comVersao,
    /** O beneficiário pede a reanálise por um dos canais dele (nunca o portal do prestador nem a ANS). */
    canal: z.enum(['telefone', 'presencial', 'eletronico']),
    origem: z.number().int().min(1).max(32_767),
    relato: texto(2000, 10, 'Registre o pedido de reanálise (10 caracteres ou mais).'),
    escritaPedida: z.boolean().default(false),
  })
  .strict();
export type ReanaliseProtocoloEntrada = z.infer<typeof esquemaReanaliseProtocolo>;

export const esquemaFiltroProtocolos = z.object({
  /** Protocolo (20 dígitos), carteirinha (16 dígitos), número da NIP ou trecho do nome do beneficiário. */
  busca: z.string().trim().min(1).max(60).optional(),
  situacao: z.enum(SITUACOES_PROTOCOLO_OPE).optional(),
  instancia: z.enum(INSTANCIAS_PROTOCOLO).optional(),
  natureza: z.enum(NATUREZAS_PROTOCOLO).optional(),
  /** Só os em aberto com o prazo vencido, ou com a resposta por escrito atrasada. */
  vencidos: z
    .enum(['sim'])
    .transform(() => true)
    .optional(),
  apos: z.coerce.number().int().min(1).optional(),
});
export type FiltroProtocolos = z.infer<typeof esquemaFiltroProtocolos>;

export const esquemaConsultaNumeroProtocolo = z.object({
  numero: z
    .string()
    .trim()
    .regex(/^\d{20}$/, 'O protocolo tem 20 dígitos.'),
});

// Contas do portal (credenciamento da operadora).
/** As funções liberadas (códigos de PFPORTALOPCAO; o servidor confere as liberáveis e o domínio do banco). */
const funcoes = z
  .array(z.number().int().min(1).max(32_767))
  .min(1, 'Libere ao menos uma função do portal.')
  .max(8);
const login = z
  .string()
  .trim()
  .toLowerCase()
  .max(100)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'O acesso é o e-mail do responsável no prestador.');

export const esquemaCriarAcessoPortal = z
  .object({
    operadora: id,
    prestador: id,
    login,
    nome: texto(120, 3, 'Informe o nome do responsável no prestador.'),
    funcoes,
    /** Tipo de atendimento (PFTPATEND), conferido no domínio do banco. */
    tipoAtendimento: z.number().int().min(1).max(32_767),
  })
  .strict();
export type CriarAcessoPortalEntrada = z.infer<typeof esquemaCriarAcessoPortal>;

export const esquemaAlterarAcessoPortal = z
  .object({ ...comVersao, funcoes, tipoAtendimento: z.number().int().min(1).max(32_767) })
  .strict();
export type AlterarAcessoPortalEntrada = z.infer<typeof esquemaAlterarAcessoPortal>;

export const esquemaReemitirAcessoPortal = z.object({ ...comVersao }).strict();

export const esquemaEncerrarAcessoPortal = z
  .object({ ...comVersao, motivo: texto(200, 10, 'Descreva o motivo (10 caracteres ou mais).') })
  .strict();
export type EncerrarAcessoPortalEntrada = z.infer<typeof esquemaEncerrarAcessoPortal>;

// Portal do prestador (sessão do portal).
/** A senha nova do portal do prestador (ativação e troca): 12+ caracteres com letras e números. */
const senhaNovaPortalPrestador = z
  .string()
  .min(12, 'A senha tem 12 caracteres ou mais.')
  .max(128)
  .regex(/[A-Za-z]/, 'A senha precisa de letras.')
  .regex(/\d/, 'A senha precisa de números.');
const codigoAutenticador = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'O código do aplicativo autenticador tem 6 dígitos.');

export const esquemaAtivarPortalPrestador = z
  .object({
    login,
    /** Código de ativação de uso único (12 caracteres, entregue pelo credenciamento). */
    codigo: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{12}$/, 'O código de ativação tem 12 letras e números.'),
    senha: senhaNovaPortalPrestador,
  })
  .strict();
export type AtivarPortalPrestadorEntrada = z.infer<typeof esquemaAtivarPortalPrestador>;

export const esquemaEntrarPortalPrestador = z
  .object({
    login,
    senha: z.string().min(1).max(128),
    codigo: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'O código do aplicativo autenticador tem 6 dígitos.'),
  })
  .strict();
export type EntrarPortalPrestadorEntrada = z.infer<typeof esquemaEntrarPortalPrestador>;

/** W0-10: o prestador troca a senha (confere a atual e o código do aplicativo; a nova é diferente da atual). */
export const esquemaTrocarSenhaPortalPrestador = z
  .object({
    senhaAtual: z.string().min(1).max(128),
    codigo: codigoAutenticador,
    senhaNova: senhaNovaPortalPrestador,
  })
  .strict()
  .refine((x) => x.senhaNova !== x.senhaAtual, {
    message: 'A senha nova tem de ser diferente da atual.',
    path: ['senhaNova'],
  });
export type TrocarSenhaPortalPrestadorEntrada = z.infer<typeof esquemaTrocarSenhaPortalPrestador>;

/** W0-10: o início da troca do autenticador confere a senha e o código do aplicativo atual. */
export const esquemaIniciarAutenticadorPortalPrestador = z
  .object({ senha: z.string().min(1).max(128), codigo: codigoAutenticador })
  .strict();
export type IniciarAutenticadorPortalPrestadorEntrada = z.infer<
  typeof esquemaIniciarAutenticadorPortalPrestador
>;

/** W0-10: a confirmação grava o novo segredo só com um código certo do aplicativo novo. */
export const esquemaConfirmarAutenticadorPortalPrestador = z.object({ codigo: codigoAutenticador }).strict();

/** O novo autenticador para cadastrar no aplicativo (sai uma vez; vale até `validoAte`, só nesta sessão). */
export const esquemaAutenticadorNovoPortalPrestador = z.object({
  otpauth: z.string(),
  validoAte: z.string(),
  mensagem: z.string(),
});
export type AutenticadorNovoPortalPrestador = z.infer<typeof esquemaAutenticadorNovoPortalPrestador>;

export const esquemaFiltroAutorizacoesPortal = z.object({
  busca: z.string().trim().min(1).max(60).optional(),
  apos: z.coerce.number().int().min(1).optional(),
});

// ── Respostas ─────────────────────────────────────────────────────────────────────────────────────

const esquemaOpcao = z.object({ codigo: z.number().int(), rotulo: z.string() });

export const esquemaApoioProtocolos = z.object({
  dominios: z.object({ origem: z.array(esquemaOpcao) }),
  operadoras: z.array(z.object({ id: z.number().int(), nome: z.string(), registroAns: z.string() })),
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  podeRegistrar: z.boolean(),
  hoje: z.string(),
  /** Os parâmetros que a tela mostra (dias úteis de cada prazo e as horas da resposta por escrito). */
  parametros: z.object({
    diasUteisAssistencial: z.number().int(),
    diasUteisComplexo: z.number().int(),
    diasUteisNaoAssistencial: z.number().int(),
    diasUteisOuvidoria: z.number().int(),
    diasUteisOuvidoriaMaximo: z.number().int(),
    diasUteisNipAssistencial: z.number().int(),
    diasUteisNipNaoAssistencial: z.number().int(),
    horasEscrita: z.number().int(),
  }),
});
export type ApoioProtocolos = z.infer<typeof esquemaApoioProtocolos>;

export const esquemaProtocoloOpeResumo = z.object({
  id: z.number().int(),
  protocolo: z.string(),
  instancia: z.enum(INSTANCIAS_PROTOCOLO),
  natureza: z.enum(NATUREZAS_PROTOCOLO),
  classe: z.enum(CLASSES_PROTOCOLO),
  canal: z.enum(CANAIS_PROTOCOLO),
  beneficiarioNome: z.string().nullable(),
  carteirinha: z.string().nullable(),
  assunto: z.string(),
  situacao: z.enum(SITUACOES_PROTOCOLO_OPE),
  abertoEm: z.string(),
  /** O prazo que vale (o prorrogado, se houver). */
  prazoEm: z.string(),
  vencido: z.boolean(),
  /** Resposta por escrito pedida e ainda não enviada. */
  escritaPendente: z.boolean(),
  escritaVencida: z.boolean(),
  versao: z.number().int(),
});
export type ProtocoloOpeResumo = z.infer<typeof esquemaProtocoloOpeResumo>;

export const esquemaProtocolos = z.object({
  itens: z.array(esquemaProtocoloOpeResumo),
  proxima: z.number().int().nullable(),
  totais: z.object({
    abertos: z.number().int(),
    emAnalise: z.number().int(),
    vencidos: z.number().int(),
    escritaPendente: z.number().int(),
    respondidosHoje: z.number().int(),
  }),
});
export type Protocolos = z.infer<typeof esquemaProtocolos>;

export const esquemaEventoProtocolo = z.object({
  id: z.number().int(),
  evento: z.enum(EVENTOS_PROTOCOLO),
  situacao: z.enum(SITUACOES_PROTOCOLO_OPE),
  texto: z.string().nullable(),
  em: z.string(),
  por: z.string(),
});
export type EventoProtocoloLido = z.infer<typeof esquemaEventoProtocolo>;

/** W0-10: a resposta do prestador, pelo portal, a uma interação da operadora (registro novo; o anexo, se houver). */
export const esquemaRespostaPrestadorProtocolo = z.object({
  id: z.number().int(),
  /** O evento 'interacao' da operadora respondido e o evento que a resposta gerou no histórico. */
  interacao: z.number().int(),
  evento: z.number().int(),
  texto: z.string(),
  anexo: z
    .object({ nome: z.string(), tipo: z.string(), tamanho: z.number().int(), sha256: z.string() })
    .nullable(),
  em: z.string(),
});
export type RespostaPrestadorProtocolo = z.infer<typeof esquemaRespostaPrestadorProtocolo>;

export const esquemaProtocoloDetalhe = esquemaProtocoloOpeResumo.extend({
  operadora: z.number().int(),
  origem: z.number().int(),
  origemRotulo: z.string(),
  solicitante: z.enum(SOLICITANTES_PROTOCOLO),
  solicitanteNome: z.string().nullable(),
  beneficiario: z.number().int().nullable(),
  prestador: z.number().int().nullable(),
  autorizacao: z.object({ id: z.number().int(), protocolo: z.string(), situacao: z.string() }).nullable(),
  origemProtocolo: z.object({ id: z.number().int(), protocolo: z.string() }).nullable(),
  reanalises: z.array(z.object({ id: z.number().int(), protocolo: z.string(), situacao: z.string() })),
  numeroNip: z.string().nullable(),
  urgente: z.boolean(),
  altaComplexidade: z.boolean(),
  relato: z.string(),
  prazoTipo: z.enum(TIPOS_PRAZO_PROTOCOLO),
  prazoOriginalEm: z.string(),
  prorrogadoAte: z.string().nullable(),
  prorrogacaoMotivo: z.string().nullable(),
  /** Até quando a ouvidoria pode prorrogar (null fora da ouvidoria ou já prorrogado). */
  prorrogavelAte: z.string().nullable(),
  conclusao: z.enum(CONCLUSOES_PROTOCOLO).nullable(),
  resposta: z.string().nullable(),
  fundamento: z.string().nullable(),
  meio: z.enum(MEIOS_RESPOSTA_PROTOCOLO).nullable(),
  respondidoEm: z.string().nullable(),
  respondidoPor: z.string().nullable(),
  escritaPedida: z.boolean(),
  escritaPedidaEm: z.string().nullable(),
  escritaPrazoEm: z.string().nullable(),
  escritaEnviadaEm: z.string().nullable(),
  escritaMeio: z.enum(MEIOS_RESPOSTA_PROTOCOLO).nullable(),
  encerradoEm: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  eventos: z.array(esquemaEventoProtocolo),
  /** As ações que valem agora (a tela só mostra estas). */
  acoes: z.array(
    z.enum([
      'analisar',
      'interagir',
      'prorrogar',
      'responder',
      'pedirEscrita',
      'enviarEscrita',
      'encerrar',
      'cancelar',
      'reanalise',
    ]),
  ),
  /** O texto da resposta por escrito (o protocolo, a data, a conclusão, o fundamento e a reanálise). */
  textoEscrito: z.string().nullable(),
  /** W0-10: as respostas do prestador pelo portal (o anexo se baixa pela rota `anexoResposta`). */
  respostasPrestador: z.array(esquemaRespostaPrestadorProtocolo).default([]),
});
export type ProtocoloDetalhe = z.infer<typeof esquemaProtocoloDetalhe>;
export type AcaoProtocolo = ProtocoloDetalhe['acoes'][number];

export const esquemaConsultaProtocolo = z.object({
  tipo: z.enum(['atendimento', 'autorizacao']),
  id: z.number().int(),
  protocolo: z.string(),
  situacao: z.string(),
  situacaoRotulo: z.string(),
  abertoEm: z.string(),
  prazoEm: z.string(),
  vencido: z.boolean(),
});
export type ConsultaProtocolo = z.infer<typeof esquemaConsultaProtocolo>;

/**
 * W0-10: o protocolo no portal do prestador: a situação e, no de atendimento, a versão e as interações da operadora,
 * cada uma com a resposta do prestador (se já respondida). A de autorização não tem interações (versão nula).
 */
export const esquemaInteracaoProtocoloPortal = z.object({
  evento: z.number().int(),
  em: z.string(),
  texto: z.string().nullable(),
  /** As respostas do prestador a esta interação, em ordem (cada uma é registro novo; uma nova não apaga a anterior). */
  respostas: z.array(esquemaRespostaPrestadorProtocolo),
});
export const esquemaProtocoloPortal = esquemaConsultaProtocolo.extend({
  versao: z.number().int().nullable(),
  /** Pode responder agora: protocolo de atendimento aberto, em análise ou respondido. */
  respondivel: z.boolean(),
  interacoes: z.array(esquemaInteracaoProtocoloPortal),
});
export type ProtocoloPortal = z.infer<typeof esquemaProtocoloPortal>;

export interface ResultadoProtocoloOpe {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoProtocoloOpe;
  readonly protocolo: string;
  readonly mensagem: string;
}

export const esquemaAcessoPortal = z.object({
  id: z.number().int(),
  operadora: z.number().int(),
  prestador: z.number().int(),
  prestadorNome: z.string(),
  login: z.string(),
  nome: z.string(),
  funcoes: z.array(z.number().int()),
  tipoAtendimento: z.number().int(),
  situacao: z.enum(SITUACOES_ACESSO_PORTAL),
  ativacaoValidaAte: z.string().nullable(),
  bloqueadoAte: z.string().nullable(),
  ultimoAcessoEm: z.string().nullable(),
  motivoEncerramento: z.string().nullable(),
  versao: z.number().int(),
});
export type AcessoPortalPrestador = z.infer<typeof esquemaAcessoPortal>;

export const esquemaAcessosPortal = z.object({
  itens: z.array(esquemaAcessoPortal),
  ligada: z.boolean(),
  motivo: z.string().nullable(),
  podeEditar: z.boolean(),
  /** Funções do portal (PFPORTALOPCAO) e tipos de atendimento (PFTPATEND) do banco; `liberavel` marca as liberáveis. */
  funcoes: z.array(esquemaOpcao.extend({ liberavel: z.boolean() })),
  tiposAtendimento: z.array(esquemaOpcao),
  prestadores: z.array(z.object({ id: z.number().int(), nome: z.string() })),
  operadoras: z.array(z.object({ id: z.number().int(), nome: z.string(), registroAns: z.string() })),
});
export type AcessosPortalPrestador = z.infer<typeof esquemaAcessosPortal>;

export interface ResultadoAcessoPortal {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly situacao: SituacaoAcessoPortal;
  /** O código de ativação, mostrado UMA vez (só na criação e na reemissão). */
  readonly codigoAtivacao: string | null;
  readonly ativacaoValidaAte: string | null;
  readonly mensagem: string;
}

export const esquemaSessaoPortalPrestador = z.object({
  nome: z.string(),
  prestador: z.number().int(),
  prestadorNome: z.string(),
  operadora: z.number().int(),
  funcoes: z.array(z.number().int()),
  expiraEm: z.string(),
});
export type SessaoPortalPrestador = z.infer<typeof esquemaSessaoPortalPrestador>;

export const esquemaAutorizacaoPortal = z.object({
  id: z.number().int(),
  protocolo: z.string(),
  carteirinha: z.string(),
  /** Só as iniciais do beneficiário (o prestador já tem o cadastro do paciente dele). */
  beneficiarioIniciais: z.string(),
  tipoGuia: z.number().int(),
  situacao: z.string(),
  situacaoRotulo: z.string(),
  solicitadaEm: z.string(),
  prazoEm: z.string(),
  senha: z.string().nullable(),
  senhaValidade: z.string().nullable(),
  versao: z.number().int(),
});
export type AutorizacaoPortal = z.infer<typeof esquemaAutorizacaoPortal>;

/** O apoio do pedido pelo portal: os tipos de guia do domínio e a data do servidor (nada da rede nem da operadora). */
export const esquemaApoioPortalPrestador = z.object({
  tiposGuia: z.array(esquemaOpcao),
  hoje: z.string(),
});
export type ApoioPortalPrestador = z.infer<typeof esquemaApoioPortalPrestador>;

// ── W0-10: a resposta do prestador ao complemento pedido pelo auditor, pelo portal, com anexos ────────

/** Quantos arquivos uma resposta leva e o teto de cada um (PDF, PNG ou JPEG, conferidos pelo conteúdo no servidor). */
export const ANEXOS_COMPLEMENTO_PORTAL_MAX = 5;
export const ANEXO_PORTAL_MAX_BYTES = 2 * 1024 * 1024;
/**
 * O corpo com anexos vai com este tipo, que tem teto próprio (os 5 anexos em base64 e o texto); o JSON comum segue com o
 * teto padrão do servidor.
 */
export const TIPO_CORPO_ANEXOS_PORTAL = 'application/vnd.sgh.anexos+json' as const;
export const LIMITE_CORPO_ANEXOS_PORTAL = 15 * 1024 * 1024;

const esquemaAnexoPortal = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome do arquivo.').max(200),
    /** O conteúdo em base64 (o tipo é conferido pelos primeiros bytes no servidor, nunca pelo nome). */
    conteudo: z
      .string()
      .min(4, 'O arquivo anexado está vazio.')
      .max(
        Math.ceil(ANEXO_PORTAL_MAX_BYTES / 3) * 4,
        'O anexo passa de 2 MB. Reduza o arquivo e envie de novo.',
      )
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'O anexo não veio em base64.'),
  })
  .strict();

export const esquemaResponderComplementoPortal = z
  .object({
    ...comVersao,
    resposta: texto(1000, 3, 'Escreva a resposta (ao menos 3 caracteres).'),
    anexos: z
      .array(esquemaAnexoPortal)
      .max(
        ANEXOS_COMPLEMENTO_PORTAL_MAX,
        `Envie no máximo ${ANEXOS_COMPLEMENTO_PORTAL_MAX} arquivos por resposta.`,
      )
      .default([]),
  })
  .strict();
export type ResponderComplementoPortalEntrada = z.infer<typeof esquemaResponderComplementoPortal>;

/** W0-10: a resposta do prestador a uma interação da operadora no protocolo, com um anexo opcional (mesmo corpo). */
export const esquemaResponderInteracaoPortal = z
  .object({
    ...comVersao,
    texto: texto(1000, 3, 'Escreva a resposta (ao menos 3 caracteres).'),
    anexo: esquemaAnexoPortal.nullable().default(null),
  })
  .strict();
export type ResponderInteracaoPortalEntrada = z.infer<typeof esquemaResponderInteracaoPortal>;

/**
 * W0-10: as naturezas que o prestador abre pelo portal (a demanda dele à operadora; reembolso, cancelamento do contrato e
 * reclamação assistencial são do beneficiário).
 */
export const NATUREZAS_PROTOCOLO_PORTAL = [
  'informacao',
  'cobertura',
  'cadastro',
  'financeiro',
  'reclamacao-administrativa',
] as const satisfies readonly NaturezaProtocolo[];

/**
 * W0-10: o prestador abre, pelo portal, um protocolo de atendimento (canal do portal, solicitante "prestador"; a operadora,
 * o prestador e quem fez o contato saem da conta, nunca da tela). A carteirinha do beneficiário de quem se trata é
 * obrigatória (o protocolo de atendimento da RN 395 é sempre de um beneficiário; só "outro" registra sem ela).
 */
export const esquemaAbrirProtocoloPortal = z
  .object({
    natureza: z.enum(NATUREZAS_PROTOCOLO_PORTAL),
    carteirinha,
    assunto: texto(200, 5, 'Descreva o assunto (5 caracteres ou mais).'),
    relato: texto(2000, 10, 'Registre o relato (10 caracteres ou mais).'),
  })
  .strict();
export type AbrirProtocoloPortalEntrada = z.infer<typeof esquemaAbrirProtocoloPortal>;

export interface ResultadoProtocoloPortalAberto {
  readonly ok: true;
  readonly id: number;
  readonly protocolo: string;
  readonly prazoEm: string;
  readonly mensagem: string;
}

export interface ResultadoInteracaoPortal {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly resposta: number;
  readonly evento: number;
  readonly mensagem: string;
}

export const esquemaAnexoComplementoPortal = z.object({
  id: z.number().int(),
  nome: z.string(),
  tipo: z.string(),
  tamanho: z.number().int(),
  sha256: z.string(),
});

/** O complemento no detalhe do pedido: o que o auditor pediu e as respostas dadas (texto e anexos), em ordem. */
export const esquemaComplementoPortal = z.object({
  pedido: z.string().nullable(),
  /** O pedido está pendente de complemento: a tela oferece "Responder". */
  aguardando: z.boolean(),
  respostas: z.array(
    z.object({
      evento: z.number().int(),
      em: z.string(),
      texto: z.string().nullable(),
      anexos: z.array(esquemaAnexoComplementoPortal),
    }),
  ),
});
export type ComplementoPortal = z.infer<typeof esquemaComplementoPortal>;

export interface ResultadoComplementoPortal {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly evento: number;
  readonly anexos: number;
  readonly mensagem: string;
}

// ── Rotas, chaves e textos ──────────────────────────────────────────────────────────────────────

/** Rotas internas da F7 (D-PERM-56: `operadora.protocolo.ler` / `.registrar`; contas do portal pelo credenciamento). */
export const ROTAS_OPERADORA_F7 = {
  apoio: { caminho: 'operadora/protocolos/apoio', permissao: 'operadora.protocolo.ler' },
  lista: { caminho: 'operadora/protocolos', permissao: 'operadora.protocolo.ler' },
  consulta: { caminho: 'operadora/protocolos/consulta', permissao: 'operadora.protocolo.ler' },
  ficha: { caminho: 'operadora/protocolos/:id', permissao: 'operadora.protocolo.ler' },
  registrar: { caminho: 'operadora/protocolos', permissao: 'operadora.protocolo.registrar' },
  analisar: { caminho: 'operadora/protocolos/:id/analise', permissao: 'operadora.protocolo.registrar' },
  interagir: { caminho: 'operadora/protocolos/:id/interacao', permissao: 'operadora.protocolo.registrar' },
  prorrogar: { caminho: 'operadora/protocolos/:id/prorrogacao', permissao: 'operadora.protocolo.registrar' },
  responder: { caminho: 'operadora/protocolos/:id/resposta', permissao: 'operadora.protocolo.registrar' },
  pedirEscrita: { caminho: 'operadora/protocolos/:id/escrita', permissao: 'operadora.protocolo.registrar' },
  enviarEscrita: {
    caminho: 'operadora/protocolos/:id/escrita/envio',
    permissao: 'operadora.protocolo.registrar',
  },
  encerrar: { caminho: 'operadora/protocolos/:id/encerrar', permissao: 'operadora.protocolo.registrar' },
  cancelar: { caminho: 'operadora/protocolos/:id/cancelar', permissao: 'operadora.protocolo.registrar' },
  reanalise: { caminho: 'operadora/protocolos/:id/reanalise', permissao: 'operadora.protocolo.registrar' },
  acessos: { caminho: 'operadora/portal/acessos', permissao: 'operadora.prestador.ler' },
  criarAcesso: { caminho: 'operadora/portal/acessos', permissao: 'operadora.prestador.editar' },
  alterarAcesso: { caminho: 'operadora/portal/acessos/:id', permissao: 'operadora.prestador.editar' },
  reemitirAcesso: {
    caminho: 'operadora/portal/acessos/:id/reemissao',
    permissao: 'operadora.prestador.editar',
  },
  encerrarAcesso: {
    caminho: 'operadora/portal/acessos/:id/encerrar',
    permissao: 'operadora.prestador.editar',
  },
  /** W0-10: o anexo de uma resposta do prestador no protocolo (download na ficha). */
  anexoResposta: {
    caminho: 'operadora/protocolos/:id/respostas/:resposta/anexo',
    permissao: 'operadora.protocolo.ler',
  },
} as const;

/** Rotas do portal do prestador (sessão do portal; `operadora.portal.acessar` é a da sessão, nunca de usuário interno). */
export const ROTAS_PORTAL_PRESTADOR = {
  ativar: 'portal-prestador/:hospital/ativacao',
  entrar: 'portal-prestador/:hospital/entrada',
  sair: 'portal-prestador/saida',
  sessao: 'portal-prestador/sessao',
  apoio: 'portal-prestador/apoio',
  procedimentos: 'portal-prestador/procedimentos',
  autorizacoes: 'portal-prestador/autorizacoes',
  autorizacao: 'portal-prestador/autorizacoes/:id',
  cancelar: 'portal-prestador/autorizacoes/:id/cancelar',
  protocolo: 'portal-prestador/protocolos/:numero',
  /** W0-10: a troca da senha e do autenticador pelo próprio prestador. */
  senha: 'portal-prestador/conta/senha',
  autenticador: 'portal-prestador/conta/autenticador',
  autenticadorConfirmar: 'portal-prestador/conta/autenticador/confirmacao',
  /** W0-10: a resposta ao complemento pedido pelo auditor (com anexos) e o download de um anexo dela. */
  complemento: 'portal-prestador/autorizacoes/:id/complemento',
  anexo: 'portal-prestador/autorizacoes/:id/anexos/:anexo',
  /** W0-10: a resposta a uma interação da operadora no protocolo (com um anexo) e o download do anexo dela. */
  /** W0-10: o prestador abre um protocolo de atendimento (função 7). */
  protocolos: 'portal-prestador/protocolos',
  interacaoResposta: 'portal-prestador/protocolos/:id/interacoes/:evento/resposta',
  anexoProtocolo: 'portal-prestador/protocolos/:id/respostas/:resposta/anexo',
  /** W0-10 (M7): a consulta de elegibilidade (POST registra a consulta) e as últimas consultas do prestador. */
  elegibilidade: 'portal-prestador/elegibilidade',
  /**
   * W0-10 (M8): o envio do lote XML TISS (POST, o mesmo corpo do recebimento interno), os lotes do prestador (GET) e o
   * demonstrativo de análise de um lote dele (o de pagamento logo abaixo).
   */
  contas: 'portal-prestador/contas',
  contaDemonstrativo: 'portal-prestador/contas/:id/demonstrativo',
  /** W0-10 (M8): o demonstrativo de pagamento de um lote quitado do prestador. */
  contaDemonstrativoPagamento: 'portal-prestador/contas/:id/demonstrativo-pagamento',
  /** W0-10 (M8): as glosas de um lote do prestador (GET) e o recurso de glosa por item de uma guia (POST). */
  contaGlosas: 'portal-prestador/contas/:id/glosas',
  contaRecursos: 'portal-prestador/contas/:id/recursos',
} as const;

export const COOKIE_PORTAL_PRESTADOR = '__Host-sgh_portal_prestador' as const;
export const COOKIE_PORTAL_PRESTADOR_DEV = 'sgh_portal_prestador' as const;
export const COOKIE_CSRF_PORTAL_PRESTADOR = 'sgh_portal_prestador_csrf' as const;
export const CABECALHO_CSRF_PORTAL_PRESTADOR = 'x-csrf-portal-prestador' as const;

/** Chaves de liberação da fatia (CHAVES_FATIA_OPERADORA, recursos `atendimento` e `portalPrestador`). */
export const CHAVE_OPERADORA_ATENDIMENTO = 'operadora.atendimento' as const;
export const CHAVE_OPERADORA_PORTAL_PRESTADOR = 'operadora.portalPrestador' as const;

/** W0-10: os textos da troca da senha e do autenticador do portal do prestador (API e tela). */
export const MENSAGENS_TROCA_CREDENCIAL: Readonly<Record<string, string>> = {
  'credencial-nao-confere':
    'A senha ou o código do aplicativo não confere. Depois de várias tentativas erradas, o acesso fica bloqueado por alguns minutos.',
  'acesso-bloqueado':
    'O acesso está bloqueado por alguns minutos depois de várias tentativas erradas. Tente mais tarde.',
  'senha-trocada':
    'Senha trocada. Use a senha nova na próxima entrada; as outras sessões abertas foram encerradas.',
  'autenticador-novo':
    'Cadastre o código no aplicativo autenticador novo e digite o código que ele mostrar. Até a confirmação, vale o aplicativo atual.',
  'autenticador-sem-pedido': 'A troca do aplicativo não foi iniciada nesta sessão ou venceu. Comece de novo.',
  'codigo-novo-nao-confere':
    'O código do aplicativo novo não confere. Confira a hora do celular e tente de novo.',
  'autenticador-trocado':
    'Aplicativo autenticador trocado. Use o código do aplicativo novo na próxima entrada; as outras sessões abertas foram encerradas.',
};

/** Textos das recusas: o mesmo texto na API, no portal e na tela. */
export const MENSAGENS_ATENDIMENTO: Readonly<Record<string, string>> = {
  'operadora-inexistente': 'A operadora não está cadastrada neste estabelecimento.',
  'operadora-inativa': 'A operadora está inativa.',
  'origem-inexistente': 'A origem do atendimento não está no domínio do estabelecimento.',
  'carteirinha-obrigatoria': 'Informe a carteirinha do beneficiário.',
  'beneficiario-inexistente': 'Nenhum beneficiário da operadora com esta carteirinha.',
  'beneficiario-de-outra-operadora': 'O beneficiário é de outra operadora.',
  'solicitante-nome-obrigatorio': 'Informe o nome de quem fez o contato (não é o próprio beneficiário).',
  'sem-beneficiario-so-informacao':
    'Sem carteirinha, só a informação pedida por quem não é beneficiário (ex.: quem quer contratar).',
  'canal-da-ans': 'A NIP chega pela ANS: o canal é "ANS" e quem fez o contato é a ANS.',
  'ans-so-na-nip': 'O canal "ANS" é só da notificação da ANS (NIP).',
  'nip-sem-numero': 'Informe o número da demanda da ANS.',
  'numero-nip-so-na-nip': 'O número da demanda da ANS é só da NIP.',
  'portal-so-prestador': 'O canal do portal do prestador é só para o pedido do prestador da rede.',
  'urgente-so-assistencial':
    'Urgência só na demanda assistencial (cobertura, reembolso ou reclamação à saúde).',
  'complexidade-so-cobertura': 'Alta complexidade só no pedido de cobertura.',
  'autorizacao-so-cobertura': 'A ligação com o pedido de autorização é só na demanda de cobertura.',
  'autorizacao-inexistente': 'O pedido de autorização não existe nesta operadora.',
  'autorizacao-de-outro-beneficiario': 'O pedido de autorização é de outro beneficiário.',
  'origem-so-ouvidoria': 'O protocolo de origem só vale na ouvidoria (reanálise).',
  'origem-protocolo-inexistente': 'O protocolo de origem não existe nesta operadora.',
  'origem-protocolo-sem-resposta': 'A reanálise é de um protocolo já respondido.',
  'origem-protocolo-de-outro-beneficiario': 'O protocolo de origem é de outro beneficiário.',
  'reanalise-ja-aberta': 'Já há reanálise em aberto para este protocolo.',
  'reanalise-da-ouvidoria': 'A reanálise é pedida de uma resposta do atendimento.',
  'situacao-nao-permite': 'Esta ação não vale na situação atual do protocolo.',
  'prorrogacao-so-ouvidoria': 'Só a ouvidoria prorroga o prazo, uma vez, com o acordo do beneficiário.',
  'prorrogacao-ja-feita': 'O prazo desta demanda já foi prorrogado uma vez.',
  'prorrogacao-antes-do-prazo': 'O novo prazo tem de ser depois do atual.',
  'prorrogacao-acima-do-limite': 'O novo prazo passa do limite da ouvidoria em dias úteis.',
  'fundamento-obrigatorio':
    'Na resposta desfavorável ou parcial, informe a cláusula do contrato ou o dispositivo legal.',
  'informativa-so-nao-assistencial':
    'A demanda assistencial tem resposta conclusiva (favorável, parcial ou desfavorável).',
  'escrita-ja-pedida': 'A resposta por escrito já foi pedida.',
  'escrita-nao-pedida': 'O beneficiário não pediu a resposta por escrito.',
  'escrita-antes-da-resposta': 'A resposta por escrito sai depois da resposta conclusiva.',
  'escrita-pendente': 'Envie a resposta por escrito pedida antes de encerrar.',
  'protocolo-desatualizado':
    'O protocolo mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
  'protocolo-em-edicao':
    'Outra pessoa está gravando este protocolo agora. Abra de novo e confira antes de gravar.',
  'numero-em-uso': 'O número gerado já existe: tente de novo.',
  'protocolo-inexistente': 'Nenhum protocolo com este número.',
  // Contas do portal.
  'prestador-inexistente': 'O prestador não está na rede da operadora.',
  'prestador-inativo': 'O prestador não está ativo na rede da operadora.',
  'funcao-nao-liberavel': 'Há função do portal que não pode ser liberada ao prestador.',
  'funcao-inexistente': 'Há função do portal que não está no domínio do estabelecimento.',
  'cancelar-sem-solicitar': 'Cancelar o pedido exige a função de solicitar autorização.',
  'tipo-atendimento-inexistente': 'O tipo de atendimento não está no domínio do estabelecimento.',
  'login-em-uso': 'Este e-mail já tem acesso ao portal neste estabelecimento.',
  'acesso-inexistente': 'O acesso ao portal não existe.',
  'acesso-encerrado': 'O acesso ao portal está encerrado.',
  'acesso-desatualizado':
    'O acesso mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira.',
  // Portal.
  'ativacao-invalida': 'Código de ativação inválido ou vencido. Peça outro ao credenciamento da operadora.',
  'funcao-nao-liberada': 'Esta função do portal não está liberada para o seu acesso.',
  'prestador-descredenciado':
    'O credenciamento deste prestador na operadora está encerrado: o portal não está mais disponível.',
  'autorizacao-de-outro-prestador': 'O pedido não é deste prestador.',
};

/** Os 20 dígitos do protocolo agrupados para leitura (registro, data e sequência). */
export const protocoloLegivel = (p: string): string =>
  /^\d{20}$/.test(p) ? `${p.slice(0, 6)} ${p.slice(6, 14)} ${p.slice(14)}` : p;

// ── W0-10 (M7): a elegibilidade consultada pelo prestador no portal ─────────────────────────────

/** A entrada da consulta: a carteirinha e a data do atendimento (padrão: hoje). */
export const esquemaConsultarElegibilidadePortal = esquemaFiltroElegibilidade;
export type ConsultarElegibilidadePortalEntrada = z.infer<typeof esquemaConsultarElegibilidadePortal>;

/** Os atendimentos cuja cobertura a segmentação do plano diz (Lei 9.656/1998, art. 12). */
export const ATENDIMENTOS_COBERTURA = ['consulta', 'sadt', 'internacao', 'parto'] as const;
export type AtendimentoCobertura = (typeof ATENDIMENTOS_COBERTURA)[number];
export const ROTULOS_ATENDIMENTO_COBERTURA: Readonly<Record<AtendimentoCobertura, string>> = {
  consulta: 'Consulta',
  sadt: 'Exames e terapias (SP/SADT)',
  internacao: 'Internação',
  parto: 'Internação obstétrica (parto)',
};
export const COBERTURAS_ELEGIBILIDADE = ['cobre', 'nao-cobre', 'conferir'] as const;

/** O resultado no portal: a elegibilidade da operadora com a validade da carteirinha, a cobertura e o registro. */
export const esquemaElegibilidadePortal = esquemaElegibilidade.extend({
  /** A validade da via mais recente da carteirinha (null: nenhuma via emitida). */
  validadeCarteirinha: z.string().nullable(),
  carteirinhaVencida: z.boolean(),
  cobertura: z.array(
    z.object({ atendimento: z.enum(ATENDIMENTOS_COBERTURA), cobertura: z.enum(COBERTURAS_ELEGIBILIDADE) }),
  ),
  /** O número do registro da consulta (SGH_OPE_ELEG_CONSULTA); null só na sessão sintética sem banco. */
  registro: z.number().int().nullable(),
});
export type ElegibilidadePortal = z.infer<typeof esquemaElegibilidadePortal>;

/** As últimas consultas de elegibilidade do prestador (sem nome do beneficiário). */
export const esquemaConsultaElegibilidadePortal = z.object({
  id: z.number().int(),
  carteirinha: z.string(),
  data: z.string(),
  elegivel: z.boolean(),
  motivos: z.array(z.enum(MOTIVOS_INELEGIBILIDADE)),
  em: z.string(),
});
export type ConsultaElegibilidadePortal = z.infer<typeof esquemaConsultaElegibilidadePortal>;
export const esquemaConsultasElegibilidadePortal = z.object({
  itens: z.array(esquemaConsultaElegibilidadePortal),
});
export type ConsultasElegibilidadePortal = z.infer<typeof esquemaConsultasElegibilidadePortal>;
