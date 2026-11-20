import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  esquemaCompetenciaSus,
  esquemaFiltroCriticasSus,
  esquemaGerarCiha,
  esquemaReabrirCompetenciaSus,
  GRAVIDADE_DA_REGRA_SUS,
  REGRAS_CRITICA_SUS,
} from './sus.js';

describe('vocabulário do faturamento SUS (M51)', () => {
  it('competência AAAAMM desde a SIGTAP', () => {
    expect(esquemaCompetenciaSus.safeParse('202509').success).toBe(true);
    expect(esquemaCompetenciaSus.safeParse('202513').success).toBe(false);
    expect(esquemaCompetenciaSus.safeParse('200712').success).toBe(false);
    expect(esquemaCompetenciaSus.safeParse('2025-09').success).toBe(false);
  });

  it('entradas estritas, sem dado pessoal; reabrir exige justificativa', () => {
    const versao = '2026-10-24T10:00:00.000Z';
    expect(esquemaGerarCiha.safeParse({ competencia: '202509', versao }).success).toBe(true);
    expect(esquemaGerarCiha.safeParse({ competencia: '202509', versao, cpf: '1' }).success).toBe(false);
    expect(
      esquemaReabrirCompetenciaSus.safeParse({
        instrumento: 'ciha',
        competencia: '202509',
        versao,
        justificativa: 'curta',
      }).success,
    ).toBe(false);
    expect(esquemaFiltroCriticasSus.parse({ instrumento: 'ciha', competencia: '202509' })).toMatchObject({
      pagina: 0,
      porPagina: 50,
    });
  });

  it('toda regra tem gravidade', () => {
    expect(Object.keys(GRAVIDADE_DA_REGRA_SUS).sort()).toEqual([...REGRAS_CRITICA_SUS].sort());
  });

  it('permissões no formato do catálogo, eventos da regra 10 e as chaves dos quatro instrumentos', () => {
    const sus = CATALOGO_DECLARADO.filter((p) => /^faturamento\.sus/.test(p.codigo));
    expect(sus.length).toBeGreaterThanOrEqual(12);
    for (const p of sus) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado.length).toBeGreaterThan(0);
    }
    const eventos = Object.values(EVENTOS_AUDITAVEIS).map((e) => e.codigo);
    for (const c of [
      'faturamento.competenciaSus.fechada',
      'faturamento.ciha.gerada',
      'faturamento.bpa.gerado',
      'faturamento.aih.registrada',
      'faturamento.retornoSus.importado',
    ])
      expect(eventos).toContain(c);
    const chaves = RECURSOS_DESLIGADOS.filter((r) => r.marco === 'M51').map((r) => r.chave);
    expect(chaves.sort()).toEqual([
      'faturamento.susAih',
      'faturamento.susApac',
      'faturamento.susBpa',
      'faturamento.susCiha',
    ]);
  });
});
