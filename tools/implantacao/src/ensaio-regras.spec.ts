// M60, etapa 1: regras do ensaio da primeira aplicação (limite de espera, contagens, veredito, porta própria).
import { describe, expect, it } from 'vitest';
import {
  avaliarEsperas,
  avaliarMon,
  compararContagens,
  conferirPortaDoEnsaio,
  contagemPublica,
  type EntradaVeredito,
  type RelatorioCli,
  LIMITE_ESPERA_TRAVA_MS,
  vereditoDoEnsaio,
  divergenciasDaSimulacao,
} from './ensaio-regras.ts';

const rel = (linhas: RelatorioCli['linhas'], resultado: 'ok' | 'falhou' = 'ok'): RelatorioCli => ({
  modo: 'aplicar',
  totalMs: 12,
  resultado,
  linhas,
  resumo: '',
});

const base: EntradaVeredito = {
  copiaLimpa: { objetosSghAntes: 0 },
  aplicacao: { ok: true, scripts: 170, totalMs: 90_000 },
  impressaoLegadaAntes: 'abc',
  impressaoLegadaDepois: 'abc',
  contagensAntes: { RECADATE: 10, CADPAC: 20 },
  contagensDepois: { RECADATE: 10, CADPAC: 20 },
  esperas: avaliarEsperas([{ sessao: 1, operacao: 'gravacao', ms: 30 }]),
  mon: avaliarMon([{ instante: 1, paradosLegados: 0, maiorParadoMs: 0 }]),
  recolhimento: { ok: true, impressaoCompletaAntes: 'x', impressaoCompletaDepois: 'x', objetosSghDepois: 0 },
  cli: {
    simulacaoAntes: rel([
      { numero: 1, item: 'a', hash: 'h1', ms: null, resultado: 'a aplicar (2 comando(s))' },
      { numero: 3, item: 'c', hash: 'h3', ms: null, resultado: 'a aplicar (1 comando(s))' },
      { numero: 2, item: 'b', hash: 'h2', ms: null, resultado: 'a aplicar (1 comando(s))' },
    ]),
    ordemEsperada: [
      { numero: 1, hash: 'h1' },
      { numero: 3, hash: 'h3' },
      { numero: 2, hash: 'h2' },
    ],
    objetosSghDepoisDaSimulacao: 0,
    aplicacao: rel([
      { numero: 1, item: 'a', hash: 'h1', ms: 4, resultado: 'aplicado' },
      { numero: 3, item: 'c', hash: 'h3', ms: 4, resultado: 'aplicado' },
      { numero: 2, item: 'b', hash: 'h2', ms: 4, resultado: 'aplicado' },
    ]),
    papelConcedido: true,
    leituraConcedida: true,
    simulacaoDepois: rel([]),
    recolhimento: rel([{ item: 'DROP TABLE SGH_A', ms: 2, resultado: 'removido' }]),
  },
};

