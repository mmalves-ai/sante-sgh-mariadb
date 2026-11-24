// Integração da porta própria do cálculo da folha contra o MariaDB real (cliente de teste do lote, SGH_CLIENTE_TESTE):
// a vigência do salário com o adicional conferido contra o risco da função, os parâmetros da folha por vigência e o
// fechamento do período com a reabertura; o processamento é lido e travado pela leitura própria (lista vazia no período
// sintético), e o que ainda não tem modelo (inclusão das férias, obrigações geradas) recusa com `modelo-pendente`.
// Massa sintética da avaliação (massa.spec-util), apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { ParametrosFolha } from '@sgh/contratos';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import {
  CLIENTE_O3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../avaliacao/massa.spec-util.js';
import { adicionalDaVigencia, PortaCalculoFolhaPropria } from './porta-calculo-propria.js';

const trilha =
  (entidade: string) =>
  (id: number | null): TrilhaDaGravacao => ({
    estabelecimento: null,
    usuario: null,
    acao: 'operacao',
    entidade,
    entidadeId: id,
    dadosDepois: { evento: 'teste' },
    correlacao: 'teste-f24-calculo',
  });
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
};

describe('adicional da vigência nova contra o risco da função', () => {
  const sem = { insalubridade: 0, periculosidade: false };
  it('sem laudo: nada de adicional; laudo com um só: o do laudo; com os dois: a escolha', () => {
    expect(adicionalDaVigencia(sem, sem)).toBeNull();
    expect(() => adicionalDaVigencia({ insalubridade: 0, periculosidade: true }, sem)).toThrow(ErroOperacao);
    expect(
      adicionalDaVigencia({ insalubridade: 2000, periculosidade: false }, { ...sem, insalubridade: 2000 }),
    ).toBeNull();
    expect(() =>
      adicionalDaVigencia({ insalubridade: 1000, periculosidade: false }, { ...sem, insalubridade: 2000 }),
    ).toThrow(ErroOperacao);
    const ambos = { insalubridade: 4000, periculosidade: true };
    expect(adicionalDaVigencia({ insalubridade: 0, periculosidade: true }, ambos)).toBe('periculosidade');
    expect(adicionalDaVigencia({ insalubridade: 4000, periculosidade: false }, ambos)).toBe('insalubridade');
    expect(() => adicionalDaVigencia(sem, { insalubridade: 0, periculosidade: true })).toThrow(ErroOperacao);
  });
});

