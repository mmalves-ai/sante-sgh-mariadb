// Regras puras da fila da senha (regra-fila.ts): a ordem pelo cadastro do serviço, o peso do grupo de prioridade e o
// grupo atribuído pelo botão na emissão.
import { describe, expect, it } from 'vitest';
import { grupoDaEmissao, ordemDosServicos, ordenarCandidatas, type SenhaCandidata } from './regra-fila.js';

const s = (id: number, emitidaEm: string, extra: Partial<SenhaCandidata> = {}): SenhaCandidata => ({
  id,
  emitidaEm,
  prioritaria: false,
  pesoGrupo: null,
  horarioMarcacao: null,
  ...extra,
});

const fila = [
  s(1, '2026-11-20T08:00:00'),
  s(2, '2026-11-20T08:01:00', { prioritaria: true, pesoGrupo: 2 }),
  s(3, '2026-11-20T08:02:00', { prioritaria: true, pesoGrupo: 1 }),
  s(4, '2026-11-20T08:03:00', { horarioMarcacao: '2026-11-20T07:30:00' }),
];

describe('regra da fila da senha', () => {
  it('chegada: pela emissão, sem olhar prioridade', () => {
    expect(ordenarCandidatas(fila, 'chegada').map((x) => x.id)).toEqual([1, 2, 3, 4]);
  });

  it('prioridade: o peso do grupo decide entre as prioritárias (menor antes), depois as normais pela chegada', () => {
    expect(ordenarCandidatas(fila, 'prioridade').map((x) => x.id)).toEqual([3, 2, 1, 4]);
  });

  it('horário da marcação: a senha ligada à marcação entra pelo horário marcado', () => {
    expect(ordenarCandidatas(fila, 'horario_marcacao').map((x) => x.id)).toEqual([4, 1, 2, 3]);
  });

  it('intercalada: as prioritárias seguidas já chamadas contam', () => {
    expect(ordenarCandidatas(fila, 'intercalada', { intercalar: 1 }).map((x) => x.id)).toEqual([3, 1, 2, 4]);
    expect(
      ordenarCandidatas(fila, 'intercalada', { intercalar: 1, prioritariasSeguidas: 1 }).map((x) => x.id),
    ).toEqual([1, 3, 4, 2]);
  });

  it('a ordem dos serviços do guichê: a mesma em todos; desconhecida ou divergente é recusada', () => {
    expect(ordemDosServicos(['horario_marcacao', 'horario_marcacao'])).toEqual({
      ok: true,
      ordem: 'horario_marcacao',
    });
    expect(ordemDosServicos(['chegada', 'prioridade'])).toMatchObject({
      ok: false,
      codigo: 'ordens-fila-diferentes',
    });
    expect(ordemDosServicos(['qualquer'])).toMatchObject({ ok: false, codigo: 'ordem-fila-desconhecida' });
    expect(ordemDosServicos([])).toMatchObject({ ok: false });
  });

  it('a emissão: o grupo escolhido no balcão vale; sem escolha, o do botão do serviço', () => {
    expect(grupoDaEmissao(7, 3)).toBe(7);
    expect(grupoDaEmissao(null, 3)).toBe(3);
    expect(grupoDaEmissao(null, null)).toBeNull();
  });
});
