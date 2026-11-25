// Regras da auditoria da profilaxia antimicrobiana cirúrgica (F8, 04-CC linha 106). Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  type AdministracaoProfilaxia,
  auditarProfilaxia,
  conferirProtocoloProfilaxia,
  exigeJanelaLonga,
  indicadoresProfilaxia,
  janelaDoProtocolo,
  type ProtocoloProfilaxia,
} from './profilaxia-cirurgica.js';

const H = (h: number, m = 0) => new Date(Date.UTC(2030, 2, 10, h, m));
const CEFAZOLINA: ProtocoloProfilaxia = {
  id: 1,
  antimicrobiano: 10,
  nomeAntimicrobiano: 'CEFAZOLINA',
  classe: 'CEFALOSPORINA',
  dose: 2000,
  dosePorKg: false,
  unidade: 5,
  via: 7,
  antesMinimo: null,
  antesMaximo: null,
  intervaloRepiqueHoras: 4,
  duracaoMaximaHoras: 24,
  ordem: 1,
};
const VANCO: ProtocoloProfilaxia = {
  ...CEFAZOLINA,
  id: 2,
  antimicrobiano: 20,
  nomeAntimicrobiano: 'Vancomicina',
  dose: 15,
  dosePorKg: true,
  intervaloRepiqueHoras: null,
  ordem: 2,
};
const adm = (em: Date, o: Partial<AdministracaoProfilaxia> = {}): AdministracaoProfilaxia => ({
  prescricaoItem: 100,
  antimicrobiano: 10,
  administradoEm: em,
  dose: 2000,
  unidade: 5,
  via: 7,
  ...o,
});
const encerrado = (em: Date | null, antimicrobiano = 10) => [
  { prescricaoItem: 100, antimicrobiano, encerradoEm: em },
];
const ATO = { incisao: H(8), fim: H(10), pesoKg: 80 };
const DEPOIS = H(23, 59);

describe('protocolo de profilaxia', () => {
  const base = {
    procedimento: 1,
    grupo: null,
    antimicrobiano: 10,
    dose: 2000,
    dosePorKg: false,
    unidade: 5,
    antesMinimo: null,
    antesMaximo: 60,
    intervaloRepiqueHoras: 4,
    duracaoMaximaHoras: 24,
    vigenciaInicio: '2030-01-01',
    vigenciaFim: null,
  };
  it('aceita o protocolo completo', () => {
    expect(conferirProtocoloProfilaxia(base)).toEqual([]);
  });
  it('recusa sem alvo, dose zero, janela além do limite e duração acima de 48 h', () => {
    const p = conferirProtocoloProfilaxia({
      ...base,
      procedimento: null,
      dose: 0,
      antesMaximo: 90,
      duracaoMaximaHoras: 72,
    });
    expect(p.map((x) => x.campo)).toEqual(['procedimento', 'dose', 'antesMaximo', 'duracaoMaximaHoras']);
  });
  it('aceita 120 minutos para vancomicina e fluoroquinolona', () => {
    expect(conferirProtocoloProfilaxia({ ...base, antesMaximo: 120 }, true)).toEqual([]);
    expect(exigeJanelaLonga('Vancomicina')).toBe(true);
    expect(exigeJanelaLonga('CIPROFLOXACINO')).toBe(true);
    expect(exigeJanelaLonga('Cefazolina', 'Cefalosporina')).toBe(false);
    expect(janelaDoProtocolo(VANCO)).toEqual({ minimo: 0, maximo: 120 });
    expect(janelaDoProtocolo(CEFAZOLINA)).toEqual({ minimo: 0, maximo: 60 });
  });
  it('recusa janela invertida e vigência ao contrário', () => {
    const p = conferirProtocoloProfilaxia({
      ...base,
      antesMinimo: 50,
      antesMaximo: 30,
      vigenciaFim: '2029-01-01',
    });
    expect(p.map((x) => x.campo)).toEqual(['antesMinimo', 'vigenciaFim']);
  });
});

