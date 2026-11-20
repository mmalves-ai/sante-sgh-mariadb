// @vitest-environment jsdom
// M51 (etapa 4): o cliente da AIH e do retorno confere as respostas pelos contratos (fora deles, recusa), monta a
// consulta só com o preenchido e manda as gravações por POST com o CSRF e a Idempotency-Key; os textos cobrem toda
// situação, tipo e problema.
import {
  SITUACOES_AIH,
  SITUACOES_FAIXA_AIH,
  SITUACOES_RETORNO_SUS,
  TIPOS_ITEM_AIH,
  TRATAMENTOS_RETORNO_SUS,
} from '@sgh/contratos';
import type { ProblemaRetornoSus } from '@sgh/dominio-faturamento';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enderecoArquivoAih,
  importarRetornoSus,
  lerAihs,
  lerInternacaoAih,
  lerPainelAih,
  lerRetornosSus,
  registrarAih,
  registrarFaixaAih,
  tratarRetornoSus,
} from './api-sus-aih.js';
import { mensagensSusAih, mensagensSusRetorno } from './i18n-sus-aih.js';

afterEach(() => vi.unstubAllGlobals());

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

const AIH = {
  id: 1,
  situacao: 'solicitada',
  registro: 7401,
  prontuario: 547001,
  conta: 847001,
  entrada: '2026-10-02',
  alta: '2026-10-12',
  procedimentoSolicitado: '0406010811',
  procedimentoSolicitadoNome: null,
  procedimentoRealizado: null,
  cidPrincipal: 'I21',
  cidSecundario: null,
  carater: '02',
  solicitante: '00000000191',
  solicitanteNome: null,
  dataLaudo: '2026-10-02',
  justificativa: 'LAUDO SINTETICO',
  faixa: null,
  numero: null,
  dataAutorizacao: null,
  permanencia: null,
  diariasUti: null,
  competenciaApresentacao: null,
  arquivo: null,
  reapresentacoes: 0,
  justificativaSituacao: null,
  registradaPor: 'F',
  registradaEm: '2026-10-02T10:00:00.000',
  alteradaPor: null,
  alteradaEm: null,
  versao: '0000000001',
};

describe('cliente da AIH e do retorno', () => {
  it('a lista e a internação: consulta só com o preenchido; o esquema conferido', async () => {
    const buscar = vi.fn(async (url: string) =>
      url.includes('/internacao/')
        ? resposta({
            registro: 7401,
            prontuario: 547001,
            conta: 847001,
            convenio: 1,
            sus: true,
            entrada: '2026-10-02',
            alta: '2026-10-12',
            cidPrincipal: 'I21',
            carater: '02',
            motivoSaida: 12,
            cnsValido: true,
            aih: null,
          })
        : resposta({ itens: [AIH], total: 1, porSituacao: { solicitada: 1 } }),
    );
    const p = await lerAihs({ situacao: 'solicitada', numero: '' }, buscar as unknown as typeof fetch);
    expect(p.total).toBe(1);
    expect(buscar.mock.calls[0]?.[0]).toBe('/api/sus/aih?situacao=solicitada&pagina=0&porPagina=50');
    expect((await lerInternacaoAih(7401, buscar as unknown as typeof fetch)).sus).toBe(true);
  });

  it('o painel fora do contrato é recusado', async () => {
    const buscar = vi.fn(async () => resposta({ liberado: 'sim' }));
    await expect(lerPainelAih(buscar as unknown as typeof fetch)).rejects.toThrow();
  });

  it('as gravações: POST com o CSRF e a Idempotency-Key', async () => {
    const buscar = vi.fn(async (url: string) =>
      url.endsWith('/aih/faixas')
        ? resposta({
            id: 1,
            inicial: '3325100000016',
            final: '3325100000032',
            proximo: '3325100000016',
            usados: 0,
            total: 3,
            orgaoEmissor: 'SMS',
            dataLiberacao: '2026-10-01',
            situacao: 'ativa',
            registradaPor: 'S',
            registradaEm: '2026-10-01T10:00:00.000',
            justificativa: null,
            versao: '0000000001',
          })
        : url.endsWith('/retorno/tratamento')
          ? resposta({ id: 1 }, 409)
          : url.endsWith('/retorno')
            ? resposta({
                instrumento: 'aih',
                competencia: '202610',
                hash: 'a'.repeat(64),
                linhas: 1,
                casadas: 1,
                naoCasadas: [],
                erros: [],
                porSituacao: { rejeitada: 1 },
                valorGlosado: 10,
                repetidas: 0,
              })
            : resposta(AIH),
    );
    const b = buscar as unknown as typeof fetch;
    await registrarFaixaAih(
      {
        acao: 'registrar',
        inicial: '3325100000016',
        final: '3325100000032',
        orgaoEmissor: 'SMS',
        dataLiberacao: '2026-10-01',
      },
      b,
    );
    await registrarAih(
      { acao: 'negar', aih: 1, versao: '0000000001', justificativa: 'SEM CRITERIO (TESTE)' },
      b,
    );
    await importarRetornoSus(
      { instrumento: 'aih', competencia: '202610', nomeArquivo: 'R.CSV', conteudo: 'x' },
      b,
    );
    await expect(
      tratarRetornoSus(
        { retorno: 1, versao: '0000000001', decisao: 'aceita', justificativa: 'GLOSA OK (TESTE)' },
        b,
      ),
    ).rejects.toThrow();
    for (const c of buscar.mock.calls) {
      const init = (c as unknown as [string, RequestInit])[1];
      expect(init.method).toBe('POST');
      const h = init.headers as Record<string, string>;
      expect(h['x-csrf']).toBeDefined();
      expect(h['idempotency-key']).toMatch(/^web-/);
    }
    expect(enderecoArquivoAih(9)).toBe('/api/sus/aih/arquivos/9/conteudo');
    const lista = vi.fn<(url: string) => Promise<Response>>(async () =>
      resposta({ itens: [], total: 0, porSituacao: {}, valorGlosado: 0 }),
    );
    await lerRetornosSus({ instrumento: 'bpa', competencia: '202610' }, lista as unknown as typeof fetch);
    expect(lista.mock.calls[0]?.[0]).toBe(
      '/api/sus/retorno?instrumento=bpa&competencia=202610&pagina=0&porPagina=50',
    );
  });

  it('os textos cobrem situações, tipos, tratamentos e problemas, sem citar o sistema anterior', () => {
    for (const s of SITUACOES_AIH) expect(mensagensSusAih.situacoes[s]).toBeTruthy();
    for (const s of SITUACOES_FAIXA_AIH) expect(mensagensSusAih.situacoesFaixa[s]).toBeTruthy();
    for (const s of TIPOS_ITEM_AIH) expect(mensagensSusAih.tipos[s]).toBeTruthy();
    for (const s of SITUACOES_RETORNO_SUS) expect(mensagensSusRetorno.situacoes[s]).toBeTruthy();
    for (const s of TRATAMENTOS_RETORNO_SUS) expect(mensagensSusRetorno.tratamentos[s]).toBeTruthy();
    const problemas: Record<ProblemaRetornoSus, string> = mensagensSusRetorno.problemas;
    expect(Object.keys(problemas)).toHaveLength(8);
    const valores = (o: object): string[] =>
      Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : valores(v as object)));
    const tudo = [...valores(mensagensSusAih), ...valores(mensagensSusRetorno)].join('\n');
    expect(tudo).not.toMatch(/spdata|legado|sistema atual|FHLEITOUTI|RICTRLOC|TBPROSUS|FCCTAEXT/i);
  });
});
