// @vitest-environment jsdom
// M51 (etapa 3): o cliente da APAC confere as respostas pelos contratos (fora deles, recusa), monta a consulta só com o
// preenchido e manda o registro e a geração por POST com o CSRF e a Idempotency-Key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buscarSolicitantesApac,
  enderecoArquivoApac,
  gerarApac,
  lerApacs,
  lerAtendimentoLaudoApac,
  lerDominiosApac,
  lerLinhasApac,
  registrarApac,
} from './api-sus.js';

afterEach(() => vi.unstubAllGlobals());

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const como = (f: unknown) => f as typeof fetch;

const APAC = {
  id: 1,
  situacao: 'solicitada',
  prontuario: 500025,
  registro: 710025,
  atendimento: 610025,
  procedimento: '0305010107',
  procedimentoNome: 'PROCEDIMENTO SINTETICO DE HEMODIALISE',
  cidPrincipal: 'N180',
  cidSecundario: null,
  cidAssociado: null,
  solicitante: 's1_chaveOpacaSinteticaDoSolicitante',
  solicitanteNome: 'MEDICO SOLICITANTE SINTETICO DA APAC',
  solicitanteCrm: null,
  dataSolicitacao: '2026-09-01',
  justificativa: 'Justificativa sintética.',
  laudoEspecifico: 'nenhum',
  nefrologia: null,
  numero: null,
  tipo: null,
  dataAutorizacao: null,
  competenciaInicial: null,
  competenciaFinal: null,
  ultimaCompetencia: null,
  motivoSaida: null,
  dataEncerramento: null,
  justificativaSituacao: null,
  registradaPor: 'SINT.FATURISTA.APAC',
  registradaEm: '2026-10-26T10:00:00.000',
  alteradaPor: null,
  alteradaEm: null,
  versao: '0000000001',
};

describe('cliente da APAC', () => {
  it('a lista: consulta só com o preenchido e o esquema conferido', async () => {
    const buscar = vi.fn(async () => resposta({ itens: [APAC], total: 1, porSituacao: { solicitada: 1 } }));
    const r = await lerApacs({ situacao: 'solicitada', pagina: 0 }, como(buscar));
    expect(r.itens[0]?.procedimento).toBe('0305010107');
    expect(buscar).toHaveBeenCalledWith('/api/sus/apac?situacao=solicitada&pagina=0', expect.anything());
    const ruim = vi.fn(async () => resposta({ itens: [{ id: 'x' }], total: 1, porSituacao: {} }));
    await expect(lerApacs({}, como(ruim))).rejects.toThrow();
  });

  it('o atendimento do laudo, os domínios, os solicitantes e as linhas', async () => {
    const at = vi.fn(async () =>
      resposta({
        registro: 710025,
        atendimento: 610025,
        prontuario: 500025,
        data: '2025-09-25',
        convenio: 1,
        contaSus: true,
        cnsValido: true,
        cidPrincipal: 'I10',
      }),
    );
    expect((await lerAtendimentoLaudoApac(710025, como(at))).contaSus).toBe(true);
    expect(at).toHaveBeenCalledWith('/api/sus/apac/atendimento/710025', expect.anything());
    const dom = vi.fn(async () =>
      resposta({
        caracteristicaTratamento: [{ id: 1, nome: 'A' }],
        contraindicacaoTransplante: [],
        situacaoTransplante: [],
        acessoVascular: [],
      }),
    );
    expect((await lerDominiosApac(como(dom))).caracteristicaTratamento).toHaveLength(1);
    const sol = vi.fn(async () => resposta([{ chave: '1', nome: 'MEDICO', crm: null, cnsValido: false }]));
    expect(await buscarSolicitantesApac('medico', como(sol))).toHaveLength(1);
    expect(sol).toHaveBeenCalledWith('/api/sus/apac/solicitantes?termo=medico', expect.anything());
    const lin = vi.fn(async () => resposta({ itens: [], total: 0, apacs: 0, quantidade: 0 }));
    expect((await lerLinhasApac({ arquivo: 3 }, como(lin))).total).toBe(0);
    expect(lin).toHaveBeenCalledWith('/api/sus/apac/linhas?arquivo=3', expect.anything());
  });

  it('registrar e gerar por POST com o CSRF e a Idempotency-Key; a recusa vira erro', async () => {
    const ok = vi.fn(async () => resposta(APAC));
    const r = await registrarApac({ acao: 'continuar', apac: 1, versao: '0000000001' }, como(ok));
    expect(r.situacao).toBe('solicitada');
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method]).toEqual(['/api/sus/apac', 'POST']);
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(
      expect.arrayContaining(['x-csrf', 'idempotency-key']),
    );
    const recusa = vi.fn(async () => resposta({ title: 'Operação recusada', status: 422 }, 422));
    await expect(
      gerarApac({ competencia: '202609', versao: '0000000003' }, como(recusa)),
    ).rejects.toBeTruthy();
    expect((recusa.mock.calls[0] as unknown as [string])[0]).toBe('/api/sus/apac/arquivo');
    expect(enderecoArquivoApac(7)).toBe('/api/sus/apac/arquivos/7/conteudo');
  });
});