describe.skipIf(SEM_BANCO_O3)(
  `porta própria do cálculo da folha contra o MariaDB (cliente ${CLIENTE_O3})`,
  () => {
    let m: MassaPessoasO3;
    let porta: PortaCalculoFolhaPropria;
    const c = () => ({
      cliente: CLIENTE_O3,
      estabelecimento: m.est,
      usuario: m.usuario,
      correlacao: 'teste-f24-calculo',
    });

    async function limpar() {
      await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-f24-calculo' }, async (e) => {
        await e.executar('DELETE FROM historico_salarial WHERE vinculo_trabalho_id = ?', [m.vinculo]);
        await e.executar('DELETE FROM parametro_folha WHERE estabelecimento_id = ?', [m.est]);
        await e.executar('DELETE FROM fechamento_periodo_folha WHERE estabelecimento_id = ?', [m.est]);
      });
    }

    beforeAll(async () => {
      m = await prepararMassaO3('F24C');
      porta = new PortaCalculoFolhaPropria(m.nucleo);
      await limpar();
    });

    afterAll(async () => {
      if (m) {
        await limpar();
        await encerrarMassaO3(m);
      }
    });

    it('salário: grava a vigência com a justificativa, relê, recusa a repetida e o adicional sem laudo', async () => {
      expect(await porta.podeGravar()).toMatchObject({ pode: true });
      const nova = {
        vinculo: m.vinculo,
        inicio: '2099-03-01',
        salario: 3210.5,
        insalubridade: 0,
        periculosidade: false,
        motivo: 'Reajuste por mérito sintético',
        por: m.login,
      };
      const id = await porta.gravarSgh(c(), trilha('historico_salarial')(null), (g) =>
        g.incluirSalario(nova),
      );
      const lidos = await porta.salarios(c(), [m.vinculo]);
      expect(lidos.find((s) => s.id === id)).toMatchObject({
        vinculo: m.vinculo,
        inicio: '2099-03-01',
        salario: 3210.5,
        insalubridade: 0,
        periculosidade: false,
        motivo: 'Reajuste por mérito sintético',
        registradoPor: m.login,
      });
      expect(
        await codigo(porta.gravarSgh(c(), trilha('historico_salarial')(null), (g) => g.incluirSalario(nova))),
      ).toBe('vigencia-repetida');
      expect(
        await codigo(
          porta.gravarSgh(c(), trilha('historico_salarial')(null), (g) =>
            g.incluirSalario({ ...nova, inicio: '2099-04-01', periculosidade: true }),
          ),
        ),
      ).toBe('adicional-diverge-do-laudo');
      expect((await porta.salarios(c(), [m.vinculo])).some((s) => s.inicio === '2099-04-01')).toBe(false);
    });

    it('parâmetros da folha: grava a vigência, relê do mais recente e recusa a repetida', async () => {
      const p = {
        empresa: m.est,
        inicio: '2099-01-01',
        percentuais: { exemplo: 1 },
        encargos: { exemplo: 2 },
        divisorHoras: 220,
        rubricas: { salario: 1 },
      } as unknown as ParametrosFolha;
      const id = await porta.gravarSgh(c(), trilha('parametro_folha')(null), (g) =>
        g.incluirParametros({ ...p, por: m.login }),
      );
      const lidos = await porta.parametros(c(), m.est);
      expect(lidos[0]).toEqual({ ...p, id, registradoPor: m.login, registradoEm: expect.any(String) });
      expect(await porta.parametros(c(), m.est + 1)).toEqual([]);
      expect(
        await codigo(
          porta.gravarSgh(c(), trilha('parametro_folha')(null), (g) =>
            g.incluirParametros({ ...p, por: m.login }),
          ),
        ),
      ).toBe('vigencia-repetida');
    });

    it('fechamento: grava, relê pelo período, trava o vigente, reabre pela versão e recusa a versão velha', async () => {
      const processos = [
        {
          id: 1,
          tipo: 'mensal' as const,
          competencia: '2099-05',
          numero: 1,
          resumo: 'r',
          pagamento: null,
          colaboradores: 1,
          liquido: 10,
        },
      ];
      const totais = { proventos: 10 } as never;
      const id = await porta.gravarSgh(c(), trilha('fechamento_periodo_folha')(null), async (g) => {
        const v = await g.fechamentoEmVigorComTrava(m.est, 'mensal', '2099-05');
        expect(v).toEqual({ vigente: null, proximoNumero: 1 });
        return g.incluirFechamento({
          empresa: m.est,
          apuracao: 'mensal',
          periodo: '2099-05',
          numero: 1,
          pagamento: '2099-06-05',
          processos,
          totais,
          resumo: 'fechamento sintético',
          por: m.login,
        });
      });
      const f = await porta.fechamento(c(), id);
      expect(f).toMatchObject({
        empresa: m.est,
        apuracao: 'mensal',
        periodo: '2099-05',
        numero: 1,
        situacao: 'fechada',
        pagamento: '2099-06-05',
        processos,
        totais,
        fechadoPor: m.login,
        reabertoPor: null,
      });
      expect((await porta.fechamentos(c(), { periodo: '2099-05' })).map((x) => x.id)).toEqual([id]);
      expect((await porta.fechamentos(c(), { ano: '2099', situacao: 'reaberta' })).length).toBe(0);
      await porta.gravarSgh(c(), trilha('fechamento_periodo_folha')(id), async (g) => {
        const v = await g.fechamentoEmVigorComTrava(m.est, 'mensal', '2099-05');
        expect(v.vigente?.id).toBe(id);
        expect(v.proximoNumero).toBe(2);
        await g.reabrirFechamento({ id, versao: f!.versao, motivo: 'Correção sintética', por: m.login });
      });
      expect(await porta.fechamento(c(), id)).toMatchObject({
        situacao: 'reaberta',
        motivo: 'Correção sintética',
        reabertoPor: m.login,
      });
      expect(
        await codigo(
          porta.gravarSgh(c(), trilha('fechamento_periodo_folha')(id), (g) =>
            g.reabrirFechamento({ id, versao: f!.versao, motivo: 'De novo', por: m.login }),
          ),
        ),
      ).toBe('desatualizado');
    });

    it('processamento: leitura e trava próprias; férias e obrigações ainda recusam com modelo-pendente', async () => {
      const v = await porta.gravarSgh(c(), trilha('parametro_folha')(null), (g) =>
        g.emVigorComTrava(m.est, '2099-05'),
      );
      expect(v).toEqual({ vigente: null, proximoNumero: 1 });
      expect(await porta.processos(c(), { competencia: '2099-05' })).toEqual([]);
      expect(
        await codigo(
          porta.gravarSgh(c(), trilha('parametro_folha')(null), (g) => g.incluirFerias({} as never)),
        ),
      ).toBe('modelo-pendente');
      expect(await codigo(porta.obrigacoes())).toBe('modelo-pendente');
    });
  },
);
