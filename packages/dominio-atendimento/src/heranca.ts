// Herança do atendimento anterior (ficha do M20, seção 4 "Histórico do paciente"): as marcas da
// configuração dizem o que a nova ficha copia do atendimento anterior do paciente (convênio, profissional,
// carteirinha, plano, clínica, empresa, validade da carteirinha…). Retrato da cópia pc: convênio, profissional,
// carteirinha, plano, clínica, empresa, procedência e validade marcados; o resto não. A pessoa confere antes de gravar.
import { type CampoHerdado, HERANCAS } from '@sgh/contratos';

export type MarcasHeranca = Readonly<Record<string, string | null | undefined>>;

/** Os campos que a configuração manda herdar (coluna = 'T'). */
export function camposHerdados(marcas: MarcasHeranca): CampoHerdado[] {
  return HERANCAS.filter((h) => (marcas[h.coluna] ?? '').trim().toUpperCase() === 'T').map((h) => h.campo);
}

/** Os valores a pré-preencher: só os campos herdados com valor no atendimento anterior. */
export function aplicarHeranca(
  marcas: MarcasHeranca,
  anterior: Readonly<Partial<Record<CampoHerdado, string | number | null>>> | null,
): Partial<Record<CampoHerdado, string | number>> {
  if (!anterior) return {};
  const r: Partial<Record<CampoHerdado, string | number>> = {};
  for (const c of camposHerdados(marcas)) {
    const v = anterior[c];
    if (v !== null && v !== undefined && v !== '' && v !== 0) r[c] = v;
  }
  return r;
}
