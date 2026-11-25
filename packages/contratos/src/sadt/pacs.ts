// Lista de trabalho DICOM e integração com o PACS/RIS (M47, etapa 3; ficha, seções 4 a 8, regra 8; cap-05b §5.10;
// cap-12 §12.4). Todo exame de imagem lançado (M26) de setor com modalidade DICOM vira um item da lista de trabalho da
// modalidade (MWL) com um número de acesso único; o envio vai pela outbox e pelas integrações novas do M34 (retentativa,
// fila de mortos e o monitor), com o número de acesso como chave de idempotência no destino: o reenvio atualiza o item
// e não duplica. O PACS (ou a modalidade) devolve o status do exame (MPPS) e o UID do estudo pela entrada própria, de
// forma idempotente (a mensagem repetida devolve a primeira resposta; a fora de ordem não rebaixa o status). O link do
// visualizador aparece no prontuário e, com o laudo liberado, no portal. Fora de produção, só o simulador responde.
import { z } from 'zod';
import { idBanco } from '../validacao/id-banco.js';

/**
 * Nome do recurso na trilha das gravações da lista de trabalho. NÃO é chave de liberação (05-SADT linha 20): a função vale
 * para todos, só pela permissão do cargo; o envio segue o destino configurado em cada estabelecimento.
 */
export const RECURSO_TRILHA_WORKLIST = 'imagem.worklist';
/** Parâmetro do estabelecimento com o código do parceiro de integração que recebe a lista de trabalho dele. */
export const PARAMETRO_PARCEIRO_WORKLIST = 'pacs.parceiroWorklist';
/** Tipo do evento da outbox (e das integrações novas) que leva o item ao PACS. */
export const EVENTO_OUTBOX_MWL = 'imagem.mwl';
/** O escopo que o parceiro precisa para devolver o status do exame. */
export const ESCOPO_STATUS_ESTUDO = 'estudo.status';
/** Teto da lista de trabalho por consulta (ficha, seção 4: 500). */
export const TETO_WORKLIST = 500;

/** Status do exame na modalidade (MPPS): a ordem decide o vigente quando as mensagens chegam fora de ordem. */
export const STATUS_ESTUDO = [
  { codigo: 'em-andamento', rotulo: 'Em andamento na modalidade', ordem: 1 },
  { codigo: 'concluido', rotulo: 'Concluído', ordem: 2 },
  { codigo: 'descontinuado', rotulo: 'Descontinuado', ordem: 2 },
] as const;
export type StatusEstudo = (typeof STATUS_ESTUDO)[number]['codigo'];
export const CODIGOS_STATUS_ESTUDO = STATUS_ESTUDO.map((s) => s.codigo) as [StatusEstudo, ...StatusEstudo[]];

/** Estado da entrega do item ao PACS (SGH_INTG_ENVIO do M34; "sem-parceiro" quando nenhum parceiro assina o evento). */
export const ENTREGAS_MWL = [
  { codigo: 'pendente', rotulo: 'Na fila de envio' },
  { codigo: 'enviado', rotulo: 'Entregue ao PACS' },
  { codigo: 'morto', rotulo: 'Falhou (fila de mortos)' },
  { codigo: 'descartado', rotulo: 'Descartado no monitor' },
  { codigo: 'sem-parceiro', rotulo: 'Sem PACS configurado' },
] as const;
export type EntregaMwl = (typeof ENTREGAS_MWL)[number]['codigo'];
export const CODIGOS_ENTREGA_MWL = ENTREGAS_MWL.map((s) => s.codigo) as [EntregaMwl, ...EntregaMwl[]];

/** A situação do exame na tela (a contagem do topo). */
export const SITUACOES_WORKLIST = [
  { codigo: 'sem-modalidade', rotulo: 'Setor sem modalidade DICOM' },
  { codigo: 'a-enviar', rotulo: 'A enviar' },
  { codigo: 'na-fila', rotulo: 'Na fila de envio' },
  { codigo: 'entregue', rotulo: 'Entregue ao PACS' },
  { codigo: 'falhou', rotulo: 'Falhou' },
  { codigo: 'em-andamento', rotulo: 'Em andamento' },
  { codigo: 'concluido', rotulo: 'Concluído' },
  { codigo: 'descontinuado', rotulo: 'Descontinuado' },
] as const;
export type SituacaoWorklist = (typeof SITUACOES_WORKLIST)[number]['codigo'];
export const CODIGOS_SITUACAO_WORKLIST = SITUACOES_WORKLIST.map((s) => s.codigo) as [
  SituacaoWorklist,
  ...SituacaoWorklist[],
];

