// Serviço social (M45, etapa 5; ficha, seções 5, 7 e 8, regra 13; cap-05b §5.9): a avaliação social do internado (rede
// de apoio, vulnerabilidades, risco social, encaminhamentos à rede e o parecer), com a barreira social de alta enviada ao
// NIR na mesma gravação (`internacao.registrarBarreiraAlta` do M44). Os dados socioeconômicos são sensíveis (LGPD): o
// parecer é visível só para a categoria (assistente social); as demais categorias com vínculo assistencial veem que houve
// avaliação, o risco, as vulnerabilidades marcadas, os encaminhamentos e as orientações à equipe. Nenhum nome de tabela.
import { z } from 'zod';
import { esquemaChaveLeito } from '../internacao/adt.js';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { esquemaCorrecaoLida, SITUACOES_REGISTRO_CLINICO } from './correcao-base.js';
import { idBanco } from '../validacao/id-banco.js';

const id = idBanco;
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
/** Texto longo com as quebras de linha (o parecer). */
const longo = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/[ \t]+/g, ' ').trim());

/** Chave de liberação do serviço social (SGH_CFG_LIBERACAO; ficha, seção 12), por estabelecimento e unidade. */
export const CHAVE_LIBERACAO_SERVICO_SOCIAL = 'servico.social';

export const TIPOS_REGISTRO_SOCIAL = [
  { codigo: 'avaliacao', rotulo: 'Avaliação social' },
  { codigo: 'evolucao', rotulo: 'Evolução do serviço social' },
] as const;
export type TipoRegistroSocial = (typeof TIPOS_REGISTRO_SOCIAL)[number]['codigo'];
export const CODIGOS_TIPO_SOCIAL = TIPOS_REGISTRO_SOCIAL.map((t) => t.codigo) as [
  TipoRegistroSocial,
  ...TipoRegistroSocial[],
];

export const REDES_APOIO = [
  { codigo: 'presente', rotulo: 'Rede de apoio presente' },
  { codigo: 'fragil', rotulo: 'Rede de apoio frágil' },
  { codigo: 'ausente', rotulo: 'Sem rede de apoio' },
] as const;
export type RedeApoio = (typeof REDES_APOIO)[number]['codigo'];
export const CODIGOS_REDE_APOIO = REDES_APOIO.map((r) => r.codigo) as [RedeApoio, ...RedeApoio[]];

/** Vulnerabilidades sociais (o peso entra no risco social calculado; a assistente social pode subir o risco). */
export const VULNERABILIDADES_SOCIAIS = [
  { codigo: 'sem-moradia', rotulo: 'Situação de rua ou sem moradia', peso: 3 },
  { codigo: 'violencia', rotulo: 'Suspeita ou relato de violência ou negligência', peso: 3 },
  { codigo: 'sem-cuidador', rotulo: 'Sem cuidador para os cuidados após a alta', peso: 2 },
  { codigo: 'idoso-sozinho', rotulo: 'Pessoa idosa que mora sozinha', peso: 2 },
  { codigo: 'sem-renda', rotulo: 'Sem renda ou renda insuficiente', peso: 2 },
  { codigo: 'dependencia-quimica', rotulo: 'Uso abusivo de álcool ou outras drogas', peso: 2 },
  { codigo: 'transtorno-mental', rotulo: 'Transtorno mental sem acompanhamento', peso: 1 },
  { codigo: 'sem-documentos', rotulo: 'Sem documentos civis', peso: 1 },
  { codigo: 'migrante', rotulo: 'Migrante, refugiado ou de outra cidade sem vínculo', peso: 1 },
  { codigo: 'acesso-servicos', rotulo: 'Dificuldade de acesso à rede de saúde ou de assistência', peso: 1 },
  { codigo: 'transporte', rotulo: 'Sem meio de transporte para a alta ou o seguimento', peso: 1 },
] as const;
export type VulnerabilidadeSocial = (typeof VULNERABILIDADES_SOCIAIS)[number]['codigo'];
export const CODIGOS_VULNERABILIDADE = VULNERABILIDADES_SOCIAIS.map((v) => v.codigo) as [
  VulnerabilidadeSocial,
  ...VulnerabilidadeSocial[],
];

/** Encaminhamentos à rede (o que o serviço social aciona). */
export const ENCAMINHAMENTOS_SOCIAIS = [
  { codigo: 'cras-creas', rotulo: 'CRAS ou CREAS' },
  { codigo: 'conselho-tutelar', rotulo: 'Conselho Tutelar' },
  { codigo: 'ministerio-publico', rotulo: 'Ministério Público ou Defensoria' },
  { codigo: 'ubs-esf', rotulo: 'Unidade básica de saúde ou Estratégia Saúde da Família' },
  { codigo: 'caps', rotulo: 'CAPS' },
  { codigo: 'beneficio', rotulo: 'Benefício previdenciário ou assistencial' },
  { codigo: 'instituicao-longa-permanencia', rotulo: 'Instituição de longa permanência' },
  { codigo: 'transporte-sanitario', rotulo: 'Transporte sanitário' },
  { codigo: 'familia', rotulo: 'Contato e orientação à família' },
] as const;
export type EncaminhamentoSocial = (typeof ENCAMINHAMENTOS_SOCIAIS)[number]['codigo'];
export const CODIGOS_ENCAMINHAMENTO = ENCAMINHAMENTOS_SOCIAIS.map((e) => e.codigo) as [
  EncaminhamentoSocial,
  ...EncaminhamentoSocial[],
];

