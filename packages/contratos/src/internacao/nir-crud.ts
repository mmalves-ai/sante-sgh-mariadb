// Programa CRUD completo, pacote W0-07: as entradas de inclusão, alteração e exclusão do NIR, do mapa de leitos e da
// observação do PA. Toda alteração e toda exclusão pedem o motivo (a trilha leva quem, quando e o motivo; o valor
// anterior vai à versão do registro, nunca à trilha). Nenhum nome de tabela aqui.
import { z } from 'zod';
import { esquemaDataIso } from '../preco/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { CODIGOS_MOTIVO_BLOQUEIO_LEITO, CODIGOS_PRECAUCAO, esquemaChaveLeito } from './adt.js';
import { ESCOPOS_LIMITE_PERMANENCIA, esquemaPerfilLeito } from './nir.js';

const id = z.number().int().positive().max(2_147_483_647);
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const motivo = (min: number, max: number, msg: string) => livre(max).pipe(z.string().min(min, msg));
const motivoAlteracao = () => motivo(5, 300, 'Informe o motivo (ao menos 5 caracteres).');
/** O motivo do cancelamento da solicitação ou da reserva de leito (fica na linha, com quem e quando). */
const motivoCancelamento = () => motivo(3, 500, 'Informe o motivo do cancelamento (ao menos 3 caracteres).');

/** Recursos que a solicitação de leito pode pedir além do perfil (padrão de mercado do NIR). */
export const RECURSOS_LEITO_NIR = [
  { codigo: 'ventilacao', rotulo: 'Ventilação mecânica' },
  { codigo: 'monitor', rotulo: 'Monitorização contínua' },
  { codigo: 'oxigenio', rotulo: 'Oxigênio' },
  { codigo: 'hemodialise', rotulo: 'Hemodiálise' },
  { codigo: 'bomba', rotulo: 'Bomba de infusão' },
  { codigo: 'obeso', rotulo: 'Leito para obeso' },
  { codigo: 'berco', rotulo: 'Berço ou incubadora' },
  { codigo: 'acompanhante', rotulo: 'Acompanhante' },
] as const;
export const CODIGOS_RECURSO_LEITO_NIR = RECURSOS_LEITO_NIR.map((r) => r.codigo) as [
  (typeof RECURSOS_LEITO_NIR)[number]['codigo'],
  ...(typeof RECURSOS_LEITO_NIR)[number]['codigo'][],
];
export type RecursoLeitoNir = (typeof RECURSOS_LEITO_NIR)[number]['codigo'];

// ── NIR ───────────────────────────────────────────────────────────────────────────────────────────

/** Corrigir a solicitação aberta: o perfil, os recursos e a observação (com a versão vista e o motivo). */
export const esquemaCorrigirSolicitacao = z
  .object({
    versaoVista: z.number().int().min(1),
    perfil: esquemaPerfilLeito,
    recursos: z.array(z.enum(CODIGOS_RECURSO_LEITO_NIR)).max(8).default([]),
    observacao: livre(300).nullable().default(null),
    motivo: motivoAlteracao(),
  })
  .strict();
export type CorrigirSolicitacaoEntrada = z.infer<typeof esquemaCorrigirSolicitacao>;

/**
 * "Excluir" a solicitação vira cancelamento com o motivo (operação crítica: senha). A linha nunca é apagada: fica
 * cancelada, com o motivo, quem e quando, para a auditoria (SBIS-26).
 */
export const esquemaExcluirSolicitacao = z
  .object({ motivo: motivoCancelamento(), senha: z.string().min(1, 'Confirme a sua senha.').max(200) })
  .strict();
export type ExcluirSolicitacaoEntrada = z.infer<typeof esquemaExcluirSolicitacao>;

/** Alterar a reserva vigente: outro leito e/ou nova validade (só no novo). */
export const esquemaAlterarReserva = z
  .object({
    leito: esquemaChaveLeito.optional(),
    validadeMin: z.number().int().min(15).max(1440).optional(),
    motivo: motivoAlteracao(),
  })
  .strict()
  .refine((e) => !!e.leito || !!e.validadeMin, {
    message: 'Escolha outro leito ou outra validade.',
    path: ['leito'],
  });
