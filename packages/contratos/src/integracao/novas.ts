// Integrações novas (M34; ficha, seções 6 a 8, regras 7 a 16; cap-12 §12.3): parceiros (cliente de integração,
// escopos, segredo só como resumo, finalidade e base legal), mensagens de saída (outbox → filas → parceiro, com
// tentativas e fila de mortos), entrada idempotente pela chave do parceiro, o monitor com a saúde das integrações do
// legado que seguem sozinhas pelos gatilhos, e o retorno do laboratório de apoio conferido pelo responsável técnico.
// Nenhum conteúdo de mensagem, nome, documento ou texto clínico nestes contratos: só identificadores, contagens e
// resumos SHA-256 (cap-14 §14.2.8).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';

export const TIPOS_PARCEIRO = ['hl7', 'fhir', 'apoio', 'api', 'arquivo'] as const;
export type TipoParceiro = (typeof TIPOS_PARCEIRO)[number];

export const ROTULO_TIPO_PARCEIRO: Readonly<Record<TipoParceiro, string>> = {
  hl7: 'HL7 v2 (motor de integração)',
  fhir: 'FHIR R4',
  apoio: 'Laboratório de apoio',
  api: 'API do parceiro',
  arquivo: 'Arquivo agendado',
};

/** Bases legais (LGPD, art. 7º e 11): a do tratamento de dado de saúde vai em tutela-da-saude ou obrigacao-legal. */
export const BASES_LEGAIS = [
  'tutela-da-saude',
  'obrigacao-legal',
  'politicas-publicas',
  'execucao-de-contrato',
  'exercicio-de-direitos',
  'consentimento',
] as const;
export type BaseLegal = (typeof BASES_LEGAIS)[number];

/** Eventos da outbox que uma integração nova pode receber (nunca os que um gatilho do legado já envia). */
export const EVENTOS_INTEGRACAO = [
  'fato.exame.apoio',
  'fato.resultado.liberado',
  'fato.vacina.aplicada',
  // W0-03 (M6): as correções do registro de vacina à RNDS (o registro local nunca muda): a substituição depois da
  // retificação e o cancelamento depois do estorno.
  'fato.vacina.substituida',
  'fato.vacina.cancelada',
  // M47 (etapa 3): o item da lista de trabalho DICOM ao PACS (o número de acesso é a chave de idempotência no destino).
  'imagem.mwl',
  'integracao.teste',
] as const;
export type EventoIntegracao = (typeof EVENTOS_INTEGRACAO)[number];

/**
 * O que os gatilhos do legado já enviam sozinhos (regra 7: a outbox nunca repete): a fila HL7 de admissão, alta e
 * atualização (ADT A03, A04 e A08), a fila do BI e os bancos externos. Uma integração nova que pedisse um desses
 * eventos duplicaria o envio.
 */
export const EVENTOS_DOS_GATILHOS = [
  'adt.admissao',
  'adt.alta',
  'adt.atualizacao',
  'bi.exclusao',
  'banco-externo',
] as const;

export const ESCOPOS_PARCEIRO = [
  'resultado.ler',
  'resultado.enviar',
  'pedido.receber',
  'paciente.identificar',
  'vacina.enviar',
  // M47 (etapa 3): o PACS ou a modalidade devolve o status do exame (MPPS) e o UID do estudo.
  'estudo.status',
] as const;

const CODIGO = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const esquemaNovoParceiro = z
  .object({
    codigo: z.string().regex(CODIGO, 'Código: letras minúsculas, números e hífen (3 a 40).'),
    nome: textoCp1252(80).pipe(z.string().trim().min(3, 'Nome do parceiro: 3 caracteres ou mais.')),
    tipo: z.enum(TIPOS_PARCEIRO),
    canal: z.string().max(60).nullable(),
    escopos: z.array(z.enum(ESCOPOS_PARCEIRO)).max(ESCOPOS_PARCEIRO.length),
    eventos: z.array(z.enum(EVENTOS_INTEGRACAO)).max(EVENTOS_INTEGRACAO.length),
    limiteTentativas: z.number().int().min(1).max(20),
    finalidade: textoCp1252(300).pipe(z.string().trim().min(10, 'Diga a finalidade do tratamento.')),
    baseLegal: z.enum(BASES_LEGAIS),
  })
  .strict();
export type NovoParceiro = z.infer<typeof esquemaNovoParceiro>;

