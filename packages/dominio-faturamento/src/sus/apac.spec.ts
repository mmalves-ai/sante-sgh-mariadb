// APAC (ficha do M51, seção 5: faturamento.registrarApac; regras 1, 2, 5 e 6). Massa SINTÉTICA (documentos do algoritmo).
import { describe, expect, it } from 'vitest';
import {
  type ApacParaMontar,
  type AtendimentoApac,
  competenciasNoIntervalo,
  digitoApac,
  type EstadoApac,
  exigeLaudoNefrologia,
  montarApac,
  numeroApacValido,
  recusaAutorizarApac,
  recusaContinuarApac,
  recusaEncerrarApac,
  recusaLaudoApac,
  recusaNegarOuCancelarApac,
  recusaCorrigirApac,
  tipoNaCompetencia,
} from './apac.js';
import type { ContextoBpa } from './bpa.js';
import { competenciaSeguinte } from './competencia.js';
import type { ProcedimentoNaCiha } from './ciha.js';
import { compatibilidadesDaCompetencia, SEM_COMPATIBILIDADES } from './compatibilidade.js';
import type { RegistroSigtap } from './instrumento.js';
import {
  ATRIBUTOS_LIVRES,
  cnsSintetico,
  cnsValidoTeste,
  cpfSintetico,
  procedimento,
} from './massa.spec-util.js';

/** Um número de APAC sintético válido (12 dígitos base + o verificador). */
function numeroApacSintetico(base12: string): string {
  return `${base12}${digitoApac(base12)}`;
}

const P = (id: number, codigo: string, registros: RegistroSigtap[]): ProcedimentoNaCiha => ({
  procedimento: procedimento(id, codigo),
  naCompetencia: { fonte: 'atual', atributos: ATRIBUTOS_LIVRES },
  registros,
});
const CATALOGO = new Map<number, ProcedimentoNaCiha>([
  [301, P(301, '0304010014', ['apac-principal'])], // quimioterapia sintética: principal
  [302, P(302, '0211020036', ['apac-secundario'])], // secundário só da APAC
  [305, P(305, '0301010072', ['bpa-i', 'apac-secundario'])], // também cabe no BPA: fica no BPA (D-SECUNDARIO-51)
  [303, P(303, '0305010107', ['apac-principal'])], // hemodiálise sintética: exige o laudo de nefrologia
  [304, P(304, '0202010295', ['bpa-c'])], // exame só do BPA
]);

const ctx = (extra: Partial<ContextoBpa> = {}): ContextoBpa => ({
  competencia: '202509',
  cnes: '3132471',
  procedimento: (id) => CATALOGO.get(id) ?? null,
  compatibilidades: compatibilidadesDaCompetencia('202509', SEM_COMPATIBILIDADES),
  habilitacoes: new Set(),
  cnsValido: cnsValidoTeste,
  ...extra,
});

const EXEC = { cbo: '225125', cns: cnsSintetico(91), cpf: null };

function atendimento(
  n: number,
  paciente: number | null,
  itens: { sigtap: number | null; quantidade?: number; executante?: typeof EXEC | null }[],
  extra: { cns?: string | null; mae?: string | null; convenio?: number } = {},
): AtendimentoApac {
  return {
    conta: 1000 + n,
    atendimento: 2000 + n,
    pacienteId: paciente,
    convenio: extra.convenio ?? 1,
    data: '2025-09-10',
    cidPrincipal: 'C50',
    paciente: {
      cns: extra.cns === undefined ? cnsSintetico(n) : extra.cns,
      cpf: cpfSintetico(`30000000${n}`),
      sexo: 'F',
      nascimento: '1970-05-20',
      municipio: 330455,
      nome: `PACIENTE SINTETICA ${n}`,
      mae: extra.mae === undefined ? `MAE SINTETICA ${n}` : extra.mae,
      raca: 3,
      cep: '20000000',
      logradouro: 'RUA SINTETICA',
      numero: '10',
      complemento: null,
      bairro: 'CENTRO',
    },
    itens: itens.map((x, k) => ({
      item: 5000 + n * 10 + k,
      sigtap: x.sigtap,
      quantidade: x.quantidade ?? 1,
      procedimento: null,
      executante: x.executante === undefined ? EXEC : x.executante,
    })),
  };
}

