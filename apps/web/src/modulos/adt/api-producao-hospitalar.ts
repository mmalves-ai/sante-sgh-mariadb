// Cliente das rotas da produção hospitalar mensal e da categoria clínica do atendimento (F8, 09-AREA linha 87):
// /api/internacao/producao-hospitalar.
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const S = '/api/internacao/producao-hospitalar';
const ok = z.object({ ok: z.boolean(), mensagem: z.string() }).passthrough();
const opcao = z.object({ id: z.number(), rotulo: z.string() });
const n = z.number().nullable();

export const esquemaIndicadores = z.object({
  leitosOperacionais: z.number(),
  entradas: z.number(),
  saidas: z.number(),
  obitos: z.number(),
  transferenciasExternas: z.number(),
  pacienteDia: z.number(),
  leitoDia: z.number(),
  taxaOcupacao: n,
  mediaPermanencia: n,
  giroLeito: n,
  intervaloSubstituicao: n,
  taxaMortalidade: n,
  saidasComPrevisao: z.number(),
  saidasNoPrazo: z.number(),
  pontualidadeAlta: n,
  valorProduzido: z.number(),
  diasSemFaixa: z.number(),
});
export type IndicadoresProducaoTela = z.infer<typeof esquemaIndicadores>;
const porClinica = esquemaIndicadores.extend({ clinicaId: z.number().nullable() });

export const esquemaPainelProducao = z.object({
  mes: z.string(),
  hoje: z.string(),
  situacao: z.enum(['nao_apurada', 'aberta', 'fechada']),
  aoVivo: z.object({
    mes: z.string(),
    de: z.string(),
    ate: z.string(),
    dias: z.number(),
    total: esquemaIndicadores,
    porClinica: z.array(porClinica),
  }),
  gravada: z.array(
    porClinica.extend({
      situacao: z.enum(['aberta', 'fechada']),
      apuradoAte: z.string(),
      apuradoEm: z.string(),
      fechadoEm: z.string().nullable(),
      versao: z.number(),
    }),
  ),
  clinicas: z.array(opcao),
});
export type PainelProducaoTela = z.infer<typeof esquemaPainelProducao>;

export const esquemaFaixas = z.object({
  hoje: z.string(),
  faixas: z.array(
    z.object({
      id: z.number(),
      clinicaId: z.number(),
      clinica: z.string(),
      todasUnidades: z.boolean(),
      inicio: z.string(),
      fim: z.string().nullable(),
      valorDiaria: z.number(),
      observacao: z.string().nullable(),
      vigente: z.boolean(),
    }),
  ),
  clinicas: z.array(opcao),
});

export const esquemaCategorias = z.object({
  atendimento: z.object({
    id: z.number(),
    numero: z.string(),
    entrada: z.string(),
    saida: z.string().nullable(),
    internado: z.boolean(),
  }),
  periodos: z.array(
    z.object({
      id: z.number(),
      clinicaId: z.number(),
      clinica: z.string(),
      inicio: z.string(),
      fim: z.string().nullable(),
      diarias: z.number(),
      valor: z.number(),
      diasSemFaixa: z.number(),
      emAberto: z.boolean(),
    }),
  ),
  valorTotal: z.number(),
  clinicas: z.array(opcao),
});
export type CategoriasTela = z.infer<typeof esquemaCategorias>;

export const lerPainelProducao = (mes: string) =>
  ler(`${S}?mes=${encodeURIComponent(mes)}`, esquemaPainelProducao);
export const apurarProducao = (mes: string, fechar: boolean) =>
  enviar(`${S}/apurar`, { mes, fechar }, ok, novaChave('producao-apurar'));
export const lerFaixasCategoria = () => ler(`${S}/faixas`, esquemaFaixas);
export const incluirFaixaCategoria = (corpo: Record<string, unknown>) =>
  enviar(`${S}/faixas`, corpo, ok, novaChave('producao-faixa'));
export const lerCategoriasAtendimento = (numero: string) =>
  ler(`${S}/categorias?atendimento=${encodeURIComponent(numero)}`, esquemaCategorias);
export const classificarCategoria = (corpo: { atendimentoId: number; clinicaId: number; inicio: string }) =>
  enviar(`${S}/categorias`, corpo, ok, novaChave('producao-categoria'));
