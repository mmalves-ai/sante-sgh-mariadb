// O `teleconsulta.spec.ts` da ficha do M50 (regra 7; TELE-01 a TELE-04): a sala de espera, o início pelo médico, o
// encerramento, o alerta do crônico, a marca dos documentos e a teleinterconsulta.
import { MARCA_TELEMEDICINA, type SituacaoTeleconsulta } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  alertaCronico,
  exigirCienciaDoAlerta,
  grupoCronico,
  janelaSalaEspera,
  linhasComMarcaTelemedicina,
  minutosCivis,
  podeCancelarTeleinterconsulta,
  podeEncerrarTeleconsulta,
  podeEntrarSalaEspera,
  podeIniciarTeleconsulta,
  podeResponderTeleinterconsulta,
  podeSolicitarTeleinterconsulta,
  teleconsultaAberta,
} from './regras.js';

const agora = { hoje: '2026-11-10', hora: '10:00' };
const medico = { ligada: true, podeRealizar: true, profissional: { conselhoAtivo: true } };

describe('sala de espera (TELE-02)', () => {
  it('abre 30 minutos antes e fecha 2 horas depois do horário', () => {
    expect(janelaSalaEspera({ data: '2026-11-10', hora: '10:31' }, agora).aberta).toBe(false);
    expect(janelaSalaEspera({ data: '2026-11-10', hora: '10:30' }, agora)).toEqual({
      aberta: true,
      abreEm: '2026-11-10T10:00',
      fechaEm: '2026-11-10T12:30',
      motivo: null,
    });
    expect(janelaSalaEspera({ data: '2026-11-10', hora: '08:00' }, agora).aberta).toBe(true);
    const passou = janelaSalaEspera({ data: '2026-11-10', hora: '07:59' }, agora);
    expect(passou.aberta).toBe(false);
    expect(passou.motivo).toMatch(/já passou/);
    expect(janelaSalaEspera({ data: '2026-11-11', hora: '10:00' }, agora).motivo).toMatch(/30 minutos/);
  });

  it('entra só aberta, com a chave ligada; com o médico na sala, entra depois da janela', () => {
    const t = { situacao: 'agendada' as const, data: '2026-11-10', hora: '10:15' };
    expect(podeEntrarSalaEspera(t, agora, true).pode).toBe(true);
    expect(podeEntrarSalaEspera(t, agora, false).motivo).toMatch(/liberada/);
    expect(podeEntrarSalaEspera({ ...t, situacao: 'cancelada' }, agora, true).motivo).toMatch(/cancelada/);
    expect(podeEntrarSalaEspera({ ...t, situacao: 'encerrada' }, agora, true).motivo).toMatch(/encerrada/);
    const tarde = { data: '2026-11-10', hora: '07:00' };
    expect(podeEntrarSalaEspera({ ...tarde, situacao: 'aguardando' }, agora, true).pode).toBe(false);
    expect(podeEntrarSalaEspera({ ...tarde, situacao: 'em-andamento' }, agora, true).pode).toBe(true);
    expect(podeEntrarSalaEspera({ ...tarde, situacao: 'sala-aberta' }, agora, true).pode).toBe(true);
  });

  it('minutos civis sem fuso', () => {
    expect(minutosCivis('1970-01-01', '00:01')).toBe(1);
    expect(teleconsultaAberta('respondida')).toBe(false);
  });
});

