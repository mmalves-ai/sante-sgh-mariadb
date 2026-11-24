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

// Regra de cobrança do gás (faixas e uso simultâneo): a tela da regra (F3.4-3).
export const esquemaRegraGas = z.object({
  id: z.number(),
  gas: z.number(),
  cobranca: z.number().nullable(),
  fonte: z.number().nullable(),
  plano: z.number().nullable(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
  versao: z.number(),
  regra: z.object({
    unidade: z.string(),
    toleranciaMinutos: z.number(),
    fracaoMinimaMinutos: z.number().nullable(),
    arredondamento: z.string(),
    percentualSimultaneo: z.number().nullable(),
    faixas: z.array(
      z.object({
        horasInicio: z.number(),
        horasFim: z.number().nullable(),
        item: z.number().nullable(),
        quantidade: z.number(),
      }),
    ),
    simultaneos: z.array(
      z.object({ gas: z.number(), tratamento: z.string(), percentual: z.number().nullable() }),
    ),
  }),
});
export type RegraGas = z.infer<typeof esquemaRegraGas>;
export interface NovaRegraGas {
  gas: number;
  cobranca: number | null;
  fonte: number | null;
  plano: number | null;
  unidade: string;
  toleranciaMinutos: number;
  fracaoMinimaMinutos: number | null;
  arredondamento: string;
  percentualSimultaneo: number | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  faixas: { horasInicio: number; horasFim: number | null; item: number | null; quantidade: number }[];
  simultaneos: { gas: number; tratamento: string; percentual: number | null }[];
}
export const lerRegrasGas = (gas: number) =>
  ler(`${G}/regras?gas=${gas}`, z.object({ itens: z.array(esquemaRegraGas) }));
export const incluirRegraGas = (corpo: NovaRegraGas) =>
  enviar(`${G}/regras`, corpo, comId, novaChave('gas-regra'));
export const encerrarRegraGas = (id: number, versao: number, vigenciaFim: string) =>
  enviar(`${G}/regras/${id}/encerrar`, { versao, vigenciaFim }, comId, novaChave('gas-regra-fim'));
