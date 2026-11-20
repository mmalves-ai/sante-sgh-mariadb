// Triagem dos relatórios de SQL livre, pedidos de relatório novo e envio agendado (M34; ficha, seções 6 a 8, regras
// 2 e 5). Vocabulário, entradas e respostas da API e da tela (o mesmo Zod nos dois lados). Nenhum nome de tabela do
// banco; o texto da consulta de origem nunca sai do banco (é especificação, não é executado).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { DATAS_RELATIVAS, MESES_RELATIVOS } from './catalogo.js';

// ── Triagem (regra 2) ───────────────────────────────────────────────────────────────────────────────────

/**
 * Destino de cada relatório de SQL livre: uma tela ou fila de um marco, um relatório do catálogo, um indicador, um
 * painel, ou descartado (teste, modelo, duplicado).
 */
export const DESTINOS_TRIAGEM = ['tela', 'fila', 'catalogo', 'indicador', 'painel', 'descartado'] as const;
export type DestinoTriagem = (typeof DESTINOS_TRIAGEM)[number];
export const SITUACOES_TRIAGEM = ['proposta', 'confirmada'] as const;
export type SituacaoTriagem = (typeof SITUACOES_TRIAGEM)[number];

export const ROTULO_DESTINO_TRIAGEM: Readonly<Record<DestinoTriagem, string>> = {
  tela: 'Tela de trabalho',
  fila: 'Fila de trabalho',
  catalogo: 'Relatório do catálogo',
  indicador: 'Indicador',
  painel: 'Painel',
  descartado: 'Descartado',
};

export const esquemaTriagemLida = z.object({
  id: z.number().int(),
  nome: z.string(),
  area: z.string(),
  destino: z.enum(DESTINOS_TRIAGEM),
  marco: z.string().nullable(),
  artefato: z.string(),
  papelDono: z.string(),
  onda: z.number().int().nullable(),
  situacao: z.enum(SITUACOES_TRIAGEM),
  regra: z.string().nullable(),
  motivo: z.string().nullable(),
  decididoPor: z.string().nullable(),
  decididoEm: z.string().nullable(),
  /** Quantidade de parâmetros do relatório de origem e se o acesso era restrito por grupo ou usuário. */
  parametros: z.number().int(),
  acessoRestrito: z.boolean(),
});
export type TriagemLida = z.infer<typeof esquemaTriagemLida>;

export const esquemaResumoTriagem = z.object({
  total: z.number().int(),
  semDestino: z.number().int(),
  semDono: z.number().int(),
  confirmadas: z.number().int(),
  porDestino: z.record(z.string(), z.number().int()),
  porMarco: z.record(z.string(), z.number().int()),
});
export type ResumoTriagem = z.infer<typeof esquemaResumoTriagem>;

export const esquemaPaginaTriagem = z.object({
  itens: z.array(esquemaTriagemLida),
  total: z.number().int(),
  resumo: esquemaResumoTriagem,
});
export type PaginaTriagem = z.infer<typeof esquemaPaginaTriagem>;

export const esquemaDecisaoTriagem = z
  .object({
    destino: z.enum(DESTINOS_TRIAGEM),
    marco: z
      .string()
      .regex(/^M\d{2}$/, 'Marco no formato Mnn.')
      .nullable(),
    artefato: textoCp1252(120).pipe(z.string().trim().min(2, 'Diga a tela, o relatório ou o indicador.')),
    papelDono: textoCp1252(60).pipe(z.string().trim().min(3, 'Diga o papel dono do relatório.')),
    onda: z.number().int().min(0).max(4).nullable(),
    motivo: textoCp1252(200).pipe(z.string().trim().min(5, 'Escreva o motivo da decisão.')),
  })
  .strict()
  .refine((d) => d.destino === 'descartado' || d.marco !== null, {
    message: 'Destino diferente de descartado exige o marco que entrega.',
    path: ['marco'],
  });
export type DecisaoTriagem = z.infer<typeof esquemaDecisaoTriagem>;

// ── Pedido de relatório novo ────────────────────────────────────────────────────────────────────────────

/** W0-09: "cancelado" é a leitura do pedido aberto ou em análise cancelado com motivo (a situação gravada fica). */
export const SITUACOES_PEDIDO = ['aberto', 'em-analise', 'publicado', 'recusado', 'cancelado'] as const;
export type SituacaoPedido = (typeof SITUACOES_PEDIDO)[number];

export const esquemaNovoPedido = z
  .object({
    titulo: textoCp1252(120).pipe(z.string().trim().min(5, 'Título: 5 caracteres ou mais.')),
    descricao: textoCp1252(2000).pipe(
      z.string().trim().min(20, 'Descreva o relatório (colunas, filtros, totais): 20 caracteres ou mais.'),
    ),
    finalidade: textoCp1252(300).pipe(z.string().trim().min(10, 'Para que o relatório serve.')),
    area: textoCp1252(60).pipe(z.string().trim().min(3, 'A área que vai usar.')),
    prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Prazo: AAAA-MM-DD.'),
  })
  .strict();