describe('ensaio da primeira aplicação: regras', () => {
  it('limite de 2 s; acima ou com erro (lock time-out) reprova; sem operação nenhuma também', () => {
    expect(LIMITE_ESPERA_TRAVA_MS).toBe(2000);
    expect(avaliarEsperas([{ sessao: 1, operacao: 'leitura', ms: 2000 }]).ok).toBe(true);
    expect(avaliarEsperas([{ sessao: 1, operacao: 'leitura', ms: 2001 }])).toMatchObject({
      ok: false,
      acimaDoLimite: 1,
    });
    expect(avaliarEsperas([{ sessao: 2, operacao: 'gravacao', ms: 5, erro: 'lock_timeout' }]).ok).toBe(false);
    expect(avaliarEsperas([]).ok).toBe(false);
    expect(avaliarMon([]).ok).toBe(false);
    expect(avaliarMon([{ instante: 1, paradosLegados: 1, maiorParadoMs: 2500 }]).ok).toBe(false);
  });

  it('contagens: aponta só o que mudou; contagem pública abaixo de 5 vira <5', () => {
    expect(compararContagens({ A: 1, B: 2 }, { A: 1, B: 3, C: 0 })).toEqual(['B', 'C']);
    expect(contagemPublica(4)).toBe('<5');
    expect(contagemPublica(5)).toBe('5');
  });

  it('M60.1, sgh:aplicar na cópia limpa: simulação na ordem de aplicação com hash, contas e relatórios', () => {
    const cli = base.cli;
    const nomes = (c: Partial<EntradaVeredito['cli']>) =>
      vereditoDoEnsaio({ ...base, cli: { ...cli, ...c } })
        .criterios.filter((x) => !x.ok)
        .map((x) => x.nome);
    expect(divergenciasDaSimulacao(cli.simulacaoAntes.linhas, cli.ordemEsperada)).toEqual([]);
    // ordem numérica em vez da de dependência
    const numerica = [...cli.simulacaoAntes.linhas].sort((a, b) => a.numero! - b.numero!);
    expect(divergenciasDaSimulacao(numerica, cli.ordemEsperada)).toEqual([
      'posição 2: 2 em vez de 3',
      'posição 3: 3 em vez de 2',
    ]);
    expect(nomes({ simulacaoAntes: rel(numerica) })).toEqual(['simulação na cópia limpa (conta de leitura)']);
    expect(nomes({ objetosSghDepoisDaSimulacao: 1 })).toEqual([
      'simulação na cópia limpa (conta de leitura)',
    ]);
    expect(nomes({ simulacaoAntes: rel([], 'falhou') })).toEqual([
      'simulação na cópia limpa (conta de leitura)',
    ]);
    expect(nomes({ papelConcedido: false })).toEqual(['contas da aplicação e de leitura']);
    expect(nomes({ simulacaoDepois: rel([], 'falhou') })).toEqual(['contas da aplicação e de leitura']);
    expect(nomes({ aplicacao: rel(cli.aplicacao.linhas.slice(1)) })).toEqual([
      'relatórios do sgh:aplicar (--relatorio e --recolher)',
    ]);
    expect(nomes({ recolhimento: rel([]) })).toEqual([
      'relatórios do sgh:aplicar (--relatorio e --recolher)',
    ]);
  });

  it('veredito: verde só com todos os critérios; cada falha aponta o critério', () => {
    expect(vereditoDoEnsaio(base).ok).toBe(true);
    const falhas = (e: Partial<EntradaVeredito>) =>
      vereditoDoEnsaio({ ...base, ...e })
        .criterios.filter((c) => !c.ok)
        .map((c) => c.nome);
    expect(falhas({ copiaLimpa: { objetosSghAntes: 3 } })).toEqual(['cópia limpa']);
    expect(falhas({ impressaoLegadaDepois: 'outra' })).toEqual(['impressão legada idêntica']);
    expect(falhas({ contagensDepois: { RECADATE: 11, CADPAC: 20 } })).toEqual(['contagens legadas iguais']);
    expect(falhas({ esperas: avaliarEsperas([{ sessao: 1, operacao: 'leitura', ms: 9000 }]) })).toEqual([
      'nenhuma espera longa',
    ]);
    expect(falhas({ recolhimento: { ...base.recolhimento, impressaoCompletaDepois: 'y' } })).toEqual([
      'recolhimento volta ao estado inicial',
    ]);
    expect(falhas({ aplicacao: { ok: true, scripts: 0, totalMs: 0 } })).toEqual(['aplicação completa']);
  });

  it('porta própria: nunca as compartilhadas nem as ocupadas', () => {
    expect(() => conferirPortaDoEnsaio(3351, [])).toThrow(/compartilhada/);
    expect(() => conferirPortaDoEnsaio(3050, [3050])).toThrow(/ocupada/);
    expect(() => conferirPortaDoEnsaio(80, [])).toThrow(/inválida/);
    expect(() => conferirPortaDoEnsaio(3361, [3050])).not.toThrow();
  });
});
