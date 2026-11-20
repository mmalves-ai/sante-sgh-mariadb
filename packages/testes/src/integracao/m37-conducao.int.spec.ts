// Integração do M37 na cópia (regra 6; seção 5): a condução opcional de um setor ida e volta pelas operações do
// protocolo de permissões do grupo (TBPERUSU pelo executor do M04), com SGH_CFG_COEX_CONDUCAO na MESMA transação da
// retirada e da devolução, e TBPERUSU de volta ao estado anterior. Grupo sintético criado pelo executor, tudo em
// transação DESFEITA. O segundo caso: o lote de um setor com a condução (CONDUCAO='S', as retiradas com o id do lote)
// recolhido como unidade, com TBPERUSU de volta.
import { planejarLote, reverterLote } from '@sgh/dominio-config';
import {
  aplicarLoteCoexistencia,
  lerConducoes,
  lerLotesCoex,
  operacao,
  recolherLoteCoexistencia,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesAtivas, opcoesDoGrupo } from '../massa/coexistencia-outro-sistema.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('condução opcional na cópia (M37)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('retira o lote de opções do grupo, registra a condução e devolve; TBPERUSU volta ao de antes', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const grupo = `SGH_M37_${Date.now().toString(36).toUpperCase()}`;
      // O operador sintético (o gestor de acessos da integração), criado pelo executor na transação desfeita.
      const operador = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', operador),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      await a.executor.executar(
        operacao('acesso.criarGrupo'),
        a.cod,
        { nome: grupo },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const opcoes = await opcoesAtivas(e, 3);
      await a.executor.executar(
        operacao('acesso.concederOpcoesGrupo'),
        a.cod,
        { grupo, opcoes },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      const doGrupo = () => opcoesDoGrupo(e, grupo);
      const antes = await doGrupo();
      expect(antes).toEqual(opcoes);
      const conducao = { setor: 'agendamento', autorizacao: 'autorização sintética (M37)' };
      await a.executor.executar(
        operacao('acesso.revogarOpcoesGrupo'),
        a.cod,
        { grupo, opcoes: opcoes.slice(0, 2), conducao },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      expect(await doGrupo()).toEqual(opcoes.slice(2));
      const retiradas = (await lerConducoes(e, a.cod, 'agendamento')).filter((x) => x.grupo === grupo);
      expect(retiradas.map((x) => [x.opcao, x.situacao])).toEqual([
        [opcoes[0], 'retirada'],
        [opcoes[1], 'retirada'],
      ]);
      await a.executor.executar(
        operacao('acesso.concederOpcoesGrupo'),
        a.cod,
        { grupo, opcoes: opcoes.slice(0, 2), conducao },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      expect(await doGrupo()).toEqual(antes);
      const devolvidas = (await lerConducoes(e, a.cod, 'agendamento')).filter((x) => x.grupo === grupo);
      expect(devolvidas.every((x) => x.situacao === 'devolvida')).toBe(true);
      // Sem `conducao`, a operação do protocolo não toca a tabela da condução (o uso normal da árvore de permissões).
      await a.executor.executar(
        operacao('acesso.revogarOpcoesGrupo'),
        a.cod,
        { grupo, opcoes: [opcoes[2]!] },
        ctxOperacao(a, operador),
        { escritor: e },
      );
      expect((await lerConducoes(e, a.cod, 'agendamento')).filter((x) => x.grupo === grupo)).toHaveLength(2);
    });
  }, 300_000);

  it('lote de setor com condução: CONDUCAO=S, as retiradas levam o id do lote e o recolhimento devolve TBPERUSU', async () => {
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const grupo = `SGH_M37L_${Date.now().toString(36).toUpperCase()}`;
      const operador = (await loginLivre(e, (Date.now() + 101) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', operador),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const exec = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.cod, entrada, ctxOperacao(a, operador), { escritor: e });
      await exec('acesso.criarGrupo', { nome: grupo });
      const opcoes = await opcoesAtivas(e, 2);
      await exec('acesso.concederOpcoesGrupo', { grupo, opcoes });
      const antes = await opcoesDoGrupo(e, grupo);
      const logins = ['SGH.M37.C1', 'SGH.M37.C2'];
      const trilha = (op: string) => ({
        rede: a.nucleo.rede,
        hospital: a.cod,
        usuario: operador,
        evento: 'coexistencia.lote.aplicado',
        recurso: 'config.coexistencia',
        operacao: op,
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:integracao',
        correlacao: `integracao-m37c-${Date.now().toString(36)}`,
      });
      const r = await aplicarLoteCoexistencia(
        e,
        {
          hospital: a.cod,
          setor: 'agendamento',
          alvoTipo: 'usuarios',
          alvo: logins.join(','),
          chaves: [{ tipo: 'recurso', chave: 'agenda.consulta' }],
          incluidos: logins,
          fora: [],
          justificativa: 'lote sintético com condução (M37)',
          autorizacao: 'autorização sintética (M37)',
          autor: operador,
          conducao: true,
          planejar: (_k, estado) => planejarLote(estado.chaves, 'pessoa', logins, true),
        },
        trilha('lote:agendamento'),
      );
      const conducao = { setor: 'agendamento', autorizacao: 'autorização sintética (M37)', lote: r.id };
      await exec('acesso.revogarOpcoesGrupo', { grupo, opcoes, conducao });
      expect(await opcoesDoGrupo(e, grupo)).toEqual([]);
      const [lote] = await lerLotesCoex(e, a.cod, r.id);
      expect(lote).toMatchObject({ conducao: true, situacao: 'aplicado' });
      const doLote = (await lerConducoes(e, a.cod, 'agendamento')).filter((x) => x.grupo === grupo);
      expect(doLote.map((x) => [x.lote, x.situacao])).toEqual(opcoes.map(() => [r.id, 'retirada']));
      // O recolhimento do lote (o serviço): primeiro as opções voltam ao grupo, depois as chaves.
      await exec('acesso.concederOpcoesGrupo', { grupo, opcoes, conducao });
      const rec = await recolherLoteCoexistencia(
        e,
        {
          hospital: a.cod,
          id: r.id,
          justificativa: 'recolhimento sintético (M37)',
          autor: operador,
          chaves: lote!.chaves,
          reverter: (linhas) =>
            reverterLote(
              linhas.map((c) => ({
                escopo: c.escopo,
                valor: c.valor,
                ligada: c.ligada,
                antes: c.ligadaAntes,
              })),
            ),
        },
        trilha('recolher:agendamento'),
      );
      expect(rec.recolhido).toBe(true);
      expect(await opcoesDoGrupo(e, grupo)).toEqual(antes);
      expect(
        (await lerConducoes(e, a.cod, 'agendamento'))
          .filter((x) => x.lote === r.id)
          .every((x) => x.situacao === 'devolvida'),
      ).toBe(true);
    });
  }, 300_000);
});
