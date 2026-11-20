// Integração da apuração do custo do mês (M54, etapa 5; ficha, F5) na cópia, numa transação SEMPRE desfeita, com o
// escritor só SGH_ (somenteSgh) e os serviços da API sobre a porta das transações:
//   1. a estrutura completa dentro da transação (cada centro ativo sem classe recebe a sugestão; os que repartem, a
//      ordem e o critério "requisições"), a coleta das estatísticas de 2026-03 (a cópia para no 1º semestre de 2026);
//   2. apurar 2026-03: conservação (custo direto = produtivos + parado + não distribuído; produtivos = contas + sem
//      conta), a marca "parcial (sem pessoal)" (sem a folha liberada), as linhas atípicas à parte, as devoluções do mês
//      descontadas dos materiais, o tempo no log;
//   3. reapurar (reprocessamento): a mesma impressão, a anterior substituída; aprovar; exportar ApuraSUS; o resultado
//      por convênio soma o custo das contas;
//   4. as contagens de SGH_CUS_* e da trilha iguais antes e depois do ROLLBACK.
// Só contagens, somas e tempos saem no log (nenhum dado de pessoa; a conta só como contagem).
import type { Leitor } from '@sgh/legado';
import { contagensApuracaoSgh, somenteSgh } from '@sgh/legado';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { portaCustosNasTransacoes } from './porta-legado.js';
import { htmlRelatorioCustos } from './relatorio-custos.js';
import { ServicoCustos, type SessaoCustos } from './servico.js';
import { ServicoApuracaoCustos } from './servico-apuracao.js';

const COMPETENCIA = '2026-03';
const HOJE = '2026-10-29';
const LOGIN = 'SINT.CUSTOS';

function medir(msg: string): void {
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm54-e5-int.log'), `${new Date().toISOString()} ${msg}\n`);
}

const contagens = (l: Leitor) => contagensApuracaoSgh(l);

function sessao(hospital: string, rede: string): SessaoCustos {
  return {
    rede,
    hospital,
    login: LOGIN,
    pode: () => true,
    trilha: (evento, operacao, tabela, id) => ({
      rede,
      hospital,
      usuario: LOGIN,
      evento,
      recurso: 'custos.apuracao',
      operacao,
      tabelaAlvo: tabela,
      idAlvo: id === null ? null : String(id),
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: null,
      correlacao: 'int-m54e5',
    }),
  };
}