export type NovoPedido = z.infer<typeof esquemaNovoPedido>;

/** W0-09: o motivo obrigatório de toda alteração, cancelamento, desativação e exclusão de pedido e envio. */
export const esquemaMotivoRelatorio = textoCp1252(200).pipe(
  z.string().trim().min(5, 'Informe o motivo (5 caracteres ou mais).'),
);
export const esquemaMotivoGestaoRelatorio = z.object({ motivo: esquemaMotivoRelatorio }).strict();

/** W0-09: correção do pedido ainda aberto (sem resposta do curador), com motivo. */
export const esquemaAlteracaoPedido = esquemaNovoPedido.extend({ motivo: esquemaMotivoRelatorio }).strict();
export type AlteracaoPedido = z.infer<typeof esquemaAlteracaoPedido>;

/** W0-09: o histórico do pedido ou do envio (o valor anterior fica no banco; a tela mostra quem, quando e o motivo). */
export const esquemaEventoRelatorio = z.object({
  evento: z.enum(['alteracao', 'cancelamento', 'exclusao', 'ativacao', 'desativacao']),
  motivo: z.string(),
  por: z.string(),
  em: z.string(),
});
export type EventoGestaoRelatorio = z.infer<typeof esquemaEventoRelatorio>;

export const esquemaRespostaPedido = z
  .object({
    situacao: z.enum(['em-analise', 'publicado', 'recusado']),
    relatorio: z.string().max(60).nullable(),
    resposta: textoCp1252(500).pipe(z.string().trim().min(5, 'Escreva a resposta ao pedido.')),
  })
  .strict()
  .refine((r) => r.situacao !== 'publicado' || (r.relatorio !== null && r.relatorio !== ''), {
    message: 'Publicado exige o relatório do catálogo que atende o pedido.',
    path: ['relatorio'],
  });
export type RespostaPedido = z.infer<typeof esquemaRespostaPedido>;

export const esquemaPedidoLido = z.object({
  id: z.string(),
  titulo: z.string(),
  descricao: z.string(),
  finalidade: z.string(),
  area: z.string(),
  solicitante: z.string(),
  prazo: z.string(),
  situacao: z.enum(SITUACOES_PEDIDO),
  relatorio: z.string().nullable(),
  resposta: z.string().nullable(),
  respondidoPor: z.string().nullable(),
  respondidoEm: z.string().nullable(),
  criadoEm: z.string(),
  atrasado: z.boolean(),
  /** W0-09: o cancelamento (quem, quando e o motivo) e o que ainda se pode fazer com o pedido. */
  canceladoEm: z.string().nullable(),
  canceladoPor: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  editavel: z.boolean(),
  cancelavel: z.boolean(),
  excluivel: z.boolean(),
});
export type PedidoLido = z.infer<typeof esquemaPedidoLido>;

// ── Envio agendado (regra 5) ────────────────────────────────────────────────────────────────────────────

export const PERIODICIDADES = ['diaria', 'semanal', 'mensal'] as const;
export type Periodicidade = (typeof PERIODICIDADES)[number];

const ENDERECO = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;

/** Parâmetro do envio: valor fixo ou relativo ao dia do envio (resolvido pelo worker). */
const valorParametroAgendado = z.union([
  z.number(),
  z.enum(DATAS_RELATIVAS),
  z.enum(MESES_RELATIVOS),
  z.string().max(40),
]);

export const esquemaNovoAgendamento = z
  .object({
    relatorio: z.string().min(2).max(60),
    titulo: textoCp1252(120).pipe(z.string().trim().min(3, 'Dê um nome ao envio.')),
    parametros: z.record(z.string(), valorParametroAgendado),
    grupos: z.array(z.string().min(1).max(50)).max(10),
    enderecos: z.array(z.string().regex(ENDERECO, 'Endereço de e-mail inválido.')).max(20),
    periodicidade: z.enum(PERIODICIDADES),
    /** Hora no formato HHMM (0 a 2359). */
    hora: z
      .number()
      .int()
      .min(0)
      .max(2359)
      .refine((h) => h % 100 < 60, 'Minutos de 00 a 59.'),
    diaSemana: z.number().int().min(1).max(7).nullable(),
    diaMes: z.number().int().min(1).max(28).nullable(),
  })
  .strict()
  .refine((a) => a.grupos.length + a.enderecos.length > 0, {
    message: 'Escolha ao menos um grupo ou um endereço.',
    path: ['grupos'],
  })
  .refine((a) => a.periodicidade !== 'semanal' || a.diaSemana !== null, {
    message: 'Envio semanal exige o dia da semana.',
    path: ['diaSemana'],
  })
  .refine((a) => a.periodicidade !== 'mensal' || a.diaMes !== null, {
    message: 'Envio mensal exige o dia do mês (1 a 28).',
    path: ['diaMes'],
  });
export type NovoAgendamento = z.infer<typeof esquemaNovoAgendamento>;

/**
 * W0-09: o "Alterar" do envio agendado leva os campos do novo, o motivo e, para não redigitar, `manterEnderecos`
 * (os endereços gravados ficam; a tela só os mostra mascarados). Sem ele, os endereços são os redigitados.
 */
