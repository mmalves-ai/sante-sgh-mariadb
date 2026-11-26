// Cliente do repasse da produção SUS aos profissionais (F7, 06-SUS linha 62): /api/sus/repasse. As gravações vão com o
// CSRF e a Idempotency-Key (uma por intenção de gravar); a recusa de negócio traz o texto do servidor.
import {
  BASES_REPASSE_SUS,
  INSTRUMENTOS_REPASSE_SUS,
  MODALIDADES_REPASSE_SUS,
  PAPEIS_REGRA_SUS,
} from '@sgh/dominio-repasse';
import { z } from 'zod';
import { enviar, ler, novaChave } from '../exames/api-exames.js';

const B = '/api/sus/repasse';
const vig = { inicio: z.string(), fim: z.string().nullable(), ativo: z.boolean(), versao: z.number() };

export const esquemaPainelRepasseSus = z.object({
  regras: z.array(
    z.object({
      id: z.number(),
      codigo: z.string(),
      descricao: z.string(),
      modalidade: z.enum(MODALIDADES_REPASSE_SUS),
      procedimentoCodigo: z.string().nullable(),
      grupoCodigo: z.string().nullable(),
      ocupacaoCodigo: z.string().nullable(),
      papel: z.enum(PAPEIS_REGRA_SUS),
      base: z.enum(BASES_REPASSE_SUS),
      percentualPago: z.number().nullable(),
      percentualDesconto: z.number().nullable(),
      valorFixo: z.number().nullable(),
      valorDesconto: z.number().nullable(),
      valorPonto: z.number().nullable(),
      prioridade: z.number(),
      ...vig,
    }),
  ),
  rateios: z.array(
    z.object({
      id: z.number(),
      procedimentoCodigo: z.string().nullable(),
      grupoCodigo: z.string().nullable(),
      profissional: z.number().nullable(),
      consideraSadt: z.boolean(),
      usaPeso: z.boolean(),
      pesoPercentual: z.number().nullable(),
      tetoPercentual: z.number().nullable(),
      ...vig,
    }),
  ),
  apuracoes: z.array(z.object({ id: z.number(), numero: z.string(), competencia: z.string(), versao: z.number() })),
});
export type PainelRepasseSus = z.infer<typeof esquemaPainelRepasseSus>;

export const esquemaLinhasRepasseSus = z.array(
  z.object({
    sequencia: z.number(),
    instrumento: z.string(),
    executante: z.number(),
    executanteNome: z.string(),
    papel: z.string(),
    regraCodigo: z.string().nullable(),
    base: z.number(),
    percentual: z.number().nullable(),
    glosa: z.number(),
    repasse: z.number(),
  }),
);
export type LinhaRepasseSus = z.infer<typeof esquemaLinhasRepasseSus>[number];

export const esquemaResumoApuracaoSus = z.object({
  apuracao: z.number(),
  competencia: z.string(),
  linhas: z.number(),
  excluidas: z.number(),
  totalRepasse: z.number(),
  totalGlosa: z.number(),
  pendencias: z.array(
    z.object({
      instrumento: z.enum(INSTRUMENTOS_REPASSE_SUS),
      origem: z.number(),
      motivo: z.enum(['sem-executante', 'sem-regra']),
    }),
  ),
  versao: z.number(),
});
export type ResumoApuracaoSus = z.infer<typeof esquemaResumoApuracaoSus>;

export interface EntradaRegraSus {
  codigo: string;
  descricao: string;
  modalidade: (typeof MODALIDADES_REPASSE_SUS)[number];
  procedimento: string | null;
  grupo: string | null;
  ocupacao: string | null;
  papel: (typeof PAPEIS_REGRA_SUS)[number];
  base: (typeof BASES_REPASSE_SUS)[number];
  percentualPago: number | null;
  percentualDesconto: number | null;
  valorFixo: number | null;
  valorDesconto: number | null;
  valorPonto: number | null;
  prioridade: number;
  inicio: string;
  fim: string | null;
}
export interface EntradaRateioSadt {
  procedimento: string | null;
  grupo: string | null;
  profissional: number | null;
  consideraSadt: boolean;
  usaPeso: boolean;
  pesoPercentual: number | null;
  tetoPercentual: number | null;
  inicio: string;
  fim: string | null;
}

const comId = z.object({ id: z.number() }).passthrough();

export const lerPainelRepasseSus = () => ler(B, esquemaPainelRepasseSus);
export const lerLinhasRepasseSus = (apuracao: number) =>
  ler(`${B}/apuracoes/${apuracao}/linhas`, esquemaLinhasRepasseSus);
export const incluirRegraRepasseSus = (corpo: EntradaRegraSus) =>
  enviar(`${B}/regras`, corpo, comId, novaChave('sus-repasse-regra'));
export const incluirRateioSadt = (corpo: EntradaRateioSadt) =>
  enviar(`${B}/rateios`, corpo, comId, novaChave('sus-repasse-rateio'));
export const encerrarRepasseSus = (tipo: 'regras' | 'rateios', id: number, versao: number, fim: string) =>
  enviar(`${B}/${tipo}/${id}/encerrar`, { versao, fim }, comId, novaChave('sus-repasse-encerrar'));
export const apurarRepasseSus = (apuracao: number, versao: number) =>
  enviar(`${B}/apuracoes/${apuracao}/apurar`, { versao }, esquemaResumoApuracaoSus, novaChave('sus-repasse-apurar'));
