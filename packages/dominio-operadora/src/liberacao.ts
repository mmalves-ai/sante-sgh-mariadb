// Regra 1 do M56 (ficha, seções 8 e 12; POL-3): o módulo é construído e entregue DESLIGADO por estabelecimento. A chave
// de cada fatia (`operadora.<recurso>`) só vale com a do módulo (`operadora`) ligada; desligar a do módulo recolhe
// tudo de uma vez (a operadora volta ao sistema que usa hoje), sem mexer nas chaves das fatias. Sem nenhuma chave
// registrada, tudo está desligado. Puro: recebe as chaves que valem para quem pergunta (já resolvidas por escopo).
import {
  CHAVE_MODULO_OPERADORA,
  CHAVES_FATIA_OPERADORA,
  type ChaveOperadora,
  type RecursoOperadora,
} from '@sgh/contratos';

export type SituacaoChaveOperadora = 'desligada' | 'ligada' | 'aguardando-modulo';

const FATIAS = new Set<string>(CHAVES_FATIA_OPERADORA.map((c) => `operadora.${c.recurso}`));

/** A chave é do módulo de operadora (a do módulo ou a de uma fatia)? */
export function ehChaveOperadora(chave: string): chave is ChaveOperadora {
  return chave === CHAVE_MODULO_OPERADORA || FATIAS.has(chave);
}

/** Chave da fatia de um recurso (`beneficiarios` → `operadora.beneficiarios`). */
export function chaveDaFatia(recurso: RecursoOperadora): ChaveOperadora {
  return `operadora.${recurso}`;
}

/** Situação de uma chave da operadora diante das chaves ligadas. */
export function situacaoChaveOperadora(
  chave: ChaveOperadora,
  ligadas: ReadonlySet<string>,
): SituacaoChaveOperadora {
  if (!ligadas.has(chave)) return 'desligada';
  if (chave === CHAVE_MODULO_OPERADORA || ligadas.has(CHAVE_MODULO_OPERADORA)) return 'ligada';
  return 'aguardando-modulo';
}

/** A chave vale (a fatia ligada e o módulo ligado)? É o que a rota e a tela da fatia conferem. */
export function chaveOperadoraValendo(chave: ChaveOperadora, ligadas: ReadonlySet<string>): boolean {
  return situacaoChaveOperadora(chave, ligadas) === 'ligada';
}

export interface SituacaoModuloOperadora {
  readonly modulo: SituacaoChaveOperadora;
  readonly fatias: Readonly<Record<RecursoOperadora, SituacaoChaveOperadora>>;
  /** Fatias ligadas que não valem porque o módulo está desligado (a tela de funcionalidades avisa). */
  readonly aguardandoModulo: readonly RecursoOperadora[];
}

/** Retrato do módulo para a tela de funcionalidades e para a casca (o menu da operadora só aparece com o módulo). */
export function situacaoModuloOperadora(ligadas: ReadonlySet<string>): SituacaoModuloOperadora {
  const fatias = {} as Record<RecursoOperadora, SituacaoChaveOperadora>;
  const aguardando: RecursoOperadora[] = [];
  for (const c of CHAVES_FATIA_OPERADORA) {
    const s = situacaoChaveOperadora(chaveDaFatia(c.recurso), ligadas);
    fatias[c.recurso] = s;
    if (s === 'aguardando-modulo') aguardando.push(c.recurso);
  }
  return {
    modulo: situacaoChaveOperadora(CHAVE_MODULO_OPERADORA, ligadas),
    fatias,
    aguardandoModulo: aguardando,
  };
}
