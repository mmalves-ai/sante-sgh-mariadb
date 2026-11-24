// Contrato de efeito do laboratório de apoio (F3.5, 05-SADT linha 14) no MariaDB real (cliente f22_o2; massa
// SINTÉTICA). Prova o que fica no banco: o de-para de analito e de material incluído, alterado e desativado (nunca
// apagado), com a recusa do código repetido e do fator inválido; a remessa aberta num clique com as amostras coletadas
// do apoio (a não coletada e a de outro apoio ficam fora), numerada pela sequência; o item sem código no apoio segura o
// fechamento; o item retirado fica cancelado; fechar, enviar com protocolo e meio coerente com o canal; o cancelamento
// recusado depois de enviada; as etiquetas só com identificadores; a trilha de cada gravação; outro estabelecimento
// recusado. Só contagens.
import { ErroOperacao, garantirSequencia, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoApoioRemessa, TIPO_NUMERO_REMESSA } from './apoio-remessa-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const falha = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'passou';
  } catch (e) {
    return codigoDe(e);
  }
};

describe.skipIf(SEM_BANCO)(
  'laboratório de apoio: de-para, remessa e etiqueta (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let servico: ServicoApoioRemessa;
    let m: MassaSadt | null = null;
    const ids = {
      lab: 0,
      outroLab: 0,
      material: 0,
      exameApoio: 0,
      a1: 0,
      a2: 0,
      a3: 0,
      a4: 0,
      item3: 0,
      item4: 0,
    };
    const ctxT = { cliente: CLIENTE, correlacao: 't-f354-apoio' };
    const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ctxT, (l) => l.uma(sql, p));
    const conta = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? -1);

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassaSadt(nucleo, 'F354A');
      servico = new ServicoApoioRemessa(nucleo);
      const agora = new Date();
      await nucleo.escrever(ctxT, async (e) => {
        const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
        const est = m!.base.est;
        const emp = await e.uma('SELECT MIN(id) AS id FROM empresa_fornecedora', []);
        ids.material = Number(
          (await e.uma("SELECT id FROM material_biologico WHERE codigo = 'SANGUE-T'", []))?.['id'],
        );
        const lab = (codigo: string, canal: string) =>
          ins(
            `INSERT INTO laboratorio_apoio (estabelecimento_id, codigo, nome, empresa_fornecedora_id, canal_envio, codigo_cliente_no_apoio, criado_em)
           VALUES (?, ?, 'APOIO SINTETICO', ?, ?, 'H01', ?)`,
            [est, codigo, Number(emp?.['id']), canal, agora],
          );
        ids.lab = await lab('t-f354-ap', 'manual');
        ids.outroLab = await lab('t-f354-ap2', 'servico_web');
        ids.exameApoio = await ins(
          `INSERT INTO exame_laboratorio_apoio (exame_id, laboratorio_apoio_id, codigo_exame_apoio, nome_exame_apoio, criado_em)
         VALUES (?, ?, 'GLI-T', 'GLICOSE APOIO SINTETICA', ?)`,
          [m!.exameLab, ids.lab, agora],
        );
        // Dois itens do laboratório (a massa) e dois a mais na mesma requisição: um sem código no apoio (exame de imagem
        // não tem de-para), um de outro apoio.
        const novoItem = (seq: number, exame: number, lab: number) =>
          ins(
            `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, laboratorio_apoio_id, situacao, criado_em, versao)
           VALUES (?, ?, ?, ?, 'coletado', ?, 1)`,
            [m!.requisicao, seq, exame, lab, agora],
          );
        ids.item3 = await novoItem(91, m!.exameImagem, ids.lab);
        ids.item4 = await novoItem(92, m!.exameLab, ids.outroLab);
        await e.executar('UPDATE exame_item SET laboratorio_apoio_id = ?, situacao = ? WHERE id IN (?, ?)', [
          ids.lab,
          'coletado',
          m!.itemLab,
          m!.itemLab2,
        ]);
        const amostra = (cod: string, coletada: boolean, item: number) =>
          ins(
            `INSERT INTO amostra_biologica (estabelecimento_id, codigo_barras, requisicao_exame_id, material_biologico_id, situacao, coletada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              est,
              cod,
              m!.requisicao,
              ids.material,
              coletada ? 'coletada' : 'aguardando_coleta',
              coletada ? agora : null,
              agora,
            ],
          ).then(async (a) => {
            await ins(
              'INSERT INTO amostra_biologica_exame (amostra_biologica_id, exame_item_id, criado_em) VALUES (?, ?, ?)',
              [a, item, agora],
            );
            return a;
          });
        ids.a1 = await amostra('TF354A1', true, m!.itemLab);
        ids.a2 = await amostra('TF354A2', false, m!.itemLab2);
        ids.a3 = await amostra('TF354A3', true, ids.item3);
        ids.a4 = await amostra('TF354A4', true, ids.item4);
        await garantirSequencia(
          e,
          { tipo: TIPO_NUMERO_REMESSA, estabelecimento: est, prefixo: 'RA-' },
          { agora, usuario: null },
        );
      });
    }, 120_000);

    afterAll(async () => {
      if (m) {
        await nucleo.escrever(ctxT, async (e) => {
          const x = (sql: string, p: unknown[]) => e.executar(sql, p);
          const labs = [ids.lab, ids.outroLab];
          await x(
            'DELETE i FROM remessa_laboratorio_apoio_item i JOIN remessa_laboratorio_apoio r ON r.id = i.remessa_laboratorio_apoio_id WHERE r.laboratorio_apoio_id IN (?, ?)',
            labs,
          );
          await x('DELETE FROM remessa_laboratorio_apoio WHERE laboratorio_apoio_id IN (?, ?)', labs);
          await x('DELETE FROM de_para_analito_apoio WHERE laboratorio_apoio_id IN (?, ?)', labs);
          await x('DELETE FROM de_para_material_apoio WHERE laboratorio_apoio_id IN (?, ?)', labs);
          await x('DELETE FROM exame_laboratorio_apoio WHERE laboratorio_apoio_id IN (?, ?)', labs);
          await x('DELETE FROM amostra_biologica_exame WHERE amostra_biologica_id IN (?, ?, ?, ?)', [
            ids.a1,
            ids.a2,
            ids.a3,
            ids.a4,
          ]);
          await x('DELETE FROM amostra_biologica WHERE id IN (?, ?, ?, ?)', [ids.a1, ids.a2, ids.a3, ids.a4]);
          await x(
            'UPDATE exame_item SET laboratorio_apoio_id = NULL WHERE laboratorio_apoio_id IN (?, ?)',
            labs,
          );
          await x('DELETE FROM laboratorio_apoio WHERE id IN (?, ?)', labs);
          await x('DELETE FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
            TIPO_NUMERO_REMESSA,
            m!.base.est,
          ]);
        });
      }
      await limparMassaSadt(nucleo, m);
      await nucleo.encerrar();
    }, 120_000);

    it('de-para de analito e de material: inclui, altera, desativa sem apagar e recusa o repetido', async () => {
      const c = contexto(m!);
      const trilha = (entidade: string, id: number) =>
        conta('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [
          entidade,
          id,
        ]);
      const base = {
        laboratorio: ids.lab,
        exame: m!.exameLab,
        analito: m!.analito,
        codigoExameApoio: 'GLI-T',
        codigoAnalitoApoio: 'GLU',
        fatorConversao: 0.0555,
      };
      const a = await servico.salvarDeParaAnalito(c, base);
      expect(await falha(servico.salvarDeParaAnalito(c, { ...base, codigoAnalitoApoio: 'GLU2' }))).toBe(
        'de-para-repetido',
      );
      expect(await falha(servico.salvarDeParaAnalito(c, { ...base, id: a.id, fatorConversao: 0 }))).toBe(
        'fator-invalido',
      );
      expect(
        await falha(servico.salvarDeParaAnalito(c, { ...base, id: a.id, codigoAnalitoApoio: 'G U' })),
      ).toBe('codigo-invalido');
      await servico.salvarDeParaAnalito(c, { ...base, id: a.id, codigoAnalitoApoio: 'GLU-S', ativo: false });
      const d = await um(
        'SELECT codigo_analito_apoio, ativo, versao, excluido_em FROM de_para_analito_apoio WHERE id = ?',
        [a.id],
      );
      expect([
        d?.['codigo_analito_apoio'],
        Number(d?.['ativo']),
        Number(d?.['versao']),
        d?.['excluido_em'],
      ]).toEqual(['GLU-S', 0, 2, null]);
      expect(await trilha('de_para_analito_apoio', a.id)).toBe(2);

      const mat = await servico.salvarDeParaMaterial(c, {
        laboratorio: ids.lab,
        material: ids.material,
        codigoApoio: 'SOR',
      });
      expect(
        await falha(
          servico.salvarDeParaMaterial(c, {
            laboratorio: ids.outroLab + 999999,
            material: ids.material,
            codigoApoio: 'X',
          }),
        ),
      ).toBe('laboratorio-inexistente');
      expect(await trilha('de_para_material_apoio', mat.id)).toBe(1);
      const lido = await servico.dePara(c, ids.lab);
      expect([
        lido.analitos.length,
        lido.materiais.length,
        lido.analitos[0]?.ativo,
        lido.materiais[0]?.codigoApoio,
      ]).toEqual([1, 1, false, 'SOR']);
      // Outro estabelecimento não enxerga o laboratório.
      expect(await falha(servico.dePara(contexto(m!, m!.base.outroEst), ids.lab))).toBe(
        'laboratorio-inexistente',
      );
    });

    it('remessa: abre com as pendentes, segura sem de-para, retira, fecha, envia e não cancela depois', async () => {
      const c = contexto(m!);
      const pend = await servico.pendentes(c, ids.lab);
      // A1 (coletada, do apoio) e A3 (coletada, do apoio, sem código); A2 não coletada e A4 de outro apoio ficam fora.
      expect(pend.map((p) => p.amostra).sort()).toEqual([ids.a1, ids.a3].sort());
      const r = await servico.abrir(c, { laboratorio: ids.lab });
      expect([r.itens, r.semDePara, r.numero.startsWith('RA-')]).toEqual([2, 1, true]);
      expect(await falha(servico.abrir(c, { laboratorio: ids.lab, amostras: [ids.a2] }))).toBe(
        'amostra-nao-coletada',
      );
      expect(await falha(servico.abrir(c, { laboratorio: ids.lab, amostras: [ids.a1] }))).toBe(
        'amostra-em-remessa',
      );
      expect(await falha(servico.abrir(c, { laboratorio: ids.lab, amostras: [ids.a4] }))).toBe(
        'exame-de-outro-apoio',
      );
      expect(await falha(servico.agir(c, r.id, { acao: 'fechar' }))).toBe('remessa-sem-de-para');
      const lida = await servico.remessa(c, r.id);
      const semCodigo = lida.itens.find((i) => i.codigoExameApoio === null)!;
      await servico.retirarItem(c, r.id, { item: semCodigo.id });
      const itemRetirado = await um(
        'SELECT situacao, excluido_em FROM remessa_laboratorio_apoio_item WHERE id = ?',
        [semCodigo.id],
      );
      expect([itemRetirado?.['situacao'], itemRetirado?.['excluido_em']]).toEqual(['cancelado', null]);
      expect(await servico.agir(c, r.id, { acao: 'fechar' })).toEqual({ id: r.id, situacao: 'fechada' });
      expect(await falha(servico.agir(c, r.id, { acao: 'enviar', meio: 'integracao' }))).toBe(
        'meio-incompativel',
      );
      const etiquetas = await servico.etiquetas(c, r.id);
      expect(etiquetas.map((e) => e.codigo)).toEqual([`H01-${r.numero}-001`]);
      expect(etiquetas[0]!.linhas.join(' ')).toContain('Material SOR');
      await servico.agir(c, r.id, { acao: 'enviar', meio: 'portal', protocolo: 'P-123', temperaturaC: 4 });
      expect(await falha(servico.agir(c, r.id, { acao: 'cancelar', motivo: 'Desistência do envio' }))).toBe(
        'remessa-ja-enviada',
      );
      const g = await um(
        `SELECT situacao, protocolo_apoio, meio_envio, quantidade_amostras, enviada_em IS NOT NULL AS enviada, fechada_em IS NOT NULL AS fechada
         FROM remessa_laboratorio_apoio WHERE id = ?`,
        [r.id],
      );
      expect([
        g?.['situacao'],
        g?.['protocolo_apoio'],
        g?.['meio_envio'],
        Number(g?.['quantidade_amostras']),
        Number(g?.['enviada']),
        Number(g?.['fechada']),
      ]).toEqual(['enviada', 'P-123', 'portal', 1, 1, 1]);
      // Trilha: abrir, fechar e enviar na remessa; a retirada no item.
      expect(
        await conta(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'remessa_laboratorio_apoio' AND entidade_id = ?",
          [r.id],
        ),
      ).toBe(3);
      // A amostra retirada volta às pendentes; a nova remessa cancelada guarda o motivo e cancela os itens.
      const r2 = await servico.abrir(c, { laboratorio: ids.lab });
      expect(r2.itens).toBe(1);
      expect(await falha(servico.agir(c, r2.id, { acao: 'cancelar', motivo: '' }))).toBe(
        'motivo-obrigatorio',
      );
      await servico.agir(c, r2.id, { acao: 'cancelar', motivo: 'Exame passa a ser feito no hospital' });
      expect(
        await conta(
          "SELECT COUNT(*) AS n FROM remessa_laboratorio_apoio_item WHERE remessa_laboratorio_apoio_id = ? AND situacao = 'cancelado'",
          [r2.id],
        ),
      ).toBe(1);
      expect(await falha(servico.remessa(contexto(m!, m!.base.outroEst), r.id))).toBe('remessa-inexistente');
      expect((await servico.remessas(c, ids.lab)).length).toBe(2);
    });
  },
);
