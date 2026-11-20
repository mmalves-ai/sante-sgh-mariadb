// Integração do M35 na cópia (ficha, seções 4 e 10): (1) o público por papel — a contagem agregada por grupo de
// TBUSERS/TBGRUUSU fecha com os 728 ativos do pc e com as parcelas do cap-15 §15.4.1 (só contagens, nenhum login);
// (2) o ensaio de recolhimento de uma liberação (cap-15 §15.3.2): a chave do recurso é ligada para um grupo, a
// pessoa do grupo passa a usar a funcionalidade (inclui uma palavra no dicionário pelo executor do M04, operação
// verde), a chave é recolhida (reversão do lote) e a pessoa volta para o que usava, sem perder nada; a trilha mostra
// as duas mudanças da chave e o que o novo gravou enquanto ela esteve ligada. Tudo em transação DESFEITA (nada fica
// na cópia).
import { chaveLibera, publicoPorPapel } from '@sgh/dominio-config';
import {
  aplicarLoteLiberacao,
  contarPublicoPorGrupo,
  lerChavesLiberacao,
  lerLote,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { palavraSintetica } from '../massa/reproducao-dicionario.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  partirSemDecisao,
  prepararAmbiente,
} from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('prontidão por setor na cópia (M35)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('público por papel: a contagem agregada fecha com os ativos e com a referência de 727', async () => {
    const { porGrupo, total } = await a.nucleo.lerSomente(ctx(a), (l) => contarPublicoPorGrupo(l));
    expect(total).toBeGreaterThan(650);
    expect(total).toBeLessThan(800);
    const papeis = publicoPorPapel(porGrupo, {});
    const soma = papeis.reduce((t, p) => t + (p.usuarios ?? 0), 0);
    const pequenos = papeis.filter((p) => p.menorQue5).length;
    // A soma dos papéis fecha com o total (os grupos não nomeados vão a "Outros"); abaixo de 5 não aparece.
    expect(soma + pequenos * 4).toBeGreaterThanOrEqual(total - pequenos * 4);
    expect(soma).toBeLessThanOrEqual(total);
    const medico = papeis.find((p) => p.papel === 'medico');
    expect(Math.abs((medico?.usuarios ?? 0) - 326)).toBeLessThan(40);
    // Saída só com contagens agregadas.
    console.log(
      `[M35] público na cópia: ${total} ativos; ${papeis.map((p) => `${p.papel} ${p.usuarios ?? '<5'}`).join(', ')}`,
    );
  });

  it('ensaio de recolhimento: ligar para o grupo, usar, recolher, voltar; a trilha mostra as mudanças e o que o novo gravou', async () => {
    const hospital = a.cod;
    const recurso = 'inicio.dicionario';
    const grupo = 'ATENDIMENTO';
    const trilha = (operacao: string) => ({
      rede: a.nucleo.rede,
      hospital,
      usuario: 'SINT.M35',
      evento: `config.liberacao.${operacao}`,
      recurso: 'config.liberacao',
      operacao,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'integracao-m35',
      correlacao: `m35-recolher-${Date.now().toString(36)}`,
    });
    const linhasAntes = await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, hospital));
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // M61: a cópia pode estar com a liberação full; o ensaio parte do "sem decisão" na própria transação.
      await partirSemDecisao(e, { rede: a.nucleo.rede, hospital, chave: recurso });
      const antes = (await lerChavesLiberacao(e, hospital)).filter((c) => c.chave === recurso);
      const vale = (chaves: typeof antes) =>
        chaveLibera(
          chaves.filter((c) => c.chave === recurso),
          'SINT.M35',
          grupo,
          undefined,
        );
      // A pessoa sintética do grupo (criada pelo executor, na transação desfeita).
      const pessoa = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', pessoa),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const valePara = (chaves: typeof antes, login: string) =>
        chaveLibera(
          chaves.filter((c) => c.chave === recurso),
          login,
          grupo,
          undefined,
        );
      expect(vale(antes)).toBe(false);
      expect(valePara(antes, pessoa)).toBe(false);
      // Liberação (o comitê, em lote, para o grupo).
      const lote = await aplicarLoteLiberacao(
        e,
        {
          hospital,
          tipo: 'recurso',
          chave: recurso,
          planejar: ({ chaves }) => [
            {
              escopo: 'grupo',
              valor: grupo,
              ligada: true,
              antes: chaves.find((c) => c.escopo === 'grupo' && c.valor === grupo)?.ligada ?? null,
            },
          ],
          justificativa: 'ensaio de recolhimento (M35)',
          autor: 'SINT.M35',
        },
        trilha('ligar'),
      );
      expect(lote.alteradas).toBe(1);
      expect(vale(await lerChavesLiberacao(e, hospital))).toBe(true);
      // Com a chave ligada, a pessoa do grupo usa a funcionalidade: inclui uma palavra no dicionário pelo executor
      // do M04 (operação verde no pc), com a trilha na mesma transação.
      expect(valePara(await lerChavesLiberacao(e, hospital), pessoa)).toBe(true);
      const correlacaoUso = `m35-uso-${Date.now().toString(36)}`;
      const usoCtx = { ...ctxOperacao(a, pessoa), traceId: correlacaoUso };
      await a.executor.executar(
        operacao('acesso.incluirPalavraDicionario'),
        a.cod,
        { palavra: palavraSintetica() },
        usoCtx,
        { escritor: e },
      );
      // Recolhimento: a reversão do lote devolve o estado de antes (a linha criada pelo lote passa a herdar).
      const doLote = await lerLote(e, hospital, lote.lote);
      expect(doLote.length).toBe(1);
      const recolhe = await aplicarLoteLiberacao(
        e,
        {
          hospital,
          tipo: 'recurso',
          chave: recurso,
          planejar: () =>
            doLote.map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligadaAntes, antes: c.ligada })),
          justificativa: 'recolhimento no ensaio (M35)',
          autor: 'SINT.M35',
        },
        trilha('recolher'),
      );
      expect(recolhe.alteradas).toBe(1);
      expect(vale(await lerChavesLiberacao(e, hospital))).toBe(false);
      // A trilha mostra o que o novo gravou: as duas mudanças, com o lote como alvo.
      const t = await e.consultar(
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE TABELA_ALVO = 'SGH_CFG_LIBERACAO' AND USUARIO = 'SINT.M35'
           AND ID_ALVO IN (?, ?)`,
        [lote.lote, recolhe.lote],
        { teto: 1 },
      );
      expect(Number(t[0]?.['N'])).toBe(2);
      // Depois de recolher: a pessoa volta para o que usava, e a trilha lista o que o novo gravou enquanto a chave
      // esteve ligada (a palavra, pelo executor, com quem gravou).
      expect(valePara(await lerChavesLiberacao(e, hospital), pessoa)).toBe(false);
      const gravou = await e.consultar(
        `SELECT USUARIO FROM SGH_TRILHA WHERE CORRELACAO = ? AND OPERACAO = ?`,
        [correlacaoUso, 'acesso.incluirPalavraDicionario'],
        { teto: 5 },
      );
      expect(gravou.length).toBe(1);
      expect(
        String(gravou[0]?.['USUARIO'] ?? '')
          .trim()
          .toUpperCase(),
      ).toBe(pessoa);
    });
    // Desfeito: nada ficou na cópia.
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => lerChavesLiberacao(l, hospital));
    expect(depois.length).toBe(linhasAntes.length);
  }, 120_000);
});
