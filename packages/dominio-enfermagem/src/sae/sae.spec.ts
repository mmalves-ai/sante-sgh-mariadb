// Regra 7 do M45 (etapa 4): o processo de enfermagem em cinco etapas (COFEN 736/2024) — a conferência contra a
// terminologia em uso e os domínios do estabelecimento (escala de 1 a 5 e meta), a coerência da meta, o diagnóstico de
// risco com os fatores e o real com as características, a evolução que reavalia a meta, as etapas feitas e quem pode
// registrar (só o enfermeiro; o técnico executa e checa). Terminologia SINTÉTICA.
import { type ProcessoSaeLido, type RegistrarSaeEntrada, TERMINOLOGIA_SAE_SINTETICA } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conferirEvolucao, pontoAtualDoResultado, situacaoDaEvolucao } from './evolucao.js';
import {
  conferirSae,
  conferirTerminologia,
  dominiosDaSae,
  etapasDoProcesso,
  indexarTerminologia,
  interpretarMeta,
  interpretarPontoEscala,
  metaCoerente,
  podeChecarCuidado,
  podeRegistrarSae,
  terminologiaDasLinhas,
} from './processo.js';

const T = TERMINOLOGIA_SAE_SINTETICA;
// Os domínios como estão na cópia `pc` (6 pontos: 1 a 5 e NA; 3 metas).
const DOMINIOS = dominiosDaSae(
  [
    { codigo: 1, rotulo: '1' },
    { codigo: 2, rotulo: '2' },
    { codigo: 3, rotulo: '3' },
    { codigo: 4, rotulo: '4' },
    { codigo: 5, rotulo: '5' },
    { codigo: 6, rotulo: 'NA' },
  ],
  [
    { codigo: 1, rotulo: 'Aumentar para' },
    { codigo: 2, rotulo: 'Manter em' },
    { codigo: 3, rotulo: 'Diminuir para' },
  ],
);

const base = (): RegistrarSaeEntrada => ({
  avaliacao: 'Paciente acamado, pele íntegra, mobilidade reduzida; dor 6 em incisão.',
  versaoVista: 0,
  diagnosticos: [
    {
      codigo: 'S-D01',
      caracteristicas: [],
      fatores: ['S-F011', 'S-F013'],
      resultados: [{ codigo: 'S-R01', escalaAtual: 3, meta: 1, escalaMeta: 5 }],
      intervencoes: [{ codigo: 'S-I01' }],
    },
    {
      codigo: 'S-D04',
      caracteristicas: ['S-C041'],
      fatores: ['S-F041'],
      resultados: [{ codigo: 'S-R04', escalaAtual: 2, meta: 1, escalaMeta: 4 }],
      intervencoes: [{ codigo: 'S-I04' }],
    },
  ],
});