export const RISCOS_SOCIAIS = [
  { codigo: 'baixo', rotulo: 'Risco social baixo' },
  { codigo: 'medio', rotulo: 'Risco social médio' },
  { codigo: 'alto', rotulo: 'Risco social alto' },
] as const;
export type RiscoSocial = (typeof RISCOS_SOCIAIS)[number]['codigo'];
export const CODIGOS_RISCO_SOCIAL = RISCOS_SOCIAIS.map((r) => r.codigo) as [RiscoSocial, ...RiscoSocial[]];

/** A barreira social de alta enviada ao NIR junto com a avaliação (tipo `social` do M44). */
export const esquemaBarreiraSocial = z
  .object({
    descricao: livre(300).pipe(z.string().min(5, 'Descreva a barreira social (ao menos 5 caracteres).')),
    responsavel: livre(60).pipe(z.string().min(3, 'Informe quem resolve (setor ou função).')),
    prazo: esquemaDataIso,
  })
  .strict();

/** POST /api/servico-social/registros: a avaliação ou a evolução do serviço social. */
export const esquemaRegistrarAvaliacaoSocial = z
  .object({
    internacao: id,
    tipo: z.enum(CODIGOS_TIPO_SOCIAL),
    redeApoio: z.enum(CODIGOS_REDE_APOIO),
    vulnerabilidades: z.array(z.enum(CODIGOS_VULNERABILIDADE)).max(11).default([]),
    /** O risco escolhido pela assistente social (nunca abaixo do calculado; regra do domínio). */
    risco: z.enum(CODIGOS_RISCO_SOCIAL),
    encaminhamentos: z.array(z.enum(CODIGOS_ENCAMINHAMENTO)).max(9).default([]),
    parecer: longo(4000).pipe(z.string().min(20, 'Escreva o parecer social (ao menos 20 caracteres).')),
    orientacoes: livre(500).optional(),
    barreira: esquemaBarreiraSocial.nullable().default(null),
  })
  .strict();
export type RegistrarAvaliacaoSocialEntrada = z.infer<typeof esquemaRegistrarAvaliacaoSocial>;

export const esquemaRegistroSocialLido = z.object({
  id: z.number().int(),
  /** W0-05: o adendo complementa um registro (ADENDO_DE), sem inativá-lo. */
  tipo: z.enum([...CODIGOS_TIPO_SOCIAL, 'adendo']),
  redeApoio: z.enum(CODIGOS_REDE_APOIO),
  vulnerabilidades: z.array(z.enum(CODIGOS_VULNERABILIDADE)),
  risco: z.enum(CODIGOS_RISCO_SOCIAL),
  encaminhamentos: z.array(z.enum(CODIGOS_ENCAMINHAMENTO)),
  /** O parecer: só para a categoria (assistente social); null para as demais (sigilo = true). */
  parecer: z.string().nullable(),
  sigilo: z.boolean(),
  orientacoes: z.string().nullable(),
  barreira: z.number().int().nullable(),
  por: z.string(),
  em: z.string(),
  /** W0-05: o registro que o adendo complementa e o motivo do adendo. */
  adendoDe: z.number().int().nullable(),
  motivoAdendo: z.string().nullable(),
  /** Ativo ou estornado (inativo e visível, com o motivo). */
  situacao: z.enum(SITUACOES_REGISTRO_CLINICO),
  correcao: esquemaCorrecaoLida.nullable(),
});
export type RegistroSocialLido = z.infer<typeof esquemaRegistroSocialLido>;

export const esquemaServicoSocialPaciente = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  nome: z.string(),
  leito: esquemaChaveLeito,
  admissao: z.string(),
  idade: z.number().int().nullable(),
  registros: z.array(esquemaRegistroSocialLido),
  /** As barreiras de alta abertas da internação (todas, não só as sociais), como o NIR vê. */
  barreiras: z.array(
    z.object({
      id: z.number().int(),
      tipo: z.string(),
      descricao: z.string(),
      responsavel: z.string(),
      prazo: z.string(),
      vencida: z.boolean(),
    }),
  ),
  /** O leitor é da categoria (lê o parecer e registra). */
  daCategoria: z.boolean(),
  lidoEm: z.string(),
});
export type ServicoSocialPaciente = z.infer<typeof esquemaServicoSocialPaciente>;

/** A fila do serviço social: os internados com o risco da última avaliação e as barreiras sociais abertas. */
export const esquemaItemFilaSocial = z.object({
  internacao: z.number().int(),
  paciente: z.number().int(),
  nome: z.string(),
  leito: esquemaChaveLeito,
  admissao: z.string(),
  idade: z.number().int().nullable(),
  ultima: z
    .object({ risco: z.enum(CODIGOS_RISCO_SOCIAL), em: z.string(), tipo: z.enum(CODIGOS_TIPO_SOCIAL) })
    .nullable(),
  barreirasSociais: z.number().int(),
  /** Sugestão de avaliação: idade, permanência longa ou risco alto sem evolução recente. */
  sugerida: z.boolean(),
});
export const esquemaFilaSocial = z.object({
  itens: z.array(esquemaItemFilaSocial),
  cortada: z.boolean(),
  lidoEm: z.string(),
});
export type FilaSocial = z.infer<typeof esquemaFilaSocial>;

export const esquemaResultadoSocial = z.object({
  ok: z.literal(true),
  id: z.number().int(),
  barreira: z.number().int().nullable(),
  risco: z.enum(CODIGOS_RISCO_SOCIAL),
  mensagem: z.string(),
});
export type ResultadoSocial = z.infer<typeof esquemaResultadoSocial>;
