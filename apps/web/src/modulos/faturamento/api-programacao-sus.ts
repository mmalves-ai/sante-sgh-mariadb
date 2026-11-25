// Cliente das rotas da programação físico-orçamentária, dos tetos e das cotas SUS (F7, 06-SUS linha 54): /api/sus/programacao.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/programacao';
const comId = z.object({ id: z.number() }).passthrough();
const num = z.number().nullable();

export const esquemaSaldoSus = z.object({
  tipo: z.enum(['programacao', 'teto', 'cota']),
  id: z.number(),
  descricao: z.string(),
  instrumento: z.string(),
  quantidade: num,
  valor: num,
  consumoQuantidade: z.number(),
  consumoValor: z.number(),
  saldoQuantidade: num,
  saldoValor: num,
  percentual: num,
  situacao: z.enum(['livre', 'alerta', 'excedido']),
  bloqueia: z.boolean(),
  registros: z.number(),
  excedentes: z.number(),
  versao: num,
});
export type SaldoSus = z.infer<typeof esquemaSaldoSus>;

export const esquemaPainelProgramacao = z.object({
  competencia: z.string(),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  programacoes: z.array(
    z.object({
      id: z.number(),
      descricao: z.string().nullable(),
      contrato: num,
      contratoNumero: z.string().nullable(),
      vigenciaInicio: z.string(),
      vigenciaFim: z.string().nullable(),
      formaEntrada: z.string(),
      valorTotal: z.number(),
      situacao: z.string(),
      itens: z.number(),
      versao: z.number(),
    }),
  ),
  saldos: z.array(esquemaSaldoSus),
  registros: z.object({ bpa: z.number(), apac: z.number(), aih: z.number() }),
  remanejamentos: z.array(
    z.object({
      id: z.number(),
      cota: z.number(),
      tipo: z.string(),
      origem: z.string().nullable(),
      destino: z.string().nullable(),
      quantidade: num,
      valor: num,
      motivo: z.string(),
      situacao: z.string(),
      solicitadoEm: z.string(),
      doUsuario: z.boolean(),
      versao: z.number(),
    }),
  ),
});
export type PainelProgramacao = z.infer<typeof esquemaPainelProgramacao>;

const opcao = z.object({ id: z.number(), descricao: z.string() }).passthrough();

export const lerPainelProgramacao = (competencia: string) =>
  ler(`${B}?competencia=${encodeURIComponent(competencia)}`, esquemaPainelProgramacao);
export const lerOpcoesProgramacao = () =>
  ler(`${B}/opcoes`, z.object({ contratos: z.array(opcao), setores: z.array(opcao) }));
export const importarProgramacao = (corpo: {
  contrato: number | null;
  descricao: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  conteudo: string;
}) =>
  enviar(
    B,
    corpo,
    z.object({ id: z.number(), itens: z.number(), valorTotal: z.number() }).passthrough(),
    novaChave('sus-programacao'),
  );
export const ativarProgramacao = (id: number, versao: number) =>
  enviar(`${B}/${id}/ativar`, { versao }, comId, novaChave('sus-programacao-ativar'));
export const cancelarProgramacao = (id: number, versao: number) =>
  enviar(`${B}/${id}/cancelar`, { versao }, comId, novaChave('sus-programacao-cancelar'));
export const incluirLimiteSus = (corpo: Record<string, unknown>) =>
  enviar(`${B}/limites`, corpo, comId, novaChave('sus-limite'));
export const inativarLimiteSus = (tipo: 'teto' | 'cota', id: number, versao: number) =>
  enviar(`${B}/limites/${tipo}/${id}/inativar`, { versao }, comId, novaChave('sus-limite-inativar'));
export const remanejarCotaSus = (id: number, corpo: Record<string, unknown>) =>
  enviar(`${B}/cotas/${id}/remanejar`, corpo, comId, novaChave('sus-cota-remanejar'));
export const decidirRemanejamentoSus = (
  id: number,
  corpo: { aprovar: boolean; competencia: string; versao: number },
) => enviar(`${B}/remanejamentos/${id}/decidir`, corpo, comId, novaChave('sus-cota-decidir'));
