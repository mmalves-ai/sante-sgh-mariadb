// Integração do orçamento empresarial (M54, etapa 7; ficha, F7) na cópia, numa transação SEMPRE desfeita, com o
// escritor só SGH_ (somenteSgh) e o serviço da API sobre a porta das transações:
//   1. as leituras de apoio (centros, itens gerenciais, parâmetros) e o realizado do ano corrente da cópia, abaixo de
//      2 s (a primeira, com o cache frio, só no log);
//   2. o caminho gravado: versão a partir do realizado de 2025 com +5,00%, valores lançados por centro, a versão velha
//      recusada, a aprovação recusada para quem montou e aceita para outra pessoa, a revisão (cópia) aprovada que
//      substitui a vigente, o comparativo de 2026 com o desvio e os totais = soma das parcelas (por linha, centro, item);
//   3. as contagens de SGH_ORC_* iguais antes e depois do ROLLBACK e nenhuma linha desta integração na trilha.
// Só contagens, totais agregados e tempos saem no log (nenhum dado de pessoa; centros e itens são da instituição).
import type { Leitor } from '@sgh/legado';
import {
  contagensOrcamentoSgh,
  lerCentrosOrcamento,
  lerItensGerenciais,
  lerRealizadoAno,
  somenteSgh,
} from '@sgh/legado';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { portaOrcamentoNasTransacoes } from './porta-legado.js';
import { ServicoOrcamento, type SessaoOrcamento } from './servico.js';

const CORRELACAO = 'int-m54e7';
const EVENTOS = {
  criado: 'financeiro.orcamento.criado',
  linhas: 'financeiro.orcamento.linhasGravadas',
  aprovado: 'financeiro.orcamento.aprovado',
  descartado: 'financeiro.orcamento.descartado',
};
const CODIGOS = { editar: 'financeiro.orcamento.editar', aprovar: 'financeiro.orcamento.aprovar' };

function medir(msg: string): void {
  const pasta = resolve(import.meta.dirname, '../../../../../.tmp');
  mkdirSync(pasta, { recursive: true });
  appendFileSync(resolve(pasta, 'm54-e7-int.log'), `${new Date().toISOString()} ${msg}\n`);
}

async function cronometrar<T>(nome: string, fn: () => Promise<T>, teto = 2000): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t0);
  medir(`${nome}: ${ms} ms`);
  expect(ms, `${nome} em ${ms} ms`).toBeLessThan(teto);
  return r;
}

const contagens = (l: Leitor) => contagensOrcamentoSgh(l, CORRELACAO);

function sessao(hospital: string, rede: string, login: string): SessaoOrcamento {
  return {
    rede,
    hospital,
    login,
    pode: () => true,
    trilha: (evento, operacao, tabela, id, chave = null) => ({
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'financeiro.orcamento',
      operacao,
      tabelaAlvo: tabela,
      idAlvo: id === null ? null : String(id),
      chaveNaturalAlvo: chave,
      resultado: 'sucesso',
      estacao: null,
      correlacao: CORRELACAO,
    }),
  };
}

