// Oncologia (M45, etapa 6; mina, regra 19): protocolo imutável pelo hash, superfície corporal, Cockcroft-Gault, Calvert,
// redução de dose com as parcelas impressas, sequência e intervalo do ciclo e a dupla checagem do farmacêutico.
import { esquemaPublicarProtocoloOncologico, esquemaRegistrarCicloOncologico } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroEspecialidade } from './comum.js';
import {
  calcularDoses,
  clearanceCockcroftGault,
  conferirCiclo,
  conferirPrescricaoParaValidar,
  conferirProtocolo,
  conferirVinculoPrescricao,
  cursoDoCiclo,
  duplaChecagem,
  hashProtocolo,
  type ProtocoloDoCiclo,
  superficieCorporalOnco,
} from './oncologia.js';

const PROTOCOLO = esquemaPublicarProtocoloOncologico.parse({
  codigo: 'sint-pc',
  nome: 'Paclitaxel e carboplatina SINTETICO',
  tipo: 3,
  intervaloDias: 21,
  ciclos: 6,
  farmacos: [
    {
      nome: 'Paclitaxel',
      dose: 175,
      unidade: 'mg/m2',
      via: 'iv',
      dias: [1],
      administracao: 'SF 0,9% 500 mL em 3 h',
    },
    { nome: 'Carboplatina', dose: 5, unidade: 'auc', via: 'iv', dias: [1] },
    { nome: 'Dexametasona', dose: 20, unidade: 'mg', via: 'iv', dias: [1] },
    { nome: 'Filgrastim', dose: 5, unidade: 'mg/kg', via: 'sc', dias: [3, 2] },
  ],
  referencia: 'Protocolo institucional SINTETICO',
});

const erro = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ErroEspecialidade ? e.codigo : `outro: ${String(e)}`;
  }
  return 'passou';
};

describe('protocolo', () => {
  it('o mesmo conteúdo dá o mesmo hash (ordem dos dias e chaves não importa); conteúdo diferente, outro', async () => {
    const a = await hashProtocolo(PROTOCOLO);
    const b = await hashProtocolo({
      ...PROTOCOLO,
      farmacos: PROTOCOLO.farmacos.map((f) => ({ ...f, dias: [...f.dias].reverse() })),
    });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(await hashProtocolo({ ...PROTOCOLO, ciclos: 4 })).not.toBe(a);
    expect(PROTOCOLO.codigo).toBe('SINT-PC');
  });

  it('confere o tipo do cadastro, os dias no ciclo e o fármaco repetido na mesma via', () => {
    expect(erro(() => conferirProtocolo(PROTOCOLO, new Set([1, 2, 3])))).toBe('passou');
    expect(erro(() => conferirProtocolo(PROTOCOLO, new Set([1])))).toBe('valor-desconhecido');
    expect(
      erro(() =>
        conferirProtocolo(
          { ...PROTOCOLO, farmacos: [{ ...PROTOCOLO.farmacos[0]!, dias: [22] }] },
          new Set([3]),
        ),
      ),
    ).toBe('dia-fora-do-ciclo');
    expect(
      erro(() =>
        conferirProtocolo(
          {
            ...PROTOCOLO,
            farmacos: [PROTOCOLO.farmacos[0]!, { ...PROTOCOLO.farmacos[0]!, nome: 'PACLITAXEL' }],
          },
          new Set([3]),
        ),
      ),
    ).toBe('farmaco-repetido');
    expect(erro(() => conferirProtocolo({ ...PROTOCOLO, farmacos: [] }, new Set([3])))).toBe(
      'protocolo-sem-farmaco',
    );
  });
});

