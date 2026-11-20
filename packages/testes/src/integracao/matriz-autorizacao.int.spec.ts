// Matriz de autorização na cópia (ficha do M06, regras 1, 4 e 5; seção 10): para usuários SINTÉTICOS postos
// em cada um dos grupos com permissões, as opções efetivas lidas ao vivo (TBUSERS.GRUPO → TBPERUSU) são as
// do grupo e as permissões calculadas cobrem exatamente as opções ativas do catálogo (ninguém ganha nem
// perde além do justificado); escopo por unidade: registro de outra unidade (troca de ID) recusado; tempo da
// leitura fria. Tudo em transação desfeita; saída só com nomes de grupo e contagens.
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';
import { conceder, criarAbility, indexarCatalogo, pode, regrasDeAcesso } from '@sgh/dominio-acesso';
import { lerConcessoesUsuario, lerEscoposUsuario, lerGruposLegado, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  grupoSintetico,
  loginLivre,
  unidadeSintetica,
  unidadesAtivas,
  usuarioSintetico,
} from '../massa/sintetica.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const criarUsuario = operacao('acesso.criarUsuarioIntegracao');
const indice = indexarCatalogo([...CATALOGO_LEGADO, ...CATALOGO_DECLARADO]);
const opcoesDoCatalogo = new Map<number, string>();
for (const p of CATALOGO_LEGADO) for (const o of p.opcoesLegado) opcoesDoCatalogo.set(o, p.codigo);

describe.skipIf(!PODE_ESCREVER)('matriz perfil × permissão × escopo (M06)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('cada grupo com permissões: opções efetivas do usuário sintético = TBPERUSU do grupo; permissões batem', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const grupos = (await lerGruposLegado(e)).map((g) => g.nome);
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        criarUsuario,
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, login),
        {
          escritor: e,
        },
      );
      const linhas: string[] = [];
      const tempos: number[] = [];
      let comPermissao = 0;
      for (const g of grupos) {
        await grupoSintetico(e, login, g);
        const t0 = performance.now();
        const c = await lerConcessoesUsuario(e, login);
        tempos.push(performance.now() - t0);
        if (c.opcoesGrupo.length === 0) continue;
        comPermissao++;
        const [n] = await e.consultar('SELECT COUNT(*) N FROM TBPERUSU WHERE GRUPO = ?', [g], { teto: 1 });
        expect(c.grupo, g).toBe(g);
        expect(c.opcoesGrupo.length, g).toBe(Number(n?.['N']));
        const perm = conceder({ legado: { ...c, papeis: [] }, catalogo: [], indice });
        // Toda opção do grupo que está no catálogo vira a sua permissão, já depois da segregação (regra 4: a
        // segregação nunca retira o que o legado concede; o conflito vai à revisão).
        const esperadas = new Set(c.opcoesGrupo.flatMap((o) => opcoesDoCatalogo.get(o) ?? []));
        for (const p of esperadas) expect(perm.permissoes.has(p), `${g}: ${p}`).toBe(true);
        linhas.push(
          `${g}: ${c.opcoesGrupo.length} opções → ${perm.permissoes.size} permissões (${perm.conflitos.length} conflito(s) de segregação à revisão)`,
        );
      }
      tempos.sort((x, y) => x - y);
      return {
        linhas,
        comPermissao,
        p95: tempos[Math.floor(tempos.length * 0.95)] ?? 0,
        grupos: grupos.length,
      };
    });
    expect(r.grupos).toBe(42);
    expect(r.comPermissao).toBe(39);
    console.log(
      `[${a.cod}] ${r.comPermissao} grupos com permissões; leitura fria das concessões p95 ${r.p95.toFixed(1)} ms`,
    );
    for (const l of r.linhas) console.log(`  ${l}`);
    expect(r.p95).toBeLessThan(200);
  });

  it('escopo: só a unidade do vínculo; registro de outra unidade (troca de ID) é recusado', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = (await loginLivre(e, (Date.now() + 7) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        criarUsuario,
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, login),
        {
          escritor: e,
        },
      );
      await grupoSintetico(e, login, 'ATENDIMENTO');
      const [u1, u2] = await unidadesAtivas(e, 2);
      await unidadeSintetica(e, login, u1 as number);
      const escopos = await lerEscoposUsuario(e, login);
      const c = await lerConcessoesUsuario(e, login);
      const perm = conceder({ legado: c, catalogo: [], indice });
      const alvo = [...perm.permissoes].find((p) => p.startsWith('recepcao.')) as string;
      const ab = criarAbility(
        regrasDeAcesso(perm.permissoes, {
          ...escopos,
          unidades: [...escopos.unidades],
          locais: [...escopos.locais],
          convenios: [...escopos.convenios],
          centrosCusto: [...escopos.centrosCusto],
          locaisEstoque: [...escopos.locaisEstoque],
          contasBancarias: [...escopos.contasBancarias],
          tiposAgenda: [...escopos.tiposAgenda],
          tiposProntuario: [...escopos.tiposProntuario],
        }),
      );
      return {
        unidades: escopos.unidades,
        alvo,
        propria: pode(ab, alvo, { unidade: u1 }),
        outra: pode(ab, alvo, { unidade: u2 }),
      };
    });
    expect(r.unidades).toHaveLength(1);
    expect(r.propria).toBe(true);
    expect(r.outra).toBe(false);
  });
});
