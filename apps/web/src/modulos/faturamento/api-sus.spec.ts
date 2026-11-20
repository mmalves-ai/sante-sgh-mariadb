// @vitest-environment jsdom
// M51 (etapa 1): o cliente do faturamento SUS confere as respostas pelos contratos (fora deles, recusa), monta a
// consulta só com o preenchido e manda toda escrita por POST com o CSRF e a Idempotency-Key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abrirCompetenciaSus,
  criticarSus,
  enderecoArquivoSus,
  fecharCompetenciaSus,
  gerarCiha,
  justificarCriticaSus,
  lerArquivosSus,
  lerCompetenciasSus,
  lerCriticasSus,
  buscarProcedimentosHospitalSus,
  buscarSigtapSus,
  desativarEquivalenciaSus,
  lerEquivalenciasSus,
  reabrirCompetenciaSus,
  registrarEquivalenciaSus,
} from './api-sus.js';

afterEach(() => vi.unstubAllGlobals());

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

const COMP = {
  instrumento: 'ciha',
  competencia: '202609',
  situacao: 'aberta',
  registros: 4,
  criticasBloqueantes: 0,
  avisos: 1,
  abertaPor: 'FATURISTA',
  abertaEm: '2026-10-01T10:00:00.000',
  criticadaEm: null,
  fechadaPor: null,
  fechadaEm: null,
  reabertaPor: null,
  reabertaEm: null,
  cnes: '9999991',
  liberada: true,
  versao: '0000000002',
};
const ARQ = {
  id: 7,
  instrumento: 'ciha',
  competencia: '202609',
  leiaute: 'CIHA01',
  versaoLeiaute: '1.0.4.0',
  conferidoContraOficial: true,
  nomeArquivo: 'CIHA_9999991_202609.TXT',
  linhas: 3,
  registros: 1,
  procedimentos: 1,
  semMovimento: false,
  hash: 'a'.repeat(64),
  bytes: 800,
  situacao: 'gerado',
  geradoPor: 'FATURISTA',
  geradoEm: '2026-10-02T10:00:00.000',
};
const EQ = {
  id: 1,
  procedimento: 7001,
  procedimentoCodigo: 40801012,
  procedimentoNome: 'ELETROCARDIOGRAMA SINTETICO',
  tabela: '1 TABELA SINTETICA A',
  sigtap: '0211020036',
  sigtapNome: 'PROCEDIMENTO SINTETICO',
  ativa: true,
  registradaPor: 'F',
  registradaEm: 'x',
  versao: '0000000001',
};