describe.skipIf(!PODE_ESCREVER)('apuração do custo do mês na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m54e5-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('estrutura, coleta, apurar, reapurar idêntico, aprovar, exportar e resultado; contagens iguais depois do ROLLBACK', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m54e5' }, async (e0) => {
      const e = somenteSgh(e0);
      const porta = portaCustosNasTransacoes(new Map([[a.cod, e]]));
      const estrutura = new ServicoCustos(porta);
      const servico = new ServicoApuracaoCustos(porta);
      const s = sessao(a.cod, a.c.rede);

      // 1. Estrutura completa (só dentro da transação) e a coleta da competência.
      const est = await estrutura.estrutura(s);
      let ordem = 0;
      for (const c of est.centros.filter((x) => x.ativo && x.classificacao === null)) {
        const classe = c.sugestao ?? 'auxiliar';
        await estrutura.classificar(s, c.id, {
          classe,
          ordemRateio: classe === 'produtivo' ? null : ++ordem + 500,
          criterio: classe === 'produtivo' ? null : 'requisicoes',
          unidadeMensuracao: null,
          observacao: null,
          versao: null,
        });
      }
      const depois = await estrutura.estrutura(s);
      medir(
        `estrutura: ${JSON.stringify(depois.contagem)}; pendências ${depois.pendencias.map((p) => p.tipo).join(',')}`,
      );
      await estrutura.coletar(s, COMPETENCIA, HOJE);

      // 2. Apurar.
      let t0 = performance.now();
      const r = await servico.apurar(
        s,
        { competencia: COMPETENCIA, limiteLinhaSaida: 10_000_000, justificativa: null },
        HOJE,
      );
      const ms = Math.round(performance.now() - t0);
      const t = r.totais;
      medir(
        `apurar ${COMPETENCIA}: ${ms} ms; centros ${r.linhas.length}; contas ${t.contas}; direto ${t.diretoTotal}` +
          ` (pessoal ${t.direto.pessoal}, materiais ${t.direto.materiais}, despesas ${t.direto.despesas}, sem centro ${t.despesasSemCentro});` +
          ` produtivos ${t.custoFinalProdutivos}; parado ${t.naoRateado}; não distribuído ${t.despesasNaoDistribuidas};` +
          ` fora ${t.foraDoCusteio}; atípicas ${t.atipicas.linhas} linhas/${t.atipicas.centavos};` +
          ` devoluções ${t.devolucoes?.linhas ?? 0} linhas/${t.devolucoes?.centavos ?? 0}; nas contas ${t.custoNasContas};` +
          ` sem conta ${t.custoSemConta}; receita ${t.receitaBruta}/${t.receitaLiquida}; ${r.completude.rotulo};` +
          ` pendências ${r.pendencias.map((p) => p.tipo).join(',')}`,
      );
      expect(t.diretoTotal).toBe(t.custoFinalProdutivos + t.naoRateado + t.despesasNaoDistribuidas);
      expect(t.custoFinalProdutivos).toBe(t.custoNasContas + t.custoSemConta);
      expect(r.completude.rotulo).toBe('parcial (sem pessoal)');
      expect(t.contas).toBeGreaterThan(0);
      // Pelo valor da linha (D-VALOR-SAIDA-545) nenhuma saída de 03/2026 passa de R$ 100.000; as devoluções do mês já
      // saíram dos materiais (D-DEVOLUCAO-545).
      expect(t.atipicas.linhas).toBeGreaterThanOrEqual(0);
      expect(t.devolucoes?.linhas ?? 0).toBeGreaterThan(0);
      expect(t.devolucoes?.centavos ?? 0).toBeGreaterThan(0);
      expect(ms).toBeLessThan(120_000);

      // 3. Reapurar dá o mesmo resultado (impressão); aprovar; exportar; resultado.
      t0 = performance.now();
      const r2 = await servico.apurar(
        s,
        { competencia: COMPETENCIA, limiteLinhaSaida: 10_000_000, justificativa: null },
        HOJE,
      );
      medir(
        `reapurar: ${Math.round(performance.now() - t0)} ms; impressão igual: ${r2.impressao === r.impressao}`,
      );
      expect(r2.impressao).toBe(r.impressao);
      const painel = await servico.painel(s, COMPETENCIA);
      expect(painel.historico.slice(0, 2).map((h) => h.situacao)).toEqual(['apurada', 'substituida']);
      const ap = await servico.aprovar(s, r2.id, r2.versao);
      expect(ap.situacao).toBe('aprovada');
      const arq = await servico.exportar(s, COMPETENCIA, 'apurasus');
      medir(
        `exportação ApuraSUS: ${arq.linhas} linhas, ${arq.semCodigo.length} centro(s) sem código, ${arq.conteudo.length} bytes`,
      );
      expect(arq.linhas).toBe(r.linhas.length);
      t0 = performance.now();
      const conv = await servico.resultado(s, COMPETENCIA, 'convenio');
      const pag = await servico.contas(s, { competencia: COMPETENCIA, negativas: false, pagina: 1 });
      const lms = Math.round(performance.now() - t0);
      medir(
        `resultado por convênio + 1ª página das contas: ${lms} ms; ${conv.grupos.length} convênio(s); contas ${pag.total}`,
      );
      expect(conv.total.custo).toBe(t.custoNasContas);
      expect(conv.total.contas).toBe(t.contas);
      expect(pag.total).toBe(t.contas);
      expect(lms).toBeLessThan(4_000);
      // Custo por paciente pelo prontuário (D-PACIENTE-545): a soma dos grupos é a da competência; o 1º paciente com
      // mais de uma conta tem as contas dele pelo filtro, que somam o grupo. Só contagens no log.
      t0 = performance.now();
      const pac = await servico.resultado(s, COMPETENCIA, 'paciente');
      const pms = Math.round(performance.now() - t0);
      const varias = pac.grupos.find((g) => g.contas > 1 && /^\d+$/.test(g.chave));
      const doPac = varias
        ? await servico.contas(s, {
            competencia: COMPETENCIA,
            prontuario: Number(varias.chave),
            negativas: false,
            pagina: 1,
          })
        : null;
      const semPront = pac.grupos.find((g) => g.chave === 'sem')?.contas ?? 0;
      medir(
        `resultado por paciente: ${pms} ms; ${pac.grupos.length} paciente(s); contas sem prontuário ${semPront < 5 ? '<5' : semPront}; ` +
          `filtro pelo prontuário: ${doPac ? (doPac.total < 5 ? '<5' : doPac.total) : 0} conta(s)`,
      );
      expect(pac.total.custo).toBe(t.custoNasContas);
      expect(pac.total.contas).toBe(t.contas);
      expect(pac.grupos.every((g) => /^Prontuário \d+$|^Sem prontuário$/.test(g.rotulo))).toBe(true);
      if (varias && doPac) {
        expect(doPac.total).toBe(varias.contas);
        expect(doPac.contas.reduce((x, c) => x + c.custo, 0)).toBe(varias.custo);
        expect(doPac.contas.every((c) => c.prontuario === Number(varias.chave))).toBe(true);
      }
      const umaConta = pag.contas[0]!;
      const porNumero = await servico.contas(s, {
        competencia: COMPETENCIA,
        numero: umaConta.numero,
        negativas: false,
        pagina: 1,
      });
      expect(porNumero.contas.some((c) => c.conta === umaConta.conta)).toBe(true);
      expect(pms).toBeLessThan(10_000);
      // O relatório de custos (HTML do PDF/A) da apuração aprovada, relida do banco: a conservação e todos os centros.
      const vigente = (await servico.painel(s, COMPETENCIA)).apuracao!;
      const html = htmlRelatorioCustos(vigente);
      medir(`relatório de custos: ${html.length} bytes, ${vigente.linhas.length} centro(s)`);
      expect(html).toContain('Conservação do custo');
      expect(html.match(/<tr><td>\d+<\/td>/g)?.length).toBe(vigente.linhas.length);
      // O resultado por unidade: a soma do custo dos produtivos é o custo final dos produtivos.
      const uni = await servico.resultado(s, COMPETENCIA, 'centro');
      expect(uni.total.custo).toBe(t.custoFinalProdutivos);
      dentro = await contagens(e);
    });
    const fim = await retrato();
    medir(
      `contagens antes=${JSON.stringify(antes)} dentro=${JSON.stringify(dentro)} depois=${JSON.stringify(fim)}`,
    );
    expect(dentro['SGH_CUS_APURACAO']).toBe((antes['SGH_CUS_APURACAO'] ?? 0) + 2);
    expect(dentro['SGH_TRILHA']).toBeGreaterThan(antes['SGH_TRILHA'] ?? 0);
    expect(fim).toEqual(antes);
  }, 900_000);
});
