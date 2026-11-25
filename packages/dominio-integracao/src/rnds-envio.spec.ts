// C2-085 (08-INTG L130): regras do envio de documentos à rede nacional (versões, resposta, bloqueio, perfis fixados) e os
// documentos do sumário de alta e do resultado de exame em FHIR R4 (BR Core fixado). Massa sintética.
import { VERSAO_BR_CORE } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { identificacaoRnds } from './rnds.js';
import {
  documentoResultadoExameRnds,
  documentoSumarioAltaRnds,
  identificadorLocalRnds,
  motivoBloqueioRnds,
  PERFIL_DO_DOCUMENTO,
  PERFIS_FHIR_RNDS,
  proximaVersaoRnds,
  situacoesDaResposta,
  versaoDoEventoVacina,
} from './rnds-envio.js';

const CPF = '52998224725'; // CPF sintético de dígitos válidos
const CNS = '700000000000005'; // CNS provisório sintético (soma ponderada múltipla de 11)
const idCpf = identificacaoRnds({ cpf: CPF, cns: null });
const idCns = identificacaoRnds({ cpf: null, cns: CNS });
const entrada = (
  numeroVersao = 1,
  tipoVersao: 'original' | 'substituicao' | 'cancelamento' = 'original',
) => ({
  hospital: 'h1',
  numeroVersao,
  tipoVersao,
  identificacao: idCpf,
  profissional: 7,
  emitidoEm: new Date('2026-11-25T12:00:00Z'),
});
const sumario = {
  id: 41,
  altaEm: new Date('2026-11-24T15:00:00Z'),
  cid10Principal: 'J18.9',
  situacaoDiagnostico: 'confirmado',
  motivoInternacao: 'Febre e tosse <sintético>',
  evolucao: 'Boa evolução',
  planoPosAlta: null,
  condicaoAlta: 'Melhorado',
  obito: false,
};
const resultado = {
  id: 77,
  exameCodigo: 'HMG',
  exameNome: 'Hemograma',
  liberadoEm: new Date('2026-11-25T10:00:00Z'),
  conclusao: 'Sem alterações',
  texto: 'Hemoglobina 13,5 g/dL',
  anormal: true,
};

describe('versões do envio à RNDS', () => {
  it('sem envio, só a original (versão 1)', () => {
    expect(proximaVersaoRnds(null, 'original')).toEqual({ ok: true, numero: 1, tipo: 'original' });
    expect(proximaVersaoRnds(null, 'substituicao')).toMatchObject({ ok: false, codigo: 'sem-envio' });
  });
  it('com a versão aceita: substitui ou cancela na versão seguinte; a original de novo é recusada', () => {
    const atual = { situacao: 'aceito', versaoAtual: 2, situacaoVersao: 'aceito' } as const;
    expect(proximaVersaoRnds(atual, 'substituicao')).toEqual({ ok: true, numero: 3, tipo: 'substituicao' });
    expect(proximaVersaoRnds(atual, 'cancelamento')).toEqual({ ok: true, numero: 3, tipo: 'cancelamento' });
    expect(proximaVersaoRnds(atual, 'original')).toMatchObject({ ok: false, codigo: 'ja-enviado' });
  });
  it('versão anterior pendente ou recusada e envio cancelado travam a versão nova', () => {
    expect(
      proximaVersaoRnds(
        { situacao: 'rejeitado', versaoAtual: 1, situacaoVersao: 'rejeitado' },
        'substituicao',
      ),
    ).toMatchObject({ ok: false, codigo: 'versao-pendente' });
    expect(
      proximaVersaoRnds({ situacao: 'cancelado', versaoAtual: 2, situacaoVersao: 'aceito' }, 'substituicao'),
    ).toMatchObject({ ok: false, codigo: 'cancelado' });
  });
  it('o evento da vacina vira a versão da tabela (0 → 1 original; N → N+1)', () => {
    expect(versaoDoEventoVacina('fato.vacina.aplicada', 0)).toEqual({ numero: 1, tipo: 'original' });
    expect(versaoDoEventoVacina('fato.vacina.substituida', 1)).toEqual({ numero: 2, tipo: 'substituicao' });
    expect(versaoDoEventoVacina('fato.vacina.cancelada', 2)).toEqual({ numero: 3, tipo: 'cancelamento' });
  });
});

describe('resposta da RNDS', () => {
  it('2xx aceita (o cancelamento aceito cancela o envio); 4xx recusa; 408, 429, 5xx e rede são erro passageiro', () => {
    expect(situacoesDaResposta('original', { status: 201 })).toEqual({ envio: 'aceito', versao: 'aceito' });
    expect(situacoesDaResposta('cancelamento', { status: 200 })).toEqual({
      envio: 'cancelado',
      versao: 'aceito',
    });
    expect(situacoesDaResposta('original', { status: 422 })).toEqual({
      envio: 'rejeitado',
      versao: 'rejeitado',
    });
    for (const s of [408, 429, 503])
      expect(situacoesDaResposta('original', { status: s })).toEqual({ envio: 'erro', versao: 'erro' });
    expect(situacoesDaResposta('substituicao', { falha: 'tempo' })).toEqual({
      envio: 'erro',
      versao: 'erro',
    });
  });
});

