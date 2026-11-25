// Contrato de efeito das respostas, dos textos padrão e do cálculo por fórmula (F3.5, 05-SADT linha 3) contra o MariaDB
// real (cliente de teste, massa SINTÉTICA). Prova o que fica no banco:
//   - o grupo de respostas incluído com as respostas, alterado só no enviado (versão vista), a troca de ordem entre
//     duas respostas, a resposta inativada sem apagar, a regra do domínio recusando antes de gravar, o código único, o
//     grupo em uso que não inativa; a ligação do grupo ao analito do exame pela regra (numérico não leva grupo);
//   - o texto padrão do exame incluído, o atalho repetido recusado, a inativação sem apagar, e a oferta na digitação;
//   - a digitação lida com a fórmula vigente: o analito calculado sai com a conta ou com o motivo, e a variável a
//     digitar aparece; a gravação do resultado grava o calculado pela fórmula (o digitado nele é ignorado), guarda a
//     variável digitada em resultado_variavel_formula e recusa variável de fora do exame; a nova gravação refaz a conta;
//   - a trilha de cada gravação.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import { ServicoResultadoSadt } from './aplicacao/resultado-propria.js';
import { type ContextoCatalogo, PortaCatalogoSadtPropria } from './catalogo-porta-propria.js';
import { PortaRespostasSadtPropria } from './catalogo-respostas-propria.js';
import { PortaSadtPropria } from './porta-propria.js';

const COR = { cliente: CLIENTE, correlacao: 't-catalogo-resp' };
const falhaDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao
      ? `${String(e.problema['codigo'] ?? '')} ${String(e.problema['detail'] ?? '')}`
      : String(e);
  }
};