/** Número de acesso (DICOM SH, até 16): letras maiúsculas e dígitos. */
export const FORMATO_ACCESSION = /^[A-Z0-9]{4,16}$/;
/** UID DICOM (UI, até 64): componentes numéricos separados por ponto, sem zero à esquerda. */
export const FORMATO_UID_DICOM = /^(0|[1-9]\d*)(\.(0|[1-9]\d*))+$/;

const id = idBanco;
const uid = z.string().max(64).regex(FORMATO_UID_DICOM, 'UID DICOM inválido.');

export const esquemaFiltroWorklist = z
  .object({
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    setor: z.coerce.number().int().positive().max(9999).optional(),
    situacao: z.enum(CODIGOS_SITUACAO_WORKLIST).optional(),
    /** O paciente (nome, prontuário ou registro) ou o número de acesso do item. */
    termo: z.string().trim().max(60).optional(),
  })
  .strict();
export type FiltroWorklist = z.infer<typeof esquemaFiltroWorklist>;

/** sadt.enviarWorklist: os exames que ficaram de fora (ou a geração do dia, pela tela). */
export const esquemaEnviarWorklist = z
  .object({ exames: z.array(id).min(1, 'Escolha ao menos um exame.').max(100) })
  .strict();
export type EnviarWorklistEntrada = z.infer<typeof esquemaEnviarWorklist>;

/** Reenvio de um item já criado: o mesmo número de acesso (a trilha registra quem e quando). */
export const esquemaReenviarWorklist = z
  .object({
    /** O número de envios visto na tela (dois reenvios ao mesmo tempo: um vence, o outro é recusado). */
    envios: z.number().int().min(1).max(999),
  })
  .strict();
export type ReenviarWorklistEntrada = z.infer<typeof esquemaReenviarWorklist>;

/** sadt.receberStatusExame: o status vindo do PACS ou da modalidade (MPPS), com a chave da mensagem. */
export const esquemaStatusExame = z
  .object({
    /** Identificador da mensagem no PACS (a idempotência). */
    mensagem: z
      .string()
      .regex(
        /^[A-Za-z0-9._:-]{8,120}$/,
        'Identificador da mensagem: 8 a 120 letras, dígitos, ponto, hífen ou dois-pontos.',
      ),
    accession: z.string().regex(FORMATO_ACCESSION, 'Número de acesso inválido.'),
    status: z.enum(CODIGOS_STATUS_ESTUDO),
    uidEstudo: uid.nullable().default(null),
    uidMpps: uid.nullable().default(null),
    /** Quando aconteceu na modalidade (AAAA-MM-DDTHH:MM:SS, hora local do estabelecimento). */
    ocorridoEm: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Data e hora do status inválidas.'),
  })
  .strict()
  .refine((x) => x.status !== 'concluido' || x.uidEstudo !== null, {
    message: 'O exame concluído traz o UID do estudo.',
    path: ['uidEstudo'],
  });
export type StatusExameEntrada = z.infer<typeof esquemaStatusExame>;

/** O simulador de modalidade (fora de produção): o status que a modalidade mandaria. */
export const esquemaSimularStatus = z.object({ status: z.enum(CODIGOS_STATUS_ESTUDO) }).strict();
export type SimularStatusEntrada = z.infer<typeof esquemaSimularStatus>;

const txt = z.string();
const n = z.number().int();

export const esquemaEstudoLido = z.object({
  status: z.enum(CODIGOS_STATUS_ESTUDO),
  uidEstudo: txt.nullable(),
  ocorridoEm: txt,
  recebidoEm: txt,
  /** O link do visualizador (null sem UID ou sem o endereço do visualizador configurado). */
  link: txt.nullable(),
  /** Mensagens recebidas (a repetida não conta; a fora de ordem conta e não rebaixa o status). */
  mensagens: n,
});
export type EstudoLido = z.infer<typeof esquemaEstudoLido>;