describe('bloqueio antes do envio', () => {
  it('sumário só finalizado ou assinado; resultado só liberado; paciente com CPF ou CNS válido', () => {
    expect(motivoBloqueioRnds('sumario_alta', 'rascunho', idCpf)).toMatch(/finalizado ou assinado/);
    expect(motivoBloqueioRnds('sumario_alta', 'assinado', idCpf)).toBeNull();
    expect(motivoBloqueioRnds('resultado_exame', 'conferido', idCns)).toMatch(/liberado/);
    expect(motivoBloqueioRnds('resultado_exame', 'liberado', idCns)).toBeNull();
    expect(
      motivoBloqueioRnds('resultado_exame', 'liberado', identificacaoRnds({ cpf: '11111111111', cns: null })),
    ).toMatch(/CPF válido nem CNS/);
  });
});

describe('perfis fixados e identificador local', () => {
  it('cada documento aponta um perfil fixado na versão do pacote BR Core', () => {
    const codigos = PERFIS_FHIR_RNDS.map((p) => p.codigo);
    for (const p of Object.values(PERFIL_DO_DOCUMENTO)) expect(codigos).toContain(p);
    expect(new Set(PERFIS_FHIR_RNDS.map((p) => p.versaoPerfil))).toEqual(new Set([VERSAO_BR_CORE]));
    expect(PERFIS_FHIR_RNDS.every((p) => !p.urlCanonica.includes('|'))).toBe(true);
  });
  it('o identificador local é estável por documento', () => {
    expect(identificadorLocalRnds('h1', 'sumario_alta', 41)).toBe('sa-h1-41');
    expect(identificadorLocalRnds('h1', 'resultado_exame', 77)).toBe('rel-h1-77');
    expect(() => identificadorLocalRnds('h1', 'imunizacao', 0)).toThrow();
  });
});

describe('documentos FHIR', () => {
  it('sumário de alta: Composition SA, sujeito pelo CPF, CID-10 sem ponto, narrativa escapada', () => {
    const b = documentoSumarioAltaRnds(entrada(), sumario) as {
      entry: { resource: Record<string, unknown> }[];
    };
    const comp = b.entry[0]!.resource;
    expect(b).toMatchObject({ type: 'document', identifier: { value: 'sa-h1-41-v1' } });
    expect(comp).toMatchObject({
      status: 'final',
      type: { coding: [{ code: 'SA' }] },
      subject: { identifier: { system: 'https://saude.gov.br/fhir/sid/cpf', value: CPF } },
    });
    expect(comp['relatesTo']).toBeUndefined();
    const cond = b.entry[1]!.resource;
    expect(cond).toMatchObject({ resourceType: 'Condition', code: { coding: [{ code: 'J189' }] } });
    expect(JSON.stringify(comp)).toContain('&lt;sintético&gt;');
  });
  it('substituição aponta a versão anterior; cancelamento vai entered-in-error', () => {
    const s = documentoSumarioAltaRnds(entrada(2, 'substituicao'), sumario) as {
      entry: { resource: Record<string, unknown> }[];
    };
    expect(s.entry[0]!.resource).toMatchObject({
      status: 'amended',
      relatesTo: [{ code: 'replaces', targetIdentifier: { value: 'sa-h1-41-v1' } }],
    });
    const c = documentoResultadoExameRnds(entrada(3, 'cancelamento'), resultado) as {
      entry: { resource: Record<string, unknown> }[];
    };
    expect(c.entry.map((x) => x.resource['status'])).toEqual([
      'entered-in-error',
      'entered-in-error',
      'entered-in-error',
    ]);
    expect(() => documentoSumarioAltaRnds(entrada(1, 'substituicao'), sumario)).toThrow(/versão 1/);
  });
  it('resultado: REL com laudo e resultado; anormal interpretado; paciente pelo CNS sem CPF', () => {
    const b = documentoResultadoExameRnds({ ...entrada(), identificacao: idCns }, resultado) as {
      entry: { resource: Record<string, unknown> }[];
    };
    const [comp, dr, obs] = b.entry.map((x) => x.resource);
    expect(comp).toMatchObject({ type: { coding: [{ code: 'REL' }] } });
    expect(dr).toMatchObject({
      resourceType: 'DiagnosticReport',
      status: 'final',
      conclusion: 'Sem alterações',
    });
    expect(obs).toMatchObject({
      resourceType: 'Observation',
      subject: { identifier: { system: 'https://saude.gov.br/fhir/sid/cns', value: CNS } },
      interpretation: [{ coding: [{ code: 'A' }] }],
    });
  });
});