export const esquemaAlteracaoParceiro = z
  .object({
    nome: textoCp1252(80).pipe(z.string().trim().min(3)),
    canal: z.string().max(60).nullable(),
    escopos: z.array(z.enum(ESCOPOS_PARCEIRO)).max(ESCOPOS_PARCEIRO.length),
    eventos: z.array(z.enum(EVENTOS_INTEGRACAO)).max(EVENTOS_INTEGRACAO.length),
    limiteTentativas: z.number().int().min(1).max(20),
    finalidade: textoCp1252(300).pipe(z.string().trim().min(10)),
    baseLegal: z.enum(BASES_LEGAIS),
    ativo: z.boolean(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(5, 'Escreva o motivo da mudança.')),
  })
  .strict();
export type AlteracaoParceiro = z.infer<typeof esquemaAlteracaoParceiro>;

export const esquemaParceiroLido = z.object({
  id: z.string(),
  codigo: z.string(),
  nome: z.string(),
  tipo: z.enum(TIPOS_PARCEIRO),
  canal: z.string().nullable(),
  clienteId: z.string().nullable(),
  temSegredo: z.boolean(),
  escopos: z.array(z.string()),
  eventos: z.array(z.string()),
  limiteTentativas: z.number().int(),
  finalidade: z.string(),
  baseLegal: z.enum(BASES_LEGAIS),
  ativo: z.boolean(),
  criadoPor: z.string(),
  alteradoEm: z.string().nullable(),
});
export type ParceiroLido = z.infer<typeof esquemaParceiroLido>;

/** O segredo do cliente de integração sai UMA vez, na criação ou na troca (só o resumo fica no banco). */
export const esquemaCredencialEmitida = z.object({
  clienteId: z.string(),
  segredo: z.string(),
});
export type CredencialEmitida = z.infer<typeof esquemaCredencialEmitida>;

// ── Mensagens de saída e fila de mortos (regras 8 a 10) ────────────────────────────────────────────────

export const SITUACOES_ENVIO = ['pendente', 'enviado', 'morto', 'descartado'] as const;
export type SituacaoEnvio = (typeof SITUACOES_ENVIO)[number];

export const TRATAMENTOS_MORTO = ['reprocessar', 'corrigir', 'descartar'] as const;
export type TratamentoMorto = (typeof TRATAMENTOS_MORTO)[number];

export const esquemaEnvioLido = z.object({
  id: z.string(),
  evento: z.string(),
  tipoEvento: z.string(),
  parceiro: z.string(),
  chaveOrdem: z.string(),
  objeto: z.string().nullable(),
  situacao: z.enum(SITUACOES_ENVIO),
  tentativas: z.number().int(),
  proximaTentativaEm: z.string().nullable(),
  enviadoEm: z.string().nullable(),
  recibo: z.string().nullable(),
  resposta: z.string().nullable(),
  resumoConteudo: z.string().nullable(),
  mortoEm: z.string().nullable(),
  /** Minutos na fila de mortos sem tratamento (alerta acima de 4 h; regra 10). */
  minutosMorto: z.number().int().nullable(),
  tratamento: z.enum(TRATAMENTOS_MORTO).nullable(),
  tratadoPor: z.string().nullable(),
  motivoTratamento: z.string().nullable(),
  criadoEm: z.string(),
});
export type EnvioLido = z.infer<typeof esquemaEnvioLido>;

export const esquemaTratarMorto = z
  .object({
    acao: z.enum(TRATAMENTOS_MORTO),
    motivo: textoCp1252(200).pipe(z.string().trim().min(5, 'Escreva o motivo (5 caracteres ou mais).')),
  })
  .strict();
export type TratarMorto = z.infer<typeof esquemaTratarMorto>;

/** Limite da fila de mortos sem tratamento antes do alerta (cap-14 §14.5). */
export const LIMITE_MORTO_SEM_TRATAMENTO_MIN = 240;

export const esquemaSaudeLegado = z.object({
  filas: z.array(
    z.object({
      fila: z.string(),
      direcao: z.enum(['saida', 'entrada']),
      quantidade: z.union([z.number(), z.string()]),
      maisAntiga: z.string().nullable(),
    }),
  ),
  bi: z.object({ pendentes: z.union([z.number(), z.string()]), maisAntiga: z.string().nullable() }),
  examesApoio: z.object({
    marcados: z.union([z.number(), z.string()]),
    exportados: z.union([z.number(), z.string()]),
    pendentes: z.union([z.number(), z.string()]),
    maisAntigo: z.string().nullable(),
  }),
  medidoEm: z.string(),
});
export type SaudeLegado = z.infer<typeof esquemaSaudeLegado>;

