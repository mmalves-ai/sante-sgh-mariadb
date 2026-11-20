// M56 regra 3 (ficha, seção 8; cap-07 §7.4) na cópia, numa transação SEMPRE desfeita: a operadora é empresa distinta,
// e o escopo dos dados é ela. Duas operadoras SINTÉTICAS no mesmo estabelecimento: o contrato herda a operadora do
// produto (nunca a do pedido); a lista de contratos e de beneficiários de uma não mostra os da outra; o produto não muda
// de operadora (404 no serviço; 0 linha no banco, `desatualizado`); a leitura com outro estabelecimento não acha nada;
// a trilha de cada gravação leva o recurso da operadora. Nada fica gravado.
import {
  contratoSgh,
  gravarProdutoSgh,
  type NucleoLegado,
  produtoSgh,
  somenteSgh,
  trilhaDaOperadoraPorRecurso,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COD,
  codigoDe,
  criarNucleo,
  montarCarteira,
  PODE,
  servicoNaTransacao,
  sessao,
} from './copia.spec-util.js';

let nucleo: NucleoLegado;
beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  await nucleo.verificarSchema(COD);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

describe.skipIf(!PODE)('regra 3: o escopo da operadora na cópia', () => {
  it('duas operadoras: o contrato herda a do produto, as listas não se misturam e o produto não muda de operadora', async () => {
    const r = await nucleo.desfazendoNaCopia(
      { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-escopo' },
      async (e) => {
        const { servico } = servicoNaTransacao(e);
        const s = sessao(nucleo.rede);
        const a = await montarCarteira(servico, s, { registro: '990571', base: '99057' });
        const b = await montarCarteira(servico, s, { registro: '990572', base: '99058' });
        const ctrA = await contratoSgh(e, COD, a.contrato);
        const contratosB = await servico.contratos(s, { operadora: b.operadora });
        const beneficiariosB = await servico.beneficiarios(s, { operadora: b.operadora });
        const buscaCruzada = await servico.beneficiarios(s, {
          operadora: b.operadora,
          busca: a.titular.carteirinha!,
        });
        const prodA = (await produtoSgh(e, COD, a.produto))!;
        const trocaNoServico = await codigoDe(
          servico.gravarProduto(s, a.produto, {
            ...prodA,
            operadora: b.operadora,
            versao: prodA.versao,
            coparticipacao: prodA.coparticipacao,
            carencias: prodA.carencias,
            precos: prodA.precos ? [...prodA.precos] : null,
            segmentacao: prodA.segmentacao as 'ambulatorialHospitalar',
            abrangencia: prodA.abrangencia as 'estadual',
            situacao: 'ativo',
          }),
        );
        const trocaNoBanco = await codigoDe(
          gravarProdutoSgh(somenteSgh(e), {
            hospital: COD,
            id: a.produto,
            versao: prodA.versao,
            dados: { ...prodA, operadora: b.operadora },
            por: 'SGH.INT.M56',
          }),
        );
        const outroHospital = await contratoSgh(e, 'zz', a.contrato);
        const trilha = await trilhaDaOperadoraPorRecurso(e, COD, 'SGH.INT.M56');
        return {
          operadoraDoContratoA: ctrA?.operadora,
          a,
          b,
          contratosB: contratosB.itens.map((x) => x.id),
          beneficiariosB: beneficiariosB.itens.map((x) => x.id),
          buscaCruzada: buscaCruzada.itens.length,
          trocaNoServico,
          trocaNoBanco,
          outroHospital,
          trilha: Object.entries(trilha)
            .map(([r, n]) => `${r}:${n}`)
            .sort(),
        };
      },
    );
    expect(r.operadoraDoContratoA).toBe(r.a.operadora);
    expect(r.contratosB).toEqual([r.b.contrato]);
    expect(r.beneficiariosB.sort()).toEqual([r.b.titular.id, r.b.dependente].sort());
    expect(r.buscaCruzada).toBe(0);
    expect(r.trocaNoServico).toBe('404');
    expect(r.trocaNoBanco).toBe('desatualizado');
    expect(r.outroHospital).toBeNull();
    // Recurso da trilha: a empresa pelo gestor; o resto pela edição de beneficiários (5 por carteira, 2 carteiras).
    expect(r.trilha).toEqual(['operadora.beneficiario.editar:8', 'operadora.empresa.editar:2']);
    console.log(`[int-m56.2] ${COD}: escopo da operadora conferido com 2 operadoras sintéticas (desfeito)`);
  });
});