describe('início pelo médico (TELE-01)', () => {
  const t: {
    situacao: SituacaoTeleconsulta;
    data: string;
    termo: boolean;
    local: boolean;
    atendimento: number | null;
  } = {
    situacao: 'aguardando',
    data: '2026-11-10',
    termo: true,
    local: true,
    atendimento: null,
  };

  it('com o paciente na sala de espera, termo e local, no dia, com conselho ativo', () => {
    expect(podeIniciarTeleconsulta(t, agora, medico)).toEqual({ pode: true, motivo: null });
    expect(podeIniciarTeleconsulta({ ...t, situacao: 'sala-aberta' }, agora, medico).pode).toBe(true);
  });

  it('recusa cada falta com o motivo', () => {
    const m = (x: Partial<typeof t>, q: Partial<typeof medico> = {}) =>
      podeIniciarTeleconsulta({ ...t, ...x }, agora, { ...medico, ...q }).motivo;
    expect(m({}, { ligada: false })).toMatch(/liberação/);
    expect(m({}, { podeRealizar: false })).toMatch(/perfil/);
    expect(podeIniciarTeleconsulta(t, agora, { ...medico, profissional: null }).motivo).toMatch(
      /vínculo profissional/,
    );
    expect(
      podeIniciarTeleconsulta(t, agora, { ...medico, profissional: { conselhoAtivo: false } }).motivo,
    ).toMatch(/conselho/);
    expect(m({ atendimento: 900001 })).toMatch(/já foi iniciada/);
    expect(m({ situacao: 'em-andamento' })).toMatch(/já foi iniciada/);
    expect(m({ situacao: 'cancelada' })).toMatch(/encerrada ou cancelada/);
    expect(m({ data: '2026-11-11' })).toMatch(/dia marcado/);
    expect(m({ situacao: 'agendada' })).toMatch(/sala de espera/);
    expect(m({ termo: false })).toMatch(/termo/);
    expect(m({ local: false })).toMatch(/local/);
  });

  it('encerrar: concluída só com o atendimento aberto; ausente antes', () => {
    expect(podeEncerrarTeleconsulta({ situacao: 'em-andamento' }, 'concluida').pode).toBe(true);
    expect(podeEncerrarTeleconsulta({ situacao: 'aguardando' }, 'concluida').motivo).toMatch(/concluída/);
    expect(podeEncerrarTeleconsulta({ situacao: 'agendada' }, 'paciente-ausente').pode).toBe(true);
    expect(podeEncerrarTeleconsulta({ situacao: 'encerrada' }, 'falha-conexao').pode).toBe(false);
    expect(podeEncerrarTeleconsulta({ situacao: 'sala-aberta' }, null).pode).toBe(true);
  });
});

describe('alerta do crônico sem presencial (TELE-04)', () => {
  it('grupo crônico pelo CID', () => {
    expect(grupoCronico('I10')).toBe('I10-I15 hipertensão');
    expect(grupoCronico('e11.9')).toBe('E10-E14 diabetes');
    expect(grupoCronico('C509')).toBe('C00-C97 neoplasia maligna');
    expect(grupoCronico('G40')).toBe('G40 epilepsia');
    expect(grupoCronico('J06')).toBeNull();
    expect(grupoCronico(null)).toBeNull();
    expect(grupoCronico('12')).toBeNull();
  });

  it('crônico com a última presencial há mais de 180 dias: alerta', () => {
    const a = alertaCronico(
      [
        { data: '2026-04-01', cid: 'I10', teleconsulta: false },
        { data: '2026-10-01', cid: 'I10', teleconsulta: true },
        { data: '2026-09-01', cid: 'R51', teleconsulta: false, laboratorio: true },
      ],
      '2026-11-10',
    );
    expect(a).toMatchObject({
      cronico: true,
      condicoes: ['I10-I15 hipertensão'],
      ultimaPresencial: '2026-04-01',
      diasSemPresencial: 223,
      alerta: true,
    });
    expect(a.mensagem).toMatch(/223 dias/);
  });

  it('crônico com presencial recente: sem alerta; não crônico: sem alerta; sem presencial: alerta', () => {
    expect(
      alertaCronico([{ data: '2026-08-01', cid: 'E11', teleconsulta: false }], '2026-11-10').alerta,
    ).toBe(false);
    expect(
      alertaCronico([{ data: '2025-01-01', cid: 'J06', teleconsulta: false }], '2026-11-10'),
    ).toMatchObject({ cronico: false, alerta: false, mensagem: null });
    const s = alertaCronico([{ data: '2026-10-01', cid: 'N18', teleconsulta: true }], '2026-11-10');
    expect(s).toMatchObject({ alerta: true, ultimaPresencial: null, diasSemPresencial: null });
    expect(s.mensagem).toMatch(/no histórico/);
    // O CID crônico de mais de dois anos não conta; a data no futuro é ignorada.
    expect(
      alertaCronico(
        [
          { data: '2024-01-01', cid: 'I10', teleconsulta: false },
          { data: '2027-01-01', cid: 'I10', teleconsulta: false },
        ],
        '2026-11-10',
      ).cronico,
    ).toBe(false);
  });

  it('com o alerta, só com a ciência', () => {
    const a = alertaCronico([], '2026-11-10');
    expect(exigirCienciaDoAlerta(a, false).pode).toBe(true);
    const c = alertaCronico([{ data: '2025-12-01', cid: 'I50', teleconsulta: false }], '2026-11-10');
    expect(exigirCienciaDoAlerta(c, false).motivo).toMatch(/alerta/);
    expect(exigirCienciaDoAlerta(c, true).pode).toBe(true);
    expect(exigirCienciaDoAlerta(null, false).pode).toBe(true);
  });
});

