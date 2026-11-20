// Regra 10 do M24: quem prescreve o quê, pelo CBO; tipos e frequências fechados.
import { describe, expect, it } from 'vitest';
import { TIPOS_ITEM_PRESCRICAO } from '@sgh/contratos';
import {
  categoriaPorOcupacao,
  dosesNoPeriodo,
  ehDieta,
  exigeCoassinatura,
  frequencia,
  PLANO_DO_TIPO,
  planoPermitido,
  podePrescrever,
  SEM_FREQUENCIA,
  tipoDoPlano,
} from './catalogo.js';

describe('catálogo da prescrição', () => {
  it('cada tipo oferecido tem o código do cadastro, e de volta', () => {
    for (const t of TIPOS_ITEM_PRESCRICAO) expect(tipoDoPlano(PLANO_DO_TIPO[t])).toBe(t);
    expect(tipoDoPlano(5)).toBeNull();
    expect(ehDieta('jejum')).toBe(true);
    expect(ehDieta('medicamento')).toBe(false);
  });
  it('categorias pelo CBO', () => {
    expect(categoriaPorOcupacao('225125')).toBe('medico');
    expect(categoriaPorOcupacao('2231-F9')).toBe('residente');
    expect(categoriaPorOcupacao('223710')).toBe('nutricionista');
    expect(categoriaPorOcupacao('223208')).toBe('dentista');
    expect(categoriaPorOcupacao('223505')).toBe('enfermeiro');
    expect(categoriaPorOcupacao('322205')).toBe('outro');
    expect(categoriaPorOcupacao(null)).toBe('outro');
  });
  it('médico tudo; nutricionista só dieta; dentista no escopo; enfermeiro só o cuidado de enfermagem (M45.4); residente com coassinatura', () => {
    expect(TIPOS_ITEM_PRESCRICAO.every((t) => podePrescrever('medico', t))).toBe(true);
    expect(TIPOS_ITEM_PRESCRICAO.filter((t) => podePrescrever('nutricionista', t))).toEqual([
      'jejum',
      'dieta-livre',
      'dieta-oral',
      'dieta-enteral',
    ]);
    expect(TIPOS_ITEM_PRESCRICAO.filter((t) => podePrescrever('dentista', t))).toEqual([
      'medicamento',
      'solucao',
      'jejum',
      'dieta-oral',
      'procedimento',
    ]);
    expect(planoPermitido('nutricionista', 3)).toBe(true);
    expect(planoPermitido('nutricionista', 6)).toBe(false);
    expect(planoPermitido('medico', 99)).toBe(false);
    expect(TIPOS_ITEM_PRESCRICAO.filter((t) => podePrescrever('enfermeiro', t))).toEqual(['procedimento']);
    expect(podePrescrever('outro', 'procedimento')).toBe(false);
    expect(podePrescrever('residente', 'hemoterapia')).toBe(true);
    expect(exigeCoassinatura('residente')).toBe(true);
    expect(exigeCoassinatura('medico')).toBe(false);
  });
  it('frequências e número de doses', () => {
    expect(frequencia(null)).toBe(SEM_FREQUENCIA);
    expect(frequencia(0)).toBe(SEM_FREQUENCIA);
    expect(frequencia(6)).toBeNull();
    expect(dosesNoPeriodo(frequencia(9)!, 0)).toBe(3);
    expect(dosesNoPeriodo(frequencia(18)!, 3)).toBe(3);
    expect(dosesNoPeriodo(frequencia(18)!, 0)).toBe(1);
    expect(dosesNoPeriodo(frequencia(17)!, 0)).toBe(1);
  });
});
