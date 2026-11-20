// Integração do M12 na cópia (ficha, seção 10): o lote de reajuste em transações de até 200 itens, cada uma
// curta e desfeita (sem segurar transação entre as partes); a colisão com um valor inserido por fora na mesma
// (TAB, COD, DATA); o LOCK TIMEOUT com TBTABTHM travada por outra conexão; e o "valor vigente em data" para
// 1% dos pares (TAB, COD), sorteados de forma determinística, em três datas, igual ao da regra da sante-api
// sobre a mesma cópia (e igual à regra pura do novo sobre as vigências). Saída só com contagens e tempos.
import {
  ErroOperacao,
  itemHonorarioNaData,
  linhasDoLote,
  lotesDeReajuste,
  operacao,
  preConferirDesfazer,
  vigenciasDoItem,
} from '@sgh/legado';
import { totalComponentes, vigenteEm } from '@sgh/dominio-preco';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contagensM12,
  contratoAtivo,
  convenioEstaNaSituacao,
  convenioNaSituacao,
  entradaReajuste,
  hojeDoBanco,
  MARCA_M12,
  mexerPorFora,
  retratosDoConvenio,
  inserirVigenciaPorFora,
  itensDaTabela,
  linhasNaData,
  paresSorteados,
  travarItemDaTabela,
  valorPelaRegraSanteApi,
} from '../massa/precos.js';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';
import type { Leitor } from '@sgh/legado';

const USUARIO = 'SGH.M12';

const contagensLidas = (a: Ambiente) => a.nucleo.lerSomente(ctx(a), (l: Leitor) => contagensM12(l, USUARIO));

const recusaDe = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? 'sem-codigo';
    throw e;
  }
};

