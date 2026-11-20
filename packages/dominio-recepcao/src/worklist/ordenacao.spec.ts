// Regra 5 do M27: a fila da recepção pela prioridade legal (Lei 13.466/2017: acima de 80 anos antes das demais
// prioridades) e as guias aguardando autorização, da mais antiga para a mais nova.
import type { SenhaDaWorklist } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  descricaoDoGrupo,
  esperaEmMinutos,
  ordenarGuiasPendentes,
  ordenarSenhasDaWorklist,
} from './ordenacao.js';

const s = (
  id: number,
  prioridade: '0' | '1' | '2',
  emitidaEm: string,
  grupo: number | null = null,
): SenhaDaWorklist => ({
  id,
  senha: `A${String(id).padStart(3, '0')}`,
  prioridade,
  grupo,
  grupoDescricao: '',
  emitidaEm,
  esperaMinutos: 0,
  situacao: 'aguardando',
  gerador: 'Recepção',
});

describe('fila da recepção pela prioridade legal', () => {
  it('acima de 80 anos, depois as demais prioridades, depois a normal; dentro do grupo, pela chegada', () => {
    const o = ordenarSenhasDaWorklist([
      s(1, '2', '2026-10-22T07:00:00'),
      s(2, '1', '2026-10-22T07:10:00', 4),
      s(3, '0', '2026-10-22T07:20:00'),
      s(4, '1', '2026-10-22T07:05:00', 3),
      s(5, '2', '2026-10-22T06:59:00'),
      s(6, '0', '2026-10-22T07:15:00'),
    ]);
    expect(o.map((x) => x.id)).toEqual([6, 3, 4, 2, 5, 1]);
  });
  it('a descrição do grupo: o detalhado do novo ou o da prioridade gravada pelo outro sistema', () => {
    expect(descricaoDoGrupo('1', 4)).toBe('Gestante');
    expect(descricaoDoGrupo('0', null)).toBe('Acima de 80 anos');
    expect(descricaoDoGrupo('1', null)).toBe('Demais prioridades');
    expect(descricaoDoGrupo('', null)).toBe('Normal');
    expect(descricaoDoGrupo('2', 99)).toBe('Normal');
  });
  it('guias aguardando autorização: a mais antiga primeiro', () => {
    const g = (reg: number, abertoEm: string) => ({
      reg,
      abertoEm,
      paciente: 'P',
      convenio: 'C',
      esperaMinutos: 0,
    });
    expect(
      ordenarGuiasPendentes([
        g(3, '2026-10-22T09:00:00'),
        g(1, '2026-10-22T08:00:00'),
        g(2, '2026-10-22T08:00:00'),
      ]).map((x) => x.reg),
    ).toEqual([1, 2, 3]);
  });
  it('a espera em minutos nunca é negativa', () => {
    expect(esperaEmMinutos('2026-10-22T08:00:00', '2026-10-22T08:42:30')).toBe(42);
    expect(esperaEmMinutos('2026-10-22T09:00:00', '2026-10-22T08:00:00')).toBe(0);
    expect(esperaEmMinutos('lixo', '2026-10-22T08:00:00')).toBe(0);
  });
});
