// Sinais vitais e controles (ficha do M25, regra 13; cap-05b §5.8): unidade padronizada e faixa plausível; fora da
// faixa de alerta pede a confirmação; fora da faixa plausível é recusado (erro de digitação); a retificação cria uma
// versão nova com a justificativa (a anterior fica guardada).
import { SINAIS_VITAIS, type TipoSinalVital } from '@sgh/contratos';

export type ResultadoSinal =
  | { readonly ok: true; readonly unidade: string; readonly foraDaFaixa: boolean }
  | {
      readonly ok: false;
      readonly codigo: 'sinal-implausivel' | 'sinal-confirmar' | 'sinal-tipo';
      readonly mensagem: string;
    };

const fmt = (n: number) => String(n).replace('.', ',');

export function validarSinal(s: {
  readonly tipo: string;
  readonly valor: number;
  readonly confirmadoForaDaFaixa: boolean;
}): ResultadoSinal {
  const d = (SINAIS_VITAIS as Record<string, (typeof SINAIS_VITAIS)[TipoSinalVital] | undefined>)[s.tipo];
  if (!d) return { ok: false, codigo: 'sinal-tipo', mensagem: 'Tipo de sinal vital desconhecido.' };
  if (!Number.isFinite(s.valor) || s.valor < d.minimo || s.valor > d.maximo)
    return {
      ok: false,
      codigo: 'sinal-implausivel',
      mensagem: `${d.rotulo}: ${fmt(s.valor)} ${d.unidade} está fora da faixa plausível (${fmt(d.minimo)} a ${fmt(d.maximo)}); confira o valor.`,
    };
  if (s.tipo === 'acvpu' && !Number.isInteger(s.valor))
    return {
      ok: false,
      codigo: 'sinal-implausivel',
      mensagem: 'O nível de consciência é um dos cinco da escala.',
    };
  if (s.tipo === 'dor' && !Number.isInteger(s.valor))
    return { ok: false, codigo: 'sinal-implausivel', mensagem: 'A dor vai de 0 a 10, em números inteiros.' };
  const [baixo, alto] = d.alerta;
  const fora = s.valor < baixo || s.valor > alto;
  if (fora && !s.confirmadoForaDaFaixa)
    return {
      ok: false,
      codigo: 'sinal-confirmar',
      mensagem: `${d.rotulo}: ${fmt(s.valor)} ${d.unidade} está fora da faixa esperada (${fmt(baixo)} a ${fmt(alto)}); confirme o valor.`,
    };
  return { ok: true, unidade: d.unidade, foraDaFaixa: fora };
}

export interface VersaoSinal {
  readonly id: number;
  readonly versao: number;
  readonly substituidoPor: number | null;
}

/** Regra 13: a retificação é uma versão nova (a seguinte), com a justificativa; a vigente é a sem substituta. */
export function conferirRetificacao(r: {
  readonly atual: VersaoSinal | null;
  readonly justificativa: string;
}): { readonly ok: true; readonly versao: number } | { readonly ok: false; readonly mensagem: string } {
  if (!r.atual) return { ok: false, mensagem: 'O sinal vital não foi encontrado.' };
  if (r.atual.substituidoPor !== null)
    return { ok: false, mensagem: 'Este registro já foi retificado: retifique a versão vigente.' };
  if (r.justificativa.trim().length < 10)
    return { ok: false, mensagem: 'Justifique a retificação (10 caracteres ou mais).' };
  return { ok: true, versao: r.atual.versao + 1 };
}

/** As versões vigentes (as sem substituta). */
export function vigentes<T extends VersaoSinal>(lista: readonly T[]): T[] {
  return lista.filter((s) => s.substituidoPor === null);
}
