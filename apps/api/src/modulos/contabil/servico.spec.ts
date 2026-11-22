// Serviço e portas da contabilidade (M54.1) sem HTTP: a porta própria sem estabelecimento recusa gravar sem abrir
// transação (409), a indisponível
// dá 503 em tudo, a origem tem de ser a do tipo de fato, os campos mudados vão à trilha só pelos nomes e a simulação
// avisa quando a competência passa do teto. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { ErroOperacao } from '@sgh/nucleo';
import { ErroProblema } from '../../problema.filter.js';
import { portaContabilIndisponivel, PortaContabilPropria } from './porta-propria.js';
import { PLANO_SINTETICO, PortaContabilMemoria } from './porta-memoria.js';
import { camposAlterados, impressaoDaRegra, ServicoContabil, TETO_FATOS_COMPETENCIA } from './servico.js';

const C = {
  rede: 'sint',
  hospital: 'aa',
  cliente: 'sint',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'teste',
};

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof ErroProblema) return e.getStatus();
    if (e instanceof ErroOperacao) return e.problema.status;
    throw e;
  }
};

describe('portas da contabilidade', () => {
  it('sem estabelecimento na sessão a gravação é recusada sem abrir transação; a indisponível dá 503', async () => {
    let abriu = false;
    const nucleo = {
      lerSomente: () => Promise.resolve(null as never),
      criarExecutor: () => ({
        executar: () => {
          abriu = true;
          return Promise.resolve(null as never);
        },
      }),
    };
    const p = new PortaContabilPropria(nucleo as never);
    expect(p.destino).toBe('banco');
    expect(
      await status(
        p.gravar(
          { ...C, estabelecimento: null },
          { operacao: 'contabil.teste', pedido: null },
          {} as never,
          () => Promise.resolve(1),
        ),
      ),
    ).toBe(409);
    expect(abriu).toBe(false);
    const i = portaContabilIndisponivel();
    expect(await status(i.plano(C, 1))).toBe(503);
    expect(
      await status(
        i.gravar(C, { operacao: 'contabil.teste', pedido: null }, {} as never, () => Promise.resolve(1)),
      ),
    ).toBe(503);
  });
});

describe('serviço da contabilidade', () => {
  it('campos alterados só pelos nomes; impressão da regra é o SHA-256 da forma canônica', () => {
    const a = PLANO_SINTETICO[4]!;
    expect(camposAlterados(a, { ...a, nome: 'Outro', ativa: false })).toEqual(['nome', 'ativa']);
    expect(impressaoDaRegra('{}')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('a origem tem de ser a do tipo de fato', async () => {
    const s = new ServicoContabil(new PortaContabilMemoria());
    const r = {
      empresa: 1,
      origem: 1 as const,
      tipoFato: 'receitaConta' as const,
      versao: 1,
      nome: 'X',
      vigenciaInicio: '2026-10-01',
      vigenciaFim: null,
      prioridade: 100,
      condicoes: [],
      partidas: [],
    };
    expect(await status(s.prepararPublicacao(C, r))).toBe(409);
  });

  it('a simulação avisa quando a competência passa do teto (resultado parcial)', async () => {
    const m = new PortaContabilMemoria();
    const base = m.fatosGravados[0]!;
    m.fatosGravados.splice(0);
    for (let i = 0; i <= TETO_FATOS_COMPETENCIA; i += 1)
      m.fatosGravados.push({ ...base, idFato: i + 1, id: 800_000 + i, impressao: `p${i}` });
    const s = new ServicoContabil(m);
    const r = await s.simular(
      C,
      {
        empresa: 1,
        origem: 3,
        tipoFato: 'receitaConta',
        versao: 1,
        nome: 'Receita',
        vigenciaInicio: '2026-10-01',
        vigenciaFim: null,
        prioridade: 100,
        condicoes: [],
        partidas: [
          {
            lado: 'D',
            conta: { modo: 'fixa', conta: '1.1.2.01.0001' },
            valor: { base: 'valorFato' },
            historico: 'R',
            centroCusto: 'nenhum',
          },
          {
            lado: 'C',
            conta: { modo: 'fixa', conta: '3.1.1.01.0001' },
            valor: { base: 'valorFato' },
            historico: 'R',
            centroCusto: 'doFato',
          },
        ],
      },
      '2026-10',
    );
    expect(r.parcial).toBe(true);
    expect(r.fatos).toBe(TETO_FATOS_COMPETENCIA);
    const rp = await s.reprocessar(C, 1, '2026-10', true);
    expect(rp.resultado.parcial).toBe(true);
  });
});
