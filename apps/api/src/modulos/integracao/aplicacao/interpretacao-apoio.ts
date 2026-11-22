// Interpretação do valor que chega do laboratório de apoio pelas regras do SADT (@sgh/dominio-sadt: a faixa do
// paciente, o fora da referência e o valor crítico), sem regra nova: só a composição para o valor do analito
// (referência aplicada, interpretação, anormal e crítico), a mesma que a digitação no setor usa.
// Melhoria: o resultado do apoio sai com a referência congelada, o sinal de anormal e de crítico, e o crítico abre o
// aviso com o prazo da regra (antes o retorno gravava só o valor e o crítico passava em silêncio).
import { type FaixaCritica, faixaDoPaciente, foraDaReferencia, valorCritico } from '@sgh/dominio-sadt';

/** Prazo de comunicação do crítico quando a faixa marca o crítico e nenhuma regra própria diz o prazo. */
export const PRAZO_CRITICO_PADRAO_MINUTOS = 30;

/** A faixa de referência vigente do analito para o paciente (já escolhida por sexo, idade e vigência). */
export interface FaixaDoAnalito {
  readonly id: number;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly texto: string | null;
  readonly criticoMinimo: number | null;
  readonly criticoMaximo: number | null;
}

/** A regra de valor crítico vigente do analito (lista aprovada pelo laboratório). */
export interface RegraCriticaDoAnalito {
  readonly id: number;
  readonly abaixoDe: number | null;
  readonly acimaDe: number | null;
  readonly prazoMinutos: number;
}

export type InterpretacaoValor = 'normal' | 'baixo' | 'alto' | 'critico_baixo' | 'critico_alto';

export interface ValorInterpretado {
  readonly referenciaMinimo: number | null;
  readonly referenciaMaximo: number | null;
  readonly referenciaTexto: string | null;
  readonly criticoMinimo: number | null;
  readonly criticoMaximo: number | null;
  readonly interpretacao: InterpretacaoValor | null;
  readonly anormal: boolean;
  readonly critico: boolean;
  /** Com o valor crítico: o prazo do aviso e a regra que o marcou (nula quando veio da faixa). */
  readonly prazoCriticoMinutos: number | null;
  readonly regraCritica: number | null;
}

/** A idade em dias completos na data (sem nascimento, nula). */
export function idadeEmDias(nascimento: Date | null, em: Date): number | null {
  if (!nascimento || Number.isNaN(nascimento.getTime())) return null;
  const d = Math.floor((em.getTime() - nascimento.getTime()) / 86_400_000);
  return d >= 0 ? d : null;
}

/** O valor do analito interpretado pela faixa do paciente e pela regra de crítico (a regra vale sobre a faixa). */
export function interpretarValorApoio(e: {
  readonly elemento: number;
  readonly valor: number | null;
  readonly faixa: FaixaDoAnalito | null;
  readonly regra: RegraCriticaDoAnalito | null;
  readonly paciente: { readonly sexo: 'M' | 'F' | null; readonly idadeAnos: number | null };
}): ValorInterpretado {
  const f = e.faixa;
  let minimo = f?.minimo ?? null;
  let maximo = f?.maximo ?? null;
  // A faixa só em texto ("12 a 16", "Homens: 13 a 17 / Mulheres: 12 a 16"): os limites da linha do paciente.
  if (f && minimo === null && maximo === null && f.texto) {
    const t = faixaDoPaciente(f.texto, e.paciente);
    minimo = t.minimo;
    maximo = t.maximo;
  }
  // Texto lido ao contrário não vira faixa (nunca inventa referência).
  if (minimo !== null && maximo !== null && maximo < minimo) {
    minimo = null;
    maximo = null;
  }
  const critica: FaixaCritica | null = e.regra
    ? {
        elemento: e.elemento,
        abaixoDe: e.regra.abaixoDe,
        acimaDe: e.regra.acimaDe,
        prazoMinutos: e.regra.prazoMinutos,
        ativo: true,
      }
    : f && (f.criticoMinimo !== null || f.criticoMaximo !== null)
      ? {
          elemento: e.elemento,
          abaixoDe: f.criticoMinimo,
          acimaDe: f.criticoMaximo,
          prazoMinutos: PRAZO_CRITICO_PADRAO_MINUTOS,
          ativo: true,
        }
      : null;
  const critico = valorCritico(e.valor, critica);
  const fora = foraDaReferencia(e.valor, { minimo, maximo });
  let interpretacao: InterpretacaoValor | null = null;
  if (e.valor !== null) {
    if (critico && critica)
      interpretacao =
        critica.abaixoDe !== null && e.valor < critica.abaixoDe ? 'critico_baixo' : 'critico_alto';
    else if (fora) interpretacao = fora === 'abaixo' ? 'baixo' : 'alto';
    else if (minimo !== null || maximo !== null) interpretacao = 'normal';
  }
  return {
    referenciaMinimo: minimo,
    referenciaMaximo: maximo,
    referenciaTexto: f?.texto ?? null,
    criticoMinimo: critica?.abaixoDe ?? null,
    criticoMaximo: critica?.acimaDe ?? null,
    interpretacao,
    anormal: critico || fora !== null,
    critico,
    prazoCriticoMinutos: critico && critica ? critica.prazoMinutos : null,
    regraCritica: critico && e.regra ? e.regra.id : null,
  };
}
