// Regra 6 do M51 (AIH): número com o dígito e da faixa, laudo autorizado, CID compatível, permanência coerente e
// diárias de UTI pela trajetória com leito habilitado. Massa SINTÉTICA (nenhum dado de pessoa).
import { describe, expect, it } from 'vitest';
import {
  acaoPermitida,
  aihApresentavel,
  type AihRegistrada,
  type ContextoAih,
  diariasUtiDaTrajetoria,
  diasDePermanencia,
  digitoAih,
  type InternacaoAih,
  montarAih,
  numeroAih,
  numeroAihValido,
  numeroNaFaixa,
  proximoNumeroDaFaixa,
  recusaFaixaAih,
  utiPorAcomodacaoDoParametro,
} from './aih.js';
import type { ProcedimentoNaCiha } from './ciha.js';
import { compatibilidadesDaCompetencia, SEM_COMPATIBILIDADES } from './compatibilidade.js';
import {
  ATRIBUTOS_LIVRES,
  cnsSintetico,
  cnsValidoTeste,
  cpfSintetico,
  procedimento,
} from './massa.spec-util.js';
import type { RegistroSigtap } from './instrumento.js';

const N1 = numeroAih('332510000001');
/** O mesmo número com o dígito errado. */
const ERRADO = `${N1.slice(0, 12)}${(Number(N1[12]) + 1) % 10}`;
const MAPA_UTI = utiPorAcomodacaoDoParametro('3:2:0802010083;7:2:0802010083');

const proc = (id: number, codigo: string, registros: RegistroSigtap[], permanencia: number | null = null) => {
  const p = procedimento(id, codigo, { atuais: { ...ATRIBUTOS_LIVRES, permanencia } });
  return {
    procedimento: p,
    naCompetencia: { fonte: 'atual' as const, atributos: p.atuais },
    registros,
  } satisfies ProcedimentoNaCiha;
};
const CATALOGO = new Map<number, ProcedimentoNaCiha>([
  [301, proc(301, '0406010811', ['aih-principal'], 6)],
  [302, proc(302, '0211020036', ['bpa-c', 'aih-secundario'])],
  [303, proc(303, '0702040061', ['aih-especial'])],
  [304, proc(304, '0802010083', ['aih-especial'])],
  [305, proc(305, '0301010072', ['bpa-c'])],
]);

function ctx(extra: Partial<ContextoAih> = {}): ContextoAih {
  return {
    procedimento: (id) => CATALOGO.get(id) ?? null,
    porCodigo: (c) => [...CATALOGO.values()].find((x) => x.procedimento.codigo === c) ?? null,
    compatibilidades: compatibilidadesDaCompetencia('202509', SEM_COMPATIBILIDADES),
    habilitacoes: new Set(),
    leitosUti: new Map([[2, 10]]),
    utiPorAcomodacao: MAPA_UTI,
    cnsValido: cnsValidoTeste,
    ...extra,
  };
}

const aih = (extra: Partial<AihRegistrada> = {}): AihRegistrada => ({
  id: 1,
  situacao: 'autorizada',
  numero: N1,
  procedimentoSolicitado: '0406010811',
  procedimentoRealizado: null,
  cidPrincipal: 'I21',
  cidSecundario: null,
  dataLaudo: '2025-09-02',
  dataAutorizacao: '2025-09-03',
  ...extra,
});

const internacao = (extra: Partial<InternacaoAih> = {}): InternacaoAih => ({
  registro: 4001,
  conta: 9001,
  atendimento: 8001,
  convenio: 1,
  entrada: '2025-09-02',
  alta: '2025-09-12',
  motivoSaida: 12,
  especialidadeLeito: 1,
  paciente: {
    cns: cnsSintetico(51),
    cpf: cpfSintetico('100200300'),
    sexo: 'M',
    nascimento: '1960-01-01',
    municipio: 330100,
    nome: 'PACIENTE SINTETICO AIH',
  },
  itens: [
    { item: 1, sigtap: 302, quantidade: 2, procedimento: 70, cbo: '225125' },
    { item: 2, sigtap: 303, quantidade: 1, procedimento: 71, cbo: null },
    { item: 3, sigtap: 305, quantidade: 1, procedimento: 72, cbo: null },
    { item: 4, sigtap: null, quantidade: 1, procedimento: 73, cbo: null },
  ],
  passagens: [
    { entrada: '2025-09-02', saida: '2025-09-04', acomodacao: 2 },
    { entrada: '2025-09-04', saida: '2025-09-07', acomodacao: 3 },
    { entrada: '2025-09-07', saida: '2025-09-12', acomodacao: 2 },
  ],
  ...extra,
});

const regras = (r: { criticas: readonly { regra: string }[] }) => r.criticas.map((c) => c.regra).sort();

