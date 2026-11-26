// Cliente do ciclo de esterilização pelos testes dos indicadores e da rejeição no reprocessamento (CME; F7, 04-CME
// linha 116). Toda gravação leva a chave de idempotência; o encerramento leva a versão lida (409 se outro gravou antes).
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const C = '/api/cirurgia/cme';

export const CATEGORIAS_INDICADOR = ['fisico', 'quimico', 'biologico', 'bowie_dick'] as const;
export const RESULTADOS_TESTE = ['pendente', 'aprovado', 'reprovado', 'inconclusivo'] as const;
const indicador = z.enum(['conforme', 'nao_conforme', 'pendente']);

export const esquemaPainelCiclos = z.object({
  ciclos: z.array(
    z.object({
      id: z.number(),
      numero: z.string(),
      lote: z.string(),
      situacao: z.string(),
      inicio: z.string().nullable(),
    }),
  ),
  tipos: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      categoria: z.enum(CATEGORIAS_INDICADOR),
      exigeLote: z.boolean(),
      exigeControle: z.boolean(),
      liberacaoDepende: z.boolean(),
    }),
  ),
  motivos: z.array(
    z.object({
      id: z.number(),
      descricao: z.string(),
      fase: z.number().nullable(),
      exigeRecolhimento: z.boolean(),
    }),
  ),
  fases: z.array(z.object({ id: z.number(), descricao: z.string(), ordem: z.number() })),
  rejeicoes: z.array(
    z.object({
      id: z.number(),
      motivo: z.string(),
      fase: z.string(),
      pacote: z.number().nullable(),
      etiqueta: z.string().nullable(),
      ciclo: z.number().nullable(),
      numeroCiclo: z.string().nullable(),
      situacao: z.string(),
      exigeRecolhimento: z.boolean(),
      recolhidos: z.number(),
      pendentes: z.number(),
      rejeitadoEm: z.string().nullable(),
    }),
  ),
});
export type PainelCiclos = z.infer<typeof esquemaPainelCiclos>;

export const esquemaCicloComTestes = z.object({
  id: z.number(),
  numero: z.string(),
  lote: z.string(),
  equipamento: z.string(),
  metodo: z.string(),
  situacao: z.string(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
  versao: z.number(),
  implante: z.boolean(),
  indicadores: z.object({ fisico: indicador, quimico: indicador, biologico: indicador }),
  testes: z.array(
    z.object({
      id: z.number(),
      sequencia: z.number(),
      tipo: z.number(),
      descricao: z.string(),
      categoria: z.enum(CATEGORIAS_INDICADOR),
      resultado: z.enum(RESULTADOS_TESTE),
      lote: z.string().nullable(),
      validade: z.string().nullable(),
      leitura: z.string().nullable(),
      responsavel: z.string().nullable(),
    }),
  ),
  pacotes: z.array(z.object({ id: z.number(), etiqueta: z.string(), situacao: z.string() })),
});
export type CicloComTestes = z.infer<typeof esquemaCicloComTestes>;

const esquemaGravado = z.object({}).passthrough();

export interface TesteEntrada {
  tipo: number;
  resultado: (typeof RESULTADOS_TESTE)[number];
  lote: string | null;
  validade: string | null;
  incubacaoInicio: string | null;
  leitura: string | null;
  controlePositivoOk: boolean | null;
  valorMedido: string | null;
  observacao: string | null;
}
export interface RejeicaoEntrada {
  objeto: 'pacote' | 'ciclo';
  pacote: number | null;
  ciclo: number | null;
  motivo: number;
  fase: number;
  descricao: string | null;
  retorna: boolean;
  faseRetorno: number | null;
}

export const lerPainelCiclos = () => ler(`${C}/ciclos`, esquemaPainelCiclos);
export const lerCicloComTestes = (id: number) => ler(`${C}/ciclos/${id}/testes`, esquemaCicloComTestes);
export const registrarTeste = (ciclo: number, e: TesteEntrada) =>
  enviar(`${C}/ciclos/${ciclo}/testes`, e, esquemaGravado, novaChave('cme-teste'));
export const encerrarCiclo = (ciclo: number, versao: number, observacao: string | null) =>
  enviar(`${C}/ciclos/${ciclo}/encerrar`, { versao, observacao }, esquemaGravado, novaChave('cme-encerrar'));
export const rejeitar = (e: RejeicaoEntrada) =>
  enviar(`${C}/rejeicoes`, e, esquemaGravado, novaChave('cme-rejeitar'));
export const recolher = (rejeicao: number, pacote: number) =>
  enviar(`${C}/rejeicoes/${rejeicao}/recolher`, { pacote }, esquemaGravado, novaChave('cme-recolher'));