describe('marca dos documentos', () => {
  it('só na teleconsulta, uma vez', () => {
    expect(linhasComMarcaTelemedicina(['a'], false)).toEqual(['a']);
    const m = linhasComMarcaTelemedicina(['a'], true);
    expect(m).toEqual(['a', '', MARCA_TELEMEDICINA]);
    expect(linhasComMarcaTelemedicina(m, true)).toEqual(m);
  });
});

describe('teleinterconsulta', () => {
  const base = {
    ligada: true,
    podeRealizar: true,
    solicitante: { vinculo: 1, conselhoAtivo: true },
    convidado: { vinculo: 2, ativo: true, medico: true },
    atendimentoAberto: true,
  };

  it('pedir: médico com conselho, atendimento aberto, outro médico ativo', () => {
    expect(podeSolicitarTeleinterconsulta(base).pode).toBe(true);
    expect(podeSolicitarTeleinterconsulta({ ...base, ligada: false }).motivo).toMatch(/liberação/);
    expect(podeSolicitarTeleinterconsulta({ ...base, podeRealizar: false }).motivo).toMatch(/perfil/);
    expect(podeSolicitarTeleinterconsulta({ ...base, solicitante: null }).motivo).toMatch(/conselho/);
    expect(podeSolicitarTeleinterconsulta({ ...base, atendimentoAberto: false }).motivo).toMatch(/aberto/);
    expect(podeSolicitarTeleinterconsulta({ ...base, convidado: null }).motivo).toMatch(/não foi encontrado/);
    expect(
      podeSolicitarTeleinterconsulta({ ...base, convidado: { vinculo: 2, ativo: true, medico: false } })
        .motivo,
    ).toMatch(/médico ativo/);
    expect(
      podeSolicitarTeleinterconsulta({ ...base, convidado: { vinculo: 1, ativo: true, medico: true } })
        .motivo,
    ).toMatch(/outro médico/);
  });

  it('responder: só o convidado, aberta, com conselho', () => {
    const t = { situacao: 'solicitada' as const, convidado: 2 };
    const o = { ligada: true, podeRealizar: true, vinculo: 2, conselhoAtivo: true };
    expect(podeResponderTeleinterconsulta(t, o).pode).toBe(true);
    expect(podeResponderTeleinterconsulta({ ...t, situacao: 'sala-aberta' }, o).pode).toBe(true);
    expect(podeResponderTeleinterconsulta(t, { ...o, ligada: false }).motivo).toMatch(/liberação/);
    expect(podeResponderTeleinterconsulta(t, { ...o, podeRealizar: false }).motivo).toMatch(/perfil/);
    expect(podeResponderTeleinterconsulta({ ...t, situacao: 'respondida' }, o).motivo).toMatch(/já foi/);
    expect(podeResponderTeleinterconsulta(t, { ...o, vinculo: 3 }).motivo).toMatch(/convidado/);
    expect(podeResponderTeleinterconsulta(t, { ...o, conselhoAtivo: false }).motivo).toMatch(/conselho/);
  });

  it('cancelar: só quem pediu, antes do parecer', () => {
    const t = { situacao: 'solicitada' as const, solicitante: 'SINT.MEDICO' };
    expect(podeCancelarTeleinterconsulta(t, { ligada: true, login: 'SINT.MEDICO' }).pode).toBe(true);
    expect(podeCancelarTeleinterconsulta(t, { ligada: false, login: 'SINT.MEDICO' }).pode).toBe(false);
    expect(podeCancelarTeleinterconsulta(t, { ligada: true, login: 'OUTRO' }).motivo).toMatch(/quem pediu/);
    expect(
      podeCancelarTeleinterconsulta({ ...t, situacao: 'cancelada' }, { ligada: true, login: 'SINT.MEDICO' })
        .motivo,
    ).toMatch(/já foi/);
  });
});
