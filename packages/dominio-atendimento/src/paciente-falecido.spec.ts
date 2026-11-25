import { describe, expect, it } from 'vitest';
import { pacienteFalecido, recusarEntradaDeFalecido } from './paciente-falecido.js';

describe('02-CAD linha 13: entrada de paciente falecido', () => {
  it('paciente vivo passa em todos os atos', () => {
    for (const ato of ['atendimento', 'marcacao', 'internacao', 'pre-internacao'] as const)
      expect(recusarEntradaDeFalecido({ falecido: false, situacao: 'ativo' }, ato)).toEqual({ ok: true });
  });

  it('falecido pela declaração recusa com o ato e a data do óbito', () => {
    expect(
      recusarEntradaDeFalecido(
        { falecido: true, situacao: 'ativo', dataObito: '2026-11-22T10:00:00.000Z' },
        'marcacao',
      ),
    ).toEqual({
      ok: false,
      codigo: 'paciente-falecido',
      mensagem: 'Não é possível marcar horário: o paciente tem óbito registrado em 22/11/2026.',
    });
    expect(recusarEntradaDeFalecido({ falecido: true, dataObito: '2026-11-22' }, 'internacao')).toMatchObject(
      {
        ok: false,
        mensagem: 'Não é possível internar: o paciente tem óbito registrado em 22/11/2026.',
      },
    );
  });

  it('situação "obito" sem declaração ligada também recusa, sem data inventada', () => {
    expect(pacienteFalecido({ falecido: false, situacao: 'obito' })).toBe(true);
    expect(
      recusarEntradaDeFalecido({ falecido: false, situacao: 'obito', dataObito: null }, 'atendimento'),
    ).toEqual({
      ok: false,
      codigo: 'paciente-falecido',
      mensagem: 'Não é possível abrir atendimento: o paciente tem óbito registrado.',
    });
    expect(recusarEntradaDeFalecido({ falecido: true }, 'pre-internacao')).toMatchObject({
      mensagem: 'Não é possível agendar internação: o paciente tem óbito registrado.',
    });
  });

  it('data em formato desconhecido não entra na mensagem', () => {
    expect(recusarEntradaDeFalecido({ falecido: true, dataObito: 'ontem' }, 'atendimento')).toMatchObject({
      mensagem: 'Não é possível abrir atendimento: o paciente tem óbito registrado.',
    });
  });
});