export const esquemaMonitorIntegracoes = z.object({
  outbox: z.array(z.object({ situacao: z.string(), tipo: z.string(), quantidade: z.number().int() })),
  envios: z.array(
    z.object({ parceiro: z.string(), situacao: z.enum(SITUACOES_ENVIO), quantidade: z.number().int() }),
  ),
  entradas: z.array(z.object({ parceiro: z.string(), situacao: z.string(), quantidade: z.number().int() })),
  mortos: z.array(esquemaEnvioLido),
  /** Mortos sem tratamento há mais de 4 h (regra 10). */
  alertas: z.array(z.object({ envio: z.string(), parceiro: z.string(), minutos: z.number().int() })),
  legado: esquemaSaudeLegado.nullable(),
  medidoEm: z.string(),
});
export type MonitorIntegracoes = z.infer<typeof esquemaMonitorIntegracoes>;

// ── Entrada idempotente (regra 8) e retorno do laboratório de apoio (regra 13) ───────────────────────────

export const SITUACOES_RECEBIDA = ['recebida', 'conferir', 'processada', 'recusada'] as const;
export type SituacaoRecebida = (typeof SITUACOES_RECEBIDA)[number];

export const esquemaMensagemParceiroRecebida = z
  .object({
    parceiro: z.string().regex(CODIGO),
    /** Tipo da mensagem (ex.: ORU^R01, Bundle, retorno-apoio). */
    tipo: z.string().min(2).max(40),
    /** Conteúdo como recebido (texto HL7, JSON FHIR); vai ao S3, nunca ao banco nem ao log. */
    conteudo: z.string().min(1).max(2_000_000),
  })
  .strict();
export type MensagemParceiroRecebida = z.infer<typeof esquemaMensagemParceiroRecebida>;

export const esquemaRespostaRecebida = z.object({
  id: z.string(),
  situacao: z.enum(SITUACOES_RECEBIDA),
  /** A mesma chave do parceiro já tinha entrado: a resposta é a da primeira. */
  repetida: z.boolean(),
  chaveParceiro: z.string(),
  resumo: z.string(),
});
export type RespostaRecebida = z.infer<typeof esquemaRespostaRecebida>;

export const esquemaRecebidaLida = z.object({
  id: z.string(),
  parceiro: z.string(),
  tipo: z.string(),
  chaveParceiro: z.string(),
  resumo: z.string(),
  tamanho: z.number().int(),
  situacao: z.enum(SITUACOES_RECEBIDA),
  detalhe: z.string().nullable(),
  objeto: z.string().nullable(),
  conferidoPor: z.string().nullable(),
  conferidoEm: z.string().nullable(),
  recebidoEm: z.string(),
});
export type RecebidaLida = z.infer<typeof esquemaRecebidaLida>;

/** Um elemento do resultado estruturado vindo do laboratório de apoio, já no de-para do estabelecimento. */
export const esquemaElementoApoio = z.object({
  elemento: z.number().int().min(0).max(32767),
  codigoApoio: z.string().max(18),
  nome: z.string().max(80),
  numerico: z.number().nullable(),
  alfa: z.string().max(60).nullable(),
  unidade: z.string().max(20).nullable(),
  referencia: z.string().max(80).nullable(),
});
export type ElementoApoio = z.infer<typeof esquemaElementoApoio>;

export const esquemaRetornoApoioLido = z.object({
  recebida: z.string(),
  protocolo: z.string(),
  exame: z.number().int(),
  exameNome: z.string().nullable(),
  paciente: z.object({ id: z.number().int().nullable(), nome: z.string().nullable() }),
  elementos: z.array(esquemaElementoApoio),
  observacao: z.string().nullable(),
  /** Elementos sem de-para (o laboratório mandou um código que o estabelecimento não mapeou). */
  semDePara: z.array(z.string()),
  situacao: z.enum(SITUACOES_RECEBIDA),
  recebidoEm: z.string(),
});
export type RetornoApoioLido = z.infer<typeof esquemaRetornoApoioLido>;

