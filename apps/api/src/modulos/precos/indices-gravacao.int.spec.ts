// Contrato de efeito do índice de cobrança e do porte (06-FAT linha 5) contra o MariaDB real. Massa SINTÉTICA com
// códigos "C220" (nenhum dado real). Prova o que fica no banco e o que o motor lê dele:
//   - preco.registrar-indice / -porte / -porte-anestesico gravam uma vigência NOVA (a anterior fica; nada se altera
//     nem se apaga), com trilha; a mesma data de início e a tabela fora do acordo recusam;
//   - o total do item no modelo CH e PORTE pelo ServicoPrecos sai de valor_indice × quantidade (nunca da soma da
//     vigência do valor), com o porte anestésico do acordo no regime da conta (e em horário especial);
//   - o índice do setor executante (valor_indice_setor) e o do procedimento (valor_indice_item) entram com
//     precedência procedimento > setor > acordo; o do setor cai junto com o valor do índice substituído.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { CtxPrecos } from './fonte.js';
import { FontePrecosPropria } from './fonte-propria.js';
import { GravadorIndices } from './indices-gravacao.js';
import { ServicoPrecos } from './servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C220';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)(
  'índice de cobrança e porte: gravação por vigência e total pelo índice (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let gravador: GravadorIndices;
    let servico: ServicoPrecos;
    const ids = {
      est: 0,
      usuario: 0,
      fonte: 0,
      tabela: 0,
      tabelaFora: 0,
      contrato: 0,
      grupo: 0,
      itemCh: 0,
      itemPorte: 0,
      ppCh: 0,
      ppPorte: 0,
      ch: 0,
      porte: 0,
      setor: 0,
      vCh2025: 0,
    };
    let c: CtxPrecos;

    const ctx = (): ContextoOperacao =>
      ({
        cliente: CLIENTE,
        estabelecimento: ids.est,
        usuario: ids.usuario,
        correlacao: 'teste-c220',
        chaveIdempotencia: `c220-${randomUUID()}`,
      }) as ContextoOperacao;

    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, estabelecimento: ids.est, usuario: null, correlacao: 't' }, (l) =>
        l.consultar<T>(sql, p),
      );

    const limpar = async (e: Escritor) => {
      await e.executar(
        'DELETE s FROM valor_indice_setor s JOIN valor_indice v ON v.id = s.valor_indice_id WHERE v.fonte_pagadora_id = ?',
        [ids.fonte],
      );
      await e.executar('DELETE FROM valor_indice_item WHERE fonte_pagadora_id = ?', [ids.fonte]);
      await e.executar('DELETE FROM valor_indice WHERE fonte_pagadora_id = ? OR tabela_preco_id IN (?, ?)', [
        ids.fonte,
        ids.tabela,
        ids.tabelaFora,
      ]);
      await e.executar('DELETE FROM valor_porte_medico WHERE fonte_pagadora_id = ? OR tabela_preco_id = ?', [
        ids.fonte,
        ids.tabela,
      ]);
      await e.executar('DELETE FROM valor_porte_anestesico WHERE tabela_preco_id IN (?, ?)', [
        ids.tabela,
        ids.tabelaFora,
      ]);
      await e.executar(
        'DELETE v FROM preco_procedimento_valor v JOIN preco_procedimento pp ON pp.id = v.preco_procedimento_id WHERE pp.tabela_preco_id = ?',
        [ids.tabela],
      );
      await e.executar(
        'DELETE ctv FROM contrato_tabela_vigencia ctv JOIN contrato_fonte_pagadora k ON k.id = ctv.contrato_fonte_pagadora_id WHERE k.fonte_pagadora_id = ?',
        [ids.fonte],
      );
      await e.executar('DELETE FROM contrato_fonte_pagadora WHERE fonte_pagadora_id = ?', [ids.fonte]);
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-c220' }, async (e) => {
        const agora = new Date();
        ids.est = await garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [`${P}A`],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}A`, 'ESTAB C220 SINTETICO', 'ESTAB C220 SINTETICO', agora],
        );
        ids.usuario = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [`${P}.indices`],
          "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
          [`${P}.indices`, 'USUARIO C220 SINTETICO', agora],
        );
        const classe = await garantir(
          e,
          'SELECT id FROM classe_fonte_pagadora WHERE codigo = ?',
          [`${P}-CONV`],
          "INSERT INTO classe_fonte_pagadora (codigo, descricao, natureza, criado_em) VALUES (?, 'CONVENIO C220', 'convenio', ?)",
          [`${P}-CONV`, agora],
        );
        ids.fonte = await garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [`${P}-A`],
          `INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, classe_fonte_pagadora_id, dias_retorno, criado_em)
           VALUES (?, 'OPERADORA C220 SINTETICA', 'operadora', 'ativa', ?, 30, ?)`,
          [`${P}-A`, classe, agora],
        );
        await garantir(
          e,
          'SELECT id FROM fonte_pagadora_estabelecimento WHERE fonte_pagadora_id = ? AND estabelecimento_id = ?',
          [ids.fonte, ids.est],
          "INSERT INTO fonte_pagadora_estabelecimento (fonte_pagadora_id, estabelecimento_id, situacao, criado_em) VALUES (?, ?, 'ativa', ?)",
          [ids.fonte, ids.est, agora],
        );
        const tabela = (codigo: string) =>
          garantir(
            e,
            'SELECT id FROM tabela_preco WHERE estabelecimento_id = ? AND codigo = ?',
            [ids.est, codigo],
            `INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, moeda_calculo, situacao, criado_em)
             VALUES (?, ?, ?, 'honorario', 'propria', 'real', 'ativa', ?)`,
            [ids.est, codigo, `HONORARIOS ${codigo}`, agora],
          );
        ids.tabela = await tabela(`${P}-HON`);
        ids.tabelaFora = await tabela(`${P}-FORA`);
        ids.grupo = await garantir(
          e,
          'SELECT id FROM grupo_faturamento WHERE codigo = ?',
          [`${P}-GF`],
          "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'HONORARIOS C220', 'honorario', ?)",
          [`${P}-GF`, agora],
        );
        const item = (codigo: string, porteAnestesico: number | null) =>
          garantir(
            e,
            'SELECT id FROM item_faturavel WHERE codigo = ?',
            [codigo],
            `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, porte_anestesico, criado_em)
             VALUES (?, ?, 'procedimento', ?, ?, ?)`,
            [codigo, `PROCEDIMENTO ${codigo} SINTETICO`, ids.grupo, porteAnestesico, agora],
          );
        ids.itemCh = await item(`${P}-CH1`, 1);
        ids.itemPorte = await item(`${P}-PT1`, null);
        ids.ch = await garantir(
          e,
          'SELECT id FROM indice_cobranca WHERE codigo = ?',
          [`${P}-CH`],
          "INSERT INTO indice_cobranca (codigo, descricao, tipo_indice, ativo, criado_em) VALUES (?, 'CH C220', 'coeficiente_honorario', TRUE, ?)",
          [`${P}-CH`, agora],
        );
        ids.porte = await garantir(
          e,
          'SELECT id FROM porte_procedimento WHERE codigo = ?',
          [`${P}3A`],
          "INSERT INTO porte_procedimento (codigo, descricao, tipo_porte, ordem, criado_em) VALUES (?, 'PORTE C220 3A', 'honorario', 9, ?)",
          [`${P}3A`, agora],
        );
        ids.setor = await garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}-CC`],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'CENTRO CIRURGICO C220', 'assistencial', ?)",
          [ids.est, `${P}-CC`, agora],
        );
        ids.ppCh = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids.tabela, ids.itemCh],
          `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, quantidade_indice, criado_em)
           VALUES (?, 1, ?, 'indice', 100, ?)`,
          [ids.tabela, ids.itemCh, agora],
        );
        ids.ppPorte = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids.tabela, ids.itemPorte],
          `INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, porte_procedimento_id, criado_em)
           VALUES (?, 2, ?, 'porte', ?, ?)`,
          [ids.tabela, ids.itemPorte, ids.porte, agora],
        );
        await limparTrilhaDaMassa(e, { ids: [ids.est] });
        await limpar(e);
        // Vigência do valor do item CH (999 no honorário): nunca pode ser o total do modelo CH.
        await e.inserir(
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, ocorrido_em, vigencia_inicio, valor_honorario,
           valor_custo_operacional, valor_filme, valor_anestesia, valor_outros, valor_total, criado_em)
         VALUES (?, ?, '2025-01-01', 999, 0, 0, 0, 0, 999, ?)`,
          [ids.ppCh, agora, agora],
        );
        ids.contrato = await e.inserir(
          `INSERT INTO contrato_fonte_pagadora (estabelecimento_id, fonte_pagadora_id, numero, descricao, vigencia_inicio,
           situacao, prazo_apresentacao_dias, criado_em) VALUES (?, ?, ?, 'ACORDO C220', '2025-01-01', 'vigente', 60, ?)`,
          [ids.est, ids.fonte, `${P}-1`, agora],
        );
        await e.inserir(
          `INSERT INTO contrato_tabela_vigencia (contrato_fonte_pagadora_id, tipo_item, tabela_preco_id, vigencia_inicio, criado_em)
           VALUES (?, 'honorario_internacao', ?, '2025-01-01', ?)`,
          [ids.contrato, ids.tabela, agora],
        );
      });
      c = {
        cliente: CLIENTE,
        estabelecimento: ids.est,
        usuario: ids.usuario,
        correlacao: 'teste-c220',
        rede: 'teste',
        hospital: P,
        traceId: 'teste-c220',
      } as CtxPrecos;
      gravador = new GravadorIndices(nucleo);
      servico = new ServicoPrecos(new FontePrecosPropria(nucleo), null);
    });

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-c220' }, async (e) => {
        await limparTrilhaDaMassa(e, { ids: [ids.est] });
        await limpar(e);
      });
      await nucleo.encerrar();
    });

    const valor = (data: string, extra: Record<string, unknown> = {}, item = ids.ppCh) =>
      servico.valorVigente(c, {
        convenio: ids.fonte,
        tipo: 'honorario',
        conta: 'internacao',
        item,
        data,
        ...extra,
      });

    it('registra índice, porte e porte anestésico como vigência nova; a anterior fica; mesma data e tabela fora recusam', async () => {
      const a = await gravador.gravar('indice', ctx(), {
        fonteId: ids.fonte,
        indiceId: ids.ch,
        vigenciaInicio: '2025-01-01',
        valor: 0.5,
      });
      ids.vCh2025 = a.id;
      await gravador.gravar('indice', ctx(), {
        fonteId: ids.fonte,
        indiceId: ids.ch,
        vigenciaInicio: '2026-03-01',
        valor: 0.55,
      });
      await gravador.gravar('porte', ctx(), {
        fonteId: ids.fonte,
        porte: `${P}3A`,
        vigenciaInicio: '2025-01-01',
        valor: 210,
      });
      await gravador.gravar('porte-anestesico', ctx(), {
        fonteId: ids.fonte,
        tabelaId: ids.tabela,
        porte: '1',
        vigenciaInicio: '2025-01-01',
        valor: 150,
        valorHorarioEspecial: 195,
      });
      await expect(
        gravador.gravar('indice', ctx(), {
          fonteId: ids.fonte,
          indiceId: ids.ch,
          vigenciaInicio: '2026-03-01',
          valor: 0.6,
        }),
      ).rejects.toMatchObject({ problema: { codigo: 'entrada-invalida' } });
      await expect(
        gravador.gravar('porte-anestesico', ctx(), {
          fonteId: ids.fonte,
          tabelaId: ids.tabelaFora,
          porte: '1',
          vigenciaInicio: '2025-01-01',
          valor: 10,
        }),
      ).rejects.toMatchObject({ problema: { codigo: 'referencia-inexistente' } });
      await expect(
        gravador.gravar('porte-anestesico', ctx(), {
          fonteId: ids.fonte,
          tabelaId: ids.tabela,
          porte: '2',
          vigenciaInicio: '2025-01-01',
          valor: 100,
          valorHorarioEspecial: 90,
        }),
      ).rejects.toMatchObject({ problema: { codigo: 'entrada-invalida' } });
      const linhas = await ler(
        `SELECT vigencia_inicio, valor_indice, operacao, usuario_id, criado_por, fonte_pagadora_id, tabela_preco_id
         FROM valor_indice WHERE indice_cobranca_id = ? AND fonte_pagadora_id = ? ORDER BY vigencia_inicio`,
        [ids.ch, ids.fonte],
      );
      expect(linhas.map((r) => [Number(r['valor_indice']), r['operacao'], r['tabela_preco_id']])).toEqual([
        [0.5, 'inclusao', null],
        [0.55, 'inclusao', null],
      ]);
      expect(
        linhas.every(
          (r) => Number(r['usuario_id']) === ids.usuario && Number(r['criado_por']) === ids.usuario,
        ),
      ).toBe(true);
      const pa = await ler(
        'SELECT valor, valor_horario_especial FROM valor_porte_anestesico WHERE tabela_preco_id = ?',
        [ids.tabela],
      );
      expect(pa.map((r) => [Number(r['valor']), Number(r['valor_horario_especial'])])).toEqual([[150, 195]]);
      const pm = await ler(
        'SELECT valor FROM valor_porte_medico WHERE fonte_pagadora_id = ? AND porte_procedimento_id = ?',
        [ids.fonte, ids.porte],
      );
      expect(pm.map((r) => Number(r['valor']))).toEqual([210]);
      const trilha = await ler<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
        [ids.est, ids.usuario],
      );
      expect(Number(trilha[0]?.n)).toBe(4);
    });

    it('modelo CH: o total sai de valor_indice × quantidade com o porte anestésico do regime, nunca da vigência', async () => {
      const em2025 = await valor('2025-06-01');
      expect(em2025).toMatchObject({
        modelo: 'CH',
        origemTotal: 'indice',
        total: 0.5 * 100 + 150,
        falta: [],
      });
      expect(em2025?.valores?.ch).toBe(999);
      // A vigência nova do índice (registrada pela operação) já vale no motor.
      expect((await valor('2026-04-01'))?.total).toBe(0.55 * 100 + 150);
      // Horário especial: o porte anestésico pelo valor do horário especial.
      expect((await valor('2025-06-01', { horarioEspecial: true }))?.total).toBe(0.5 * 100 + 195);
      // Antes do acordo: falta o CH; o total é nulo (nunca os 999 da vigência).
      const antes = await valor('2024-06-01');
      expect(antes).toMatchObject({ total: null, origemTotal: null });
      expect(antes?.falta).toContain('valor do CH do convênio na data');
    });

    it('modelo PORTE: o total é o valor do porte do acordo na data', async () => {
      expect(await valor('2025-06-01', {}, ids.ppPorte)).toMatchObject({
        modelo: 'PORTE',
        origemTotal: 'indice',
        total: 210,
      });
    });

    it('índice do setor e do procedimento: procedimento > setor > acordo; o do setor cai com o índice substituído', async () => {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-c220-setor' }, async (e) => {
        const agora = new Date();
        await e.inserir(
          `INSERT INTO valor_indice_setor (valor_indice_id, setor_funcional_id, valor_honorario, ativo, criado_em)
           VALUES (?, ?, 0.7, TRUE, ?)`,
          [ids.vCh2025, ids.setor, agora],
        );
        await e.inserir(
          `INSERT INTO valor_indice_item (fonte_pagadora_id, item_faturavel_id, indice_cobranca_id, vigencia_inicio,
           valor_indice, ativo, criado_em) VALUES (?, ?, NULL, '2026-05-01', 0.9, TRUE, ?)`,
          [ids.fonte, ids.itemCh, agora],
        );
      });
      const setor = await valor('2025-06-01', { setor: ids.setor });
      expect(setor?.total).toBe(0.7 * 100 + 150);
      expect(setor?.passos.join(' ')).toMatch(/setor executante/);
      // Sem o setor, o do acordo.
      expect((await valor('2025-06-01'))?.total).toBe(0.5 * 100 + 150);
      // 2026-04: o valor do índice de 2025 foi substituído pelo de 2026-03; o diferenciado do setor cai junto.
      expect((await valor('2026-04-01', { setor: ids.setor }))?.total).toBe(0.55 * 100 + 150);
      // 2026-06: o do procedimento vence o do setor e o do acordo.
      const item = await valor('2026-06-01', { setor: ids.setor });
      expect(item?.total).toBe(0.9 * 100 + 150);
      expect(item?.passos.join(' ')).toMatch(/do procedimento/);
    });
  },
);
