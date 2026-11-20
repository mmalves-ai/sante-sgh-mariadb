// Regras do agendamento online (M50, etapa 2; regra 3): a janela, o convênio e o serviço liberados, a antecedência e o
// horizonte, a ordem e o teto dos horários, o próximo oferecido na colisão, o prazo do cancelamento, o valor do
// particular e a janela da pesquisa.
import { describe, expect, it } from 'vitest';
import {
  type ConfigOnline,
  convenioLiberado,
  horarioDentroDoPortal,
  horariosDoPortal,
  janelaDoPortal,
  minutosAte,
  pesquisaAberta,
  podeMudarPeloPortal,
  proximoOferecido,
  servicoLiberado,
  valorDoPortal,
} from './regras.js';

const R = { hoje: '2026-10-25', hhmm: '1000' };
const CFG: ConfigOnline = {
  agenda: 41,
  ativa: true,
  convenios: [],
  servicos: [],
  antecedenciaHoras: 24,
  horizonteDias: 30,
  cancelaAteHoras: 12,
  precheckin: true,
  valorParticular: 250,
};

describe('janela, convênio e serviço', () => {
  it('a janela vai de hoje (ou de uma data futura) até o horizonte', () => {
    expect(janelaDoPortal(CFG, R)).toEqual({ de: '2026-10-25', ate: '2026-11-24' });
    expect(janelaDoPortal(CFG, R, '2026-11-01')).toEqual({ de: '2026-11-01', ate: '2026-11-24' });
    expect(janelaDoPortal(CFG, R, '2026-10-01').de).toBe('2026-10-25');
    expect(janelaDoPortal(CFG, R, '2027-01-01')).toEqual({ de: '2026-11-24', ate: '2026-11-24' });
  });
  it('convênio: a lista da configuração restringe; vazia, vale a da agenda; agenda sem lista aceita todos', () => {
    expect(convenioLiberado({ convenios: [10] }, [10, 306], 306)).toBe(false);
    expect(convenioLiberado({ convenios: [10] }, [10, 306], 10)).toBe(true);
    expect(convenioLiberado({ convenios: [] }, [10, 306], 306)).toBe(true);
    expect(convenioLiberado({ convenios: [] }, [10], 306)).toBe(false);
    expect(convenioLiberado({ convenios: [] }, [], 999)).toBe(true);
  });
  it('serviço: sem filtro passa; a lista da configuração manda; senão a da agenda', () => {
    expect(servicoLiberado({ servicos: [5] }, [], null)).toBe(true);
    expect(servicoLiberado({ servicos: [5] }, [5, 6], 6)).toBe(false);
    expect(servicoLiberado({ servicos: [] }, [5, 6], 6)).toBe(true);
    expect(servicoLiberado({ servicos: [] }, [5], 6)).toBe(false);
    expect(servicoLiberado({ servicos: [] }, [], 6)).toBe(true);
  });
});

describe('horários do portal', () => {
  it('antecedência e horizonte', () => {
    expect(minutosAte({ data: '2026-10-26', hora: '1000' }, R)).toBe(1440);
    expect(horarioDentroDoPortal({ data: '2026-10-26', hora: '1000' }, CFG, R)).toBe(true);
    expect(horarioDentroDoPortal({ data: '2026-10-26', hora: '0959' }, CFG, R)).toBe(false);
    expect(horarioDentroDoPortal({ data: '2026-11-25', hora: '0800' }, CFG, R)).toBe(false);
    expect(
      horarioDentroDoPortal({ data: '2026-10-25', hora: '0900' }, { ...CFG, antecedenciaHoras: 0 }, R),
    ).toBe(false);
  });
  it('só agendas ativas configuradas, em ordem, com teto', () => {
    const cfgs = new Map<number, ConfigOnline>([
      [41, CFG],
      [42, { ...CFG, agenda: 42, ativa: false }],
    ]);
    const vagas = [
      { agenda: 41, data: '2026-10-28', hora: '0900' },
      { agenda: 41, data: '2026-10-27', hora: '1100' },
      { agenda: 42, data: '2026-10-27', hora: '0800' },
      { agenda: 43, data: '2026-10-27', hora: '0800' },
      { agenda: 41, data: '2026-10-27', hora: '0800' },
    ];
    const r = horariosDoPortal(vagas, cfgs, R);
    expect(r.itens.map((v) => `${v.data} ${v.hora}`)).toEqual([
      '2026-10-27 0800',
      '2026-10-27 1100',
      '2026-10-28 0900',
    ]);
    expect(r.truncado).toBe(false);
    const t = horariosDoPortal(vagas, cfgs, R, 2);
    expect(t.itens).toHaveLength(2);
    expect(t.truncado).toBe(true);
  });
  it('colisão: o próximo livre da mesma agenda depois do ocupado', () => {
    const relidas = [
      { agenda: 41, data: '2026-10-27', hora: '0800' },
      { agenda: 41, data: '2026-10-27', hora: '0830' },
      { agenda: 99, data: '2026-10-27', hora: '0815' },
      { agenda: 41, data: '2026-10-28', hora: '0800' },
    ];
    expect(proximoOferecido(relidas, { agenda: 41, data: '2026-10-27', hora: '0815' }, CFG, R)).toEqual({
      agenda: 41,
      data: '2026-10-27',
      hora: '0830',
    });
    expect(proximoOferecido([], { agenda: 41, data: '2026-10-27', hora: '0815' }, CFG, R)).toBeNull();
  });
});

describe('o que o paciente pode fazer', () => {
  const m = { data: '2026-10-27', hora: '0900', estado: 'marcada' as const };
  it('cancelar ou remarcar até o prazo da agenda', () => {
    expect(podeMudarPeloPortal(m, CFG, R)).toEqual({ pode: true, motivo: null });
    expect(podeMudarPeloPortal({ ...m, estado: 'chegou' }, CFG, R).pode).toBe(false);
    expect(podeMudarPeloPortal(m, null, R).motivo).toContain('central');
    expect(podeMudarPeloPortal(m, { ...CFG, ativa: false }, R).pode).toBe(false);
    expect(podeMudarPeloPortal({ ...m, data: '2026-10-25', hora: '0900' }, CFG, R).motivo).toBe(
      'O horário já passou.',
    );
    expect(podeMudarPeloPortal({ ...m, data: '2026-10-25', hora: '2100' }, CFG, R).motivo).toContain(
      '12 hora(s)',
    );
    expect(podeMudarPeloPortal({ ...m, estado: 'confirmada' }, CFG, R).pode).toBe(true);
  });
  it('valor só no particular com o valor configurado', () => {
    expect(valorDoPortal(CFG, 10)).toBe(250);
    expect(valorDoPortal(CFG, 306)).toBeNull();
    expect(valorDoPortal({ valorParticular: null }, 10)).toBeNull();
    expect(valorDoPortal(null, 10)).toBeNull();
  });
  it('pesquisa: depois da chegada ou do atendimento, por 30 dias, uma vez', () => {
    const veio = { data: '2026-10-20', hora: '0900', estado: 'atendida' as const };
    expect(pesquisaAberta(veio, false, R)).toBe(true);
    expect(pesquisaAberta({ ...veio, estado: 'chegou' }, false, R)).toBe(true);
    expect(pesquisaAberta(veio, true, R)).toBe(false);
    expect(pesquisaAberta({ ...veio, estado: 'faltou' }, false, R)).toBe(false);
    expect(pesquisaAberta({ ...veio, data: '2026-09-01' }, false, R)).toBe(false);
    expect(pesquisaAberta({ ...veio, data: '2026-10-26' }, false, R)).toBe(false);
  });
});