describe('cálculo das doses', () => {
  it('Mosteller com duas casas e o teto opcional', () => {
    expect(superficieCorporalOnco(70, 170)).toBe(1.82);
    expect(superficieCorporalOnco(120, 190, 2)).toBe(2);
    expect(superficieCorporalOnco(120, 190, 0)).toBe(2.52);
  });

  it('Cockcroft-Gault com o fator do sexo feminino', () => {
    expect(clearanceCockcroftGault(60, 70, 1, 'M')).toBe(77.8);
    expect(clearanceCockcroftGault(60, 70, 1, 'F')).toBe(66.1);
  });

  it('as quatro unidades, Calvert com o teto de 125 mL/min e a redução com as parcelas', () => {
    const d = calcularDoses(PROTOCOLO.farmacos, {
      superficieM2: 1.82,
      pesoKg: 70,
      clearanceMlMin: 77.8,
      reducaoPct: 0,
    });
    expect(d.map((x) => x.final)).toEqual([318.5, 514, 20, 350]);
    expect(d[0]!.conta).toBe('175,0 mg/m² × 1,82 m² = 318,5 mg');
    expect(d[1]!.conta).toBe('AUC 5,0 × (TFG 77,8 + 25) mL/min = 514,0 mg');
    expect(d[3]!.dias).toEqual([3, 2]);
    const teto = calcularDoses([PROTOCOLO.farmacos[1]!], {
      superficieM2: 1.8,
      pesoKg: 70,
      clearanceMlMin: 160,
      reducaoPct: 20,
    });
    expect(teto[0]!.calculada).toBe(750);
    expect(teto[0]!.final).toBe(600);
    expect(teto[0]!.conta).toContain('redução de 20% = 600,0 mg');
    expect(
      erro(() =>
        calcularDoses([PROTOCOLO.farmacos[1]!], {
          superficieM2: 1.8,
          pesoKg: 70,
          clearanceMlMin: null,
          reducaoPct: 0,
        }),
      ),
    ).toBe('creatinina-ausente');
  });
});

const P: ProtocoloDoCiclo = {
  id: 1,
  vigente: true,
  ciclos: 6,
  intervaloDias: 21,
  farmacos: PROTOCOLO.farmacos,
};
const ciclo = (x: Record<string, unknown> = {}) =>
  esquemaRegistrarCicloOncologico.parse({
    internacao: 1,
    protocolo: 1,
    numero: 2,
    dataPrevista: '2026-11-15',
    pesoKg: 70,
    alturaCm: 170,
    creatininaMgDl: 1,
    ...x,
  });

describe('ciclo', () => {
  it('o primeiro ciclo e o seguinte no intervalo', () => {
    expect(conferirCiclo(ciclo({ numero: 1 }), P, [])).toEqual({ diasDesdeAnterior: null });
    expect(conferirCiclo(ciclo(), P, [{ numero: 1, dataPrevista: '2026-10-25' }])).toEqual({
      diasDesdeAnterior: 21,
    });
  });

  it('recusa versão substituída, ciclo além do protocolo, repetido e fora da sequência', () => {
    expect(erro(() => conferirCiclo(ciclo(), { ...P, vigente: false }, []))).toBe('protocolo-substituido');
    expect(erro(() => conferirCiclo(ciclo({ numero: 7 }), P, []))).toBe('ciclo-alem-do-protocolo');
    expect(
      erro(() => conferirCiclo(ciclo({ numero: 1 }), P, [{ numero: 1, dataPrevista: '2026-10-01' }])),
    ).toBe('ciclo-repetido');
    expect(
      erro(() => conferirCiclo(ciclo({ numero: 3 }), P, [{ numero: 1, dataPrevista: '2026-10-01' }])),
    ).toBe('ciclo-fora-de-sequencia');
  });

  it('o intervalo curto pede a justificativa; a data antes da anterior é recusada', () => {
    const ant = [{ numero: 1, dataPrevista: '2026-11-01' }];
    expect(erro(() => conferirCiclo(ciclo(), P, ant))).toBe('intervalo-curto');
    expect(
      conferirCiclo(ciclo({ justificativaIntervalo: 'Antecipado por decisão clínica' }), P, ant),
    ).toEqual({
      diasDesdeAnterior: 14,
    });
    expect(erro(() => conferirCiclo(ciclo({ dataPrevista: '2026-10-20' }), P, ant))).toBe(
      'data-antes-do-anterior',
    );
  });

  it('a creatinina com AUC e o motivo da redução', () => {
    expect(erro(() => conferirCiclo(ciclo({ numero: 1, creatininaMgDl: null }), P, []))).toBe(
      'creatinina-ausente',
    );
    expect(erro(() => conferirCiclo(ciclo({ numero: 1, reducaoPct: 20 }), P, []))).toBe('motivo-reducao');
    expect(
      erro(() =>
        conferirCiclo(ciclo({ numero: 1, reducaoPct: 20, motivoReducao: 'Neutropenia grau 3' }), P, []),
      ),
    ).toBe('passou');
  });
});