describe('domínios e terminologia', () => {
  it('interpreta a escala (1 a 5 e NA) e as metas; o rótulo nunca visto fica nulo', () => {
    expect(interpretarPontoEscala('3')).toBe(3);
    expect(interpretarPontoEscala('5 - Nenhum comprometimento')).toBe(5);
    expect(interpretarPontoEscala('N.A.')).toBeNull();
    expect(interpretarPontoEscala('Não se aplica')).toBeNull();
    expect(interpretarPontoEscala('sem número')).toBeNull();
    expect(interpretarMeta('Aumentar para')).toBe('aumentar');
    expect(interpretarMeta('MANTER EM')).toBe('manter');
    expect(interpretarMeta('Diminuir para')).toBe('diminuir');
    expect(interpretarMeta('Outra')).toBeNull();
    expect(DOMINIOS.escala.map((p) => p.valor)).toEqual([1, 2, 3, 4, 5, null]);
  });

  it('a terminologia sintética indexada; carregada de linhas, monta a árvore; sem linhas, a sintética', () => {
    const ix = indexarTerminologia(T);
    expect(ix.diagnosticos.get('S-D02')?.risco).toBe(true);
    expect(ix.intervencoes.get('S-I03')?.atividades).toHaveLength(3);
    expect(terminologiaDasLinhas([], T)).toBe(T);
    const linha = (tipo: string, codigo: string, pai: string | null, risco = false) => ({
      sistema: 'CIPE' as const,
      versao: '2026',
      licenca: 'Licença de teste',
      tipo,
      codigo,
      pai,
      descricao: `Termo ${codigo}`,
      risco,
    });
    const c = terminologiaDasLinhas(
      [
        linha('diagnostico', 'D1', null, true),
        linha('fator', 'F1', 'D1'),
        linha('caracteristica', 'C1', 'D1'),
        linha('resultado', 'R1', null),
        linha('intervencao', 'I1', null),
        linha('atividade', 'A1', 'I1'),
      ],
      T,
    );
    expect(c).toMatchObject({ sistema: 'CIPE', versao: '2026', sintetica: false });
    expect(c.diagnosticos[0]).toMatchObject({ codigo: 'D1', risco: true, fatores: [{ codigo: 'F1' }] });
    expect(c.intervencoes[0]?.atividades).toEqual([{ codigo: 'A1', descricao: 'Termo A1' }]);
  });

  it('confere a carga da terminologia: completa, com pai, sem repetir', () => {
    const ok = [
      { tipo: 'diagnostico', codigo: 'D1', pai: null, risco: true },
      { tipo: 'fator', codigo: 'F1', pai: 'D1', risco: false },
      { tipo: 'resultado', codigo: 'R1', pai: null, risco: false },
      { tipo: 'intervencao', codigo: 'I1', pai: null, risco: false },
      { tipo: 'atividade', codigo: 'A1', pai: 'I1', risco: false },
    ];
    expect(conferirTerminologia(ok)).toEqual({ ok: true });
    expect(conferirTerminologia(ok.slice(0, 2))).toMatchObject({ codigo: 'terminologia-incompleta' });
    expect(conferirTerminologia([...ok, ok[1]!])).toMatchObject({ codigo: 'termo-repetido' });
    expect(
      conferirTerminologia([...ok, { tipo: 'atividade', codigo: 'A2', pai: 'D1', risco: false }]),
    ).toMatchObject({
      codigo: 'termo-sem-pai',
    });
    expect(
      conferirTerminologia([...ok, { tipo: 'resultado', codigo: 'R2', pai: 'D1', risco: false }]),
    ).toMatchObject({
      codigo: 'termo-sem-pai',
    });
    expect(
      conferirTerminologia([...ok, { tipo: 'resultado', codigo: 'R3', pai: null, risco: true }]),
    ).toMatchObject({
      codigo: 'termo-risco',
    });
  });
});

