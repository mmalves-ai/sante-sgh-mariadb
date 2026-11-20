// @vitest-environment jsdom
// M58 (etapa 1): o cliente da prontidão do desligamento e do cartão da plataforma valida a resposta pelo contrato (fora
// dele, recusa); o registro de um item vai por POST com o CSRF, a Idempotency-Key e a senha, no endereço do item.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarPlataformaBanco } from '../config/api.js';
import { lerDesligamento, registrarItemDesligamento } from './api.js';

afterEach(() => vi.unstubAllGlobals());

const plataforma = {
  versaoMotor: '3.0.14',
  versaoMaior: 3,
  ods: '12.0',
  charsetBanco: 'NONE',
  charsetParametro: 'CP1252',
  charsetConfere: true,
  funcoesExternas: [{ nome: 'SUBSTR', modulo: 'ib_udf', dependentes: 45, esperada: true }],
  impressao: 'fd04f7760ccb8e45',
};
const painel = {
  hospital: 'pc',
  em: '2026-10-26T12:00:00.000Z',
  sessoes: {
    janelaDias: 14,
    porDia: [{ dia: '2026-10-25', pessoas: 4 }],
    pessoasNaJanela: 4,
    diasSemSessao: 1,
    cumprido: false,
    cumpridoCap14: false,
  },
  itens: [
    {
      item: 'paineis-tv',
      tipo: 'painel',
      areaResponsavel: 'TI do hospital',
      situacao: 'pendente',
      contingencia: null,
      substituto: { marco: 'M19', itemMenu: null, aConfirmar: false },
      resolvido: false,
      pendencias: ['sem-registro'],
      registradoEm: null,
    },
  ],
  contas: { declaradas: [], naoDeclaradas: 0 },
  plataforma,
  passos: [{ passo: 'desligamento', fatia: 'M58-F1', situacao: 'bloqueado', motivos: ['dp6-sem-data'] }],
  medidaDiaria: { diasLimpos: 0, exigidos: 14, paradaSemMedida: '2026-10-26', ultimaSessao: null },
  sessoesCumprido: false,
  ultimoDiaTabela: '2026-10-25',
  contasCombinadas: 0,
  fimRegistradoEm: null,
  dp6: { decididaEm: null, previstaPara: null },
  registro: 'docs/coexistencia/desligamento/pc.yaml',
  registroInvalido: null,
  podeRegistrar: true,
};

describe('prontidão do desligamento (cliente)', () => {
  it('o painel e o cartão são validados pelo contrato; fora dele, recusa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/plataforma')
                ? {
                    hospital: 'pc',
                    em: '2026-10-26T12:00:00.000Z',
                    plataforma,
                    restricaoEntrada: 'cp1252',
                    funcoesPendentes: ['SUBSTR'],
                    colunasTexto: [{ tipo: 'varchar', charset: 'NONE', colunas: 10 }],
                    indicesComTexto: 3,
                  }
                : painel,
            ),
          ),
      ),
    );
    const p = await lerDesligamento();
    expect(p.itens[0]).toMatchObject({ papelResponsavel: null, evidencia: null });
    expect((await buscarPlataformaBanco()).funcoesPendentes).toEqual(['SUBSTR']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ hospital: 'pc' }))),
    );
    await expect(lerDesligamento()).rejects.toThrow();
  });

  it('registrar um item vai por POST com o CSRF, a Idempotency-Key e a senha', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ item: 'paineis-tv', registradoEm: '2026-10-26T12:00:00.000Z' })),
    );
    vi.stubGlobal('fetch', f);
    const r = await registrarItemDesligamento(
      {
        item: 'paineis-tv',
        situacao: 'substituto-em-uso',
        contingencia: 'nenhuma',
        papelResponsavel: 'TI',
        evidencia: 'ata',
      },
      'segredo',
    );
    expect(r.item).toBe('paineis-tv');
    const [url, init] = (f.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe('/api/administracao/coexistencia/desligamento/itens/paineis-tv');
    expect(init.method).toBe('POST');
    const cab = init.headers as Record<string, string>;
    expect('x-csrf' in cab && 'idempotency-key' in cab).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({
      situacao: 'substituto-em-uso',
      contingencia: 'nenhuma',
      papelResponsavel: 'TI',
      evidencia: 'ata',
      senha: 'segredo',
    });
  });
});