describe('cliente do faturamento SUS', () => {
  it('leituras: consulta só com o preenchido e resposta conferida pelo contrato', async () => {
    const urls: string[] = [];
    const buscar = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      urls.push(url);
      if (url.includes('/competencias'))
        return resposta({
          competencias: [COMP],
          instrumentos: [{ instrumento: 'ciha', liberado: true }],
          cihaFonteDoEnvio: false,
          escopoParcial: false,
          hoje: '2026-10-25',
        });
      if (url.includes('/criticas')) return resposta({ itens: [], total: 0, porRegra: {} });
      if (url.includes('/arquivos')) return resposta([ARQ]);
      if (url.includes('/sigtap'))
        return resposta([{ id: 9004, codigo: '0211020036', nome: 'PROCEDIMENTO SINTETICO', vigente: true }]);
      if (url.includes('/procedimentos-hospital'))
        return resposta([{ id: 7001, codigo: 40801012, nome: 'ELETRO', tabela: '1 A' }]);
      return resposta({ itens: [EQ], total: 1 });
    }) as unknown as typeof fetch;
    expect((await lerCompetenciasSus('ciha', buscar)).competencias[0]!.versao).toBe('0000000002');
    expect((await lerCompetenciasSus(null, buscar)).hoje).toBe('2026-10-25');
    await lerCriticasSus({ instrumento: 'ciha', competencia: '202609', regra: undefined, pagina: 0 }, buscar);
    expect((await lerArquivosSus('ciha', null, buscar))[0]!.hash).toHaveLength(64);
    expect((await lerEquivalenciasSus({}, buscar)).itens).toHaveLength(1);
    await lerEquivalenciasSus({ termo: 'eletro', pagina: 1 }, buscar);
    expect((await buscarSigtapSus('eletro', '202609', buscar))[0]!.vigente).toBe(true);
    expect(await buscarProcedimentosHospitalSus({ termo: '40801012' }, buscar)).toHaveLength(1);
    await buscarProcedimentosHospitalSus({ ids: [7001, 7101] }, buscar);
    expect(urls).toEqual([
      '/api/sus/competencias?instrumento=ciha',
      '/api/sus/competencias',
      '/api/sus/criticas?instrumento=ciha&competencia=202609&pagina=0',
      '/api/sus/arquivos?instrumento=ciha',
      '/api/sus/equivalencias',
      '/api/sus/equivalencias?termo=eletro&pagina=1',
      '/api/sus/sigtap?termo=eletro&competencia=202609',
      '/api/sus/procedimentos-hospital?termo=40801012',
      '/api/sus/procedimentos-hospital?ids=7001%2C7101',
    ]);
    expect(enderecoArquivoSus(7)).toBe('/api/sus/arquivos/7/conteudo');
  });

  it('escritas por POST com CSRF e Idempotency-Key; resposta fora do contrato é recusada', async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const buscar = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      pedidos.push({ url, init: init ?? {} });
      if (url.endsWith('/critica'))
        return resposta({
          competencia: COMP,
          registros: 1,
          foraPorSerSus: 0,
          bloqueantes: 0,
          avisos: 0,
          corrigidas: 0,
          porRegra: {},
          tempoMs: 5,
        });
      if (url.endsWith('/ciha/arquivo'))
        return resposta({ arquivo: ARQ, competencia: COMP, substituidos: 0, tempoMs: 3 });
      if (url.endsWith('/justificativa'))
        return resposta({
          id: 1,
          regra: 'item-sem-sigtap',
          gravidade: 'aviso',
          situacao: 'justificada',
          origem: { conta: 1, atendimento: null, item: null },
          detalhe: {},
          justificativa: 'texto longo',
          versao: '0000000002',
        });
      if (url.endsWith('/equivalencias')) return resposta({ equivalencia: EQ, mudou: true });
      if (url.endsWith('/desativacao')) return resposta({ ...EQ, ativa: false });
      return resposta(COMP);
    }) as unknown as typeof fetch;
    await abrirCompetenciaSus({ instrumento: 'ciha', competencia: '202609' }, buscar);
    expect((await criticarSus({ instrumento: 'ciha', competencia: '202609' }, buscar)).tempoMs).toBe(5);
    await fecharCompetenciaSus({ instrumento: 'ciha', competencia: '202609', versao: COMP.versao }, buscar);
    await reabrirCompetenciaSus(
      { instrumento: 'ciha', competencia: '202609', versao: COMP.versao, justificativa: 'motivo suficiente' },
      buscar,
    );
    await justificarCriticaSus({ critica: 1, versao: '0000000001', justificativa: 'texto longo' }, buscar);
    expect((await gerarCiha({ competencia: '202609', versao: COMP.versao }, buscar)).arquivo.id).toBe(7);
    expect((await registrarEquivalenciaSus({ procedimento: 7001, sigtap: '0211020036' }, buscar)).mudou).toBe(
      true,
    );
    expect((await desativarEquivalenciaSus({ procedimento: 7001, versao: '0000000001' }, buscar)).ativa).toBe(
      false,
    );
    for (const p of pedidos) {
      expect(p.init.method).toBe('POST');
      const h = p.init.headers as Record<string, string>;
      expect(h['idempotency-key']).toMatch(/^web-/);
      expect(h).toHaveProperty('x-csrf');
    }
    const ruim = vi.fn(async () => resposta({ competencia: 'x' })) as unknown as typeof fetch;
    await expect(abrirCompetenciaSus({ instrumento: 'ciha', competencia: '202609' }, ruim)).rejects.toThrow();
    const erro = vi.fn(async () =>
      resposta({ type: 'urn:sgh:problema:recusa-de-negocio', title: 'Operação recusada', status: 422 }, 422),
    ) as unknown as typeof fetch;
    await expect(gerarCiha({ competencia: '202609', versao: COMP.versao }, erro)).rejects.toBeTruthy();
  });
});
