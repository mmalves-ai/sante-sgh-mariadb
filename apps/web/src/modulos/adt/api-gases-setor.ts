// Cliente das rotas do consumo de gás por setor (C1-050, 05-SUP linha 30): /api/internacao/gases/setores.
import { z } from 'zod';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const G = '/api/internacao/gases/setores';

const opcao = z.object({ id: z.number(), nome: z.string() });
export const esquemaOpcoesGasSetor = z.object({ setores: z.array(opcao), gases: z.array(opcao) });

export const esquemaConsumoGasSetor = z.object({
  id: z.number(),
  setor: z.number(),
  setorNome: z.string(),
  insumo: z.number(),
  gasNome: z.string(),
  leito: z.number().nullable(),
  ponto: z.number().nullable(),
  fluxoLitrosMinuto: z.number().nullable(),
  inicio: z.string(),
  fim: z.string().nullable(),
  quantidadeLitros: z.number().nullable(),
  situacao: z.string(),
  observacao: z.string().nullable(),
  versao: z.number(),
});
export type ConsumoGasSetor = z.infer<typeof esquemaConsumoGasSetor>;

const parcela = z.object({
  registros: z.number(),
  horas: z.number(),
  litros: z.number(),
  semVolume: z.number(),
});
export const esquemaApuracaoGasSetor = z.object({
  de: z.string(),
  ate: z.string(),
  itens: z.array(
    z.object({
      setor: z.number().nullable(),
      setorNome: z.string().nullable(),
      gas: z.number(),
      gasNome: z.string(),
      pacientes: parcela,
      setorSemPaciente: parcela,
      total: parcela,
    }),
  ),
});
export type ApuracaoGasSetor = z.infer<typeof esquemaApuracaoGasSetor>;

const comId = z.object({ id: z.number().nullable() }).passthrough();
type Periodo = { de: string; ate: string; setor: number | null };

export const lerOpcoesGasSetor = () => ler(`${G}/opcoes`, esquemaOpcoesGasSetor);
export const lerConsumosGasSetor = (p: Periodo) =>
  ler(`${G}/consumos${qs(p)}`, z.object({ itens: z.array(esquemaConsumoGasSetor) }));
export const lerApuracaoGasSetor = (p: Periodo) => ler(`${G}/apuracao${qs(p)}`, esquemaApuracaoGasSetor);
export const registrarConsumoGasSetor = (corpo: {
  setor: number;
  insumo: number;
  fluxoLitrosMinuto: number | null;
  quantidadeLitros: number | null;
  inicio: string;
  fim: string | null;
  observacao: string | null;
}) => enviar(`${G}/consumos`, corpo, comId, novaChave('gas-setor-registrar'));
export const encerrarConsumoGasSetor = (id: number, versao: number) =>
  enviar(`${G}/consumos/${id}/encerrar`, { versao }, comId, novaChave('gas-setor-encerrar'));
export const cancelarConsumoGasSetor = (id: number, versao: number, motivo: string) =>
  enviar(`${G}/consumos/${id}/cancelar`, { versao, motivo }, comId, novaChave('gas-setor-cancelar'));
