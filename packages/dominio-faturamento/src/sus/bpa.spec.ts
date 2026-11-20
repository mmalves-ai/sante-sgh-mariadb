// BPA (ficha do M51, seção 5: faturamento.gerarBpa; regras 1, 2, 4 e 5). Massa SINTÉTICA (documentos do algoritmo).
import { describe, expect, it } from 'vitest';
import { type AtendimentoBpa, type ContextoBpa, idadeEmAnos, montarBpa, racaSia } from './bpa.js';
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

const P = (id: number, codigo: string, registros: RegistroSigtap[], vigente = true): ProcedimentoNaCiha => ({
  procedimento: procedimento(id, codigo),
  naCompetencia: vigente ? { fonte: 'atual', atributos: ATRIBUTOS_LIVRES } : null,
  registros,
});
const CATALOGO = new Map<number, ProcedimentoNaCiha>([
  [201, P(201, '0301010072', ['bpa-i', 'bpa-c'])], // consulta: I ou C
  [202, P(202, '0202010295', ['bpa-c'])], // exame: só C
  [203, P(203, '0211020036', ['bpa-i'])], // ECG: só I
  [204, P(204, '0304010014', ['apac-principal'])], // só APAC
  [205, P(205, '0101010010', ['bpa-c'], false)], // fora da competência
  [206, P(206, '0406010811', ['aih-principal'])], // só AIH
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
  itens: {
    sigtap: number | null;
    quantidade?: number;
    procedimento?: number;
    executante?: typeof EXEC | null;
  }[],
  extra: Partial<AtendimentoBpa> & { cns?: string | null } = {},
): AtendimentoBpa {
  return {
    conta: 1000 + n,
    atendimento: 2000 + n,
    convenio: 1,
    data: '2025-09-10',
    cidPrincipal: 'I10',
    paciente: {
      cns: extra.cns === undefined ? cnsSintetico(n) : extra.cns,
      cpf: cpfSintetico(`20000000${n}`),
      sexo: 'F',
      nascimento: '1980-03-15',
      municipio: 330390,
      nome: `PACIENTE SINTETICO ${n}`,
      raca: 3,
      cep: '25600000',
      logradouro: 'RUA SINTETICA',
      numero: '10',
      complemento: null,
      bairro: 'CENTRO',
    },
    itens: itens.map((x, k) => ({
      item: n * 10 + k,
      sigtap: x.sigtap,
      quantidade: x.quantidade ?? 1,
      procedimento: x.procedimento ?? 7000 + k,
      executante: x.executante === undefined ? EXEC : x.executante,
    })),
    ...extra,
  };
}

const regras = (r: ReturnType<typeof montarBpa>) => r.criticas.map((c) => c.regra).sort();

describe('montagem do BPA', () => {
  it('regra 1: BPA-I quando permitido e o paciente tem CNS; BPA-C para o só consolidado, somado por CBO, procedimento e idade', () => {
    const r = montarBpa(
      [
        atendimento(1, [{ sigtap: 201 }, { sigtap: 202, quantidade: 2 }]),
        atendimento(2, [{ sigtap: 202, quantidade: 3 }]),
      ],
      ctx(),
    );
    expect(r.criticas).toEqual([]);
    expect(r.individualizado.map((x) => [x.conta, x.procedimento])).toEqual([[1001, '0301010072']]);
    expect(r.consolidado).toEqual([{ cbo: '225125', procedimento: '0202010295', idade: 45, quantidade: 5 }]);
    expect(r.atendimentos).toBe(2);
    const i = r.individualizado[0]!;
    expect(i.cnsPaciente).toBe(cnsSintetico(1));
    expect(i.raca).toBe('03');
    expect(i.idade).toBe(45);
  });

  it('sem CNS do paciente: o que permite os dois vai consolidado (D-BPAI-51); o só individualizado vai para a crítica', () => {
    const r = montarBpa(
      [atendimento(3, [{ sigtap: 201 }], { cns: null }), atendimento(4, [{ sigtap: 203 }], { cns: '0' })],
      ctx(),
    );
    expect(r.consolidado.map((x) => x.procedimento)).toEqual(['0301010072']);
    expect(r.individualizado).toEqual([]);
    expect(regras(r)).toEqual(['sem-cns-paciente']);
  });

  it('instrumento incompatível (só AIH), fora da competência e item sem equivalente', () => {
    const r = montarBpa(
      [
        atendimento(5, [{ sigtap: 206 }]),
        atendimento(6, [{ sigtap: 205 }]),
        atendimento(7, [{ sigtap: null }]),
        atendimento(8, [{ sigtap: 201 }, { sigtap: null }]),
      ],
      ctx(),
    );
    expect(regras(r)).toEqual([
      'instrumento-incompativel',
      'item-sem-sigtap',
      'sem-sigtap',
      'sigtap-fora-da-competencia',
    ]);
    // O aviso não tira a linha do atendimento 8.
    expect(r.individualizado.map((x) => x.conta)).toEqual([1008]);
  });

  it('regra 1 (etapa 3): o procedimento só de APAC vai à APAC, sem crítica nem linha no BPA', () => {
    const r = montarBpa(
      [atendimento(5, [{ sigtap: 204 }]), atendimento(9, [{ sigtap: 204 }, { sigtap: 202 }])],
      ctx(),
    );
    expect(r.criticas).toEqual([]);
    expect(r.individualizado).toEqual([]);
    expect(r.consolidado.map((x) => x.procedimento)).toEqual(['0202010295']);
    expect(r.atendimentos).toBe(1);
  });

  it('com a APAC desligada, o procedimento só de APAC fica no BPA com a crítica do instrumento (D-BPA-APAC-513)', () => {
    const r = montarBpa(
      [atendimento(5, [{ sigtap: 204 }]), atendimento(9, [{ sigtap: 204 }, { sigtap: 202 }])],
      { ...ctx(), apacLiberada: false },
    );
    const incompativeis = r.criticas.filter((c) => c.regra === 'instrumento-incompativel');
    expect(incompativeis.map((c) => c.conta).sort()).toEqual([1005, 1009]);
    // A crítica do instrumento é bloqueante: o atendimento fica fora até a APAC ser liberada (ou o item corrigido).
    expect(incompativeis.every((c) => c.gravidade === 'bloqueante')).toBe(true);
    expect(r.consolidado).toEqual([]);
    // Ligada explicitamente: o mesmo que o padrão (sai do BPA sem crítica).
    expect(montarBpa([atendimento(5, [{ sigtap: 204 }])], { ...ctx(), apacLiberada: true }).criticas).toEqual(
      [],
    );
  });

  it('a equivalência do Sante vale quando o item não tem vínculo (D-EQUIV-BPA-51)', () => {
    const r = montarBpa([atendimento(9, [{ sigtap: null, procedimento: 7777 }])], {
      ...ctx(),
      equivalencia: (p) => (p === 7777 ? 202 : null),
    });
    expect(r.criticas).toEqual([]);
    expect(r.consolidado).toHaveLength(1);
  });

  it('regra 5: executante sem CBO ou sem CNS no BPA-I; dado mínimo do paciente', () => {
    const r = montarBpa(
      [
        atendimento(10, [{ sigtap: 201, executante: null }]),
        atendimento(11, [{ sigtap: 203, executante: { cbo: '225125', cns: '0', cpf: null } }]),
        atendimento(12, [{ sigtap: 203 }], {
          paciente: { ...atendimento(12, []).paciente, nome: ' ', municipio: null },
        }),
      ],
      ctx(),
    );
    expect(regras(r)).toEqual([
      'dado-minimo-ausente',
      'dado-minimo-ausente',
      'profissional-sem-identificacao',
      'profissional-sem-identificacao',
      'sem-cbo',
    ]);
    expect(r.individualizado).toEqual([]);
  });

  it('só o SUS: o convênio e o particular ficam fora (vão na CIHA); data fora da competência; sem CNES', () => {
    const r = montarBpa(
      [
        atendimento(13, [{ sigtap: 201 }], { convenio: 20 }),
        atendimento(14, [{ sigtap: 201 }], { data: '2025-08-31' }),
      ],
      ctx({ cnes: '0' }),
    );
    expect(r.foraPorNaoSerSus).toBe(1);
    expect(regras(r)).toEqual(['data-fora-da-competencia', 'sem-cnes']);
  });

  it('o validador de compatibilidade entra na montagem (CBO incompatível e habilitação)', () => {
    const lidas = {
      cids: [],
      cbos: [{ id: 202, codigo: '322205', competenciaInicial: 0, competenciaFinal: 0 }],
      habilitacoes: [{ id: 201, codigo: '1712', competenciaInicial: 0, competenciaFinal: 0 }],
      leitos: [],
    };
    const r = montarBpa([atendimento(15, [{ sigtap: 202 }]), atendimento(16, [{ sigtap: 201 }])], {
      ...ctx(),
      compatibilidades: compatibilidadesDaCompetencia('202509', lidas),
    });
    expect(regras(r)).toEqual(['cbo-incompativel', 'habilitacao-ausente']);
    const r2 = montarBpa([atendimento(16, [{ sigtap: 201 }])], {
      ...ctx(),
      compatibilidades: compatibilidadesDaCompetencia('202509', lidas),
      habilitacoes: new Set(['1712']),
    });
    expect(r2.criticas).toEqual([]);
  });

  it('auxiliares: raça e idade em anos', () => {
    expect(racaSia(1)).toBe('01');
    expect(racaSia(9)).toBe('99');
    expect(racaSia(null)).toBe('99');
    expect(idadeEmAnos('2000-09-11', '2025-09-10')).toBe(24);
    expect(idadeEmAnos(null, '2025-09-10')).toBeNull();
  });
});