describe.skipIf(!PODE_ESCREVER)('orçamento empresarial na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  const retrato = () => a.nucleo.lerSomente({ ...a.c, traceId: 'int-m54e7-contagens' }, contagens);
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras de apoio e o realizado do ano, abaixo de 2 s', async () => {
    await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m54e7-leituras' }, async (l) => {
      const centros = await cronometrar('centros', () => lerCentrosOrcamento(l));
      const itens = await cronometrar('itens gerenciais', () => lerItensGerenciais(l));
      const t0 = performance.now();
      await lerRealizadoAno(l, 1, 2026);
      medir(`realizado 2026 (primeira, cache frio): ${Math.round(performance.now() - t0)} ms`);
      const r = await cronometrar('realizado 2026', () => lerRealizadoAno(l, 1, 2026));
      medir(
        `centros=${centros.length} itens=${itens.length} (receita ${itens.filter((i) => i.natureza === 'receita').length})` +
          ` grupos do realizado=${r.agregado.length} rateados=${r.rateados.length} ultimo=${r.ultimoMovimento}`,
      );
      expect(centros.length).toBeGreaterThan(5);
      expect(itens.length).toBeGreaterThan(10);
      expect(r.agregado.length).toBeGreaterThan(0);
    });
  });

  it('do realizado à aprovação e ao comparativo; contagens iguais depois do ROLLBACK', async () => {
    const antes = await retrato();
    let dentro: Record<string, number> = {};
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: CORRELACAO }, async (e0) => {
      const e = somenteSgh(e0);
      const servico = new ServicoOrcamento(portaOrcamentoNasTransacoes(new Map([[a.cod, e]])));
      const autor = sessao(a.cod, a.c.rede, 'SINT.ORCAMENTO');
      const aprovador = sessao(a.cod, a.c.rede, 'SINT.ORCAMENTO.APROVA');

      // 1. Versão de 2026 a partir do realizado de 2025 com +5,00%.
      const criada = await cronometrar(
        'criar do realizado 2025',
        () =>
          servico.criar(
            autor,
            {
              ano: 2026,
              empresa: 1,
              descricao: 'Integração M54.7',
              base: { tipo: 'realizado', ajusteCentesimos: 500 },
            },
            EVENTOS,
          ),
        10_000,
      );
      medir(`versão do realizado: ${criada.linhas} linhas, ${criada.descartadas} fora do cadastro`);
      expect(criada.linhas).toBeGreaterThan(0);
      let d = await servico.detalhe(autor, criada.id, CODIGOS, true);
      expect(d.orcamento.base).toBe('realizado de 2025 +5,00%');
      expect(d.orcamento.linhas).toBe(criada.linhas);
      expect(d.orcamento.totalCentavos).toBe(
        d.orcamento.totaisPorNatureza.despesa +
          d.orcamento.totaisPorNatureza.receita +
          d.orcamento.totaisPorNatureza.consumo,
      );
      expect(d.acoes.aprovar).toBe(false);

      // 2. Valores lançados: uma linha de consumo num centro do cadastro, outra alterada; a versão velha é recusada.
      const consumo = d.linhas.find((l) => l.natureza === 'consumo');
      const outra = d.linhas.find((l) => l.natureza === 'despesa')!;
      const g = await servico.gravarLinhas(
        autor,
        criada.id,
        {
          versao: d.orcamento.versao,
          linhas: [
            { ...outra, meses: outra.meses.map((v) => v + 100), observacao: 'revisado na integração' },
            ...(consumo ? [{ ...consumo, meses: consumo.meses.map(() => 0), observacao: null }] : []),
          ],
        },
        EVENTOS,
      );
      expect(g.mudou).toBe(true);
      expect(g.alteradas).toBe(1);
      expect(g.totalDepois).toBe(g.totalAntes + 1200 - (consumo ? consumo.totalCentavos : 0));
      await expect(
        servico.gravarLinhas(
          autor,
          criada.id,
          { versao: d.orcamento.versao, linhas: [{ ...outra, meses: [...outra.meses], observacao: null }] },
          EVENTOS,
        ),
      ).rejects.toMatchObject({ extras: { codigo: 'desatualizado' } });

      // 3. Quem montou não aprova; outra pessoa aprova.
      d = await servico.detalhe(autor, criada.id, CODIGOS, true);
      await expect(
        servico.aprovar(autor, criada.id, { versao: d.orcamento.versao, observacao: null }, EVENTOS),
      ).rejects.toMatchObject({
        extras: { codigo: 'segregacao' },
      });
      const ap = await servico.aprovar(
        aprovador,
        criada.id,
        { versao: d.orcamento.versao, observacao: 'Integração' },
        EVENTOS,
      );
      // A cópia não tem orçamento aprovado de 2026 deste estabelecimento (a não ser de outra integração já desfeita).
      expect(ap.substituida).toBeNull();

      // 4. Revisão (cópia) aprovada substitui a vigente na mesma transação.
      const rev = await servico.criar(
        autor,
        { ano: 2026, empresa: 1, descricao: 'Revisão integração', base: { tipo: 'versao', id: criada.id } },
        EVENTOS,
      );
      expect(rev.numero).toBeGreaterThan(criada.numero);
      const ap2 = await servico.aprovar(aprovador, rev.id, { versao: 0, observacao: null }, EVENTOS);
      expect(ap2.substituida).toBe(criada.id);
      const lista = await servico.versoes(autor, 2026);
      expect(lista.filter((v) => v.situacao === 'aprovado').map((v) => v.id)).toEqual([rev.id]);
      expect(lista.find((v) => v.id === criada.id)?.situacao).toBe('substituido');

      // 5. Comparativo de 2026 até junho: desvio e totais = soma das parcelas, nas três visões.
      for (const visao of ['linha', 'centro', 'item'] as const) {
        const c = await cronometrar(`comparativo ${visao}`, () =>
          servico.comparativo(autor, rev.id, { mesAte: 6, visao }),
        );
        for (const t of c.totais) {
          expect(t.orcadoCentavos).toBe(t.parcelasOrcado.reduce((s, p) => s + p.centavos, 0));
          expect(t.realizadoCentavos).toBe(t.parcelasRealizado.reduce((s, p) => s + p.centavos, 0));
          expect(t.desvioCentavos).toBe(t.realizadoCentavos - t.orcadoCentavos);
        }
        medir(
          `comparativo ${visao}: ${c.linhas.length} linhas; ` +
            c.totais
              .map(
                (t) =>
                  `${t.natureza} orçado ${t.orcadoCentavos} realizado ${t.realizadoCentavos} desvio ${t.desvioPercentual}%`,
              )
              .join('; ') +
            `; avisos ${c.avisos.length}`,
        );
      }
      dentro = await contagens(e);
    });
    const depois = await retrato();
    medir(
      `contagens antes ${JSON.stringify(antes)} dentro ${JSON.stringify(dentro)} depois ${JSON.stringify(depois)}`,
    );
    expect(dentro['SGH_ORC_ORCAMENTO']).toBe((antes['SGH_ORC_ORCAMENTO'] ?? 0) + 2);
    expect(dentro['SGH_TRILHA da correlação']).toBeGreaterThanOrEqual(5);
    expect(depois).toEqual(antes);
  }, 600_000);
});