describe('auditoria da profilaxia do ato', () => {
  it('conforme: dose 30 min antes, repique em 4 h desnecessário (2 h de cirurgia) e item encerrado em 24 h', () => {
    const r = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(7, 30))], encerrado(H(12)), DEPOIS);
    expect(r).toMatchObject({
      situacao: 'conforme',
      protocolo: 1,
      minutosAntesIncisao: 30,
      drogaAdequada: true,
      doseAdequada: true,
      momentoAdequado: true,
      viaAdequada: true,
      repiqueAdequado: true,
      duracaoAdequada: true,
    });
  });
  it('não conforme: dose 90 min antes (fora dos 60)', () => {
    const r = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(6, 30))], encerrado(H(12)), DEPOIS);
    expect(r.momentoAdequado).toBe(false);
    expect(r.situacao).toBe('nao_conforme');
    expect(r.motivos).toContain('dose-fora-da-janela');
  });
  it('vancomicina 90 min antes está na janela de 120; a dose por quilo usa o peso do ato', () => {
    const r = auditarProfilaxia(
      ATO,
      [CEFAZOLINA, VANCO],
      [adm(H(6, 30), { antimicrobiano: 20, dose: 1200 })],
      encerrado(H(12), 20),
      DEPOIS,
    );
    expect(r).toMatchObject({
      protocolo: 2,
      momentoAdequado: true,
      doseAdequada: true,
      situacao: 'conforme',
    });
  });
  it('dose depois da incisão é atrasada', () => {
    const r = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(8, 15))], encerrado(H(12)), DEPOIS);
    expect(r.minutosAntesIncisao).toBe(-15);
    expect(r.motivos).toContain('dose-depois-da-incisao');
  });
  it('cirurgia de 6 h sem repique em 4 h é não conforme; com repique é conforme', () => {
    const longo = { ...ATO, fim: H(14) };
    const sem = auditarProfilaxia(longo, [CEFAZOLINA], [adm(H(7, 40))], encerrado(H(16)), DEPOIS);
    expect(sem.repiqueAdequado).toBe(false);
    const com = auditarProfilaxia(
      longo,
      [CEFAZOLINA],
      [adm(H(7, 40)), adm(H(11, 50))],
      encerrado(H(16)),
      DEPOIS,
    );
    expect(com.repiqueAdequado).toBe(true);
    expect(com.situacao).toBe('conforme');
  });
  it('profilaxia prolongada: dose depois de 24 h do fim ou item aberto passado o limite', () => {
    const dose = auditarProfilaxia(
      ATO,
      [CEFAZOLINA],
      [adm(H(7, 30)), adm(new Date(H(10).getTime() + 30 * 3_600_000))],
      encerrado(H(12)),
      DEPOIS,
    );
    expect(dose.duracaoAdequada).toBe(false);
    const aberto = auditarProfilaxia(
      ATO,
      [CEFAZOLINA],
      [adm(H(7, 30))],
      encerrado(null),
      new Date(H(10).getTime() + 25 * 3_600_000),
    );
    expect(aberto.duracaoAdequada).toBe(false);
    expect(aberto.situacao).toBe('nao_conforme');
  });
  it('item aberto dentro das 24 h fica pendente', () => {
    const r = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(7, 30))], encerrado(null), H(12));
    expect(r.situacao).toBe('pendente');
    expect(r.motivos).toContain('duracao-em-curso');
  });
  it('droga fora do protocolo, dose diferente e via diferente', () => {
    const fora = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(7, 30), { antimicrobiano: 99 })], [], DEPOIS);
    expect(fora.drogaAdequada).toBe(false);
    const dose = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(7, 30), { dose: 1000, via: 8 })], [], DEPOIS);
    expect(dose).toMatchObject({ doseAdequada: false, viaAdequada: false, situacao: 'nao_conforme' });
    const semUnidade = auditarProfilaxia(ATO, [CEFAZOLINA], [adm(H(7, 30), { unidade: 6 })], [], DEPOIS);
    expect(semUnidade.doseAdequada).toBeNull();
  });
  it('sem dose: não conforme; sem incisão ou sem protocolo: não avaliável', () => {
    expect(auditarProfilaxia(ATO, [CEFAZOLINA], [], [], DEPOIS)).toMatchObject({
      situacao: 'nao_conforme',
      avaliavel: true,
      drogaAdequada: false,
      motivos: ['sem-dose'],
    });
    expect(auditarProfilaxia({ ...ATO, incisao: null }, [CEFAZOLINA], [], [], DEPOIS).situacao).toBe(
      'nao_avaliavel',
    );
    expect(auditarProfilaxia(ATO, [], [adm(H(7))], [], DEPOIS).motivos).toEqual(['sem-protocolo']);
  });
});

describe('indicadores do painel', () => {
  it('conta e calcula o percentual sobre as avaliáveis', () => {
    expect(
      indicadoresProfilaxia(5, [
        { situacao: 'conforme', momentoAdequado: true, duracaoAdequada: true },
        { situacao: 'nao_conforme', momentoAdequado: false, duracaoAdequada: true },
        { situacao: 'conforme', momentoAdequado: true, duracaoAdequada: true },
        { situacao: 'nao_avaliavel', momentoAdequado: null, duracaoAdequada: null },
      ]),
    ).toEqual({
      cirurgias: 5,
      auditadas: 4,
      conformes: 2,
      naoConformes: 1,
      momentoAdequado: 2,
      duracaoAdequada: 3,
      percentualConforme: 66.7,
    });
    expect(indicadoresProfilaxia(0, []).percentualConforme).toBeNull();
  });
});
