// Ciclo do resultado no banco do cliente (F3.5, 05-SADT linha 10): digitação com a faixa de referência congelada no
// momento do resultado, liberação só por quem tem habilitação para o setor e retificação do liberado com motivo, sem
// apagar a versão anterior (ela vai inteira para o histórico de versões). O exame retido na bancada não recebe
// resultado nem é liberado (conferirAvancoDoRetido, 05-SADT linha 8). Regra pura: a gravação só aplica a decisão.
import { conferirAvancoDoRetido } from '../mapa/distribuir.js';

/** Situações do exame pedido em que a bancada pode digitar o resultado. */
export const SITUACOES_DIGITAVEIS: readonly string[] = [
  'coletado',
  'em_analise',
  'resultado_digitado',
  'revisado',
];

/** A faixa de referência vigente do analito, copiada para o resultado (fica congelada mesmo se a faixa mudar). */
export interface FaixaDoAnalito {
  readonly faixa: number | null;
  readonly minimo: number | null;
  readonly maximo: number | null;
  readonly criticoMinimo: number | null;
  readonly criticoMaximo: number | null;
  readonly absurdoMinimo: number | null;
  readonly absurdoMaximo: number | null;
  readonly texto: string | null;
}

export interface ValorDigitado {
  readonly analito: number;
  readonly numero: number | null;
  readonly texto: string | null;
}

export interface AvaliacaoDoValor {
  readonly interpretacao: 'normal' | 'baixo' | 'alto' | 'critico_baixo' | 'critico_alto' | null;
  readonly anormal: boolean;
  readonly critico: boolean;
  readonly absurdo: boolean;
}

export type RecusaResultado =
  | 'exame-fechado'
  | 'exame-retido'
  | 'ja-liberado'
  | 'sem-valor'
  | 'analito-fora-do-exame'
  | 'analito-repetido'
  | 'valor-absurdo'
  | 'nao-digitado'
  | 'nao-habilitado'
  | 'nao-liberado'
  | 'motivo-curto'
  | 'sem-mudanca';

export const MENSAGEM_RESULTADO: Readonly<Record<RecusaResultado, string>> = {
  'exame-fechado': 'O exame não está na bancada (coletado ou em análise): não recebe resultado.',
  'exame-retido': 'O exame está retido na bancada: solte-o no mapa de trabalho antes de digitar ou liberar.',
  'ja-liberado': 'O resultado já foi liberado: para mudar, retifique com o motivo.',
  'sem-valor': 'Informe o valor de cada analito digitado (número ou texto).',
  'analito-fora-do-exame': 'O analito não faz parte deste exame.',
  'analito-repetido': 'O mesmo analito foi informado duas vezes.',
  'valor-absurdo': 'O valor está fora do limite de plausibilidade do analito: confira a digitação.',
  'nao-digitado': 'Só o resultado digitado pode ser liberado.',
  'nao-habilitado': 'A sessão não tem habilitação para liberar o resultado deste setor.',
  'nao-liberado': 'Só o resultado liberado é retificado; antes disso, corrija na digitação.',
  'motivo-curto': 'Informe o motivo da retificação (ao menos 10 letras).',
  'sem-mudanca': 'A retificação não muda nenhum valor do resultado.',
};

/** Interpretação do valor numérico pela faixa: crítico vence anormal; o absurdo é recusado na digitação. */
export function avaliarValor(numero: number | null, f: FaixaDoAnalito | null): AvaliacaoDoValor {
  if (numero === null || !f) return { interpretacao: null, anormal: false, critico: false, absurdo: false };
  const absurdo =
    (f.absurdoMinimo !== null && numero < f.absurdoMinimo) ||
    (f.absurdoMaximo !== null && numero > f.absurdoMaximo);
  if (f.criticoMinimo !== null && numero <= f.criticoMinimo)
    return { interpretacao: 'critico_baixo', anormal: true, critico: true, absurdo };
  if (f.criticoMaximo !== null && numero >= f.criticoMaximo)
    return { interpretacao: 'critico_alto', anormal: true, critico: true, absurdo };
  if (f.minimo !== null && numero < f.minimo)
    return { interpretacao: 'baixo', anormal: true, critico: false, absurdo };
  if (f.maximo !== null && numero > f.maximo)
    return { interpretacao: 'alto', anormal: true, critico: false, absurdo };
  if (f.minimo === null && f.maximo === null)
    return { interpretacao: null, anormal: false, critico: false, absurdo };
  return { interpretacao: 'normal', anormal: false, critico: false, absurdo };
}

/** A digitação (ou a correção antes da liberação): exame na bancada, não retido, valores dos analitos do exame. */
export function conferirDigitacao(a: {
  readonly situacaoExame: string;
  readonly retido: boolean;
  readonly situacaoResultado: string | null;
  readonly valores: readonly ValorDigitado[];
  readonly analitosDoExame: readonly number[];
  readonly faixas: ReadonlyMap<number, FaixaDoAnalito>;
}): RecusaResultado | null {
  const retido = conferirAvancoDoRetido(a.retido);
  if (retido) return retido;
  if (a.situacaoResultado === 'liberado' || a.situacaoResultado === 'retificado') return 'ja-liberado';
  if (!SITUACOES_DIGITAVEIS.includes(a.situacaoExame)) return 'exame-fechado';
  const vistos = new Set<number>();
  for (const v of a.valores) {
    if (vistos.has(v.analito)) return 'analito-repetido';
    vistos.add(v.analito);
    if (!a.analitosDoExame.includes(v.analito)) return 'analito-fora-do-exame';
    if (v.numero === null && !(v.texto ?? '').trim()) return 'sem-valor';
    if (avaliarValor(v.numero, a.faixas.get(v.analito) ?? null).absurdo) return 'valor-absurdo';
  }
  return a.valores.length ? null : 'sem-valor';
}

/** Setores cujo laudo é privativo de médico (Lei 12.842/2013, art. 4º, VII). */
export function liberacaoPrivativaDeMedico(tipoSetor: string): boolean {
  return ['imagem', 'endoscopia', 'metodos_graficos'].includes(tipoSetor);
}

/** A liberação: resultado digitado (ou conferido), exame não retido e profissional habilitado para o setor. */
export function conferirLiberacao(a: {
  readonly situacaoResultado: string | null;
  readonly retido: boolean;
  readonly habilitado: boolean;
}): RecusaResultado | null {
  const retido = conferirAvancoDoRetido(a.retido);
  if (retido) return retido;
  if (a.situacaoResultado === 'liberado' || a.situacaoResultado === 'retificado') return 'ja-liberado';
  if (a.situacaoResultado !== 'digitado' && a.situacaoResultado !== 'conferido') return 'nao-digitado';
  return a.habilitado ? null : 'nao-habilitado';
}

/** A retificação: só do liberado, com motivo, habilitação e alguma mudança de valor. */
export function conferirRetificacao(a: {
  readonly situacaoResultado: string | null;
  readonly motivo: string;
  readonly habilitado: boolean;
  readonly mudou: boolean;
}): RecusaResultado | null {
  if (a.situacaoResultado !== 'liberado' && a.situacaoResultado !== 'retificado') return 'nao-liberado';
  if (a.motivo.trim().length < 10) return 'motivo-curto';
  if (!a.habilitado) return 'nao-habilitado';
  return a.mudou ? null : 'sem-mudanca';
}

// Responsável pelo laudo do setor (05-SADT linha 25), exportado junto com o ciclo do resultado.
export * from './responsavel-setor.js';
