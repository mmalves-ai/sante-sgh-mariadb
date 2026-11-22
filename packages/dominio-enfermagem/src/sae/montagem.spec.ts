// Montagem do processo de enfermagem e dose vigente da vacina (regra pura, dados sintéticos).
import { describe, expect, it } from 'vitest';
import { doseVigenteDaVacina, type ItemSae, montarProcessoSae } from './montagem.js';

const base = {
  codigo: null,
  caracteristicas: [],
  fatores: [],
  escala: null,
  meta: null,
  escalaMeta: null,
  frequencia: null,
  horarios: [],
  inicio: null,
  fim: null,
  situacao: null,
  nota: null,
  chave: null,
  usuario: 'enf.teste',
  em: '2026-10-22T10:00:00',
} as const;
const item = (x: Partial<ItemSae> & Pick<ItemSae, 'id' | 'tipo' | 'pai' | 'descricao'>): ItemSae => ({
  ...base,
  ...x,
});

describe('montarProcessoSae', () => {
  it('monta a árvore com evolução agrupada e atividade suspensa', () => {
    const itens: ItemSae[] = [
      item({
        id: 1,
        tipo: 'diagnostico',
        pai: null,
        codigo: 'D1',
        descricao: 'DIAG',
        caracteristicas: ['C1'],
      }),
      item({
        id: 2,
        tipo: 'resultado',
        pai: 1,
        codigo: 'R1',
        descricao: 'RES',
        escala: 2,
        meta: 4,
        escalaMeta: 4,
      }),
      item({ id: 3, tipo: 'intervencao', pai: 1, codigo: 'I1', descricao: 'INT' }),
      item({
        id: 4,
        tipo: 'atividade',
        pai: 3,
        descricao: 'ATV',
        frequencia: 2,
        horarios: ['08:00', '20:00'],
        inicio: '2026-10-22',
      }),
      item({ id: 5, tipo: 'suspensao', pai: 4, descricao: 'SUSP', nota: 'alta' }),
      item({
        id: 6,
        tipo: 'evolucao',
        pai: 2,
        descricao: 'EV',
        escala: 3,
        situacao: 'melhorada',
        nota: 'ok',
        chave: 'k#1',
      }),
      item({
        id: 7,
        tipo: 'evolucao',
        pai: 2,
        descricao: 'EV',
        escala: 3,
        situacao: 'melhorada',
        nota: 'ok',
        chave: 'k#2',
      }),
    ];
    const p = montarProcessoSae(
      {
        id: 9,
        versao: 1,
        avaliacao: 'A',
        sistema: 'SINT',
        versaoTerminologia: '1',
        usuario: 'u',
        em: 'e',
        registroProntuario: null,
      },
      itens,
      (tipo, _d, codigo) => ({ tipo, codigo, descricao: codigo }) as never,
    );
    expect(p.diagnosticos).toHaveLength(1);
    expect(p.diagnosticos[0]?.resultados[0]?.evolucoes).toHaveLength(2);
    expect(p.diagnosticos[0]?.intervencoes[0]?.atividades[0]?.suspensa?.motivo).toBe('alta');
    expect(p.evolucoes).toHaveLength(1);
  });
});

describe('doseVigenteDaVacina', () => {
  it('estorno anula; retificação troca a dose', () => {
    expect(doseVigenteDaVacina({ dose: 'D1', correcoes: [{ tipo: 'estorno', dados: null }] })).toBeNull();
    expect(
      doseVigenteDaVacina({ dose: 'D1', correcoes: [{ tipo: 'retificacao', dados: { dose: 'D2' } }] }),
    ).toBe('D2');
    expect(doseVigenteDaVacina({ dose: 'D1', correcoes: [] })).toBe('D1');
  });
});
