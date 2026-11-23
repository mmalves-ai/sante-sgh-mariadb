// Regra 1 do M33: a regra mais específica vence; desempate pela vigência mais recente e pelo maior ID.
import { describe, expect, it } from 'vitest';
import { item, regra } from './fixtures.spec-util.js';
import {
  compararEspecificidade,
  dimensoesFixadas,
  motivoNaoAplica,
  resolverRegra,
} from './resolver-regra.js';

describe('resolverRegra', () => {
  it('grupo de ato: a regra com grupo casa o item do mesmo grupo e vence a geral; outro grupo não vale', () => {
    // O "ato" da regra da origem é o grupo de ato do procedimento (não a função na equipe): caso sintético ATO 42.
    const geral = regra({ id: 1 });
    const grupo42 = regra({ id: 2, grupoAto: 42, percentual: 70 });
    const r = resolverRegra(item({ grupoAto: 42 }), [geral, grupo42]);
    expect(r.regra?.id).toBe(2);
    expect(r.dimensoes).toEqual(['grupoAto', 'convenio']);
    const outro = resolverRegra(item({ grupoAto: 7 }), [geral, grupo42]);
    expect(outro.regra?.id).toBe(1);
    expect(outro.ignoradas).toContainEqual({ regra: 2, motivo: 'outra-dimensao', dimensao: 'grupoAto' });
    expect(motivoNaoAplica(grupo42, item({ grupoAto: null }))).toEqual({
      motivo: 'outra-dimensao',
      dimensao: 'grupoAto',
    });
  });

  it('grupo de ato é independente da função na equipe: a regra por grupo não olha a função do executante', () => {
    const grupo42 = regra({ id: 3, grupoAto: 42 });
    expect(motivoNaoAplica(grupo42, item({ grupoAto: 42, ato: 9 }))).toBeNull();
    const funcaoEGrupo = regra({ id: 4, grupoAto: 42, ato: 1 });
    expect(resolverRegra(item({ grupoAto: 42, ato: 1 }), [grupo42, funcaoEGrupo]).regra?.id).toBe(4);
  });

  it('profissional vence procedimento, que vence convênio', () => {
    const geral = regra({ id: 1 });
    const proc = regra({ id: 2, procedimentoInicial: 10101012 });
    const prof = regra({ id: 3, profissional: 77 });
    const r = resolverRegra(item(), [geral, proc, prof]);
    expect(r.regra?.id).toBe(3);
    expect(r.dimensoes).toEqual(['profissional', 'convenio']);
    expect(r.ignoradas).toEqual([
      { regra: 2, motivo: 'menos-especifica' },
      { regra: 1, motivo: 'menos-especifica' },
    ]);
  });

  it('procedimento único vence a faixa; faixa mais estreita vence a larga', () => {
    const larga = regra({ id: 1, procedimentoInicial: 10000000, procedimentoFinal: 19999999 });
    const estreita = regra({ id: 2, procedimentoInicial: 10101000, procedimentoFinal: 10101099 });
    const unico = regra({ id: 3, procedimentoInicial: 10101012, procedimentoFinal: 10101012 });
    expect(resolverRegra(item(), [larga, estreita]).regra?.id).toBe(2);
    expect(resolverRegra(item(), [larga, estreita, unico]).regra?.id).toBe(3);
  });

  it('empate de dimensões: vigência mais recente já começada; depois o maior ID', () => {
    const antiga = regra({ id: 10, vigencia: '2025-01-01', percentual: 40 });
    const nova = regra({ id: 5, vigencia: '2026-06-01', percentual: 45 });
    const futura = regra({ id: 11, vigencia: '2026-12-01' });
    const r = resolverRegra(item(), [antiga, nova, futura]);
    expect(r.regra?.id).toBe(5);
    expect(r.ignoradas).toContainEqual({ regra: 11, motivo: 'fora-da-vigencia' });
    const gemea = regra({ id: 6, vigencia: '2026-06-01' });
    expect(resolverRegra(item(), [nova, gemea]).regra?.id).toBe(6);
  });

  it('sem regra que valha: null com os motivos de cada uma', () => {
    const r = resolverRegra(item({ tipoConta: 'E', hora: '23:00' }), [
      regra({ id: 1, profissional: 99 }),
      regra({ id: 2, procedimentoInicial: 20000000 }),
      regra({ id: 3, convenio: 400 }),
      regra({ id: 4, tipoConta: 'I' }),
      regra({ id: 5, horaInicial: '07:00', horaFinal: '19:00' }),
    ]);
    expect(r.regra).toBeNull();
    expect(r.dimensoes).toEqual([]);
    expect(r.ignoradas.map((i) => i.motivo)).toEqual([
      'outro-profissional',
      'outro-procedimento',
      'outra-dimensao',
      'outro-tipo-de-conta',
      'fora-do-horario',
    ]);
    expect(r.ignoradas[2]?.dimensao).toBe('convenio');
  });

  it('tipo de conta A vale para externa e internação', () => {
    expect(motivoNaoAplica(regra({ id: 1, tipoConta: 'A' }), item({ tipoConta: 'E' }))).toBeNull();
    expect(motivoNaoAplica(regra({ id: 1, tipoConta: 'E' }), item({ tipoConta: 'E' }))).toBeNull();
  });

  it('procedimento abaixo do início da faixa não vale', () => {
    const r = regra({ id: 1, procedimentoInicial: 10101013, procedimentoFinal: 10101099 });
    expect(motivoNaoAplica(r, item())?.motivo).toBe('outro-procedimento');
  });

  it('dimensões fixadas e comparação simétrica', () => {
    const a = regra({ id: 1, tipoConta: 'I', especialidade: 5, procedimentoInicial: 1 });
    expect(dimensoesFixadas(a)).toEqual(['procedimento', 'especialidade', 'tipoConta', 'convenio']);
    const b = regra({ id: 2, convenio: null });
    expect(compararEspecificidade(a, b)).toBeLessThan(0);
    expect(compararEspecificidade(b, a)).toBeGreaterThan(0);
    expect(dimensoesFixadas(b)).toEqual([]);
  });
});