describe('número e faixa da AIH (regra 6)', () => {
  it('dígito: resto da divisão dos 12 dígitos por 11 (10 vira 0)', () => {
    expect(digitoAih('000000000011')).toBe('0');
    expect(digitoAih('000000000012')).toBe('1');
    expect(digitoAih('000000000010')).toBe('0');
    expect(numeroAihValido(N1)).toBe(true);
    expect(numeroAihValido(ERRADO)).toBe(false);
    expect(numeroAihValido('123')).toBe(false);
  });

  it('faixa: extremos válidos, em ordem, mesmo prefixo, sem sobrepor; o próximo número livre', () => {
    const fim = numeroAih('332510000100');
    expect(recusaFaixaAih(N1, fim, [])).toBeNull();
    expect(recusaFaixaAih(fim, N1, [])).toBe('faixa-invertida');
    expect(recusaFaixaAih(ERRADO, fim, [])).toBe('numero-invalido');
    expect(recusaFaixaAih(N1, numeroAih('332610000100'), [])).toBe('faixa-prefixo-diferente');
    expect(
      recusaFaixaAih(N1, fim, [{ inicio: 332510000050n, fim: 332510000200n, situacao: 'cancelada' }]),
    ).toBe('faixa-sobreposta');
    const f = { inicio: 332510000001n, fim: 332510000003n };
    expect(proximoNumeroDaFaixa(f, null)).toBe(N1);
    expect(proximoNumeroDaFaixa(f, N1)).toBe(numeroAih('332510000002'));
    expect(proximoNumeroDaFaixa(f, numeroAih('332510000003'))).toBeNull();
    expect(proximoNumeroDaFaixa(f, numeroAih('332509999999'))).toBe(N1);
    expect(numeroNaFaixa(N1, f)).toBe(true);
    expect(numeroNaFaixa(numeroAih('332510000004'), f)).toBe(false);
  });

  it('máquina de estados: autoriza só a solicitada; fecha só a autorizada; a apresentada não reabre', () => {
    expect(acaoPermitida('autorizar', 'solicitada')).toBe(true);
    expect(acaoPermitida('autorizar', 'autorizada')).toBe(false);
    expect(acaoPermitida('fechar', 'solicitada')).toBe(false);
    expect(acaoPermitida('fechar', 'autorizada')).toBe(true);
    expect(acaoPermitida('reabrir', 'fechada')).toBe(true);
    expect(acaoPermitida('reabrir', 'apresentada')).toBe(false);
    expect(acaoPermitida('cancelar', 'apresentada')).toBe(false);
  });
});

describe('permanência e diárias de UTI pela trajetória (regra 6)', () => {
  it('permanência: o dia da alta não conta; mesmo dia conta 1; alta antes da entrada é incoerente', () => {
    expect(diasDePermanencia('2025-09-02', '2025-09-12')).toBe(10);
    expect(diasDePermanencia('2025-09-02', '2025-09-02')).toBe(1);
    expect(diasDePermanencia('2025-09-12', '2025-09-02')).toBeNull();
    expect(diasDePermanencia('2025-09-12', null)).toBeNull();
  });

  it('diárias: só as acomodações de UTI, pelo tipo do SIH; a passagem sem saída vai até a alta; mês anterior', () => {
    const r = diariasUtiDaTrajetoria(
      [
        { entrada: '2025-08-29', saida: '2025-09-03', acomodacao: 3 },
        { entrada: '2025-09-05', saida: null, acomodacao: 7 },
        { entrada: '2025-09-03', saida: '2025-09-05', acomodacao: 2 },
        { entrada: '2025-09-06', saida: '2025-09-06', acomodacao: 9 },
      ],
      MAPA_UTI,
      '2025-09-08',
    );
    expect(r.porTipo).toEqual([{ tipo: 2, procedimento: '0802010083', diarias: 8, mesAnterior: 3 }]);
    expect(r.semTipo).toEqual([9]);
    expect(r.total).toBe(8);
  });
});