describe('regra 7: o processo (avaliação, diagnóstico, planejamento)', () => {
  it('confere e devolve o plano com as descrições (o retrato gravado)', () => {
    const r = conferirSae(base(), T, DOMINIOS, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagnosticos.map((d) => d.descricao)).toEqual([
      'Sintético: risco de lesão da pele por pressão',
      'Sintético: dor aguda',
    ]);
    expect(r.diagnosticos[0]?.fatores.map((f) => f.codigo)).toEqual(['S-F011', 'S-F013']);
    expect(r.diagnosticos[1]?.resultados[0]).toMatchObject({
      codigo: 'S-R04',
      escalaAtual: 2,
      escalaMeta: 4,
    });
    expect(r.diagnosticos[1]?.intervencoes).toEqual([{ codigo: 'S-I04', descricao: 'Controle da dor' }]);
  });

  it('a versão vista tem de ser a vigente (revisão concorrente recusa)', () => {
    expect(conferirSae(base(), T, DOMINIOS, 1)).toMatchObject({ ok: false, codigo: 'sae-mudou' });
  });

  it('diagnóstico de risco pede os fatores e não tem características; o real pede ao menos uma característica', () => {
    const e = base();
    expect(
      conferirSae({ ...e, diagnosticos: [{ ...e.diagnosticos[0]!, fatores: [] }] }, T, DOMINIOS, 0),
    ).toMatchObject({ codigo: 'sem-fator-de-risco' });
    expect(
      conferirSae(
        { ...e, diagnosticos: [{ ...e.diagnosticos[0]!, caracteristicas: ['S-C041'] }] },
        T,
        DOMINIOS,
        0,
      ),
    ).toMatchObject({ codigo: 'termo-desconhecido' });
    expect(
      conferirSae({ ...e, diagnosticos: [{ ...e.diagnosticos[1]!, caracteristicas: [] }] }, T, DOMINIOS, 0),
    ).toMatchObject({ codigo: 'sem-caracteristica' });
    // Um diagnóstico de risco com característica do próprio catálogo (inventada no teste) também recusa.
    const comCaract = {
      ...T,
      diagnosticos: T.diagnosticos.map((d) =>
        d.codigo === 'S-D01' ? { ...d, caracteristicas: [{ codigo: 'X-C', descricao: 'x' }] } : d,
      ),
    };
    expect(
      conferirSae(
        { ...e, diagnosticos: [{ ...e.diagnosticos[0]!, caracteristicas: ['X-C'] }] },
        comCaract,
        DOMINIOS,
        0,
      ),
    ).toMatchObject({ codigo: 'diagnostico-de-risco' });
  });

  it('códigos fora da terminologia, repetidos e fatores de outro diagnóstico são recusados (regra 15)', () => {
    const e = base();
    const d0 = e.diagnosticos[0]!;
    expect(conferirSae({ ...e, diagnosticos: [{ ...d0, codigo: 'NANDA-1' }] }, T, DOMINIOS, 0)).toMatchObject(
      {
        codigo: 'termo-desconhecido',
      },
    );
    expect(conferirSae({ ...e, diagnosticos: [d0, d0] }, T, DOMINIOS, 0)).toMatchObject({
      codigo: 'diagnostico-repetido',
    });
    expect(
      conferirSae({ ...e, diagnosticos: [{ ...d0, fatores: ['S-F021'] }] }, T, DOMINIOS, 0),
    ).toMatchObject({
      codigo: 'termo-desconhecido',
    });
    expect(
      conferirSae(
        { ...e, diagnosticos: [{ ...d0, resultados: [{ ...d0.resultados[0]!, codigo: 'X' }] }] },
        T,
        DOMINIOS,
        0,
      ),
    ).toMatchObject({ codigo: 'termo-desconhecido' });
    expect(
      conferirSae(
        { ...e, diagnosticos: [{ ...d0, resultados: [d0.resultados[0]!, d0.resultados[0]!] }] },
        T,
        DOMINIOS,
        0,
      ),
    ).toMatchObject({ codigo: 'resultado-repetido' });
    expect(
      conferirSae({ ...e, diagnosticos: [{ ...d0, intervencoes: [{ codigo: 'X' }] }] }, T, DOMINIOS, 0),
    ).toMatchObject({ codigo: 'termo-desconhecido' });
    expect(
      conferirSae(
        { ...e, diagnosticos: [{ ...d0, intervencoes: [{ codigo: 'S-I01' }, { codigo: 'S-I01' }] }] },
        T,
        DOMINIOS,
        0,
      ),
    ).toMatchObject({ codigo: 'intervencao-repetida' });
  });

  it('o resultado esperado: ponto e meta do domínio, de 1 a 5, e a meta coerente com o ponto de agora', () => {
    const e = base();
    const d0 = e.diagnosticos[0]!;
    const com = (r: Partial<(typeof d0.resultados)[number]>) =>
      conferirSae(
        { ...e, diagnosticos: [{ ...d0, resultados: [{ ...d0.resultados[0]!, ...r }] }] },
        T,
        DOMINIOS,
        0,
      );
    expect(com({ escalaAtual: 9 })).toMatchObject({ codigo: 'valor-nunca-visto' });
    expect(com({ meta: 9 })).toMatchObject({ codigo: 'valor-nunca-visto' });
    expect(com({ escalaMeta: 6 })).toMatchObject({ codigo: 'escala-nao-se-aplica' });
    expect(com({ escalaAtual: 5, escalaMeta: 3 })).toMatchObject({ codigo: 'meta-incoerente' });
    expect(com({ meta: 2, escalaAtual: 3, escalaMeta: 3 }).ok).toBe(true);
    expect(com({ meta: 3, escalaAtual: 4, escalaMeta: 2 }).ok).toBe(true);
    const metaNova = dominiosDaSae(DOMINIOS.escala, [{ codigo: 1, rotulo: 'Alcançar' }]);
    expect(conferirSae(e, T, metaNova, 0)).toMatchObject({ codigo: 'valor-nunca-visto' });
    expect(metaCoerente('aumentar', 2, 4)).toBe(true);
    expect(metaCoerente('manter', 2, 3)).toBe(false);
    expect(metaCoerente('diminuir', 4, 2)).toBe(true);
  });

  it('SAE e diagnóstico privativos do enfermeiro; o técnico checa', () => {
    expect(podeRegistrarSae('enfermeiro')).toBe(true);
    expect(podeRegistrarSae('tecnico')).toBe(false);
    expect(podeRegistrarSae('outro')).toBe(false);
    expect(podeChecarCuidado('tecnico')).toBe(true);
    expect(podeChecarCuidado('outro')).toBe(false);
  });
});

