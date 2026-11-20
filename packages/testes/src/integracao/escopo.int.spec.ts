// Escopos lidos ao vivo (ficha do M06, regra 6): o usuário SINTÉTICO com vínculo a uma unidade (TBUNIUSE)
// tem só essa unidade no escopo e a lista de unidades da sessão (o mesmo repositório do M05) não sai dele;
// sem vínculo, a lista não restringe (como o SPDATA trata a ausência; POL-1). PRPARAM é lido igual nos dois
// sistemas. Tudo em transação desfeita.
import { lerEscoposUsuario, lerRestricaoVinculo, lerUnidades, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginLivre, unidadeSintetica, unidadesAtivas, usuarioSintetico } from '../massa/sintetica.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const criarUsuario = operacao('acesso.criarUsuarioIntegracao');

describe.skipIf(!PODE_ESCREVER)('escopos do legado (M06)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('com vínculo, a lista de unidades fica no escopo; sem vínculo, não restringe', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = (await loginLivre(e, (Date.now() + 13) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        criarUsuario,
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, login),
        {
          escritor: e,
        },
      );
      const semVinculo = await lerEscoposUsuario(e, login);
      const todas = await lerUnidades(e, login);
      const [u] = await unidadesAtivas(e, 1);
      await unidadeSintetica(e, login, u as number);
      const comVinculo = await lerEscoposUsuario(e, login);
      const lista = await lerUnidades(e, login);
      return {
        semVinculo: semVinculo.unidades,
        todas: todas.length,
        comVinculo: comVinculo.unidades,
        lista: lista.map((x) => String(x.codigo)),
        u,
      };
    });
    expect(r.semVinculo).toEqual([]);
    expect(r.todas).toBeGreaterThan(1);
    expect(r.comVinculo).toEqual([String(r.u)]);
    expect(r.lista.every((x) => r.comVinculo.includes(x))).toBe(true);
    console.log(
      `[${a.cod}] escopo: sem vínculo ${r.todas} unidades; com vínculo, ${r.lista.length} (só a do vínculo)`,
    );
  });

  it('PRPARAM.REST_ACESS_PACI_NAO_ESTE_ATEND é lido do banco do estabelecimento', async () => {
    const v = await a.nucleo.lerSomente(ctx(a), (l) => lerRestricaoVinculo(l));
    expect(typeof v).toBe('boolean');
    console.log(`[${a.cod}] restrição por vínculo no legado: ${v ? 'ligada' : 'desligada'}`);
  });
});
