// Regra 5 do M24: alergia ativa ao princípio (ou à classe) bloqueia; libera só com justificativa.
import { describe, expect, it } from 'vitest';
import { contexto, item, produto } from './fabrica.spec-util.js';
import { alertasAlergia } from './alergia.js';
import { avaliarAlertas, impede, justificativaAlergia } from './motor.js';

const dipirona = produto({ produto: 10, principiosAtivos: [501] });
const alergia = { alergia: 7, nome: 'Dipirona', principios: [501, 502] };

describe('alergia', () => {
  it('princípio do item ligado à alergia ativa gera o alerta', () => {
    const a = alertasAlergia(item('i1', [{ produto: dipirona }]), contexto({ alergias: [alergia] }));
    expect(a).toHaveLength(1);
    expect(a[0]?.id).toBe('alergia:10:7');
  });
  it('sem princípio em comum, nenhum alerta (caso-limite: alergia sem princípios)', () => {
    expect(
      alertasAlergia(
        item('i1', [{ produto: dipirona }]),
        contexto({ alergias: [{ ...alergia, principios: [] }] }),
      ),
    ).toEqual([]);
    expect(
      alertasAlergia(item('i1', [{ produto: produto({ produto: 2 }) }]), contexto({ alergias: [alergia] })),
    ).toEqual([]);
  });
  it('bloqueia até a justificativa e libera mantido com justificativa; a justificativa vai para a coluna do item', () => {
    const base = {
      itens: [item('i1', [{ produto: dipirona }])],
      ctx: contexto({ alergias: [alergia], interacoes: [] }),
      foraDaCategoria: [],
      dietas: [],
    };
    const sem = avaliarAlertas({ ...base, decisoes: new Map() });
    expect(sem[0]?.nivel).toBe('justificar');
    expect(impede(sem)).toEqual({ impede: true, motivo: 'alerta-sem-justificativa' });
    const curta = avaliarAlertas({
      ...base,
      decisoes: new Map([['i1', [{ alerta: 'alergia:10:7', decisao: 'mantido', justificativa: 'curta' }]]]),
    });
    expect(impede(curta).impede).toBe(true);
    const ok = avaliarAlertas({
      ...base,
      decisoes: new Map([
        [
          'i1',
          [
            {
              alerta: 'alergia:10:7',
              decisao: 'mantido',
              justificativa: 'Reação leve antiga; dessensibilizado',
            },
          ],
        ],
      ]),
    });
    expect(impede(ok).impede).toBe(false);
    expect(justificativaAlergia(ok, 'i1')).toBe('Reação leve antiga; dessensibilizado');
    expect(justificativaAlergia(ok, 'outro')).toBeNull();
  });
  it('item retirado diante do alerta não impede', () => {
    const a = avaliarAlertas({
      itens: [item('i1', [{ produto: dipirona }])],
      ctx: contexto({ alergias: [alergia] }),
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map([['i1', [{ alerta: 'alergia:10:7', decisao: 'retirado' }]]]),
    });
    expect(impede(a).impede).toBe(false);
  });
});
