// Regra 8 (primeira parte): escala publicada só muda com motivo; a publicação confere vazio, conselho e furo.
import { describe, expect, it } from 'vitest';
import { conferirMudancaNaEscala, conferirPublicacao, type SituacaoParaPublicar } from './publicacao.js';

const base: SituacaoParaPublicar = {
  estado: 'rascunho',
  plantoesPrevistos: 10,
  furos: 0,
  bloqueadosPeloConselho: 0,
  justificativaFuro: null,
};
const codigo = (
  x: Partial<typeof base> & { justificativaFuro?: string | null; estado?: 'rascunho' | 'publicada' },
) => {
  const r = conferirPublicacao({ ...base, ...x });
  return r.ok ? 'ok' : r.codigo;
};

describe('publicação e mudança da escala (regra 8)', () => {
  it('rascunho muda sem motivo; publicada só com motivo de 10 caracteres', () => {
    expect(conferirMudancaNaEscala('rascunho', null).ok).toBe(true);
    expect(conferirMudancaNaEscala('publicada', null)).toMatchObject({ ok: false, codigo: 'sem-motivo' });
    expect(conferirMudancaNaEscala('publicada', 'curto').ok).toBe(false);
    expect(conferirMudancaNaEscala('publicada', 'Atestado médico do titular').ok).toBe(true);
  });

  it('publica uma vez, não publica vazia nem com conselho vencido no dia', () => {
    expect(codigo({})).toBe('ok');
    expect(codigo({ estado: 'publicada' })).toBe('ja-publicada');
    expect(codigo({ plantoesPrevistos: 0 })).toBe('escala-vazia');
    expect(codigo({ bloqueadosPeloConselho: 1 })).toBe('conselho-vencido-na-escala');
    const r = conferirPublicacao({ ...base, bloqueadosPeloConselho: 2 });
    expect(r.ok ? '' : r.mensagem).toContain('2 plantões');
  });

  it('furo de cobertura só publica com a justificativa (D-FURO-52)', () => {
    expect(codigo({ furos: 1 })).toBe('furo-sem-justificativa');
    const r = conferirPublicacao({ ...base, furos: 3 });
    expect(r.ok ? '' : r.mensagem).toContain('3 turnos');
    expect(
      codigo({ furos: 3, justificativaFuro: 'Contratação em andamento; cobertura pelo sobreaviso' }),
    ).toBe('ok');
  });
});