describe.skipIf(!PODE_ESCREVER)('M12 na cópia (transações desfeitas)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('lote de 450 itens em 3 transações curtas de até 200, cada uma desfeita; nada fica', async () => {
    const antes = await contagensLidas(a);
    const hoje = await a.nucleo.lerSomente(ctx(a), (l) => hojeDoBanco(l));
    const itens = await a.nucleo.lerSomente(ctx(a), (l) => itensDaTabela(l, 305, 450));
    const tempos: number[] = [];
    for (let i = 0; i < itens.length; i += 200) {
      const parte = itens.slice(i, i + 200);
      const ent = { ...entradaReajuste(305, hoje, parte, 'percentual'), parte: i / 200 + 1, partes: 3 };
      const inicio = performance.now();
      const r = await a.executor.executar(
        operacao('preco.reajustar'),
        a.cod,
        ent,
        ctxOperacao(a, 'SGH.M12'),
        {
          desfazer: true,
        },
      );
      tempos.push(Math.round(performance.now() - inicio));
      expect(r.resultado['linhas']).toBe(parte.length);
      expect(parte.length).toBeLessThanOrEqual(200);
    }
    expect(tempos).toHaveLength(3);
    const ficou = await a.nucleo.lerSomente(ctx(a), (l) =>
      linhasNaData(
        l,
        305,
        itens.map((x) => x.codigo),
        hoje,
      ),
    );
    expect(ficou).toBe(0);
    expect(await contagensLidas(a)).toEqual(antes);
    console.log(`[${a.cod}] reajuste de 450 itens em 3 transações (ms por transação): ${tempos.join(', ')}`);
  });

  it('reajuste e desfazer na mesma transação desfeita: pré-conferência, retomada do que falta e recusa antes de excluir', async () => {
    const antes = await contagensLidas(a);
    const hoje = await a.nucleo.lerSomente(ctx(a), (l) => hojeDoBanco(l));
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const itens = await itensDaTabela(e, 307, 3);
      const ent = entradaReajuste(307, hoje, itens, 'percentual');
      const op = (n: string, x: unknown) =>
        a.executor.executar(operacao(n), a.cod, x, ctxOperacao(a, USUARIO), { escritor: e });
      await op('preco.reajustar', ent);
      const linhas = await linhasDoLote(e, a.cod, ent.lote);
      expect(linhas).toHaveLength(3);
      const parte = (l: typeof linhas, n: number, de: number) => ({
        tabela: 307,
        data: hoje,
        lote: ent.lote,
        parte: n,
        partes: de,
        justificativa: `${MARCA_M12}: desfazer em partes`,
        itens: l.map((x) => ({ codigo: x.codigo, valores: x.valores })),
      });
      // Uma parte desfeita (como um pedido que parou depois dela): o lote fica "em parte".
      await op('preco.desfazerReajuste', parte(linhas.slice(0, 1), 1, 2));
      const faltam = await linhasDoLote(e, a.cod, ent.lote);
      expect(faltam.map((x) => x.codigo)).toEqual(linhas.slice(1).map((x) => x.codigo));
      const lote = (await lotesDeReajuste(e, a.cod, 307))?.find((x) => x.lote === ent.lote);
      expect(lote).toMatchObject({ itens: 3, desfeitos: 1, desfeito: false });
      // Item da parte que falta mexido por fora: a pré-conferência recusa ANTES de qualquer exclusão.
      const ultimo = faltam[faltam.length - 1]!;
      await mexerPorFora(e, 307, ultimo.codigo, hoje);
      const recusa = await recusaDe(preConferirDesfazer(e, a.cod, [parte(faltam, 2, 2)]));
      expect(recusa).toBe('alterado-por-fora');
      expect(
        await linhasNaData(
          e,
          307,
          faltam.map((x) => x.codigo),
          hoje,
        ),
      ).toBe(faltam.length);
      // Sem o item mexido, o pedido completa só o que falta.
      const resto = faltam.slice(0, -1);
      await preConferirDesfazer(e, a.cod, [parte(resto, 2, 2)]);
      await op('preco.desfazerReajuste', parte(resto, 2, 2));
      expect(
        await linhasNaData(
          e,
          307,
          resto.map((x) => x.codigo),
          hoje,
        ),
      ).toBe(0);
      return { itens: itens.length };
    });
    expect(r.itens).toBe(3);
    expect(await contagensLidas(a)).toEqual(antes);
  });

  it('suspender e reativar, e alterar o NOME com o retrato em HTCONVEN, na transação desfeita', async () => {
    const antes = await contagensLidas(a);
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const op = (n: string, x: unknown) =>
        a.executor.executar(operacao(n), a.cod, x, ctxOperacao(a, USUARIO), { escritor: e });
      const cod = await convenioNaSituacao(e, 'A');
      const sit = (x: string) => convenioEstaNaSituacao(e, cod, x);
      await op('convenio.alterarSituacao', {
        convenio: cod,
        operacao: 'suspender',
        justificativa: `${MARCA_M12}: suspender`,
      });
      expect(await sit('I')).toBe(true);
      await op('convenio.alterarSituacao', {
        convenio: cod,
        operacao: 'reativar',
        justificativa: `${MARCA_M12}: reativar`,
      });
      expect(await sit('A')).toBe(true);
      const c = await contratoAtivo(e);
      const ht = () => retratosDoConvenio(e, c.codigo);
      const antesHt = await ht();
      await op('convenio.alterarContrato', {
        convenio: c.codigo,
        aba: 'cadastro',
        valores: { nome: `${MARCA_M12} ${c.codigo}` },
        lidos: { nome: c.nome },
        justificativa: `${MARCA_M12}: nome`,
      });
      expect(await ht()).toBe(antesHt + 1);
    });
    expect(await contagensLidas(a)).toEqual(antes);
  });

  it('0123: o papel da aplicação tem DELETE nas tabelas SGH_ do M12 (Corrigir de inclusão no "como")', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), (l: Leitor) =>
      l.consultar(
        `SELECT TRIM(p.RDB$RELATION_NAME) T FROM RDB$USER_PRIVILEGES p
          WHERE p.RDB$USER = 'SGH_APLICACAO' AND p.RDB$PRIVILEGE = 'D'
            AND p.RDB$RELATION_NAME IN ('SGH_PRECO_AUTORIA', 'SGH_CAD_CONVENIO_PLANO', 'SGH_CAT_CARGA', 'SGH_CAT_CARGA_LINHA')`,
        [],
        { teto: 10 },
      ),
    );
    expect(r.map((x) => String(x['T'])).sort()).toEqual([
      'SGH_CAD_CONVENIO_PLANO',
      'SGH_CAT_CARGA',
      'SGH_CAT_CARGA_LINHA',
      'SGH_PRECO_AUTORIA',
    ]);
  });

  it('colisão com valor inserido por fora na mesma (TAB, COD, DATA): recusa, nada gravado', async () => {
    const hoje = await a.nucleo.lerSomente(ctx(a), (l) => hojeDoBanco(l));
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [item] = await itensDaTabela(e, 306, 1);
      if (!item) throw new Error('sem item');
      await inserirVigenciaPorFora(e, 306, item.codigo, hoje, item.valores.ch + 1);
      const ent = entradaReajuste(306, hoje, [item], 'percentual');
      const codigo = await recusaDe(
        a.executor.executar(operacao('preco.reajustar'), a.cod, ent, ctxOperacao(a, 'SGH.M12'), {
          escritor: e,
        }),
      );
      // A linha "por fora" muda a vigência que vale hoje: a receita recusa (já existe vigência na data).
      expect(['vigencia-existente', 'proposta-desatualizada']).toContain(codigo);
    });
  });

  it('LOCK TIMEOUT: item de TBTABTHM travado por outra conexão → 409 registro em edição', async () => {
    const hoje = await a.nucleo.lerSomente(ctx(a), (l) => hojeDoBanco(l));
    const [item] = await a.nucleo.lerSomente(ctx(a), (l) => itensDaTabela(l, 307, 1));
    if (!item) throw new Error('sem item');
    let codigo = '';
    const inicio = performance.now();
    await a.nucleo.desfazendoNaCopia(ctx(a), async (trava) => {
      await travarItemDaTabela(trava, 307, item.codigo);
      codigo = await recusaDe(
        a.executor.executar(
          operacao('preco.reajustar'),
          a.cod,
          entradaReajuste(307, hoje, [item], 'percentual'),
          ctxOperacao(a, 'SGH.M12'),
          { desfazer: true },
        ),
      );
    });
    expect(codigo).toBe('registro-em-edicao');
    console.log(`[${a.cod}] LOCK TIMEOUT com TBTABTHM travada: ${Math.round(performance.now() - inicio)} ms`);
  });

  it('valor vigente em data: 1% dos pares em três datas igual à regra da sante-api e à regra pura', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const pares = await paresSorteados(l);
      const datas = ['2024-06-30', '2025-12-31', await hojeDoBanco(l)];
      let comparados = 0;
      let iguais = 0;
      let semValor = 0;
      for (const p of pares) {
        const vig = await vigenciasDoItem(l, p.tab, p.cod);
        for (const d of datas) {
          const sante = await valorPelaRegraSanteApi(l, p.tab, p.cod, d);
          const item = await itemHonorarioNaData(l, p.tab, p.cod, d);
          const novo = item?.valores ? totalComponentes(item.valores) : null;
          const v = vigenteEm(vig, d);
          const puro = v ? totalComponentes(v.valores) : null;
          comparados++;
          if (sante === null) semValor++;
          const igual = (a2: number | null, b: number | null) =>
            a2 === null || b === null ? a2 === b : Math.abs(a2 - b) < 1e-9;
          if (igual(sante, novo) && igual(sante, puro)) iguais++;
        }
      }
      return { pares: pares.length, comparados, iguais, semValor };
    });
    expect(r.pares).toBeGreaterThan(100);
    expect(r.iguais).toBe(r.comparados);
    console.log(
      `[${a.cod}] valor vigente: ${r.pares} pares × 3 datas = ${r.comparados} comparações, ${r.iguais} iguais (100%); ${r.semValor} sem vigência na data`,
    );
  });
});
