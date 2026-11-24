// Cliente das rotas de gases medicinais (F3.4, 04-INT linha 82): /api/internacao/gases.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const G = '/api/internacao/gases';

export const esquemaUsoGas = z.object({
  id: z.number(),
  insumo: z.number(),
  gasNome: z.string(),
  item: z.number().nullable(),
  local: z.string(),
  fluxoLitrosMinuto: z.number().nullable(),
  inicio: z.string(),
  fim: z.string().nullable(),
  horasUso: z.number().nullable(),
  usoAnterior: z.number().nullable(),
  situacao: z.string(),
  faturado: z.boolean(),
  conta: z.number().nullable(),
  observacao: z.string().nullable(),
  versao: z.number(),
});
export type UsoGas = z.infer<typeof esquemaUsoGas>;

const comId = z.object({ id: z.number().nullable() }).passthrough();

export const lerUsosGas = (atd: number) =>
  ler(`${G}/atendimentos/${atd}/usos`, z.object({ itens: z.array(esquemaUsoGas) }));
export const iniciarUsoGas = (corpo: {
  atendimento: number;
  insumo: number;
  local: string;
  fluxoLitrosMinuto: number | null;
  usoAnterior: number | null;
}) => enviar(`${G}/usos`, corpo, comId, novaChave('gas-iniciar'));
export const encerrarUsoGas = (id: number, versao: number) =>
  enviar(`${G}/usos/${id}/encerrar`, { versao }, comId, novaChave('gas-encerrar'));
export const cancelarUsoGas = (id: number, versao: number, motivo: string) =>
  enviar(`${G}/usos/${id}/cancelar`, { versao, motivo }, comId, novaChave('gas-cancelar'));
export const lancarGasesNaConta = (atd: number) =>
  enviar(
    `${G}/atendimentos/${atd}/lancar-conta`,
    {},
    z.object({ id: z.number().nullable(), itens: z.array(z.number()) }),
    novaChave('gas-lancar'),
  );
