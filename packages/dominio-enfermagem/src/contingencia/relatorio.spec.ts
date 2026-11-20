// Massa sintética (nenhum dado de pessoa real).
import { describe, expect, it } from 'vitest';
import {
  camposDoRelatorioContingencia,
  itemDaPrescricao,
  type LeituraContingencia,
  montarRelatorioContingencia,
} from './relatorio.js';

const base: LeituraContingencia = {
  unidade: 'UTI',
  agora: '2026-12-01T10:00:00',
  horas: 6,
  internados: [
    { paciente: 2, atendimento: 20, nome: 'PACIENTE SINTETICO B', leito: '10', alergia: false },
    { paciente: 1, atendimento: 10, nome: 'PACIENTE SINTETICO A', leito: '2', alergia: true },
  ],
  alergias: new Map([[1, ['Dipirona']]]),
  horarios: [
    {
      atendimento: 10,
      prescricao: 100,
      previsto: '2026-12-01T12:00:00',
      situacao: 'P',
      descricao: 'Cefazolina',
      dose: 1,
      unidadeDose: 'g',
      via: 'EV',
      seNecessario: false,
    },
    {
      atendimento: 10,
      prescricao: 100,
      previsto: '2026-12-01T08:00:00',
      situacao: 'A',
      descricao: 'Cefazolina',
      dose: 1,
      unidadeDose: 'g',
      via: 'EV',
      seNecessario: false,
    },
    {
      atendimento: 10,
      prescricao: 100,
      previsto: '2026-12-01T18:00:00',
      situacao: 'P',
      descricao: 'Cefazolina',
      dose: 1,
      unidadeDose: 'g',
      via: 'EV',
      seNecessario: false,
    },
    {
      atendimento: 10,
      prescricao: 100,
      previsto: '2026-12-01T06:00:00',
      situacao: 'P',
      descricao: 'Cefazolina',
      dose: 1,
      unidadeDose: 'g',
      via: 'EV',
      seNecessario: false,
    },
    {
      atendimento: 10,
      prescricao: 100,
      previsto: '2026-12-01T11:00:00',
      situacao: 'P',
      descricao: 'Dipirona',
      dose: 0.5,
      unidadeDose: 'g',
      via: 'VO',
      seNecessario: true,
    },
  ],
  cortado: false,
  sinais: [
    { paciente: 1, tipo: 'fc', valor: 80, unidade: 'bpm', horaReal: '2026-12-01T06:00:00' },
    { paciente: 1, tipo: 'fc', valor: 92, unidade: 'bpm', horaReal: '2026-12-01T09:00:00' },
    { paciente: 1, tipo: 'temperatura', valor: 37.2, unidade: '°C', horaReal: '2026-12-01T09:00:00' },
  ],
  problemas: [{ paciente: 1, descricao: 'Pneumonia', cid: 'J18' }],
  justificativas: [
    { prescricao: 100, texto: 'alergia conferida com a família' },
    { prescricao: 999, texto: 'outra' },
  ],
  amostras: [{ atendimento: 10, codigo: 'A0001', estado: 'emTransporte' }],
  limpezas: [{ leito: '5', etapa: 'emExecucao', prazo: '2026-12-01T11:30:00' }],
};