const NUMERO = numeroApacSintetico('331250000001');

function apac(extra: Partial<ApacParaMontar> = {}): ApacParaMontar {
  return {
    id: 1,
    situacao: 'autorizada',
    tipo: 'inicial',
    numero: NUMERO,
    paciente: 77,
    procedimento: '0304010014',
    cidPrincipal: 'C50',
    cidSecundario: null,
    cidAssociado: null,
    dataSolicitacao: '2025-09-01',
    dataAutorizacao: '2025-09-02',
    competenciaInicial: '202509',
    competenciaFinal: '202511',
    ultimaCompetencia: '202509',
    autorizador: cnsSintetico(81),
    solicitante: { cns: cnsSintetico(82), nome: 'MEDICO SOLICITANTE SINTETICO' },
    laudoEspecifico: 'nenhum',
    nefrologia: null,
    motivoSaida: null,
    dataEncerramento: null,
    ...extra,
  };
}

const regras = (r: { criticas: readonly { regra: string }[] }) => r.criticas.map((c) => c.regra).sort();

describe('número da APAC (D-NUMERO-APAC-51)', () => {
  it('13 dígitos com o verificador (resto por 11; 10 vira 0)', () => {
    expect(numeroApacValido(NUMERO)).toBe(true);
    const errado = `${NUMERO.slice(0, 12)}${(Number(NUMERO[12]) + 1) % 10}`;
    expect(numeroApacValido(errado)).toBe(false);
    expect(numeroApacValido('0000000000000')).toBe(false);
    expect(numeroApacValido('12345')).toBe(false);
    expect(numeroApacValido(null)).toBe(false);
    // 12 dígitos cujo resto é 10: o verificador é 0.
    const base = Array.from({ length: 200 }, (_, k) => String(331250000100 + k)).find(
      (b) => Number(BigInt(b) % 11n) === 10,
    ) as string;
    expect(digitoApac(base)).toBe(0);
  });
});

describe('competências', () => {
  it('a seguinte e o intervalo', () => {
    expect(competenciaSeguinte('202512')).toBe('202601');
    expect(competenciaSeguinte('202509')).toBe('202510');
    expect(competenciasNoIntervalo('202511', '202601')).toBe(3);
    expect(competenciasNoIntervalo('202511', '202510')).toBe(0);
  });
});

const solicitada: EstadoApac = {
  situacao: 'solicitada',
  tipo: null,
  dataSolicitacao: '2025-09-01',
  dataAutorizacao: null,
  competenciaInicial: null,
  competenciaFinal: null,
  ultimaCompetencia: null,
};
const autorizar = (extra: Partial<Parameters<typeof recusaAutorizarApac>[1]> = {}) => ({
  numero: NUMERO,
  tipo: 'inicial' as const,
  dataAutorizacao: '2025-09-02',
  competenciaInicial: '202509',
  competenciaFinal: '202511',
  ...extra,
});