describe('tratamento (curso) e a prescrição ligada', () => {
  const doPaciente = [
    { curso: 1, numero: 1, dataPrevista: '2026-01-05' },
    { curso: 1, numero: 2, dataPrevista: '2026-01-26' },
    { curso: 2, numero: 1, dataPrevista: '2026-09-01' },
  ];
  it('sem tratamento novo, o curso atual e só os ciclos dele; o primeiro do paciente é o curso 1', () => {
    expect(cursoDoCiclo({ numero: 2 }, doPaciente)).toEqual({
      curso: 2,
      anteriores: [{ numero: 1, dataPrevista: '2026-09-01' }],
    });
    expect(cursoDoCiclo({ numero: 1 }, [])).toEqual({ curso: 1, anteriores: [] });
  });

  it('o tratamento novo é o curso seguinte, só no ciclo 1 e só depois de outro tratamento', () => {
    expect(cursoDoCiclo({ numero: 1, novoTratamento: 'Recaída' }, doPaciente)).toEqual({
      curso: 3,
      anteriores: [],
    });
    expect(erro(() => cursoDoCiclo({ numero: 2, novoTratamento: 'Recaída' }, doPaciente))).toBe(
      'novo-tratamento-fora-do-ciclo-1',
    );
    expect(erro(() => cursoDoCiclo({ numero: 1, novoTratamento: 'Recaída' }, []))).toBe(
      'novo-tratamento-sem-anterior',
    );
    // O ciclo 1 do curso atual, sem o tratamento novo, continua repetido.
    const { anteriores } = cursoDoCiclo({ numero: 1 }, doPaciente);
    expect(erro(() => conferirCiclo(ciclo({ numero: 1 }), P, anteriores))).toBe('ciclo-repetido');
  });

  it('a ligação: ciclo prescrito, prescrição da internação no dia, não suspensa e não repetida', () => {
    const cand = [
      { id: 10, suspensa: false },
      { id: 11, suspensa: true },
    ];
    const c = { situacao: 'prescrito', prescricoes: [] as number[] };
    expect(erro(() => conferirVinculoPrescricao(c, 10, cand))).toBe('passou');
    expect(erro(() => conferirVinculoPrescricao(c, 11, cand))).toBe('prescricao-suspensa');
    expect(erro(() => conferirVinculoPrescricao(c, 12, cand))).toBe('prescricao-fora-do-ciclo');
    expect(erro(() => conferirVinculoPrescricao({ ...c, prescricoes: [10] }, 10, cand))).toBe(
      'prescricao-ja-vinculada',
    );
    expect(erro(() => conferirVinculoPrescricao({ ...c, situacao: 'validado' }, 10, cand))).toBe(
      'ciclo-ja-validado',
    );
    expect(erro(() => conferirPrescricaoParaValidar({ prescricoes: [] }))).toBe('ciclo-sem-prescricao');
    expect(erro(() => conferirPrescricaoParaValidar({ prescricoes: [10] }))).toBe('passou');
  });
});

describe('dupla checagem do farmacêutico', () => {
  const doses = calcularDoses(PROTOCOLO.farmacos, {
    superficieM2: 1.82,
    pesoKg: 70,
    clearanceMlMin: 77.8,
    reducaoPct: 0,
  });

  it('dentro da tolerância passa; fora dela devolve a divergência', () => {
    expect(duplaChecagem(doses, [318, 515, 20, 350], 5)).toEqual([]);
    expect(duplaChecagem(doses, [318, 600, 20, 350], 5)).toEqual([
      { farmaco: 'Carboplatina', sistema: 514, informada: 600, diferencaPct: 16.7 },
    ]);
  });

  it('exige uma dose por fármaco', () => {
    expect(erro(() => duplaChecagem(doses, [318], 5))).toBe('doses-incompletas');
  });
});