const processo = (extra: Partial<ProcessoSaeLido> = {}): ProcessoSaeLido => ({
  id: 10,
  versao: 1,
  avaliacao: 'Avaliação sintética de teste do processo.',
  sistema: 'SINT',
  versaoTerminologia: 'SINT-2026.1',
  usuario: 'SINT.ENF.PLANTAO',
  em: '2026-10-22T08:00',
  registroProntuario: null,
  evolucoes: [],
  diagnosticos: [
    {
      id: 11,
      codigo: 'S-D01',
      descricao: 'x',
      caracteristicas: [],
      fatores: [],
      resultados: [
        { id: 12, codigo: 'S-R01', descricao: 'Pele', escalaAtual: 3, meta: 1, escalaMeta: 5, evolucoes: [] },
        { id: 13, codigo: 'S-R04', descricao: 'Dor', escalaAtual: 4, meta: 3, escalaMeta: 2, evolucoes: [] },
        { id: 14, codigo: 'S-R03', descricao: 'Resp', escalaAtual: 4, meta: 2, escalaMeta: 4, evolucoes: [] },
      ],
      intervencoes: [{ id: 15, codigo: 'S-I01', descricao: 'Prev', atividades: [] }],
    },
  ],
  ...extra,
});

describe('regra 7: a evolução reavalia a meta', () => {
  it('a situação sai da conta (aumentar, diminuir e manter)', () => {
    expect(situacaoDaEvolucao('aumentar', 3, 5, 5)).toBe('atingida');
    expect(situacaoDaEvolucao('aumentar', 3, 5, 4)).toBe('melhorou');
    expect(situacaoDaEvolucao('aumentar', 3, 5, 3)).toBe('mantida');
    expect(situacaoDaEvolucao('aumentar', 3, 5, 2)).toBe('piorou');
    expect(situacaoDaEvolucao('diminuir', 4, 2, 1)).toBe('atingida');
    expect(situacaoDaEvolucao('diminuir', 4, 2, 3)).toBe('melhorou');
    expect(situacaoDaEvolucao('diminuir', 4, 2, 4)).toBe('mantida');
    expect(situacaoDaEvolucao('diminuir', 4, 2, 5)).toBe('piorou');
    expect(situacaoDaEvolucao('manter', 4, 4, 4)).toBe('atingida');
    expect(situacaoDaEvolucao('manter', 2, 4, 3)).toBe('melhorou');
    expect(situacaoDaEvolucao('manter', 3, 4, 5)).toBe('mantida');
    expect(situacaoDaEvolucao('manter', 3, 4, 1)).toBe('piorou');
  });

  it('confere contra o processo vigente; o ponto anterior é o da última evolução', () => {
    const p = processo();
    const r = conferirEvolucao(
      {
        versaoVista: 1,
        nota: 'Evolução sintética do turno.',
        resultados: [
          { resultado: 12, escala: 4 },
          { resultado: 13, escala: 2 },
        ],
      },
      p,
      DOMINIOS,
    );
    expect(r).toMatchObject({
      ok: true,
      resultados: [
        { resultado: 12, situacao: 'melhorou' },
        { resultado: 13, situacao: 'atingida' },
      ],
    });
    const comEvolucao = processo();
    const res = comEvolucao.diagnosticos[0]!.resultados[0]!;
    const evoluido = {
      ...res,
      evolucoes: [
        { id: 2, escala: 4, situacao: 'melhorou' as const, usuario: 'u', em: '2026-10-22T10:00' },
        { id: 1, escala: 2, situacao: 'piorou' as const, usuario: 'u', em: '2026-10-22T09:00' },
      ],
    };
    expect(pontoAtualDoResultado(evoluido)).toBe(4);
    expect(pontoAtualDoResultado(res)).toBe(3);
  });

  it('recusa sem processo, de outra versão, resultado de outro processo, repetido e ponto fora do domínio', () => {
    const e = {
      versaoVista: 1,
      nota: 'Evolução sintética.',
      resultados: [{ resultado: 12, escala: 4 }],
    };
    expect(conferirEvolucao(e, null, DOMINIOS)).toMatchObject({ codigo: 'sem-processo' });
    expect(conferirEvolucao({ ...e, versaoVista: 2 }, processo(), DOMINIOS)).toMatchObject({
      codigo: 'sae-mudou',
    });
    expect(
      conferirEvolucao({ ...e, resultados: [{ resultado: 99, escala: 4 }] }, processo(), DOMINIOS),
    ).toMatchObject({
      codigo: 'resultado-de-outro-processo',
    });
    expect(
      conferirEvolucao({ ...e, resultados: [e.resultados[0]!, e.resultados[0]!] }, processo(), DOMINIOS),
    ).toMatchObject({
      codigo: 'resultado-repetido',
    });
    expect(
      conferirEvolucao({ ...e, resultados: [{ resultado: 12, escala: 6 }] }, processo(), DOMINIOS),
    ).toMatchObject({
      codigo: 'valor-nunca-visto',
    });
    const semMeta = dominiosDaSae(DOMINIOS.escala, [{ codigo: 9, rotulo: 'x' }]);
    expect(conferirEvolucao(e, processo(), semMeta)).toMatchObject({ codigo: 'valor-nunca-visto' });
  });
});