describe('montagem da AIH (fechamento e crítica)', () => {
  it('caminho principal: principal, secundário somado, especial, OPM por item e diária de UTI; fora e sem SIGTAP', () => {
    const r = montarAih(aih(), internacao(), ctx());
    expect(r.competencia).toBe('202509');
    expect(r.linhas.map((l) => [l.tipo, l.procedimento, l.quantidade])).toEqual([
      ['principal', '0406010811', 1],
      ['opm', '0702040061', 1],
      ['secundario', '0211020036', 2],
      ['diaria-uti', '0802010083', 3],
    ]);
    expect(r.permanencia).toEqual({ dias: 10, media: 6 });
    expect(r.itensForaDaAih).toBe(1);
    expect(r.itensSemSigtap).toBe(1);
    expect(regras(r)).toEqual(['item-sem-sigtap']);
  });

  it('sem autorização, número com dígito errado e o realizado sem registro de AIH principal', () => {
    expect(regras(montarAih(aih({ situacao: 'solicitada', numero: null }), internacao(), ctx()))).toContain(
      'aih-sem-autorizacao',
    );
    expect(regras(montarAih(aih({ numero: ERRADO }), internacao(), ctx()))).toContain('aih-numero-invalido');
    expect(regras(montarAih(aih({ procedimentoRealizado: '0211020036' }), internacao(), ctx()))).toContain(
      'instrumento-incompativel',
    );
  });

  it('CID compatível pela lista da SIGTAP da competência; sem CID é bloqueante', () => {
    const compat = compatibilidadesDaCompetencia('202509', {
      ...SEM_COMPATIBILIDADES,
      cids: [{ id: 301, codigo: 'I21', competenciaInicial: 0, competenciaFinal: 0 }],
    });
    expect(
      regras(montarAih(aih({ cidPrincipal: 'J18' }), internacao(), ctx({ compatibilidades: compat }))),
    ).toContain('cid-incompativel');
    expect(
      regras(montarAih(aih({ cidPrincipal: 'I219' }), internacao(), ctx({ compatibilidades: compat }))),
    ).not.toContain('cid-incompativel');
    expect(regras(montarAih(aih({ cidPrincipal: '' }), internacao(), ctx()))).toContain('sem-cid-principal');
  });

  it('permanência incoerente (sem alta, laudo depois da alta, UTI acima da permanência) e abaixo da média', () => {
    expect(regras(montarAih(aih(), internacao({ alta: null }), ctx()))).toContain('permanencia-incoerente');
    expect(regras(montarAih(aih({ dataLaudo: '2025-09-20' }), internacao(), ctx()))).toContain(
      'permanencia-incoerente',
    );
    const curta = montarAih(aih(), internacao({ alta: '2025-09-04', passagens: [] }), ctx());
    expect(regras(curta)).toContain('permanencia-abaixo-da-media');
    expect(curta.criticas.find((c) => c.regra === 'permanencia-abaixo-da-media')?.gravidade).toBe('aviso');
    const uti = montarAih(
      aih(),
      internacao({
        alta: '2025-09-05',
        passagens: [{ entrada: '2025-08-20', saida: '2025-09-05', acomodacao: 3 }],
      }),
      ctx(),
    );
    expect(uti.criticas.some((c) => c.detalhe['motivo'] === 'diarias-uti-acima-da-permanencia')).toBe(true);
  });

  it('UTI sem tipo do SIH e sem leito habilitado (FHLEITOUTI) são bloqueantes', () => {
    expect(regras(montarAih(aih(), internacao(), ctx({ utiPorAcomodacao: new Map() })))).toContain(
      'uti-sem-tipo-sih',
    );
    const r = montarAih(aih(), internacao(), ctx({ leitosUti: new Map([[2, 0]]) }));
    expect(regras(r)).toContain('uti-nao-habilitada');
    expect(r.criticas.find((c) => c.regra === 'uti-nao-habilitada')?.gravidade).toBe('bloqueante');
  });

  it('identificação e dados mínimos do paciente e o motivo de saída', () => {
    const r = montarAih(
      aih(),
      internacao({
        motivoSaida: 99,
        paciente: { cns: null, cpf: null, sexo: null, nascimento: null, municipio: null, nome: null },
      }),
      ctx(),
    );
    expect(regras(r)).toEqual(expect.arrayContaining(['sem-identificacao', 'dado-minimo-ausente']));
    expect(
      r.criticas.filter((c) => c.regra === 'dado-minimo-ausente').map((c) => c.detalhe['campo']),
    ).toEqual(['sexo', 'nascimento', 'nome', 'municipio', 'motivoSaida']);
  });

  it('o principal fora do catálogo, o item com vínculo fora da competência e a equivalência do Sante', () => {
    const fora = proc(306, '0202010295', ['aih-secundario']);
    const vencido = { ...fora, naCompetencia: null };
    const c = ctx({
      procedimento: (id) => (id === 306 ? vencido : id === 307 ? fora : (CATALOGO.get(id) ?? null)),
      equivalencia: (p) => (p === 74 ? 307 : null),
    });
    const r = montarAih(
      aih({ procedimentoRealizado: '0000000001' }),
      internacao({
        itens: [
          { item: 5, sigtap: 306, quantidade: 1, procedimento: 75, cbo: null },
          { item: 6, sigtap: null, quantidade: 1, procedimento: 74, cbo: 'X' },
        ],
        passagens: [],
      }),
      c,
    );
    expect(regras(r)).toEqual(['sem-sigtap', 'sigtap-fora-da-competencia']);
    expect(r.linhas.map((l) => [l.tipo, l.procedimento, l.cbo])).toEqual([
      ['secundario', '0202010295', null],
    ]);
    expect(utiPorAcomodacaoDoParametro('x;3:2;4:1:123;3:2:0802010083').size).toBe(1);
  });

  it('apresentável na competência: fechada e com alta até o fim dela', () => {
    expect(aihApresentavel({ situacao: 'fechada', alta: '2025-09-12' }, '202509')).toBe(true);
    expect(aihApresentavel({ situacao: 'fechada', alta: '2025-10-01' }, '202509')).toBe(false);
    expect(aihApresentavel({ situacao: 'autorizada', alta: '2025-09-12' }, '202509')).toBe(false);
  });
});
