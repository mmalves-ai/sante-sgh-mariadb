// W0-03, mercado M1 (plano-final.json, item W0-03; depende_de_dono: "os dois cálculos são construídos e a escolha fica em
// parâmetro, com o padrão de mercado — Padua clínico, Caprini cirúrgico"): a escala de TEV de cada perfil e a pendência
// de profilaxia ao prescritor. A pendência é o ÚLTIMO escore de TEV válido (não estornado) do paciente: em risco e sem
// decisão, está pendente; um escore mais novo sem risco a encerra; o estorno do escore a retira (desde o nascimento).
import type { EscalaTev, PerfilTev } from '@sgh/contratos';

export interface ParametrosTev {
  readonly clinico: EscalaTev;
  readonly cirurgico: EscalaTev;
}

/** O padrão de mercado quando o parâmetro não foi preenchido. */
export const PARAMETROS_TEV_PADRAO: ParametrosTev = { clinico: 'padua', cirurgico: 'caprini' };

const ehTev = (x: string): x is EscalaTev => x === 'caprini' || x === 'padua';

/** O parâmetro lido (valor fora das escalas de TEV volta ao padrão). */
export function parametrosTev(clinico: unknown, cirurgico: unknown): ParametrosTev {
  const c = String(clinico ?? '').trim();
  const r = String(cirurgico ?? '').trim();
  return {
    clinico: ehTev(c) ? c : PARAMETROS_TEV_PADRAO.clinico,
    cirurgico: ehTev(r) ? r : PARAMETROS_TEV_PADRAO.cirurgico,
  };
}

/** A escala do perfil confere com o parâmetro do estabelecimento? (a outra é recusada com a escala certa). */
export function conferirEscalaTev(
  escala: EscalaTev,
  perfil: PerfilTev,
  p: ParametrosTev,
): { ok: true } | { ok: false; codigo: 'escala-tev-do-perfil'; mensagem: string; esperada: EscalaTev } {
  const esperada = p[perfil];
  if (esperada === escala) return { ok: true };
  const nome = esperada === 'caprini' ? 'Caprini' : 'Padua';
  return {
    ok: false,
    codigo: 'escala-tev-do-perfil',
    esperada,
    mensagem: `Para o paciente ${perfil === 'clinico' ? 'clínico' : 'cirúrgico'} o estabelecimento usa a escala ${nome}.`,
  };
}

export interface EscoreTevLido {
  readonly id: number;
  readonly escala: string;
  readonly gatilho: string;
  readonly aferidoEm: string;
  readonly estornado: boolean;
}

/**
 * O escore de TEV que vale para a pendência: o último válido de Caprini ou Padua. Devolve `null` se não há nenhum; a
 * pendência existe quando ele tem o gatilho de profilaxia e ainda não foi decidido.
 */
export function escoreTevVigente<T extends EscoreTevLido>(escores: readonly T[]): T | null {
  const validos = escores
    .filter((e) => ehTev(e.escala) && !e.estornado)
    .sort((a, b) => b.aferidoEm.localeCompare(a.aferidoEm) || b.id - a.id);
  return validos[0] ?? null;
}

export function profilaxiaPendente(vigente: EscoreTevLido | null, decididos: ReadonlySet<number>): boolean {
  return !!vigente && vigente.gatilho === 'profilaxia' && !decididos.has(vigente.id);
}