describe('ciclo da APAC (laudo → autorização → continuidade → encerramento)', () => {
  it('o laudo não é futuro nem anterior à SIGTAP', () => {
    expect(recusaLaudoApac('2025-09-01', '2026-10-26')).toBeNull();
    expect(recusaLaudoApac('2026-10-27', '2026-10-26')).toBe('apac-data-invalida');
    expect(recusaLaudoApac('2007-12-31', '2026-10-26')).toBe('apac-data-invalida');
  });

  it('autorizar: número, data e validade (até 3 competências; a única, 1)', () => {
    const hoje = '2026-10-26';
    expect(recusaAutorizarApac(solicitada, autorizar(), hoje)).toBeNull();
    expect(recusaAutorizarApac({ ...solicitada, situacao: 'autorizada' }, autorizar(), hoje)).toBe(
      'apac-situacao-invalida',
    );
    expect(recusaAutorizarApac(solicitada, autorizar({ numero: '1234567890123' }), hoje)).toBe(
      'apac-numero-invalido',
    );
    expect(recusaAutorizarApac(solicitada, autorizar({ dataAutorizacao: '2025-08-31' }), hoje)).toBe(
      'apac-data-invalida',
    );
    expect(recusaAutorizarApac(solicitada, autorizar({ competenciaFinal: '202512' }), hoje)).toBe(
      'apac-validade-invalida',
    );
    expect(recusaAutorizarApac(solicitada, autorizar({ competenciaInicial: '202508' }), hoje)).toBe(
      'apac-validade-invalida',
    );
    expect(recusaAutorizarApac(solicitada, autorizar({ tipo: 'unica' }), hoje)).toBe(
      'apac-validade-invalida',
    );
    expect(
      recusaAutorizarApac(solicitada, autorizar({ tipo: 'unica', competenciaFinal: '202509' }), hoje),
    ).toBeNull();
    // A validade não começa numa competência futura.
    expect(recusaAutorizarApac(solicitada, autorizar(), '2025-09-05')).toBeNull();
    expect(
      recusaAutorizarApac(
        solicitada,
        autorizar({ competenciaInicial: '202510', competenciaFinal: '202510' }),
        '2025-09-05',
      ),
    ).toBe('apac-validade-invalida');
  });

  it('continuidade: mês a mês, dentro da validade e já começada', () => {
    const a: EstadoApac = {
      ...solicitada,
      situacao: 'autorizada',
      tipo: 'inicial',
      dataAutorizacao: '2025-09-02',
      competenciaInicial: '202509',
      competenciaFinal: '202511',
      ultimaCompetencia: '202509',
    };
    expect(recusaContinuarApac(a, '2025-10-01')).toBeNull();
    expect(recusaContinuarApac(a, '2025-09-30')).toBe('apac-continuidade-fora-da-validade');
    expect(recusaContinuarApac({ ...a, ultimaCompetencia: '202511' }, '2026-01-01')).toBe(
      'apac-continuidade-fora-da-validade',
    );
    expect(recusaContinuarApac({ ...a, tipo: 'unica' }, '2025-10-01')).toBe('apac-situacao-invalida');
    expect(recusaContinuarApac(solicitada, '2025-10-01')).toBe('apac-situacao-invalida');
  });

  it('encerramento: motivo de saída (nunca de permanência) numa competência já apresentada', () => {
    const a: EstadoApac = {
      ...solicitada,
      situacao: 'autorizada',
      tipo: 'inicial',
      dataAutorizacao: '2025-09-02',
      competenciaInicial: '202509',
      competenciaFinal: '202511',
      ultimaCompetencia: '202510',
    };
    const hoje = '2026-10-26';
    expect(recusaEncerrarApac(a, { motivo: '12', dataEncerramento: '2025-10-15' }, hoje)).toBeNull();
    expect(recusaEncerrarApac(a, { motivo: '21', dataEncerramento: '2025-10-15' }, hoje)).toBe(
      'apac-encerramento-invalido',
    );
    expect(recusaEncerrarApac(a, { motivo: '12', dataEncerramento: '2025-11-15' }, hoje)).toBe(
      'apac-encerramento-invalido',
    );
    expect(recusaEncerrarApac(a, { motivo: '12', dataEncerramento: '2025-08-15' }, hoje)).toBe(
      'apac-encerramento-invalido',
    );
    expect(recusaEncerrarApac(solicitada, { motivo: '12', dataEncerramento: '2025-09-15' }, hoje)).toBe(
      'apac-situacao-invalida',
    );
  });

  it('corrigir o laudo só na solicitada, com a data do laudo válida (D-CORRIGIR-513)', () => {
    const hoje = '2026-10-26';
    expect(recusaCorrigirApac(solicitada, '2025-09-01', hoje)).toBeNull();
    expect(recusaCorrigirApac({ situacao: 'autorizada' }, '2025-09-01', hoje)).toBe('apac-situacao-invalida');
    expect(recusaCorrigirApac({ situacao: 'negada' }, '2025-09-01', hoje)).toBe('apac-situacao-invalida');
    expect(recusaCorrigirApac(solicitada, '2099-01-01', hoje)).toBe('apac-data-invalida');
  });

  it('negar só a solicitada; cancelar a solicitada ou a autorizada', () => {
    expect(recusaNegarOuCancelarApac(solicitada, 'negar')).toBeNull();
    expect(recusaNegarOuCancelarApac({ ...solicitada, situacao: 'autorizada' }, 'negar')).toBe(
      'apac-situacao-invalida',
    );
    expect(recusaNegarOuCancelarApac({ ...solicitada, situacao: 'autorizada' }, 'cancelar')).toBeNull();
    expect(recusaNegarOuCancelarApac({ ...solicitada, situacao: 'encerrada' }, 'cancelar')).toBe(
      'apac-situacao-invalida',
    );
  });

  it('o tipo no arquivo: 1 na primeira competência, 2 nas de continuidade, 3 na única; fora da validade, nada', () => {
    const a = apac({ ultimaCompetencia: '202510' });
    expect(tipoNaCompetencia(a, '202509')).toBe('1');
    expect(tipoNaCompetencia(a, '202510')).toBe('2');
    expect(tipoNaCompetencia(a, '202511')).toBeNull();
    expect(tipoNaCompetencia(apac({ tipo: 'unica', competenciaFinal: '202509' }), '202509')).toBe('3');
    expect(tipoNaCompetencia(apac({ situacao: 'solicitada' }), '202509')).toBeNull();
    expect(tipoNaCompetencia(apac({ situacao: 'cancelada' }), '202509')).toBeNull();
  });

  it('o laudo de nefrologia nos procedimentos do grupo 03.05 (D-NEFRO-51)', () => {
    expect(exigeLaudoNefrologia('0305010107')).toBe(true);
    expect(exigeLaudoNefrologia('0304010014')).toBe(false);
  });
});

