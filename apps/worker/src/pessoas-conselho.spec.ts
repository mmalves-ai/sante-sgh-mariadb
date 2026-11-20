// M52.1 (regra 3; ficha, seção 4): o retrato diário da validade do conselho no worker. A contagem (só os registros
// ativos; vencidos, a vencer na janela e sem validade), a conferência que só vale para o mesmo número e conselho, a
// janela do parâmetro, a gravação só em SGH_PES_CONSELHO_DIA e a chave do serviço. Núcleo falso; dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  contarAlertas,
  type NucleoConselho,
  PessoasConselhoService,
  retratoConselhoLigado,
  retratoDoEstabelecimento,
} from './pessoas-conselho.service.js';

const HOJE = '2026-10-25';

describe('retrato do conselho (M52.1)', () => {
  it('conta vencidos, a vencer e sem validade; o registro inativo fica de fora', () => {
    const r = contarAlertas(
      [
        { registro: 1, profissional: 1, ativo: true, validade: '2026-10-24' },
        { registro: 2, profissional: 1, ativo: true, validade: '2026-12-20' },
        { registro: 3, profissional: 2, ativo: null, validade: null },
        { registro: 4, profissional: 2, ativo: true, validade: '2027-06-30' },
        { registro: 5, profissional: 3, ativo: false, validade: '2020-01-01' },
      ],
      HOJE,
      60,
    );
    expect(r).toEqual({ registros: 4, vencidos: 1, aVencer: 1, semValidade: 1 });
  });

  it('a chave: fora de dev/ci ligado; em dev/ci só pedido', () => {
    expect(retratoConselhoLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(retratoConselhoLigado({ AMBIENTE: 'producao', PESSOAS_CONSELHO_DIARIO: 'desligado' })).toBe(false);
    expect(retratoConselhoLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(retratoConselhoLigado({ AMBIENTE: 'ci', PESSOAS_CONSELHO_DIARIO: 'ligado' })).toBe(true);
  });

  it('lê READ ONLY, aplica a janela do parâmetro e grava só SGH_PES_CONSELHO_DIA', async () => {
    const escritas: string[] = [];
    const leitor = {
      consultar: async (sql: string) => {
        if (sql.includes('FROM SGH_PES_VINCULO v JOIN TBCBOPRO'))
          return [
            { ID: 11, ID_TBPROFIS: 7, CONS_PROF: 'COREN', COD: 123, ATIVO: 'T', VINCULO: 1, NOME: 'X' },
            { ID: 12, ID_TBPROFIS: 7, CONS_PROF: 'CRM', COD: 456, ATIVO: 'T', VINCULO: 1, NOME: 'X' },
          ];
        if (sql.includes('FROM SGH_PES_HABILITACAO'))
          return [
            // Conferida com o mesmo número: vale (vence em 45 dias: fora da janela de 30 do parâmetro; dentro da de 60).
            {
              ID_TBCBOPRO: 11,
              COD: 123,
              CONS_PROF: 'COREN',
              VALIDADE: '2026-12-09',
              CONFERIDO_EM: HOJE,
              CONFERIDO_POR: 'RH',
              VERSAO: 0,
            },
            // Conferida com outro número: não vale (sem validade).
            {
              ID_TBCBOPRO: 12,
              COD: 999,
              CONS_PROF: 'CRM',
              VALIDADE: '2030-01-01',
              CONFERIDO_EM: HOJE,
              CONFERIDO_POR: 'RH',
              VERSAO: 0,
            },
          ];
        if (sql.includes('SGH_CFG_PARAMETRO'))
          return [
            {
              ID: '1',
              CHAVE: 'pessoas.alertaConselhoDias',
              NIVEL: 'estabelecimento',
              ALVO: 'aa',
              VALOR: '30',
              VIGENTE_DESDE: new Date('2026-01-01T00:00:00'),
              VIGENTE_ATE: null,
              JUSTIFICATIVA: 'teste',
              AUTOR: 'RH',
            },
          ];
        return [];
      },
    };
    const nucleo = {
      rede: 'r',
      lerSomente: async (_c: unknown, fn: (l: never) => Promise<unknown>) => fn(leitor as never),
      gravarSgh: async (_c: unknown, fn: (e: never) => Promise<unknown>) =>
        fn({
          hospital: 'aa',
          consultar: async () => [],
          lerBlob: async () => Buffer.alloc(0),
          executar: async (sql: string) => {
            escritas.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
            return sql.startsWith('UPDATE') ? 0 : 1;
          },
          executarRetornando: async () => ({}),
        } as never),
      encerrar: async () => undefined,
    } as unknown as NucleoConselho;
    const r = await retratoDoEstabelecimento(nucleo, 'aa', HOJE);
    expect(r).toMatchObject({
      hospital: 'aa',
      dia: HOJE,
      janelaDias: 30,
      registros: 2,
      aVencer: 0,
      semValidade: 1,
      vencidos: 0,
    });
    expect(escritas).toEqual(['UPDATE SGH_PES_CONSELHO_DIA SET', 'INSERT INTO SGH_PES_CONSELHO_DIA']);
    const s = new PessoasConselhoService();
    expect(await s.ciclo()).toEqual([]);
  });
});
