// M56.2 (fatia F1) na cópia, numa transação SEMPRE desfeita: o serviço da F1 inteiro sobre o banco real — operadora →
// plano → contrato de pessoa física → titular (carteirinha e 1ª via) e dependente → ficha → segunda via → elegibilidade
// (p95 < 300 ms pela carteirinha, ficha seção 4) → baixa do titular com o dependente → reativação —, só tabelas
// SGH_OPE_* e a SGH_TRILHA escritas (nenhuma tabela do outro sistema), uma linha de trilha por gravação, e a
// concorrência pela versão. Dados SINTÉTICOS; no log, só contagens e tempos.
import { carteirinhaValida } from '@sgh/dominio-operadora';
import { escritasDaTransacao, type NucleoLegado, trilhaDaOperadoraPorRecurso } from '@sgh/legado';
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

describe.skipIf(!PODE)('operadora própria na cópia (fatia F1): o ciclo do beneficiário', () => {
  it('ciclo completo só em SGH_OPE_* e SGH_TRILHA; elegibilidade p95 < 300 ms; versão vencida recusada', async () => {
    const ctx = { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-2' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const { servico } = servicoNaTransacao(e);
      const s = sessao(nucleo.rede);
      const soma = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
      const trilhaAntes = soma(await trilhaDaOperadoraPorRecurso(e, COD, 'SGH.INT.M56'));
      const k = await montarCarteira(servico, s, { registro: '990561', base: '99056' });
      const carteirinha = k.titular.carteirinha!;
      const ficha = await servico.ficha(s, k.titular.id);
      const semMotivo = await codigoDe(
        servico.emitirVia(s, k.titular.id, { motivo: null, versao: ficha.versao }),
      );
      const motivos = (await servico.tela(s)).dominios.motivosSegundaVia;
      const segunda = motivos.length
        ? await servico.emitirVia(s, k.titular.id, { motivo: motivos[0]!.codigo, versao: ficha.versao })
        : null;
      const repetida = motivos.length
        ? await codigoDe(
            servico.emitirVia(s, k.titular.id, { motivo: motivos[0]!.codigo, versao: ficha.versao }),
          )
        : 'sem-motivos';
      // Elegibilidade: 30 leituras pela carteirinha (chave única).
      const tempos: number[] = [];
      let el = await servico.elegibilidade(s, carteirinha, '2026-10-24');
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        el = await servico.elegibilidade(s, carteirinha, '2026-10-24');
        tempos.push(performance.now() - t0);
      }
      tempos.sort((a, b) => a - b);
      const p95 = tempos[Math.floor(tempos.length * 0.95) - 1]!;
      // Baixa do titular com o dependente; elegibilidade recusa; reativação.
      const motivoBaixa = (await servico.tela(s)).dominios.motivosBaixa[0]!.codigo;
      const f2 = await servico.ficha(s, k.titular.id);
      const baixa = await servico.baixar(s, k.titular.id, {
        motivo: motivoBaixa,
        data: '2026-10-20',
        versao: f2.versao,
      });
      const depois = await servico.elegibilidade(s, carteirinha, '2026-10-24');
      const dep = await servico.ficha(s, k.dependente);
      const f3 = await servico.ficha(s, k.titular.id);
      await servico.reativar(s, k.titular.id, f3.versao);
      // D-BAIXA-56: produto com contrato em uso não muda o tipo de contratação (as contagens de uso no banco real).
      const prod = (await servico.produtos(s, k.operadora)).find((p) => p.id === k.produto)!;
      const emUso = await codigoDe(
        servico.gravarProduto(s, k.produto, {
          operadora: prod.operadora,
          codigo: prod.codigo,
          nome: prod.nome,
          natureza: prod.natureza,
          registroAns: prod.registroAns,
          tipoContratacao: 2,
          segmentacao: prod.segmentacao as 'ambulatorialHospitalar',
          abrangencia: prod.abrangencia as 'estadual',
          acomodacao: prod.acomodacao,
          coparticipacao: prod.coparticipacao,
          carencias: prod.carencias,
          precos: prod.precos,
          situacao: prod.situacao,
          versao: prod.versao,
        }),
      );
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      const trilhaDepois = soma(await trilhaDaOperadoraPorRecurso(e, COD, 'SGH.INT.M56'));
      return {
        carteirinha,
        dependentes: ficha.dependentes.length,
        viasAntes: ficha.carteirinhas.length,
        semMotivo,
        segunda: segunda?.via ?? null,
        repetida,
        el,
        p95,
        baixa,
        depois: depois.motivos,
        depSituacao: dep.situacao,
        tabelas,
        trilha: trilhaDepois - trilhaAntes,
        motivos: motivos.length,
        emUso,
      };
    });
    expect(carteirinhaValida(r.carteirinha)).toBe(true);
    expect(r.carteirinha.startsWith('990561')).toBe(true);
    expect(r.dependentes).toBe(1);
    expect(r.viasAntes).toBe(1);
    expect(r.semMotivo).toBe('segunda-via-sem-motivo');
    if (r.motivos > 0) {
      expect(r.segunda).toBe(2);
      expect(r.repetida).toBe('desatualizado');
    }
    expect(r.el).toMatchObject({ elegivel: true, motivos: [] });
    expect(r.p95).toBeLessThan(300);
    expect(r.baixa.dependentes).toBe(1);
    expect(r.depois).toEqual(['beneficiario-excluido']);
    expect(r.depSituacao).toBe('excluido');
    expect(r.emUso).toBe('produto-em-uso');
    // Só SGH_ (as da F1 e a trilha) e as sequências; nenhuma tabela do outro sistema.
    expect(r.tabelas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    expect(r.tabelas).toEqual(
      expect.arrayContaining(['SGH_OPE_BENEFICIARIO', 'SGH_OPE_CARTEIRINHA', 'SGH_TRILHA']),
    );
    // Uma linha de trilha por gravação: operadora, produto, contrato, 2 inclusões, 2ª via, baixa, reativação.
    expect(r.trilha).toBe(r.motivos > 0 ? 8 : 7);
    console.log(
      `[int-m56.2] ${COD}: ciclo F1 desfeito; tabelas escritas ${r.tabelas.length} (só SGH_); trilha ${r.trilha}; elegibilidade p95 ${r.p95.toFixed(1)} ms; motivos de 2ª via ${r.motivos}`,
    );
  });
});
