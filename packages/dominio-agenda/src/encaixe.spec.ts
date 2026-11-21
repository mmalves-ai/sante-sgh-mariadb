// Regra 6 e os vetos e alertas do encaixe (ref 01 §3.3; acoes-encaixe.js).
import { describe, expect, it } from 'vitest';
import { avaliarEncaixe, type ContextoEncaixe, podeDesfazerEncaixe, proximoMinutoLivre } from './encaixe.js';

const linha = (hora: string, x: Partial<{ paciente: string; tipo: string; duracao: string }> = {}) => ({
  data: '2026-10-22',
  hora,
  paciente: 'X',
  livre: 'S',
  situacao: '',
  tipo: 'N',
  duracao: '00:15',
  ...x,
});
const ctx = (x: Partial<ContextoEncaixe> = {}): ContextoEncaixe => ({
  relogio: { hoje: '2026-10-21', hhmm: '10:00' },
  agendaAtiva: true,
  gradeDoDia: [linha('08:00'), linha('08:15'), linha('08:30')],
  marcadasNoDia: [],
  duracaoAgendaMin: 15,
  pacienteTemProntuario: true,
  prontuarioAmbiguo: false,
  ...x,
});
const codigos = (r: { vetos: readonly { codigo: string }[] }) => r.vetos.map((v) => v.codigo);