describe.skipIf(SEM_BANCO)(
  `respostas, textos padrão e fórmula na digitação (MariaDB, cliente ${CLIENTE})`,
  () => {
    let nucleo: NucleoProprio;
    let catalogo: PortaCatalogoSadtPropria;
    let respostas: PortaRespostasSadtPropria;
    let m: MassaSadt | null = null;
    let k = 0;
    const grupos: number[] = [];
    const analitos: number[] = [];
    const c = (): ContextoCatalogo => ({
      cliente: CLIENTE,
      estabelecimento: m?.base.est ?? null,
      usuario: m?.base.usuario ?? null,
      correlacao: 't-catalogo-resp',
      chaveIdempotencia: `t-crf-${m?.marca}-${++k}`,
    });
    const um = (sql: string, p: unknown[]) => nucleo.lerSomente(COR, (l) => l.uma(sql, p));
    const varias = (sql: string, p: unknown[]) => nucleo.lerSomente(COR, (l) => l.consultar(sql, p));
    const trilhas = async (entidade: string, id: number) =>
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [
            entidade,
            id,
          ])
        )?.['n'],
      );
    const vinculoDe = async (analito: number) =>
      Number(
        (
          await um('SELECT id FROM exame_analito WHERE exame_id = ? AND analito_id = ?', [
            (m as MassaSadt).exameLab,
            analito,
          ])
        )?.['id'],
      );

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassaSadt(nucleo, 'CRF');
      catalogo = new PortaCatalogoSadtPropria(nucleo);
      respostas = new PortaRespostasSadtPropria(nucleo);
    }, 60_000);

    afterAll(async () => {
      if (m) {
        const mm = m;
        await nucleo.escrever(COR, async (e) => {
          const res = '(SELECT id FROM resultado_exame WHERE exame_item_id IN (?, ?))';
          const itens = [mm.itemLab, mm.itemLab2];
          await e.executar(
            `DELETE FROM resultado_variavel_formula WHERE resultado_exame_id IN ${res}`,
            itens,
          );
          await e.executar(`DELETE FROM resultado_observacao WHERE resultado_exame_id IN ${res}`, itens);
          await e.executar(`DELETE FROM resultado_analito WHERE resultado_exame_id IN ${res}`, itens);
          const eas = '(SELECT id FROM exame_analito WHERE exame_id = ?)';
          await e.executar(
            `DELETE FROM variavel_formula WHERE formula_calculo_id IN (SELECT id FROM formula_calculo WHERE exame_analito_id IN ${eas})`,
            [mm.exameLab],
          );
          await e.executar(`DELETE FROM formula_calculo WHERE exame_analito_id IN ${eas}`, [mm.exameLab]);
          await e.executar('DELETE FROM texto_padrao_resultado WHERE exame_id = ?', [mm.exameLab]);
          if (analitos.length)
            await e.executar(
              `DELETE FROM exame_analito WHERE analito_id IN (${analitos.map(() => '?').join(',')})`,
              analitos,
            );
          if (grupos.length) {
            const g = grupos.map(() => '?').join(',');
            await e.executar(
              `UPDATE exame_analito SET grupo_resposta_id = NULL WHERE grupo_resposta_id IN (${g})`,
              grupos,
            );
            await e.executar(`DELETE FROM resposta_padrao WHERE grupo_resposta_id IN (${g})`, grupos);
            await e.executar(`DELETE FROM grupo_resposta WHERE id IN (${g})`, grupos);
          }
        });
      }
      await limparMassaSadt(nucleo, m);
      if (m && analitos.length)
        await nucleo.escrever(COR, (e) =>
          e.executar(`DELETE FROM analito WHERE id IN (${analitos.map(() => '?').join(',')})`, analitos),
        );
      await nucleo.encerrar();
    }, 60_000);

    it('grupo de respostas: inclui, recusa pela regra, altera só o enviado, troca a ordem e inativa sem apagar', async () => {
      const mm = m as MassaSadt;
      const base = {
        codigo: `${mm.marca}REAG`,
        descricao: 'Reagente e não reagente de teste',
        tipo: 'qualitativo',
        respostas: [
          { sequencia: 1, codigo: 'NR', descricao: 'Não reagente', padrao: true, mnemonico: 'n' },
          { sequencia: 2, codigo: 'RG', descricao: 'Reagente', anormal: true },
        ],
      };
      const g = await respostas.salvarGrupo(c(), null, base);
      grupos.push(g.id);
      expect(g.versao).toBe(1);
      const linhas = await varias(
        'SELECT id, sequencia, codigo, padrao, anormal, ativo FROM resposta_padrao WHERE grupo_resposta_id = ? ORDER BY sequencia',
        [g.id],
      );
      expect(
        linhas.map((r) => [Number(r['sequencia']), r['codigo'], Number(r['padrao']), Number(r['anormal'])]),
      ).toEqual([
        [1, 'NR', 1, 0],
        [2, 'RG', 0, 1],
      ]);
      expect(await trilhas('grupo_resposta', g.id)).toBe(1);

      // Código repetido e regra do domínio: nada é gravado.
      expect(await falhaDe(respostas.salvarGrupo(c(), null, base))).toMatch(
        /^regra-catalogo .*Já existe grupo/,
      );
      expect(
        await falhaDe(
          respostas.salvarGrupo(c(), null, {
            ...base,
            codigo: `${mm.marca}X`,
            respostas: [{ sequencia: 1, codigo: 'A', descricao: 'A', critico: true }],
          }),
        ),
      ).toMatch(/^regra-catalogo .*crítica é sempre anormal/);
      expect(
        Number(
          (await um('SELECT COUNT(*) AS n FROM grupo_resposta WHERE codigo = ?', [`${mm.marca}X`]))?.['n'],
        ),
      ).toBe(0);

      // Altera só o enviado: troca a ordem das duas respostas e inclui a terceira; a descrição do grupo não muda.
      const [nr, rg] = linhas.map((r) => Number(r['id'])) as [number, number];
      const corpoDe = (id: number, sequencia: number, extra: object = {}) => {
        const l = linhas.find((r) => Number(r['id']) === id) as Record<string, unknown>;
        return {
          id,
          sequencia,
          codigo: String(l['codigo']),
          descricao: id === nr ? 'Não reagente' : 'Reagente',
          anormal: id === rg,
          padrao: id === nr,
          mnemonico: id === nr ? 'n' : null,
          ...extra,
        };
      };
      const g2 = await respostas.salvarGrupo(c(), g.id, {
        versao: 1,
        respostas: [
          corpoDe(nr, 2),
          corpoDe(rg, 1),
          { sequencia: 3, codigo: 'IND', descricao: 'Indeterminado', anormal: true },
        ],
      });
      expect(g2.versao).toBe(2);
      const depois = await varias(
        'SELECT codigo, sequencia FROM resposta_padrao WHERE grupo_resposta_id = ? ORDER BY sequencia',
        [g.id],
      );
      expect(depois.map((r) => r['codigo'])).toEqual(['RG', 'NR', 'IND']);
      expect((await um('SELECT descricao FROM grupo_resposta WHERE id = ?', [g.id]))?.['descricao']).toBe(
        'Reagente e não reagente de teste',
      );
      // Versão velha é recusada (outro usuário gravou antes).
      expect(await falhaDe(respostas.salvarGrupo(c(), g.id, { versao: 1, descricao: 'Outra' }))).not.toBe(
        'gravou',
      );

      // A resposta sai por inativação: a linha continua no banco.
      await respostas.salvarGrupo(c(), g.id, { versao: 2, respostas: [corpoDe(rg, 1, { ativo: false })] });
      const inativa = await um('SELECT ativo, excluido_em FROM resposta_padrao WHERE id = ?', [rg]);
      expect(Number(inativa?.['ativo'])).toBe(0);
      expect(inativa?.['excluido_em']).toBeNull();
      expect(await trilhas('grupo_resposta', g.id)).toBe(3);
      const lido = (await respostas.grupos(c(), mm.marca)).find((x) => Number(x['id']) === g.id);
      expect(lido).toMatchObject({ versao: 3, emUso: 0, ativo: true });
      expect((lido?.respostas ?? []).map((r) => [r['codigo'], r['ativo']])).toEqual([
        ['RG', false],
        ['NR', true],
        ['IND', true],
      ]);
    });

    it('ligação do grupo ao analito do exame pela regra; grupo em uso não inativa', async () => {
      const mm = m as MassaSadt;
      const grupo = grupos[0] as number;
      // O analito numérico da massa não leva grupo.
      const eaNumerico = await vinculoDe(mm.analito);
      const vNum = Number(
        (await um('SELECT versao FROM exame_analito WHERE id = ?', [eaNumerico]))?.['versao'],
      );
      expect(
        await falhaDe(
          catalogo.salvarVinculo(c(), 'analito', mm.exameLab, {
            id: eaNumerico,
            versao: vNum,
            grupoRespostaId: grupo,
          }),
        ),
      ).toMatch(/^regra-catalogo .*Só o analito de texto/);
      // O analito de resposta padronizada exige o grupo na inclusão, e entra com ele.
      const a = await catalogo.salvarAnalito(c(), null, {
        codigo: `${mm.marca}SOR`,
        nome: 'Sorologia de teste',
        tipoResultado: 'texto_padrao',
      });
      analitos.push(a.id);
      expect(
        await falhaDe(catalogo.salvarVinculo(c(), 'analito', mm.exameLab, { analitoId: a.id, ordem: 2 })),
      ).toMatch(/^regra-catalogo .*precisa do grupo/);
      const v = await catalogo.salvarVinculo(c(), 'analito', mm.exameLab, {
        analitoId: a.id,
        ordem: 2,
        grupoRespostaId: grupo,
      });
      expect(
        Number(
          (await um('SELECT grupo_resposta_id FROM exame_analito WHERE id = ?', [v.id]))?.[
            'grupo_resposta_id'
          ],
        ),
      ).toBe(grupo);
      expect((await catalogo.opcoes(c()))['gruposResposta']?.some((o) => o.id === grupo)).toBe(true);
      // Em uso: não inativa (e o grupo continua ativo no banco).
      expect(await falhaDe(respostas.salvarGrupo(c(), grupo, { versao: 3, ativo: false }))).toMatch(
        /^regra-catalogo .*1 analito\(s\) de exame/,
      );
      expect(Number((await um('SELECT ativo FROM grupo_resposta WHERE id = ?', [grupo]))?.['ativo'])).toBe(1);
      // A digitação oferece só as respostas ativas do grupo, na ordem.
      const d = await new PortaSadtPropria(nucleo).digitacao(contexto(mm), mm.itemLab);
      expect(d?.elementos.find((e) => e.codigo === a.id)?.respostasPadrao.map((r) => r.texto)).toEqual([
        'Não reagente',
        'Indeterminado',
      ]);
    });

    it('texto padrão do exame: inclui, recusa atalho repetido, inativa sem apagar e aparece na digitação', async () => {
      const mm = m as MassaSadt;
      const base = {
        exameId: mm.exameLab,
        codigo: `${mm.marca}HEM`,
        descricao: 'Amostra hemolisada (teste)',
        texto: 'Amostra hemolisada: resultado pode estar alterado.',
        mnemonico: 'hem',
      };
      const t = await respostas.salvarTexto(c(), base);
      expect(t.versao).toBe(1);
      expect(await trilhas('texto_padrao_resultado', t.id)).toBe(1);
      expect(
        await falhaDe(
          respostas.salvarTexto(c(), { ...base, codigo: `${mm.marca}HE2`, descricao: 'Outro texto' }),
        ),
      ).toMatch(/^regra-catalogo .*atalho/);
      expect(await falhaDe(respostas.salvarTexto(c(), { ...base, mnemonico: null }))).toMatch(
        /^regra-catalogo .*Já existe texto/,
      );
      expect(
        await falhaDe(respostas.salvarTexto(c(), { ...base, codigo: `${mm.marca}VAZ`, texto: ' ' })),
      ).toMatch(/^regra-catalogo .*Informe o texto/);
      const porta = new PortaSadtPropria(nucleo);
      expect((await porta.digitacao(contexto(mm), mm.itemLab))?.textosPadrao?.map((x) => x.codigo)).toContain(
        t.id,
      );
      // Altera só o enviado (o texto continua) e inativa: a linha fica, some da digitação.
      const t2 = await respostas.salvarTexto(c(), {
        id: t.id,
        versao: 1,
        exameId: mm.exameLab,
        ativo: false,
      });
      expect(t2.versao).toBe(2);
      const linha = await um('SELECT ativo, texto FROM texto_padrao_resultado WHERE id = ?', [t.id]);
      expect(Number(linha?.['ativo'])).toBe(0);
      expect(linha?.['texto']).toBe(base.texto);
      expect((await respostas.textos(c(), mm.exameLab)).map((x) => x['id'])).toContain(t.id);
      expect(
        (await porta.digitacao(contexto(mm), mm.itemLab))?.textosPadrao?.map((x) => x.codigo),
      ).not.toContain(t.id);
    });

    it('fórmula na digitação: o calculado sai com a conta; a gravação grava o calculado e a variável digitada', async () => {
      const mm = m as MassaSadt;
      const porta = new PortaSadtPropria(nucleo);
      const servico = new ServicoResultadoSadt(nucleo);
      const hoje = String((await um('SELECT DATE_FORMAT(CURRENT_DATE, "%Y-%m-%d") AS d', []))?.['d']);
      // Analito calculado do exame: CALC = (K * fator) / 2, com K = o analito numérico da massa e fator digitado.
      const a = await catalogo.salvarAnalito(c(), null, {
        codigo: `${mm.marca}CALC`,
        nome: 'Calculado de teste',
        tipoResultado: 'calculado',
        pulaNaDigitacao: true,
        casasDecimais: 1,
      });
      analitos.push(a.id);
      const v = await catalogo.salvarVinculo(c(), 'analito', mm.exameLab, {
        analitoId: a.id,
        ordem: 3,
        calculado: true,
      });
      await catalogo.novaFormula(c(), v.id, {
        descricao: 'Calculado de teste',
        expressao: '(K * fator) / 2',
        casasDecimais: 1,
        vigenciaInicio: hoje,
        variaveis: [
          { identificador: 'K', descricao: 'Potássio', fonte: 'analito', analitoId: mm.analito },
          { identificador: 'fator', descricao: 'Fator de diluição', fonte: 'digitado' },
        ],
      });
      // A fórmula nasce hoje (nada retroativo); a massa recua o início para a conta não depender da virada do dia.
      await nucleo.escrever(COR, (e) =>
        e.executar("UPDATE formula_calculo SET vigencia_inicio = '2020-01-01' WHERE exame_analito_id = ?", [
          v.id,
        ]),
      );
      const fator = Number(
        (
          await um(
            `SELECT vf.id FROM variavel_formula vf JOIN formula_calculo fc ON fc.id = vf.formula_calculo_id
            WHERE fc.exame_analito_id = ? AND vf.identificador = 'fator'`,
            [v.id],
          )
        )?.['id'],
      );
      expect(fator).toBeGreaterThan(0);

      // Antes de digitar: o calculado diz o que falta e a variável a digitar aparece vazia.
      const antes = await porta.digitacao(contexto(mm), mm.itemLab);
      expect(antes?.elementos.find((e) => e.codigo === a.id)?.calculo).toMatchObject({
        expressao: '(K * fator) / 2',
        valor: null,
        motivo: 'Falta o valor de K.',
      });
      expect(antes?.variaveis).toEqual([
        { codigo: fator, identificacao: 'fator', descricao: 'Fator de diluição', valor: null },
      ]);

      await nucleo.escrever(COR, (e) =>
        e.executar("UPDATE exame_item SET situacao = 'em_analise' WHERE id = ?", [mm.itemLab]),
      );
      const cs = () => ({ ...contexto(mm), chaveIdempotencia: `t-crf-${mm.marca}-${++k}` });
      // Variável de fora do exame: recusada, nada gravado.
      expect(
        await falhaDe(
          servico.registrar(cs(), mm.itemLab, {
            valores: [{ analito: mm.analito, numero: 4 }],
            variaveis: [{ variavel: fator + 999_999, valor: 1 }],
          }),
        ),
      ).toMatch(/^variavel-invalida/);
      expect(
        Number(
          (await um('SELECT COUNT(*) AS n FROM resultado_exame WHERE exame_item_id = ?', [mm.itemLab]))?.[
            'n'
          ],
        ),
      ).toBe(0);

      // Grava K = 4 e fator = 3 (o valor digitado no calculado, 999, é ignorado): CALC = 6.
      const r = await servico.registrar(cs(), mm.itemLab, {
        valores: [
          { analito: mm.analito, numero: 4 },
          { analito: a.id, numero: 999 },
        ],
        variaveis: [{ variavel: fator, valor: 3 }],
      });
      const valorDe = async (analito: number) =>
        Number(
          (
            await um(
              'SELECT valor_numerico FROM resultado_analito WHERE resultado_exame_id = ? AND analito_id = ? AND excluido_em IS NULL',
              [r.resultado, analito],
            )
          )?.['valor_numerico'],
        );
      expect(await valorDe(a.id)).toBe(6);
      expect(await valorDe(mm.analito)).toBe(4);
      const guardada = await um(
        'SELECT valor_numerico, fonte_valor FROM resultado_variavel_formula WHERE resultado_exame_id = ? AND variavel_formula_id = ?',
        [r.resultado, fator],
      );
      expect(Number(guardada?.['valor_numerico'])).toBe(3);
      expect(guardada?.['fonte_valor']).toBe('digitado');
      expect(await trilhas('resultado_exame', r.resultado)).toBe(1);

      // A leitura mostra o calculado com a conta e a variável com o valor guardado.
      const lido = await porta.digitacao(contexto(mm), mm.itemLab);
      expect(lido?.elementos.find((e) => e.codigo === a.id)?.calculo).toMatchObject({
        valor: 6,
        motivo: null,
      });
      expect(lido?.variaveis).toEqual([
        { codigo: fator, identificacao: 'fator', descricao: 'Fator de diluição', valor: 3 },
      ]);

      // Corrigir só o K antes da liberação refaz a conta com o fator guardado: CALC = (5 * 3) / 2 = 7,5.
      await servico.registrar(cs(), mm.itemLab, { valores: [{ analito: mm.analito, numero: 5 }] });
      expect(await valorDe(a.id)).toBe(7.5);
      expect(
        Number(
          (
            await um('SELECT COUNT(*) AS n FROM resultado_variavel_formula WHERE resultado_exame_id = ?', [
              r.resultado,
            ])
          )?.['n'],
        ),
      ).toBe(1);
    });
  },
);
