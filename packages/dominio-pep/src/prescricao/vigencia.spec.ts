// Regra 1 do M24: vigência de 24 h pela regra do horário de medicação da unidade (medido: internados 16:01 às 16:00;
// externo a partir do minuto da prescrição); uma prescrição ativa por atendimento e período.
import { describe, expect, it } from 'vitest';
import {
  periodoDe,
  periodoLivre,
  periodos,
  periodoSugerido,
  regraDaUnidade,
  situacaoVigencia,
  sobrepoe,
} from './vigencia.js';
import { minLocal } from './tempo.js';

const INT = { horarioInicial: '1601', considerar: 0 };
const ROTEIRO = { horarioInicial: '1300', considerar: 0 };
const EXT = { horarioInicial: '0000', considerar: 3 };

describe('vigência', () => {
  it('antes da virada: o atual começou ontem às 16:01; o seguinte começa hoje', () => {
    const p = periodos(INT, '2026-06-20T10:30');
    expect(p.atual).toEqual({ inicio: '2026-06-19T16:01', fim: '2026-06-20T16:00' });
    expect(p.seguinte).toEqual({ inicio: '2026-06-20T16:01', fim: '2026-06-21T16:00' });
  });
  it('na virada exata e depois dela, o atual começa hoje', () => {
    expect(periodos(INT, '2026-06-20T16:01').atual.inicio).toBe('2026-06-20T16:01');
    expect(periodos(INT, '2026-06-20T16:00').atual.inicio).toBe('2026-06-19T16:01');
    expect(periodos(INT, '2026-06-20T23:59').atual.fim).toBe('2026-06-21T16:00');
  });
  it('virada às 13:00 (regra 2 do cadastro): 13:00 às 12:59', () => {
    expect(periodos(ROTEIRO, '2026-06-20T12:59').atual).toEqual({
      inicio: '2026-06-19T13:00',
      fim: '2026-06-20T12:59',
    });
    expect(periodos(ROTEIRO, '2026-06-20T13:00').atual.inicio).toBe('2026-06-20T13:00');
  });
  it('externo: o período começa no minuto da prescrição, 1.439 minutos', () => {
    const p = periodos(EXT, '2026-06-20T15:12');
    expect(p.atual).toEqual({ inicio: '2026-06-20T15:12', fim: '2026-06-21T15:11' });
    expect(minLocal(p.atual.fim) - minLocal(p.atual.inicio)).toBe(1439);
  });
  it('situação: futura, vigente, vencida', () => {
    const p = periodoDe(minLocal('2026-06-20T16:01'));
    expect(situacaoVigencia(p, '2026-06-20T16:00')).toBe('futura');
    expect(situacaoVigencia(p, '2026-06-21T16:00')).toBe('vigente');
    expect(situacaoVigencia(p, '2026-06-21T16:01')).toBe('vencida');
  });
  it('período sugerido: o atual livre; ocupado, o seguinte; os dois ocupados, nenhum', () => {
    const { atual, seguinte } = periodos(INT, '2026-06-20T10:00');
    expect(periodoSugerido(INT, '2026-06-20T10:00', [])?.periodo).toBe('atual');
    expect(periodoSugerido(INT, '2026-06-20T10:00', [atual])?.periodo).toBe('seguinte');
    expect(periodoSugerido(INT, '2026-06-20T10:00', [atual, seguinte])).toBeNull();
    expect(periodoSugerido(EXT, '2026-06-20T10:00', [periodos(EXT, '2026-06-20T10:00').atual])).toBeNull();
    expect(periodoLivre(seguinte, [atual])).toBe(true);
    expect(sobrepoe(atual, seguinte)).toBe(false);
  });
  it('regra da unidade: a do bloco; senão a padrão do tipo de atendimento de menor código', () => {
    const regras = [
      { id: 1, tipoAtendimento: 'E', horarioInicial: '0000', considerar: 3, padrao: true },
      { id: 2, tipoAtendimento: 'I', horarioInicial: '1300', considerar: 0, padrao: true },
      { id: 4, tipoAtendimento: 'I', horarioInicial: '1601', considerar: 0, padrao: true },
    ];
    const blocos = new Map([['UTI-1', 4]]);
    expect(regraDaUnidade(regras, blocos, 'UTI-1 ', 'I')?.id).toBe(4);
    expect(regraDaUnidade(regras, blocos, 'OUTRO', 'I')?.id).toBe(2);
    expect(regraDaUnidade(regras, blocos, null, 'E')).toMatchObject({ id: 1, considerar: 3 });
    expect(regraDaUnidade(regras, blocos, null, 'U')).toBeNull();
    expect(
      regraDaUnidade(
        [{ id: 9, tipoAtendimento: 'I', horarioInicial: null, considerar: null, padrao: true }],
        blocos,
        null,
        'I',
      ),
    ).toEqual({ id: 9, horarioInicial: '0000', considerar: 0 });
  });
});
