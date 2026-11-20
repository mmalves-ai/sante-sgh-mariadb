// Códigos fechados da prescrição (M24; ficha, seção 8; cap-11 §11.2): o tipo do item do cadastro de tipos de
// lançamento (19 tipos; os 11 usados em 2026 são oferecidos), as frequências (21 do cadastro; as 16 usadas em 2026
// mais "sem frequência" cobrem os casos de 2026; as 5 de intervalo oncológico não são oferecidas porque o tipo
// oncológico nunca foi usado) e quem prescreve o quê pelo CBO (regra 10; cap-08 §8.4).
import type { Frequencia, NaturezaFrequencia } from '@sgh/contratos';

/** Frequências oferecidas (as usadas em 2026), com a natureza que decide os horários previstos. */
export const FREQUENCIAS: readonly Frequencia[] = [
  { id: 1, nome: 'ACM', natureza: 'acm', doses: 1, intervaloHoras: null },
  { id: 2, nome: 'ACM Contínua', natureza: 'acm-continua', doses: 1, intervaloHoras: null },
  { id: 3, nome: 'Única', natureza: 'unica', doses: 1, intervaloHoras: null },
  { id: 4, nome: 'Contínua', natureza: 'continua', doses: 1, intervaloHoras: null },
  { id: 30, nome: '24/24', natureza: 'intervalo', doses: 1, intervaloHoras: 24 },
  { id: 31, nome: '24 em 24 horas', natureza: 'intervalo', doses: 1, intervaloHoras: 24 },
  { id: 5, nome: '12/12', natureza: 'intervalo', doses: 2, intervaloHoras: 12 },
  { id: 9, nome: '08/08', natureza: 'intervalo', doses: 3, intervaloHoras: 8 },
  { id: 11, nome: '06/06', natureza: 'intervalo', doses: 4, intervaloHoras: 6 },
  { id: 13, nome: '04/04', natureza: 'intervalo', doses: 6, intervaloHoras: 4 },
  { id: 14, nome: '03/03', natureza: 'intervalo', doses: 8, intervaloHoras: 3 },
  { id: 15, nome: '02/02', natureza: 'intervalo', doses: 12, intervaloHoras: 2 },
  { id: 16, nome: '01/01', natureza: 'intervalo', doses: 24, intervaloHoras: 1 },
  { id: 17, nome: 'Outras', natureza: 'outras', doses: null, intervaloHoras: null },
  { id: 18, nome: 'Relativa', natureza: 'relativa', doses: null, intervaloHoras: null },
  { id: 19, nome: 'Livre Demanda', natureza: 'livre-demanda', doses: 1, intervaloHoras: null },
];

/** "Sem frequência" (o cadastro do item não pede; 4% dos itens de 2026). */
export const SEM_FREQUENCIA: Frequencia = {
  id: 0,
  nome: 'Sem frequência',
  natureza: 'sem',
  doses: null,
  intervaloHoras: null,
};

export function frequencia(id: number | null | undefined): Frequencia | null {
  if (id === null || id === undefined || id === 0) return SEM_FREQUENCIA;
  return FREQUENCIAS.find((f) => f.id === id) ?? null;
}

/** Natureza que exige condição objetiva e intervalo mínimo quando marcada "se necessário" (regra 9). */
export const NATUREZAS_A_CRITERIO: readonly NaturezaFrequencia[] = ['acm', 'acm-continua', 'livre-demanda'];

/** Quantas doses o item tem no período (a coluna do número de doses do item: 1 nas de dose única ou a critério). */
export function dosesNoPeriodo(f: Frequencia, relativos: number): number {
  if (f.natureza === 'relativa') return Math.max(1, relativos);
  return f.doses ?? 1;
}

// ── Quem prescreve o quê (regra 10): as regras moram nos contratos (o adaptador confere no estado relido) ──

export {
  categoriaPorOcupacao,
  ehDieta,
  exigeCoassinatura,
  PLANO_DO_TIPO,
  planoPermitido,
  podePrescrever,
  tipoDoPlano,
  TIPOS_DIETA,
} from '@sgh/contratos';
