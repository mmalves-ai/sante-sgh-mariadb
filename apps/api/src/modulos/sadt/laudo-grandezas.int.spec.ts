// Contrato de efeito do cadastro do laudo estruturado e da medida calculada (F3.5, 05-SADT linha 17) no MariaDB real
// (cliente f22_o2; massa SINTÉTICA). Prova o que fica no banco: a seção, as medidas e a faixa gravadas pela porta com a
// trilha; as recusas (código repetido, código inválido, faixa do mesmo recorte no mesmo período, fórmula que usa a
// própria medida, de outro exame ou em ciclo, medida usada em fórmula que não inativa) sem gravar nada; a fórmula da
// medida calculada com as variáveis; o laudo que grava a medida calculada pela conta (o digitado nela é ignorado), com
// a marca de calculada e a de fora da referência; a conta refeita quando a medida de origem muda (mesma linha); a
// calculada que deixa de poder ser calculada marcada como excluída, nunca apagada; a obrigatória calculada que barra a
// assinatura; a nova versão da fórmula que encerra a anterior na véspera. Só contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoLaudoRedacao } from './aplicacao/laudo-redacao.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import type { ContextoCatalogo } from './catalogo-porta-propria.js';
import { PortaGrandezasLaudoPropria } from './laudo-grandezas-propria.js';

const falha = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'passou';
  } catch (e) {
    return e instanceof ErroOperacao
      ? `${String(e.problema['codigo'] ?? '')}: ${e.problema.detail}`
      : String(e);
  }
};