export const esquemaItemMwlLido = z.object({
  id: n,
  accession: txt,
  modalidade: txt,
  envios: n,
  ultimoEnvioEm: txt,
  ultimoEnvioPor: txt,
  origem: z.enum(['automatico', 'manual']),
  entrega: z.enum(CODIGOS_ENTREGA_MWL),
  /** A resposta curta do destino (código ou motivo da falha). */
  resposta: txt.nullable(),
  tentativas: n,
});
export type ItemMwlLido = z.infer<typeof esquemaItemMwlLido>;

export const esquemaItemWorklist = z.object({
  exame: n,
  ato: n,
  setor: txt,
  nomeExame: txt,
  /** Dois identificadores do paciente (segurança do paciente): o nome com o prontuário e a data de nascimento. */
  paciente: z.object({ id: n, nome: txt, prontuario: n, nascimento: txt.nullable() }),
  data: txt,
  urgente: z.boolean(),
  modalidade: z.object({ id: n.nullable(), sigla: txt }).nullable(),
  situacao: z.enum(CODIGOS_SITUACAO_WORKLIST),
  mwl: esquemaItemMwlLido.nullable(),
  estudo: esquemaEstudoLido.nullable(),
});
export type ItemWorklist = z.infer<typeof esquemaItemWorklist>;

export const esquemaTelaWorklist = z.object({
  data: txt,
  setores: z.array(z.object({ ato: n, rotulo: txt, modalidade: txt.nullable() })),
  itens: z.array(esquemaItemWorklist),
  cortada: z.boolean(),
  contagens: z.record(z.string(), n),
  /** O destino: o simulador fora de produção; o PACS configurado em produção; ou nenhum parceiro ativo. */
  destino: z.object({
    modo: z.enum(['simulador', 'pacs', 'desligado']),
    parceiro: txt.nullable(),
    motivo: txt.nullable(),
  }),
  visualizador: z.object({ nome: txt, configurado: z.boolean() }),
  acoes: z.object({
    enviar: z.boolean(),
    reenviar: z.boolean(),
    simular: z.boolean(),
    motivo: txt.nullable(),
  }),
  lidoEm: txt,
});
export type TelaWorklist = z.infer<typeof esquemaTelaWorklist>;

export const esquemaResultadoWorklist = z.object({
  ok: z.literal(true),
  enviados: n,
  ignorados: z.array(z.object({ exame: n, motivo: txt })),
  mensagem: txt,
});
export type ResultadoWorklist = z.infer<typeof esquemaResultadoWorklist>;

export const esquemaRespostaStatusExame = z.object({
  id: n,
  repetida: z.boolean(),
  vigente: z.enum(CODIGOS_STATUS_ESTUDO),
  /** A mensagem chegou depois de outra de ordem maior (registrada, sem rebaixar o vigente). */
  foraDeOrdem: z.boolean(),
});
export type RespostaStatusExame = z.infer<typeof esquemaRespostaStatusExame>;

/** O estudo de imagem de um exame do paciente, para o prontuário. */
export const esquemaEstudoDoPaciente = z.object({
  exame: n,
  nomeExame: txt,
  setor: txt,
  data: txt,
  accession: txt,
  modalidade: txt,
  status: z.enum(CODIGOS_STATUS_ESTUDO).nullable(),
  link: txt.nullable(),
});
export type EstudoDoPaciente = z.infer<typeof esquemaEstudoDoPaciente>;

export const esquemaEstudosDoPaciente = z.object({
  estudos: z.array(esquemaEstudoDoPaciente),
  visualizador: z.object({ nome: txt, configurado: z.boolean() }),
});
export type EstudosDoPaciente = z.infer<typeof esquemaEstudosDoPaciente>;

/** O link das imagens no laudo aberto do portal (só com o laudo liberado e o estudo concluído). */
export const esquemaImagemDoLaudo = z.object({ link: txt, visualizador: txt });
export type ImagemDoLaudo = z.infer<typeof esquemaImagemDoLaudo>;