export interface AlteracaoAgendamento extends NovoAgendamento {
  readonly motivo: string;
  readonly manterEnderecos?: boolean;
  readonly ativo?: boolean;
}

/** E-mail mascarado para a tela (`di***@ex***.invalid`): nunca o endereço inteiro. */
export function mascararEnderecoEmail(email: string): string {
  const i = email.lastIndexOf('@');
  if (i <= 0) return '***';
  const dominio = email.slice(i + 1);
  const j = dominio.lastIndexOf('.');
  const nome = j > 0 ? dominio.slice(0, j) : dominio;
  const sufixo = j > 0 ? dominio.slice(j) : '';
  return `${email.slice(0, Math.min(2, i))}***@${nome.slice(0, 2)}***${sufixo}`;
}

export const esquemaAgendamentoLido = z.object({
  id: z.string(),
  relatorio: z.string(),
  titulo: z.string(),
  parametros: z.record(z.string(), z.union([z.string(), z.number()])),
  grupos: z.array(z.string()),
  enderecos: z.number().int(),
  /** W0-09: os endereços só mascarados (`di***@ex***.invalid`); o endereço inteiro nunca volta à tela. */
  enderecosMascarados: z.array(z.string()),
  periodicidade: z.enum(PERIODICIDADES),
  hora: z.number().int(),
  diaSemana: z.number().int().nullable(),
  diaMes: z.number().int().nullable(),
  ativo: z.boolean(),
  dono: z.string(),
  proximoEnvio: z.string().nullable(),
  ultimoEnvio: z.string().nullable(),
  ultimaSituacao: z.enum(['enviado', 'falhou']).nullable(),
  ultimaFalha: z.string().nullable(),
  falhasSeguidas: z.number().int(),
});
export type AgendamentoLido = z.infer<typeof esquemaAgendamentoLido>;

/** Histórico do envio do editor de origem (só contagens por ano e situação; nenhum endereço nem conteúdo). */
export const esquemaHistoricoEnvioOrigem = z.object({
  agendamentos: z.number().int(),
  porAno: z.array(
    z.object({ ano: z.number().int(), situacao: z.string(), quantidade: z.union([z.number(), z.string()]) }),
  ),
  ultimoEnviado: z.string().nullable(),
  naoEnviados: z.union([z.number(), z.string()]),
});
export type HistoricoEnvioOrigem = z.infer<typeof esquemaHistoricoEnvioOrigem>;

/** Situações do envio do editor de origem (ref 02, código decifrado). */
export const SITUACOES_ENVIO_ORIGEM: Readonly<Record<number, string>> = {
  1: 'Enviado',
  2: 'Não gerado',
  3: 'Não conectado',
  4: 'Não enviado',
};

export const esquemaExecucaoLida = z.object({
  id: z.string(),
  relatorio: z.string(),
  tipo: z.enum(['execucao', 'exportacao', 'envio']),
  formato: z.string(),
  usuario: z.string(),
  linhas: z.number().int(),
  duracaoMs: z.number().int(),
  dadoPessoal: z.boolean(),
  mascarado: z.boolean(),
  temJustificativa: z.boolean(),
  situacao: z.enum(['ok', 'cancelada', 'recusada', 'falhou']),
  criadoEm: z.string(),
});
export type ExecucaoLida = z.infer<typeof esquemaExecucaoLida>;

// ── Fila do envio de relatório (API → worker; regra 5) ──────────────────────────────────────────────────

/** Nome da fila BullMQ do envio de relatório da rede (prefixo sgh; o worker consome e entrega por SMTP). */
export function filaEnvioRelatorio(rede: string): string {
  if (!/^[a-z0-9-]{1,63}$/.test(rede)) throw new Error('Código de rede inválido para a fila.');
  return `relatorio-${rede}`;
}

/**
 * O job do envio: só o título, o link autenticado e os destinatários (endereços digitados e grupos, que o worker
 * resolve no cadastro de usuários); nunca o arquivo nem os dados do relatório. `registrar`: o worker grava o
 * resultado no agendamento (falso na sessão sintética, que guarda o agendamento em memória na API).
 */
export const esquemaJobEnvioRelatorio = z
  .object({
    rede: z.string().regex(/^[a-z0-9-]{1,63}$/),
    hospital: z.string().regex(/^[a-z0-9]{1,10}$/),
    agendamento: z.string().regex(/^\d{1,20}$/),
    titulo: z.string().min(1).max(120),
    relatorio: z.string().min(1).max(120),
    link: z
      .string()
      .max(2000)
      .refine((u) => /^https?:\/\//.test(u), 'Link inválido.'),
    enderecos: z.array(z.string().regex(ENDERECO)).max(20),
    grupos: z.array(z.string().min(1).max(50)).max(10),
    dono: z.string().min(1).max(31),
    registrar: z.boolean(),
  })
  .strict();
export type JobEnvioRelatorio = z.infer<typeof esquemaJobEnvioRelatorio>;