describe('relatório de contingência do posto (regra 6)', () => {
  it('ordena os leitos pelo número, junta a prescrição e o horizonte só com os pendentes até a hora limite', () => {
    const r = montarRelatorioContingencia(base);
    expect(r.horizonte).toEqual({ de: '2026-12-01T10:00', ate: '2026-12-01T16:00' });
    expect(r.pacientes.map((p) => p.leito)).toEqual(['2', '10']);
    const a = r.pacientes[0]!;
    expect(a.prescricao).toEqual(['Cefazolina 1 g, EV', 'Dipirona 0,5 g, VO (se necessário)']);
    expect(a.horarios.map((h) => h.previsto)).toEqual(['2026-12-01T11:00', '2026-12-01T12:00']);
    expect(a.alergias).toEqual(['Dipirona']);
    expect(a.sinais).toEqual([
      { tipo: 'Frequência cardíaca', valor: '92 bpm', em: '2026-12-01T09:00' },
      { tipo: 'Temperatura', valor: '37,2 °C', em: '2026-12-01T09:00' },
    ]);
    expect(a.problemas).toEqual(['Pneumonia (J18)']);
    expect(a.justificativas).toEqual(['alergia conferida com a família']);
    expect(a.amostras).toEqual([{ codigo: 'A0001', estado: 'Em transporte' }]);
    expect(r.limpezas).toEqual([{ leito: '5', etapa: 'Em execução', prazo: '2026-12-01T11:30' }]);
    expect(r.pacientes[1]!.temAlergia).toBe(false);
  });

  it('as linhas do documento trazem cada bloco e dizem "nenhum registro" no vazio', () => {
    const campos = camposDoRelatorioContingencia(montarRelatorioContingencia(base));
    const v = (rotulo: string) => campos.filter((c) => c.rotulo === rotulo).map((c) => c.valor);
    expect(v('Posto (unidade)')).toEqual(['UTI']);
    expect(v('Horizonte')).toEqual(['01/12/2026 10:00 a 01/12/2026 16:00']);
    expect(v('Leito 2')).toEqual(['PACIENTE SINTETICO A (atendimento 10)']);
    expect(v('Horários aprazados')[0]).toBe(
      '11:00 Dipirona 0,5 g, VO (se necessário); 12:00 Cefazolina 1 g, EV',
    );
    expect(v('Lista de problemas')[1]).toBe('nenhum registro');
    expect(v('Alergias')).toEqual(['Dipirona', 'nenhuma registrada']);
    expect(v('Higienização em andamento')).toEqual(['leito 5: Em execução (prazo 11:30)']);
    expect(campos.some((c) => c.rotulo === 'Atenção')).toBe(false);
  });

  it('alergia marcada sem nome e leitura cortada são avisadas', () => {
    const r = montarRelatorioContingencia({ ...base, alergias: new Map(), cortado: true });
    const campos = camposDoRelatorioContingencia(r);
    expect(campos.find((c) => c.rotulo === 'Alergias')?.valor).toBe(
      'alergia registrada (sem o nome no cadastro)',
    );
    expect(campos.find((c) => c.rotulo === 'Atenção')?.valor).toMatch(/teto/);
  });

  it('paciente sem a leitura dos registros (teto): "não lido" no lugar de "nenhum registro" e a linha Atenção', () => {
    // O paciente 2 (leito 10) ficou além do teto: alergias, problemas e amostras dele não foram lidos.
    const r = montarRelatorioContingencia({ ...base, naoLidos: [2] });
    expect(r.cortado).toBe(true);
    expect(r.extrasCortados).toBe(1);
    expect(r.pacientes.find((p) => p.atendimento === 20)?.extrasNaoLidos).toBe(true);
    expect(r.pacientes.find((p) => p.atendimento === 10)?.extrasNaoLidos).toBeUndefined();
    const campos = camposDoRelatorioContingencia(r);
    const v = (rotulo: string) => campos.filter((c) => c.rotulo === rotulo).map((c) => c.valor);
    expect(v('Atenção')).toEqual([expect.stringMatching(/^A leitura atingiu o teto: .* de 1 paciente\(s\)/)]);
    expect(v('Alergias')).toEqual(['Dipirona', 'não lido: consulte o prontuário']);
    expect(v('Lista de problemas')).toEqual(['Pneumonia (J18)', 'não lido: consulte o prontuário']);
    expect(v('Amostras em rastreio')).toEqual(['A0001 Em transporte', 'não lido: consulte o prontuário']);
    expect(campos.some((c) => c.valor === 'nenhum registro' && c.rotulo === 'Lista de problemas')).toBe(
      false,
    );
  });

  it('item da prescrição sem dose nem via', () => {
    expect(
      itemDaPrescricao({
        descricao: ' Dieta zero ',
        dose: null,
        unidadeDose: null,
        via: null,
        seNecessario: false,
      }),
    ).toBe('Dieta zero');
  });
});
