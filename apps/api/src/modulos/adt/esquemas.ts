// Entradas das operações de gravação da internação, dos leitos, da higienização e do SAME (M21): o mesmo Zod dos
// contratos na tela, na API, na porta de memória e nas operações do Executor sobre o banco do cliente.
import {
  esquemaCancelarAlta,
  esquemaCancelarAltaMedica,
  esquemaCorrigirPreInternacao,
  esquemaDarAlta,
  esquemaExcluirInternacao,
  esquemaExcluirMovimento,
  esquemaInternar,
  esquemaLiberarLeito,
  esquemaMovimentarProntuario,
  esquemaPreInternar,
  esquemaRegistrarGuia,
  esquemaSolicitarLimpeza,
  esquemaTransferirLeito,
  esquemaTrocarClinica,
  esquemaTrocarConvenio,
  esquemaTrocarEspecialidade,
  esquemaTrocarMedico,
} from '@sgh/contratos';
import { recusa } from '@sgh/nucleo';
import { z, type ZodType } from 'zod';

const idCadastro = z.number().int().positive().max(2_147_483_647);

/**
 * Melhoria: os cadastros escolhidos pela tela vão pelo id (o caráter de admissão e o da TISS, a categoria do
 * atendimento, a modalidade, o motivo do cancelamento, o motivo da troca de leito) e o procedimento declara a origem
 * (SIGTAP ou item faturável). Sem a escolha, vale o único cadastro ativo que serve; mais de um é recusa. Pedido de
 * contrato (lote 03-01): levar estes campos aos esquemas de @sgh/contratos e às telas.
 */
export const esquemaInternarBanco = esquemaInternar.safeExtend({
  caraterAdmissao: idCadastro.optional(),
  caraterTiss: idCadastro.optional(),
  categoriaAtendimento: idCadastro.optional(),
  modalidade: idCadastro.optional(),
  procedimentoOrigem: z.enum(['sigtap', 'item']).optional(),
});
export type InternarBancoEntrada = z.infer<typeof esquemaInternarBanco>;
export const esquemaCancelarAltaBanco = esquemaCancelarAlta.safeExtend({
  motivoCancelamento: idCadastro.optional(),
});
export type CancelarAltaBancoEntrada = z.infer<typeof esquemaCancelarAltaBanco>;
export const esquemaCancelarAltaMedicaBanco = esquemaCancelarAltaMedica.safeExtend({
  motivoCancelamento: idCadastro.optional(),
});
export const esquemaTransferirLeitoBanco = esquemaTransferirLeito.safeExtend({
  motivoTroca: idCadastro.optional(),
});
export type TransferirLeitoBancoEntrada = z.infer<typeof esquemaTransferirLeitoBanco>;

export const ESQUEMAS_ADT: Readonly<Record<string, ZodType>> = {
  'internacao.internar': esquemaInternarBanco,
  'internacao.preInternar': esquemaPreInternar,
  'internacao.corrigirPreInternacao': esquemaCorrigirPreInternacao,
  'internacao.trocarConvenio': esquemaTrocarConvenio,
  'internacao.trocarClinica': esquemaTrocarClinica,
  'internacao.trocarEspecialidade': esquemaTrocarEspecialidade,
  'internacao.trocarMedico': esquemaTrocarMedico,
  'internacao.registrarGuia': esquemaRegistrarGuia,
  'internacao.darAlta': esquemaDarAlta,
  'internacao.transferirLeito': esquemaTransferirLeitoBanco,
  'internacao.cancelarAlta': esquemaCancelarAltaBanco,
  'internacao.excluirInternacao': esquemaExcluirInternacao,
  'hotelaria.solicitarLimpeza': esquemaSolicitarLimpeza,
  'hotelaria.liberarLeito': esquemaLiberarLeito,
  'same.movimentarProntuario': esquemaMovimentarProntuario,
  'same.excluirMovimento': esquemaExcluirMovimento,
};

/** O Zod da operação; operação desconhecida é recusa. */
export function esquemaDaOperacao(op: string): ZodType {
  const e = ESQUEMAS_ADT[op];
  if (!e) throw recusa('operacao-desconhecida', `Operação desconhecida na internação: ${op}.`);
  return e;
}
