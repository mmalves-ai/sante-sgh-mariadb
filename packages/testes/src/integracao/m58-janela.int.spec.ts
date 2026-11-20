// M58 (etapa 5, verificação depois da janela) sobre a cópia de dev, sob a trava da cópia: as leituras da prova
// pós-janela rodam READ ONLY no schema real (as mesmas que a TI roda na produção com `pnpm janela:verificar`):
//   - a plataforma e o charset (banco e parâmetro do estabelecimento), a saúde da conexão e as contagens por tabela
//     (aqui só das tabelas SGH_CFG_, pequenas; a contagem inteira é do comando), contadas duas vezes com o mesmo hash;
//   - a verificação montada com os números lidos e reavaliada pela regra (falha fechada): no passo do desligamento a
//     plataforma e a saúde passam; no passo da versão 5 o motor atual (3) reprova a plataforma; o schema e as
//     operações sem número ficam "não executadas";
//   - a retirada da restrição de entrada com o charset real da cópia: restrita, com o banco e o parâmetro fora do UTF-8.
// Nenhuma escrita. Saída só com números (abaixo de 5 vira <5).
import { createHash } from 'node:crypto';
import { esquemaVerificacaoJanela, type PassoDesligamento } from '@sgh/contratos';
import {
  avaliarRetiradaRestricao,
  avaliarVerificacaoJanela,
  charsetConfere,
  compararContagens,
} from '@sgh/dominio-config';
import {
  contarLinhasTabelas,
  lerEstadoBancoJanela,
  listarTabelasUsuario,
  provarSaudeConexao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
const hash = (c: Readonly<Record<string, number>>) =>
  createHash('sha256')
    .update(
      Object.keys(c)
        .sort()
        .map((t) => `${t}=${c[t]}`)
        .join('\n'),
    )
    .digest('hex');

describe.skipIf(!PODE_ESCREVER)('M58 (etapa 5): verificação depois da janela na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras READ ONLY da prova pós-janela, reavaliadas pela regra; a restrição continua', async () => {
    const t0 = performance.now();
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const estado = await lerEstadoBancoJanela(l);
      const saude = await provarSaudeConexao(l);
      const tabelas = (await listarTabelasUsuario(l)).filter((t) => t.startsWith('SGH_CFG_'));
      const antes = await contarLinhasTabelas(l, tabelas);
      const depois = await contarLinhasTabelas(l, tabelas);
      return { estado, saude, tabelas, antes, depois };
    });
    const ms = Math.round(performance.now() - t0);

    expect(r.estado.versaoMotor).toMatch(/^\d+\.\d+/);
    expect(r.estado.charset.charsetBanco).toBe('NONE');
    expect(r.estado.charset.parametro).toBe('CP1252');
    expect(r.saude.conectou).toBe(true);
    expect(r.saude.latenciaMs).not.toBeNull();
    expect(r.tabelas.length).toBeGreaterThan(5);
    expect(hash(r.antes)).toBe(hash(r.depois));
    const c = compararContagens(r.antes, r.depois);
    expect(c.iguais).toBe(r.tabelas.length);
    expect(c.diferentes).toEqual([]);

    const verificacao = (passo: PassoDesligamento) =>
      avaliarVerificacaoJanela(
        esquemaVerificacaoJanela.parse({
          passo,
          ambiente: 'ensaio',
          em: new Date().toISOString(),
          papel: 'ti',
          plataforma: {
            versaoMotor: r.estado.versaoMotor,
            charsetBanco: r.estado.charset.charsetBanco,
            charsetParametro: r.estado.charset.parametro,
          },
          schema: null,
          contagens: {
            tabelas: c.tabelas,
            iguais: c.iguais,
            diferentes: c.diferentes,
            ausentes: c.ausentes,
            hashAntes: c.hashAntes,
            hashDepois: c.hashDepois,
          },
          saude: {
            ...r.saude,
            codecConfere: charsetConfere(r.estado.charset.charsetBanco, r.estado.charset.parametro),
          },
          operacoes: null,
        }),
      );
    const situacoes = (passo: PassoDesligamento) =>
      Object.fromEntries(verificacao(passo).checagens.map((x) => [x.checagem, x.situacao]));

    // O desligamento não muda a plataforma: plataforma e saúde passam; schema e operações sem número não executadas.
    expect(situacoes('desligamento')).toEqual({
      plataforma: 'aprovada',
      schema: 'nao-executada',
      saude: 'aprovada',
      operacoes: 'nao-executada',
    });
    expect(verificacao('desligamento').aprovada).toBe(false);
    // A versão 5 ainda não está na cópia: o motor reprova a plataforma; as contagens iguais aprovam.
    const fb5 = verificacao('firebird5');
    expect(fb5.checagens.find((x) => x.checagem === 'plataforma')?.achados).toContain(
      'motor-diferente-do-alvo',
    );
    expect(situacoes('firebird5').contagens).toBe('aprovada');
    expect(fb5.aprovada).toBe(false);

    // Regra 6: com o banco e o parâmetro reais da cópia, a restrição de entrada continua.
    const retirada = avaliarRetiradaRestricao({
      registroValido: true,
      utf8Autorizado: true,
      utf8Executado: true,
      verificacaoProducaoAprovada: true,
      charsetBanco: r.estado.charset.charsetBanco,
      charsetParametro: r.estado.charset.parametro,
      chaveLigada: true,
    });
    expect(retirada).toEqual({ situacao: 'restrita', motivos: ['banco-nao-utf8', 'parametro-nao-utf8'] });
    expect(ms).toBeLessThan(120_000);

    console.log(
      `[M58.5 ${a.cod}] motor ${r.estado.versaoMotor} ODS ${r.estado.ods}, ${r.estado.charset.charsetBanco}/${
        r.estado.charset.parametro
      }; saúde ${r.saude.latenciaMs} ms; ${r.tabelas.length} tabelas SGH_CFG_ contadas 2 vezes, ${menos5(
        c.iguais,
      )} iguais, hash igual; desligamento ${JSON.stringify(situacoes('desligamento'))}; firebird5 plataforma ${
        fb5.checagens.find((x) => x.checagem === 'plataforma')?.situacao
      }; retirada ${retirada.situacao} (${retirada.motivos.join(', ')}); ${ms} ms`,
    );
  });
});
