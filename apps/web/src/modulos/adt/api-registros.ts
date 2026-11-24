// Registros da internação além do retrato da admissão (F3.4, 04-INT linhas 65, 67 e 68): diagnósticos, acidente,
// histórico das guias (inicial e prorrogações) e quem opera cada unidade.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const I = '/api/internacoes';
const U = '/api/cadastros/estrutura/unidades';

export const esquemaRegistros = z.object({
  diagnosticos: z.array(
    z.object({
      sequencia: z.number(),
      tipo: z.string(),
      cid: z.number(),
      codigo: z.string(),
      nome: z.string(),
      registradoEm: z.string(),
      observacao: z.string().nullable(),
      situacao: z.enum(['vigente', 'substituido', 'retirado']),
      motivoRetirada: z.string().nullable(),
    }),
  ),
  acidentes: z.array(
    z.object({
      sequencia: z.number(),
      tipo: z.string(),
      ocorridoEm: z.string().nullable(),
      empregadorCnpj: z.string().nullable(),
      empregadorNome: z.string().nullable(),
      numeroComunicacao: z.string().nullable(),
      comunicacaoEmitidaEm: z.string().nullable(),
      local: z.string().nullable(),
    }),
  ),
  guias: z.array(
    z.object({
      sequencia: z.number(),
      tipo: z.string(),
      guia: z.string(),
      senha: z.string().nullable(),
      diarias: z.number(),
      inicio: z.string(),
      fim: z.string(),
      autorizador: z.string().nullable(),
      conta: z.number().nullable(),
      registradaEm: z.string(),
      motivoCorrecao: z.string().nullable(),
    }),
  ),
  diariasAutorizadas: z.number(),
});
export type RegistrosInternacao = z.infer<typeof esquemaRegistros>;

const esquemaGravado = z.object({ mensagem: z.string() }).passthrough();

export const esquemaOperadores = z.array(
  z.object({
    usuario: z.number(),
    login: z.string(),
    podeAdmitir: z.boolean(),
    podeTransferir: z.boolean(),
    podeDarAlta: z.boolean(),
  }),
);
export type OperadorUnidade = z.infer<typeof esquemaOperadores>[number];

export const lerRegistros = (reg: number) => ler(`${I}/${reg}/registros`, esquemaRegistros);
export const registrarDiagnostico = (reg: number, corpo: unknown, chave: string) =>
  enviar(`${I}/${reg}/diagnosticos`, corpo, esquemaGravado, chave);
export const retirarDiagnostico = (reg: number, sequencia: number, motivo: string, chave: string) =>
  enviar(`${I}/${reg}/diagnosticos/${sequencia}/retirada`, { motivo }, esquemaGravado, chave);
/** Corrige uma guia do histórico (sem linha nova nem diárias somadas); o período só muda na última. */
export const corrigirGuia = (reg: number, sequencia: number, corpo: unknown, chave: string) =>
  enviar(`${I}/${reg}/guias/${sequencia}/correcao`, corpo, esquemaGravado, chave);
export const registrarAcidente = (reg: number, corpo: unknown, chave: string) =>
  enviar(`${I}/${reg}/acidentes`, corpo, esquemaGravado, chave);
export const lerOperadores = (unidade: number) => ler(`${U}/${unidade}/operadores`, esquemaOperadores);

/** Período da próxima guia como a regra do servidor calcula (prévia na hora; o servidor confere de novo). */
export function previaDaGuia(
  guias: readonly { fim: string; inicio: string }[],
  entrada: string,
  diarias: number,
  inicio?: string,
): { inicio: string; fim: string } | null {
  if (!Number.isInteger(diarias) || diarias < 1) return null;
  const soma = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const ultima = guias[guias.length - 1];
  const i = inicio || (ultima ? soma(ultima.fim, 1) : entrada.slice(0, 10));
  return { inicio: i, fim: soma(i, diarias - 1) };
}
export const definirOperadores = (unidade: number, corpo: unknown, chave: string) =>
  enviar(`${U}/${unidade}/operadores`, corpo, esquemaGravado, chave);
