// M44, regra 4: estouro sem atendimento médico obriga a reclassificação; mudança de quadro também (dados SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import { problemaDaReclassificacao, reclassificacaoObrigatoria } from './tempo-alvo.js';

const vigente = { id: 7, classificadoEm: '2026-10-23T10:00:00', tempoAlvoMin: 60 };
const base = {
  vigente,
  anterior: 7,
  motivo: 'estouro' as const,
  agora: '2026-10-23T11:01:00',
  atendimentoMedicoEm: null,
  encerrado: false,
};

describe('reclassificação', () => {
  it('obrigatória só no estouro sem atendimento médico', () => {
    expect(reclassificacaoObrigatoria(vigente, '2026-10-23T10:59:00', null)).toBe(false);
    expect(reclassificacaoObrigatoria(vigente, '2026-10-23T11:01:00', null)).toBe(true);
    expect(reclassificacaoObrigatoria(vigente, '2026-10-23T11:30:00', '2026-10-23T11:20:00')).toBe(false);
  });

  it('por estouro, só depois do estouro; por mudança de quadro, a qualquer momento', () => {
    expect(problemaDaReclassificacao(base)).toBeNull();
    expect(problemaDaReclassificacao({ ...base, agora: '2026-10-23T10:30:00' })).toBe('sem-estouro');
    expect(
      problemaDaReclassificacao({ ...base, agora: '2026-10-23T10:30:00', motivo: 'mudanca_quadro' }),
    ).toBeNull();
  });

  it('sobre a vigente lida (outra reclassificação chegou antes: colisão), sem classificação ou depois da decisão', () => {
    expect(problemaDaReclassificacao({ ...base, anterior: 6 })).toBe('anterior-desatualizada');
    expect(problemaDaReclassificacao({ ...base, vigente: null })).toBe('sem-classificacao');
    expect(problemaDaReclassificacao({ ...base, encerrado: true })).toBe('atendimento-encerrado');
  });
});