describe('as cinco etapas feitas', () => {
  it('sem processo, nenhuma; com atividade vigente e evolução, as cinco', () => {
    expect(etapasDoProcesso(null).every((x) => !x.feita)).toBe(true);
    expect(
      etapasDoProcesso(processo())
        .filter((x) => x.feita)
        .map((x) => x.etapa),
    ).toEqual(['avaliacao', 'diagnostico', 'planejamento']);
    const p = processo({
      evolucoes: [{ id: 1, nota: 'n', usuario: 'u', em: '2026-10-22T10:00' }],
    });
    const comAtividade: ProcessoSaeLido = {
      ...p,
      diagnosticos: [
        {
          ...p.diagnosticos[0]!,
          intervencoes: [
            {
              id: 15,
              codigo: 'S-I01',
              descricao: 'Prev',
              atividades: [
                {
                  id: 16,
                  codigo: 'S-A011',
                  descricao: 'Mudar o decúbito',
                  frequenciaDia: 4,
                  horarios: ['06:00', '12:00', '18:00', '00:00'],
                  inicio: '2026-10-22T08:00',
                  fim: null,
                  suspensa: null,
                  usuario: 'u',
                  em: '2026-10-22T08:00',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(etapasDoProcesso(comAtividade).every((x) => x.feita)).toBe(true);
  });
});