export type AlterarReservaEntrada = z.infer<typeof esquemaAlterarReserva>;

/** "Excluir" a reserva vira cancelamento com o motivo: a linha fica, e o leito volta a livre (a convertida recusa). */
export const esquemaExcluirReserva = z.object({ motivo: motivoCancelamento() }).strict();

/** Retirar a alta prevista vigente (versão nova marcada como retirada). */
export const esquemaRetirarDpa = z
  .object({
    internacao: id,
    anterior: id,
    motivo: motivo(5, 200, 'Informe o motivo (ao menos 5 caracteres).'),
  })
  .strict();
export type RetirarDpaEntrada = z.infer<typeof esquemaRetirarDpa>;

/** Alterar a barreira aberta: descrição, responsável e prazo. */
export const esquemaAlterarBarreira = z
  .object({
    descricao: motivo(5, 300, 'Descreva a barreira (ao menos 5 caracteres).').optional(),
    responsavel: motivo(3, 60, 'Informe quem resolve (setor ou função).').optional(),
    prazo: esquemaDataIso.optional(),
    motivo: motivoAlteracao(),
  })
  .strict()
  .refine((e) => e.descricao !== undefined || e.responsavel !== undefined || e.prazo !== undefined, {
    message: 'Altere a descrição, o responsável ou o prazo.',
    path: ['descricao'],
  });
export type AlterarBarreiraEntrada = z.infer<typeof esquemaAlterarBarreira>;

/** Encerrar a barreira (resolvida ou cancelada) com o motivo; vale também para a social vinda do serviço social. */
export const esquemaEncerrarBarreira = z
  .object({ resultado: z.enum(['resolvida', 'cancelada']), motivo: motivoAlteracao() })
  .strict();
export type EncerrarBarreiraEntrada = z.infer<typeof esquemaEncerrarBarreira>;

/** Remover o limite próprio de uma chave: volta ao padrão do estabelecimento. */
export const esquemaRemoverLimite = z
  .object({
    escopo: z.enum(ESCOPOS_LIMITE_PERMANENCIA),
    chave: textoCp1252(20)
      .overwrite((t) => t.trim().toUpperCase())
      .pipe(z.string().min(1, 'Informe a chave.')),
    motivo: motivoAlteracao(),
  })
  .strict();
export type RemoverLimiteEntrada = z.infer<typeof esquemaRemoverLimite>;

// ── Mapa de leitos ────────────────────────────────────────────────────────────────────────────────

/** Alterar o estado aberto do leito sem encerrar (motivo do bloqueio, precaução, previsão, observação). */
export const esquemaAlterarEstadoLeito = z
  .object({
    leito: esquemaChaveLeito,
    estado: z.enum(['bloqueio', 'precaucao', 'extra']),
    motivo: z.enum(CODIGOS_MOTIVO_BLOQUEIO_LEITO).optional(),
    precaucao: z.enum(CODIGOS_PRECAUCAO).optional(),
    previsaoFim: esquemaDataIso.nullable().optional(),
    observacao: livre(200).nullable().optional(),
    justificativa: motivoAlteracao(),
  })
  .strict()
  .refine(
    (e) =>
      e.motivo !== undefined ||
      e.precaucao !== undefined ||
      e.previsaoFim !== undefined ||
      e.observacao !== undefined,
    { message: 'Altere o motivo, a precaução, a previsão ou a observação.', path: ['motivo'] },
  );
export type AlterarEstadoLeitoEntrada = z.infer<typeof esquemaAlterarEstadoLeito>;

/** Limpar os atributos próprios do leito: volta ao padrão. */
export const esquemaLimparAtributosLeito = z
  .object({ leito: esquemaChaveLeito, justificativa: motivoAlteracao() })
  .strict();
export type LimparAtributosLeitoEntrada = z.infer<typeof esquemaLimparAtributosLeito>;

// ── Observação do PA ──────────────────────────────────────────────────────────────────────────────

/** Transferir o paciente de leito na observação (liberar e alocar na mesma transação). */
export const esquemaTransferirObservacao = z
  .object({ atendimento: id, leito: z.number().int().min(0).max(32_767), motivo: motivoAlteracao() })
  .strict();
export type TransferirObservacaoEntrada = z.infer<typeof esquemaTransferirObservacao>;
