// M51 (etapa 1): os textos do faturamento SUS cobrem toda regra da crítica, toda recusa do domínio, instrumentos,
// fontes e situações, e não citam o sistema anterior.
import {
  FONTES_REMUNERACAO_CIHA,
  GRAVIDADES_CRITICA_SUS,
  INSTRUMENTOS_SUS,
  REGRAS_CRITICA_SUS,
  type RegraCriticaSus,
  SITUACOES_COMPETENCIA_SUS,
  SITUACOES_CRITICA_SUS,
} from '@sgh/contratos';
import type { RecusaCompetenciaSus } from '@sgh/dominio-faturamento';
import { describe, expect, it } from 'vitest';
import { mensagensSus as m } from './i18n-sus';

// Conferência de tipo: toda regra e toda recusa do domínio têm texto (falta uma, o tsc recusa).
const regras: Record<RegraCriticaSus, string> = m.criticas.regras;
const recusas: Record<RecusaCompetenciaSus, string> = m.recusas;

describe('textos do faturamento SUS', () => {
  it('cobrem regras, recusas, instrumentos, fontes e situações', () => {
    for (const r of REGRAS_CRITICA_SUS) expect(regras[r]).toBeTruthy();
    expect(Object.keys(regras)).toHaveLength(REGRAS_CRITICA_SUS.length);
    for (const r of Object.keys(recusas)) expect(recusas[r as RecusaCompetenciaSus]).toBeTruthy();
    for (const i of INSTRUMENTOS_SUS) expect(m.instrumentos[i]).toBeTruthy();
    for (const f of FONTES_REMUNERACAO_CIHA) expect(m.fontes[f]).toBeTruthy();
    for (const g of GRAVIDADES_CRITICA_SUS) expect(m.gravidades[g]).toBeTruthy();
    for (const s of SITUACOES_CRITICA_SUS) expect(m.situacoesCritica[s]).toBeTruthy();
    for (const s of SITUACOES_COMPETENCIA_SUS) expect(m.situacoesCompetencia[s]).toBeTruthy();
  });

  it('nenhum texto cita o sistema anterior pelo nome nem pela tabela', () => {
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = valores(m).join('\n');
    expect(tudo).not.toMatch(/spdata|legado|sistema atual|FCCTRLANCIHA|TBPROSUS|HTPROSUS|FCCTAEXT/i);
  });
});