describe('montagem da APAC na competência (regras 1, 2, 5)', () => {
  it('o principal e o secundário do paciente vão à APAC; o do BPA fica fora; o tipo 1 com o motivo de permanência', () => {
    const r = montarApac(
      [apac()],
      [
        atendimento(1, 77, [
          { sigtap: 301, quantidade: 2 },
          { sigtap: 302 },
          { sigtap: 304 },
          { sigtap: 305 },
        ]),
      ],
      ctx(),
    );
    expect(r.criticas).toEqual([]);
    expect(r.apacs).toHaveLength(1);
    const x = r.apacs[0]!;
    expect(x.tipoNoArquivo).toBe('1');
    expect(x.motivoSaida).toBe('21');
    expect(x.procedimentos.map((p) => [p.codigo, p.principal, p.quantidade])).toEqual([
      ['0304010014', true, 2],
      ['0211020036', false, 1],
    ]);
    expect(r.atendimentos).toBe(1);
    expect(r.apresentaveis).toBe(1);
  });

  it('o procedimento de APAC sem autorização vigente é aviso; a APAC sem produção também', () => {
    const r = montarApac(
      [apac({ id: 2, paciente: 99 })],
      [atendimento(2, 77, [{ sigtap: 301 }]), atendimento(3, 88, [{ sigtap: 302 }, { sigtap: 305 }])],
      ctx(),
    );
    expect(regras(r)).toEqual(['apac-sem-autorizacao', 'apac-sem-autorizacao', 'apac-sem-producao']);
    expect(r.criticas.every((c) => c.gravidade === 'aviso')).toBe(true);
    // O que também cabe no BPA (305) não é crítica da APAC: é produção do BPA.
    expect(r.apacs).toEqual([]);
  });

  it('identificação: CNS do paciente, do solicitante, do autorizador e do executante; nome da mãe (bloqueantes)', () => {
    const r = montarApac(
      [apac({ autorizador: '0', solicitante: { cns: null, nome: 'X' } })],
      [
        atendimento(4, 77, [{ sigtap: 301, executante: { cbo: '225125', cns: '0', cpf: null } }], {
          cns: null,
          mae: '',
        }),
      ],
      ctx(),
    );
    expect(regras(r)).toEqual([
      'autorizador-sem-identificacao',
      'dado-minimo-ausente',
      'profissional-sem-identificacao',
      'profissional-sem-identificacao',
      'sem-cns-paciente',
    ]);
    expect(r.apacs).toEqual([]);
  });

  it('o número inválido e o laudo de nefrologia ausente bloqueiam; com o laudo, sai o registro de nefrologia', () => {
    const r1 = montarApac(
      [apac({ numero: '1234567890123', procedimento: '0305010107' })],
      [atendimento(5, 77, [{ sigtap: 303 }])],
      ctx(),
    );
    expect(regras(r1)).toEqual(['apac-numero-invalido', 'laudo-especifico-ausente']);
    const neo = {
      caracteristicaTratamento: 1,
      contraindicacaoTransplante: 2,
      situacaoTransplante: 1,
      acessoVascular: 3,
      inicioTratamento: '2025-01-10',
    };
    const r2 = montarApac(
      [apac({ procedimento: '0305010107', laudoEspecifico: 'nefrologia', nefrologia: neo })],
      [atendimento(5, 77, [{ sigtap: 303 }])],
      ctx(),
    );
    expect(r2.criticas).toEqual([]);
    expect(r2.apacs[0]?.nefrologia).toEqual(neo);
  });

  it('regra 2: o validador de compatibilidade da SIGTAP da competência (CID do laudo e CBO do executante)', () => {
    const compat = compatibilidadesDaCompetencia('202509', {
      cids: [{ id: 301, codigo: 'C61', competenciaInicial: 200801, competenciaFinal: 0 }],
      cbos: [{ id: 301, codigo: '225121', competenciaInicial: 200801, competenciaFinal: 0 }],
      habilitacoes: [],
      leitos: [],
    });
    const r = montarApac(
      [apac()],
      [atendimento(6, 77, [{ sigtap: 301 }])],
      ctx({ compatibilidades: compat }),
    );
    expect(regras(r)).toEqual(['cbo-incompativel', 'cid-incompativel']);
    expect(r.apacs).toEqual([]);
  });

  it('continuidade (tipo 2) e encerramento na competência (motivo e data de saída); o não SUS fica fora', () => {
    const r = montarApac(
      [
        apac({
          situacao: 'encerrada',
          ultimaCompetencia: '202509',
          competenciaInicial: '202508',
          motivoSaida: '12',
          dataEncerramento: '2025-09-20',
        }),
      ],
      [atendimento(7, 77, [{ sigtap: 301 }]), atendimento(8, 77, [{ sigtap: 301 }], { convenio: 55 })],
      ctx(),
    );
    expect(r.criticas).toEqual([]);
    expect(r.foraPorNaoSerSus).toBe(1);
    const x = r.apacs[0]!;
    expect([x.tipoNoArquivo, x.motivoSaida, x.dataSaida]).toEqual(['2', '12', '2025-09-20']);
  });

  it('sem CNES válido, a crítica do estabelecimento', () => {
    expect(regras(montarApac([], [], ctx({ cnes: null })))).toEqual(['sem-cnes']);
  });
});