describe.skipIf(SEM_BANCO)(
  'cadastro do laudo estruturado e medida calculada (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaGrandezasLaudoPropria;
    let servico: ServicoLaudoRedacao;
    let m: MassaSadt | null = null;
    const ctxT = { cliente: CLIENTE, correlacao: 't-f3510' };
    const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ctxT, (l) => l.uma(sql, p));
    const todos = (sql: string, p: unknown[]) => nucleo.lerSomente(ctxT, (l) => l.consultar(sql, p));
    const conta = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n']);
    let k = 0;
    const c = (): ContextoCatalogo => ({
      cliente: CLIENTE,
      estabelecimento: m!.base.est,
      usuario: m!.base.usuario,
      correlacao: 't-f3510',
      chaveIdempotencia: `t-f3510-${m!.marca}-${++k}`,
    });

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassaSadt(nucleo, 'F351');
      porta = new PortaGrandezasLaudoPropria(nucleo);
      servico = new ServicoLaudoRedacao(nucleo);
    }, 60_000);

    afterAll(async () => {
      if (m) {
        await nucleo.escrever(ctxT, async (e) => {
          const x = (sql: string) => e.executar(sql, [m!.exameImagem]);
          const gs = '(SELECT id FROM grandeza_laudo WHERE exame_id = ?)';
          const laudos = `(SELECT id FROM laudo_diagnostico WHERE exame_item_id = ${Number(m!.itemImagem)})`;
          await e.executar(`DELETE FROM valor_grandeza_laudo WHERE laudo_diagnostico_id IN ${laudos}`, []);
          await e.executar(
            `DELETE FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id IN ${laudos}`,
            [],
          );
          await e.executar('DELETE FROM laudo_diagnostico WHERE exame_item_id = ?', [m!.itemImagem]);
          await x(
            `DELETE FROM variavel_formula WHERE formula_calculo_id IN (SELECT id FROM formula_calculo WHERE grandeza_laudo_id IN ${gs})`,
          );
          await x(`DELETE FROM formula_calculo WHERE grandeza_laudo_id IN ${gs}`);
          await x(`DELETE FROM faixa_referencia_grandeza WHERE grandeza_laudo_id IN ${gs}`);
          await x('DELETE FROM grandeza_laudo WHERE exame_id = ?');
          await x('DELETE FROM secao_laudo_estruturado WHERE exame_id = ?');
        });
      }
      await limparMassaSadt(nucleo, m);
      await nucleo.encerrar();
    }, 60_000);

    it('seção, medidas, faixa e fórmula pelo cadastro; o laudo grava a medida calculada pela conta', async () => {
      const exame = m!.exameImagem;
      const item = m!.itemImagem;
      const trilha = (entidade: string, id: number) =>
        conta('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [
          entidade,
          id,
        ]);

      // Seção: gravada com a trilha; o código repetido no exame é recusado sem gravar.
      const secao = await porta.salvarSecao(c(), {
        exameId: exame,
        codigo: 'VE',
        nome: 'Ventrículo esquerdo',
      });
      expect(
        await um('SELECT nome, ordem, ativo FROM secao_laudo_estruturado WHERE id = ?', [secao.id]),
      ).toEqual({
        nome: 'Ventrículo esquerdo',
        ordem: 1,
        ativo: 1,
      });
      expect(await trilha('secao_laudo_estruturado', secao.id)).toBe(1);
      expect(await falha(porta.salvarSecao(c(), { exameId: exame, codigo: 'VE', nome: 'Outra' }))).toContain(
        'regra-catalogo',
      );
      expect(
        await conta('SELECT COUNT(*) AS n FROM secao_laudo_estruturado WHERE exame_id = ?', [exame]),
      ).toBe(1);

      // Medidas: duas digitadas e duas calculadas (a fração de encurtamento é obrigatória na assinatura).
      const g = (codigo: string, descricao: string, ordem: number, extra: Record<string, unknown> = {}) =>
        porta.salvarGrandeza(c(), {
          exameId: exame,
          secaoLaudoEstruturadoId: secao.id,
          codigo,
          descricao,
          ordem,
          casasDecimais: 1,
          ...extra,
        });
      const dd = await g('ddve', 'Diâmetro diastólico do VE', 1);
      const ds = await g('dsve', 'Diâmetro sistólico do VE', 2);
      const fenc = await g('fenc', 'Fração de encurtamento', 3, { calculada: true, obrigatoria: true });
      const ifenc = await g('ifenc', 'Encurtamento indexado', 4, { calculada: true, casasDecimais: 2 });
      expect(await falha(g('1 cod', 'Código inválido', 5))).toContain('regra-catalogo');
      expect(await falha(g('ddve', 'Código repetido', 5))).toContain('regra-catalogo');
      expect(
        await todos(
          'SELECT codigo, calculada, obrigatoria, secao_laudo_estruturado_id AS s FROM grandeza_laudo WHERE exame_id = ? ORDER BY ordem',
          [exame],
        ),
      ).toEqual([
        { codigo: 'ddve', calculada: 0, obrigatoria: 0, s: secao.id },
        { codigo: 'dsve', calculada: 0, obrigatoria: 0, s: secao.id },
        { codigo: 'fenc', calculada: 1, obrigatoria: 1, s: secao.id },
        { codigo: 'ifenc', calculada: 1, obrigatoria: 0, s: secao.id },
      ]);
      expect(await trilha('grandeza_laudo', fenc.id)).toBe(1);
      // A seção com medidas ativas não inativa.
      expect(
        await falha(
          porta.salvarSecao(c(), { id: secao.id, versao: secao.versao, exameId: exame, ativo: false }),
        ),
      ).toContain('medidas ativas');

      // Faixa da fração de encurtamento (25 a 45); outra do mesmo recorte no mesmo período é recusada; a alteração
      // (só o enviado, com a versão vista) encerra a vigência e então a nova entra.
      const faixa = await porta.salvarFaixa(c(), {
        grandezaLaudoId: fenc.id,
        referenciaMinima: 25,
        referenciaMaxima: 45,
        vigenciaInicio: '2020-01-01',
      });
      expect(await trilha('faixa_referencia_grandeza', faixa.id)).toBe(1);
      const outraFaixa = {
        grandezaLaudoId: fenc.id,
        referenciaMinima: 28,
        referenciaMaxima: 44,
        vigenciaInicio: '2030-01-01',
      };
      expect(await falha(porta.salvarFaixa(c(), outraFaixa))).toContain('mesmo recorte');
      expect(
        await falha(
          porta.salvarFaixa(c(), { ...outraFaixa, vigenciaInicio: '2031-01-01', referenciaMinima: 50 }),
        ),
      ).toContain('menor que o mínimo');
      expect(
        await conta('SELECT COUNT(*) AS n FROM faixa_referencia_grandeza WHERE grandeza_laudo_id = ?', [
          fenc.id,
        ]),
      ).toBe(1);
      const encerrada = await porta.salvarFaixa(c(), {
        id: faixa.id,
        versao: faixa.versao,
        vigenciaFim: '2029-12-31',
      });
      expect(encerrada.versao).toBe(2);
      await porta.salvarFaixa(c(), outraFaixa);
      expect(
        (
          await todos(
            'SELECT referencia_minima AS mi, vigencia_fim IS NULL AS aberta FROM faixa_referencia_grandeza WHERE grandeza_laudo_id = ? ORDER BY vigencia_inicio',
            [fenc.id],
          )
        ).map((x) => [Number(x['mi']), Number(x['aberta'])]),
      ).toEqual([
        [25, 0],
        [28, 1],
      ]);

      // Fórmulas: a recusada não grava nada; a aceita grava a fórmula e as variáveis com a trilha.
      const hoje = String((await um("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS d", []))?.['d']);
      const formula = (expressao: string, variaveis: unknown[], vigenciaInicio = hoje) => ({
        descricao: 'Fórmula de teste',
        expressao,
        vigenciaInicio,
        variaveis,
      });
      const vg = (identificador: string, grandezaLaudoId: number) => ({
        identificador,
        descricao: identificador,
        fonte: 'grandeza',
        grandezaLaudoId,
      });
      expect(await falha(porta.novaFormula(c(), dd.id, formula('x * 2', [vg('x', ds.id)])))).toContain(
        'calculada leva fórmula',
      );
      expect(await falha(porta.novaFormula(c(), fenc.id, formula('x * 2', [vg('x', fenc.id)])))).toContain(
        'própria medida',
      );
      expect(
        await falha(porta.novaFormula(c(), fenc.id, formula('x * 2', [vg('x', 999_999_999)]))),
      ).toContain('não é deste exame');
      expect(
        await falha(porta.novaFormula(c(), fenc.id, formula('x * 2', [vg('x', ds.id)], '2020-01-01'))),
      ).toContain('não vale para trás');
      expect(
        await conta(
          'SELECT COUNT(*) AS n FROM formula_calculo fc JOIN grandeza_laudo g ON g.id = fc.grandeza_laudo_id WHERE g.exame_id = ?',
          [exame],
        ),
      ).toBe(0);
      const f1 = await porta.novaFormula(
        c(),
        fenc.id,
        formula('(dd - ds) / dd * 100', [vg('dd', dd.id), vg('ds', ds.id)]),
      );
      const f2 = await porta.novaFormula(
        c(),
        ifenc.id,
        formula('fe / sc', [
          vg('fe', fenc.id),
          {
            identificador: 'sc',
            descricao: 'Superfície',
            fonte: 'dado_paciente',
            dadoPaciente: 'superficie_corporal',
          },
        ]),
      );
      expect(
        await um('SELECT alvo, exame_analito_id AS ea FROM formula_calculo WHERE id = ?', [f1.id]),
      ).toEqual({
        alvo: 'grandeza',
        ea: null,
      });
      expect(
        await todos(
          'SELECT identificador AS i, fonte, grandeza_laudo_id AS g, dado_paciente AS d FROM variavel_formula WHERE formula_calculo_id = ? ORDER BY sequencia',
          [f2.id],
        ),
      ).toEqual([
        { i: 'fe', fonte: 'grandeza', g: fenc.id, d: null },
        { i: 'sc', fonte: 'dado_paciente', g: null, d: 'superficie_corporal' },
      ]);
      expect(await trilha('formula_calculo', f1.id)).toBe(1);
      // Ciclo: a fração de encurtamento não pode passar a depender do índice que depende dela.
      expect(
        await falha(porta.novaFormula(c(), fenc.id, formula('x * 2', [vg('x', ifenc.id)], '2031-01-01'))),
      ).toContain('dependendo uma da outra');
      // A medida usada na fórmula de outra não inativa.
      expect(
        await falha(
          porta.salvarGrandeza(c(), { id: dd.id, versao: dd.versao, exameId: exame, ativo: false }),
        ),
      ).toContain('fórmula de outra medida');
      expect(await um('SELECT ativo FROM grandeza_laudo WHERE id = ?', [dd.id])).toEqual({ ativo: 1 });

      // A leitura da manutenção traz tudo do exame.
      const lido = await porta.laudoEstruturado(c(), exame);
      expect(lido.secoes).toHaveLength(1);
      expect(lido.grandezas.map((x) => [x.faixas.length, x.formulas.length])).toEqual([
        [0, 0],
        [0, 0],
        [2, 1],
        [0, 1],
      ]);

      // O exame foi realizado hoje: as fórmulas (que não valem para trás) estão em vigor na data do exame.
      await nucleo.escrever(ctxT, (e) =>
        e.executar(
          "UPDATE exame_item SET situacao = 'em_analise', realizado_em = CURRENT_TIMESTAMP WHERE id = ?",
          [item],
        ),
      );
      // A massa é sintética: a vigência recua para a conta não depender do fuso do estabelecimento perto da meia-noite.
      await nucleo.escrever(ctxT, (e) =>
        e.executar("UPDATE formula_calculo SET vigencia_inicio = '2020-01-01' WHERE id IN (?, ?)", [
          f1.id,
          f2.id,
        ]),
      );
      const cs = contexto(m!);
      const aberto = await servico.abrir(cs, item);
      expect(aberto.formulas.map((f) => f.grandeza).sort((a, b) => a - b)).toEqual([fenc.id, ifenc.id]);

      // Rascunho: 50 e 30 dão 40% (o 99 digitado na calculada é ignorado); 80 kg e 180 cm dão 2 m², índice 20.
      const medidas = (laudo: number) =>
        todos(
          `SELECT grandeza_laudo_id AS g, valor_numerico AS v, calculado AS calc, fora_referencia AS fora,
                excluido_em IS NOT NULL AS excl
           FROM valor_grandeza_laudo WHERE laudo_diagnostico_id = ? ORDER BY grandeza_laudo_id`,
          [laudo],
        ).then((ls) => ls.map((x) => [x['g'], Number(x['v']), x['calc'], x['fora'], x['excl']]));
      const r = await servico.salvar(cs, item, {
        texto: 'Rascunho com medidas.',
        pesoKg: 80,
        alturaCm: 180,
        valores: [
          { grandeza: dd.id, numero: 50 },
          { grandeza: ds.id, numero: 30 },
          { grandeza: fenc.id, numero: 99 },
        ],
      });
      expect(r).toMatchObject({ situacao: 'rascunho', valores: 4, foraReferencia: 0 });
      expect(await medidas(r.id)).toEqual([
        [dd.id, 50, 0, 0, 0],
        [ds.id, 30, 0, 0, 0],
        [fenc.id, 40, 1, 0, 0],
        [ifenc.id, 20, 1, 0, 0],
      ]);

      // A medida de origem muda: a conta é refeita na mesma linha (80% fica fora de 25–45) e nada é duplicado.
      const r2 = await servico.salvar(cs, item, {
        texto: 'Rascunho com medidas.',
        pesoKg: 80,
        alturaCm: 180,
        valores: [
          { grandeza: dd.id, numero: 50 },
          { grandeza: ds.id, numero: 10 },
        ],
      });
      expect(r2).toMatchObject({ valores: 4, foraReferencia: 1 });
      expect(await medidas(r.id)).toEqual([
        [dd.id, 50, 0, 0, 0],
        [ds.id, 10, 0, 0, 0],
        [fenc.id, 80, 1, 1, 0],
        [ifenc.id, 40, 1, 0, 0],
      ]);

      // Sem o diâmetro sistólico não há conta: as calculadas ficam marcadas como excluídas (nunca apagadas) e a
      // obrigatória barra a assinatura sem gravar versão.
      const r3 = await servico.salvar(cs, item, {
        texto: 'Rascunho com medidas.',
        pesoKg: 80,
        alturaCm: 180,
        valores: [{ grandeza: dd.id, numero: 50 }],
      });
      expect(r3.valores).toBe(1);
      expect((await medidas(r.id)).map((x) => [x[0], x[4]])).toEqual([
        [dd.id, 0],
        [ds.id, 1],
        [fenc.id, 1],
        [ifenc.id, 1],
      ]);
      expect(
        await falha(
          servico.assinar(cs, item, {
            texto: 'Laudo de teste completo.',
            pesoKg: 80,
            alturaCm: 180,
            valores: [{ grandeza: dd.id, numero: 50 }],
          }),
        ),
      ).toContain('grandeza-obrigatoria');
      expect(
        await conta('SELECT COUNT(*) AS n FROM laudo_diagnostico_versao WHERE laudo_diagnostico_id = ?', [
          r.id,
        ]),
      ).toBe(0);

      // Nova versão da fórmula: a anterior é encerrada na véspera do início da nova; as duas ficam no banco.
      const f3 = await porta.novaFormula(
        c(),
        fenc.id,
        formula('(dd - ds) / dd', [vg('dd', dd.id), vg('ds', ds.id)], '2031-01-01'),
      );
      expect(f3.encerradas).toEqual([f1.id]);
      expect(
        (
          await todos(
            "SELECT id, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim FROM formula_calculo WHERE grandeza_laudo_id = ? ORDER BY vigencia_inicio",
            [fenc.id],
          )
        ).map((x) => [x['id'], x['fim']]),
      ).toEqual([
        [f1.id, '2030-12-31'],
        [f3.id, null],
      ]);
    }, 120_000);
  },
);