export const esquemaConferirRetorno = z
  .object({
    decisao: z.enum(['aprovar', 'recusar']),
    motivo: textoCp1252(200).pipe(z.string().trim().min(5)).nullable(),
  })
  .strict()
  .refine((c) => c.decisao === 'aprovar' || c.motivo !== null, {
    message: 'Recusar exige o motivo.',
    path: ['motivo'],
  });
export type ConferirRetorno = z.infer<typeof esquemaConferirRetorno>;

// ── Parceiros que leem o banco (regra 16) e configuração das interfaces ─────────────────────────────────

export const esquemaVisaoParceiro = z.object({
  parceiro: z.string(),
  visao: z.string(),
  existe: z.boolean(),
  /** Contagem agregada (nunca conteúdo); <5 quando abaixo de cinco. */
  linhas: z.union([z.number(), z.string()]).nullable(),
});
export type VisaoParceiro = z.infer<typeof esquemaVisaoParceiro>;

/** Ordem de oferta de canal novo a quem lê o banco (regra 16). */
export const PACOTES_CANAL_NOVO = [
  'api-do-parceiro-pela-outbox',
  'arquivo-agendado',
  'api-de-consulta',
] as const;
export type PacoteCanalNovo = (typeof PACOTES_CANAL_NOVO)[number];

// ── FHIR R4, RNDS e HL7 v2 ──────────────────────────────────────────────────────────────────────────────

/** Perfis BR Core na versão fixada (ADR 0016; trocada só por decisão registrada). */
export const VERSAO_BR_CORE = '1.6.1';
export const CANONICO_BR_CORE = 'https://br-core.saude.gov.br/fhir';

export const RECURSOS_FHIR_MAPEADOS = ['Patient', 'Organization', 'Practitioner', 'Immunization'] as const;
export type RecursoFhirMapeado = (typeof RECURSOS_FHIR_MAPEADOS)[number];

export const esquemaEstadoFhir = z.object({
  versaoBrCore: z.string(),
  perfis: z.array(z.object({ recurso: z.string(), perfil: z.string(), valido: z.boolean() })),
  rnds: z.object({
    ambiente: z.enum(['homologacao', 'producao', 'simulador']),
    envioVacina: z.object({ ligado: z.boolean(), motivo: z.string().nullable() }),
    prerequisitos: z.array(z.object({ descricao: z.string(), situacao: z.string() })),
  }),
  identificacao: z.object({
    pacientesComCpf: z.union([z.number(), z.string()]),
    pacientesComCns: z.union([z.number(), z.string()]),
    profissionaisComCns: z.union([z.number(), z.string()]),
    estabelecimentoComCnes: z.boolean(),
  }),
});
export type EstadoFhir = z.infer<typeof esquemaEstadoFhir>;

export const esquemaCanalOie = z.object({
  canal: z.string(),
  versao: z.string(),
  descricao: z.string(),
  mensagem: z.string(),
  direcao: z.enum(['saida', 'entrada']),
  destino: z.string(),
  ligado: z.boolean(),
});
export type CanalOie = z.infer<typeof esquemaCanalOie>;

export const esquemaEstadoHl7 = z.object({
  canais: z.array(esquemaCanalOie),
  motor: z.object({ endereco: z.string().nullable(), acessivel: z.boolean().nullable() }),
  classificacaoExterna: z.object({
    caminho: z.enum(['gatilho-em-uso', 'motor-de-integracao', 'nenhum']),
    decisao: z.string(),
  }),
  filasLegado: z.array(
    z.object({
      fila: z.string(),
      quantidade: z.union([z.number(), z.string()]),
      maisAntiga: z.string().nullable(),
    }),
  ),
});
export type EstadoHl7 = z.infer<typeof esquemaEstadoHl7>;

// ── Comunicação com o paciente pela Hal-AI (regra 15a; DP-44 b) ─────────────────────────────────────────

export const esquemaEstadoMensagens = z.object({
  /** O endereço da API da Hal-AI (parâmetro do estabelecimento); o token fica no cofre, nunca aqui. */
  enderecoApi: z.string().nullable(),
  tokenConfigurado: z.boolean(),
  envioLigado: z.boolean(),
  motivo: z.string().nullable(),
  /** O Sante SGH não tem canal próprio (WhatsApp, SMS, webchat): só a Hal-AI. */
  canalProprio: z.literal(false),
});
export type EstadoMensagens = z.infer<typeof esquemaEstadoMensagens>;