describe('encaixe', () => {
  it('minuto livre fora da grade: sem veto', () => {
    const r = avaliarEncaixe({ data: '2026-10-22', hora: '08:50' }, ctx());
    expect(r.vetos).toEqual([]);
    expect(r.sugestao).toBeNull();
  });
  it('minuto ocupado na grade: veto e sugestão do próximo livre', () => {
    const r = avaliarEncaixe({ data: '2026-10-22', hora: '08:15' }, ctx());
    expect(codigos(r)).toEqual(['minuto-ocupado']);
    expect(r.sugestao).toBe('08:16');
  });
  it('minuto ocupado por marcação órfã (sem horário na grade) também é veto', () => {
    const r = avaliarEncaixe({ data: '2026-10-22', hora: '09:00' }, ctx({ marcadasNoDia: ['09:00'] }));
    expect(codigos(r)).toEqual(['minuto-ocupado']);
  });
  it('vetos: inativa, além de 1 ano, passado, sem prontuário, trio ambíguo', () => {
    const r = avaliarEncaixe(
      { data: '2027-10-22', hora: '08:50' },
      ctx({ agendaAtiva: false, pacienteTemProntuario: false, prontuarioAmbiguo: true }),
    );
    expect(codigos(r)).toEqual(['agenda-inativa', 'alem-de-um-ano', 'sem-prontuario', 'prontuario-ambiguo']);
    expect(codigos(avaliarEncaixe({ data: '2026-10-21', hora: '09:50' }, ctx()))).toEqual([
      'horario-passado',
    ]);
  });
  it('limite de encaixes por turno (parâmetro do novo)', () => {
    const c = ctx({ gradeDoDia: [linha('08:00'), linha('08:05', { tipo: 'E' })], limitePorTurno: 1 });
    expect(codigos(avaliarEncaixe({ data: '2026-10-22', hora: '08:50' }, c))).toEqual(['limite-do-turno']);
    expect(codigos(avaliarEncaixe({ data: '2026-10-22', hora: '14:50' }, c))).toEqual([]);
    expect(
      codigos(avaliarEncaixe({ data: '2026-10-22', hora: '08:50' }, { ...c, limitePorTurno: null })),
    ).toEqual([]);
  });
  it('alertas: sobreposição com o vizinho, dia sem grade e agenda não lotada', () => {
    const sobre = avaliarEncaixe({ data: '2026-10-22', hora: '08:40' }, ctx());
    expect(sobre.alertas.map((a) => a.codigo)).toEqual(['sobreposicao']);
    const vazio = avaliarEncaixe({ data: '2026-10-22', hora: '09:00' }, ctx({ gradeDoDia: [] }));
    expect(vazio.alertas.map((a) => a.codigo)).toEqual(['dia-sem-grade']);
    const naoLotada = avaliarEncaixe(
      { data: '2026-10-22', hora: '08:50' },
      ctx({ gradeDoDia: [linha('08:00'), linha('08:15', { paciente: '' })] }),
    );
    expect(naoLotada.vagasNormais).toEqual(['08:15']);
    expect(naoLotada.alertas.map((a) => a.codigo)).toContain('agenda-nao-lotada');
  });
  it('vizinho sem duração própria usa a da agenda; sem nenhuma, não alerta', () => {
    const c = ctx({ gradeDoDia: [linha('08:00', { duracao: '00:00' })] });
    expect(avaliarEncaixe({ data: '2026-10-22', hora: '08:10' }, c).alertas.map((a) => a.codigo)).toEqual([
      'sobreposicao',
    ]);
    expect(
      avaliarEncaixe({ data: '2026-10-22', hora: '08:10' }, { ...c, duracaoAgendaMin: null }).alertas,
    ).toEqual([]);
  });
  it('próximo minuto livre e o fim do dia', () => {
    expect(proximoMinutoLivre('23:59', new Set(['23:59']))).toBeNull();
    expect(proximoMinutoLivre('08:00', new Set())).toBe('08:00');
  });
  it('desfazer só até o check-in', () => {
    expect(podeDesfazerEncaixe({ temSenha: false, atendido: 'N' })).toBe(true);
    expect(podeDesfazerEncaixe({ temSenha: true, atendido: 'N' })).toBe(false);
    expect(podeDesfazerEncaixe({ temSenha: false, atendido: 'S' })).toBe(false);
  });

  // Porta de vigencia-grade.test.js (sante-api), os casos de regra pura do encaixe.
  it('data além de um ano à frente é recusada; no limite (um ano exato), passa pelo veto', () => {
    const limite = avaliarEncaixe({ data: '2027-10-21', hora: '08:50' }, ctx());
    expect(codigos(limite)).not.toContain('alem-de-um-ano');
    const alem = avaliarEncaixe({ data: '2027-10-22', hora: '08:50' }, ctx());
    expect(codigos(alem)).toContain('alem-de-um-ano');
  });

  it('o alerta de "agenda não lotada" só oferece vaga normal que ainda não passou', () => {
    const r = avaliarEncaixe(
      { data: '2026-10-21', hora: '11:07' },
      ctx({
        gradeDoDia: [
          { ...linha('09:00', { paciente: '' }), data: '2026-10-21' },
          { ...linha('11:00', { paciente: '' }), data: '2026-10-21' },
        ],
      }),
    );
    expect(r.vagasNormais).toEqual(['11:00']);
  });

  it('se toda vaga normal do dia já passou, não há alerta de agenda não lotada', () => {
    const r = avaliarEncaixe(
      { data: '2026-10-21', hora: '11:07' },
      ctx({ gradeDoDia: [{ ...linha('09:00', { paciente: '' }), data: '2026-10-21' }] }),
    );
    expect(r.alertas.map((a) => a.codigo)).not.toContain('agenda-nao-lotada');
    expect(r.vagasNormais).toEqual([]);
  });

  it('hora de hoje que já passou é veto (data passada também)', () => {
    expect(codigos(avaliarEncaixe({ data: '2026-10-21', hora: '09:30' }, ctx()))).toContain(
      'horario-passado',
    );
    expect(codigos(avaliarEncaixe({ data: '2026-10-20', hora: '15:00' }, ctx()))).toContain(
      'horario-passado',
    );
  });

  it('dia que só tem encaixes é dia SEM grade, e o alerta diz isso', () => {
    const r = avaliarEncaixe(
      { data: '2026-10-22', hora: '08:50' },
      ctx({ gradeDoDia: [linha('08:07', { tipo: 'E' })] }),
    );
    expect(r.alertas.map((a) => a.codigo)).toContain('dia-sem-grade');
  });
});
