// Cliente dos serviços acessórios da conta (F8, 06-FAT linha 23): layout do arquivo do tarifador, importação das
// ligações e busca de item cobrável para as regras de remoção e de ligação. As regras e o lançamento na conta usam
// o cliente das regras comerciais (api-regras-comerciais.ts). A leitura do arquivo é do @sgh/dominio-faturamento,
// a mesma do servidor: a prévia aparece antes de gravar.
import { z } from 'zod';
import { enviar, ler } from '../exames/api-exames.js';

const F = '/api/faturamento';

const esquemaLayout = z.object({
  id: z.number(),
  versao: z.number(),
  descricao: z.string(),
  ativo: z.boolean(),
  separador: z.enum(['ponto_virgula', 'virgula', 'tabulacao', 'barra']),
  cabecalho: z.boolean(),
  formatoData: z.enum(['dia_mes_ano', 'ano_mes_dia']),
  formatoDuracao: z.enum(['segundos', 'minutos', 'horas_minutos_segundos']),
  decimal: z.enum([',', '.']),
  dddLocal: z.string().nullable(),
  colunaRamal: z.number().nullable(),
  colunaDataHora: z.number(),
  colunaHora: z.number().nullable(),
  colunaDuracao: z.number(),
  colunaNumero: z.number(),
  colunaValor: z.number().nullable(),
  colunaAtendimento: z.number().nullable(),
});
export type LayoutLido = z.infer<typeof esquemaLayout>;
const esquemaItem = z.object({ id: z.number(), codigo: z.string(), descricao: z.string() });
export type ItemCobravel = z.infer<typeof esquemaItem>;

const esquemaServicos = z.object({ layouts: z.array(esquemaLayout), itens: z.array(esquemaItem) });
const esquemaImportacao = z.object({
  lidas: z.number(),
  registradas: z.number(),
  repetidas: z.number(),
  outroRamal: z.number(),
  recusadas: z.number(),
  porAbrangencia: z.record(z.string(), z.number()),
  linhasRecusadas: z.array(z.object({ linha: z.number(), motivo: z.string() })),
});
export type ResultadoImportacao = z.infer<typeof esquemaImportacao>;

export const lerServicosAcessorios = () => ler(`${F}/servicos-acessorios`, esquemaServicos);
export const buscarItensCobraveis = (termo: string) =>
  ler(`${F}/servicos-acessorios/itens?termo=${encodeURIComponent(termo)}`, z.array(esquemaItem));
export const salvarLayoutTarifador = (corpo: unknown, chave: string) =>
  enviar(`${F}/servicos-acessorios/layouts`, corpo, z.object({ id: z.number() }).passthrough(), chave);
export const importarLigacoes = (
  corpo: { layoutId: number; conteudo: string; contaId: number | null; ramal: string | null },
  chave: string,
) => enviar(`${F}/ligacoes-tarifadas/importacao`, corpo, esquemaImportacao, chave);
