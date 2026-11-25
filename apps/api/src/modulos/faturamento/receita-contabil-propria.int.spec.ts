// Contrato de efeito da receita contábil do faturamento (F3.7, 06-FAT linha 37) contra o MariaDB real. Massa SINTÉTICA
// com códigos "C2103" (nenhuma pessoa real). Prova o que fica no banco, pela operação faturamento.apurar-receita-contabil
// (a mesma função que o fechamento, a reabertura, a glosa, o recurso e a baixa chamam na transação deles):
//   - estabelecimento sem regra ativa: nada é gravado;
//   - conta aberta: a receita prevista de cada item (D prevista / C receita), pendente, com chave_fato e data de
//     referência no dia do item; apurar de novo não duplica;
//   - fechamento (ciclo 1): receita do item pelo bruto, transferida da prevista para o "a receber", e o desconto na conta
//     de dedução, com a data de referência na competência e a data de lançamento de hoje;
//   - reabertura: o pendente do ciclo reaberto vira cancelado (fica no histórico); o contabilizado recebe UM estorno
//     espelhado (receita e desconto), com a chave da reabertura; apurar de novo não cria outro;
//   - refechamento: ciclo 2 com chave nova;
//   - contabilizado que diverge do apurado: o evento não muda, abre a divergência; ao voltar a casar, ela é resolvida;
//   - glosa em disputa (D glosa / C a receber), glosa aceita sem conta na regra vira pendência com motivo, recebido na
//     baixa (D conta do caixa de entrada / C a receber) e o estorno da baixa.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoReceitaContabil } from './receita-contabil.controller.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C2103';
const FALSO = 999_999_999; // referência de entrada fora da massa (parcela, forma, motivo, lançamento), sem FK na carga

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)(
  'receita contábil do faturamento: eventos, estorno e ocorrências (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let s: ServicoReceitaContabil;
    const ids: Record<string, number> = {};
    const op = (): ContextoOperacao => ({
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-c2103',
      chaveIdempotencia: `c2103-${randomUUID()}`,
      reautenticadoEm: Date.now(),
    });
    const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c2103' }, fn);
    const linhas = (sql: string, p: unknown[] = []) =>
      escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
    const exec = (sql: string, p: unknown[] = []) => escrever((e) => e.executar(sql, p));
    const apurar = () => s.apurar(op(), { conta: ids['conta'] });
    const eventos = () =>
      linhas(
        `SELECT chave_fato, tipo_acao, situacao, debito_conta_contabil_id AS d, credito_conta_contabil_id AS c,
              CAST(valor AS CHAR) AS valor, DATE_FORMAT(data_referencia, '%Y-%m-%d') AS ref,
              DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS lanc, criado_por
         FROM lancamento_contabil_receita WHERE estabelecimento_id = ? ORDER BY id`,
        [ids['est']],
      );
    const etapa = (etapa: string, situacao: string) =>
      exec(
        `INSERT INTO conta_hospitalar_etapa (conta_hospitalar_id, situacao_nova, operacao, dados, ocorrido_em, criado_em)
       VALUES (?, ?, 'alteracao', ?, NOW(3), NOW(3))`,
        [ids['conta'], situacao, JSON.stringify({ etapa, situacao: 'registrada' })],
      );
    const situacaoConta = (sit: 'aberta' | 'fechada') =>
      exec(
        `UPDATE conta_hospitalar SET situacao = ?, fechada_em = IF(? = 'fechada', NOW(3), NULL),
         fechada_por_usuario_id = IF(? = 'fechada', ?, NULL) WHERE id = ?`,
        [sit, sit, sit, ids['usuario'], ids['conta']],
      );
    const contabilizar = (chave: string) =>
      escrever(async (e) => {
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        await e.executar(
          `UPDATE lancamento_contabil_receita SET situacao = 'contabilizado', lancamento_contabil_id = ?,
           contabilizado_em = NOW(3) WHERE estabelecimento_id = ? AND chave_fato = ? AND situacao = 'pendente'`,
          [FALSO, ids['est'], chave],
        );
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      });

    const limpar = async (e: Escritor) => {
      if (!ids['est']) return;
      const est = ids['est'];
      const contas = 'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ?';
      const itens = `SELECT i.id FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
                    WHERE c.estabelecimento_id = ?`;
      await e.executar('DELETE FROM ocorrencia_contabil_receita WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM lancamento_contabil_receita WHERE estabelecimento_id = ?', [est]);
      await e.executar(`DELETE FROM recebimento_item_conta WHERE conta_hospitalar_item_id IN (${itens})`, [
        est,
      ]);
      await e.executar('DELETE FROM recebimento WHERE estabelecimento_id = ?', [est]);
      await e.executar(`DELETE FROM glosa_item WHERE conta_hospitalar_item_id IN (${itens})`, [est]);
      await e.executar('DELETE FROM glosa WHERE estabelecimento_id = ?', [est]);
      await e.executar(`DELETE FROM conta_hospitalar_etapa WHERE conta_hospitalar_id IN (${contas})`, [est]);
      await e.executar(
        'DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id = ?',
        [est],
      );
      await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM regra_contabil_receita WHERE estabelecimento_id = ?', [est]);
      await e.executar('DELETE FROM caixa WHERE estabelecimento_id = ?', [est]);
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
      s = new ServicoReceitaContabil(nucleo);
      await escrever(async (e) => {
        const agora = new Date();
        const g = (tabela: string, codigo: string, ins: string, pi: unknown[]) =>
          garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo], ins, pi);
        ids['est'] = await g(
          'estabelecimento',
          `${P}A`,
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
        );
        await limpar(e);
        ids['fonte'] = await g(
          'fonte_pagadora',
          `${P}F`,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [`${P}F`, `OPERADORA SINTETICA ${P}`, agora],
        );
        ids['grupo'] = await g(
          'grupo_faturamento',
          `${P}G`,
          "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'honorario', ?)",
          [`${P}G`, `GRUPO ${P}`, agora],
        );
        ids['itemF'] = await g(
          'item_faturavel',
          '82103001',
          `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em)
         VALUES (?, ?, 'procedimento', ?, ?)`,
          ['82103001', `PROCEDIMENTO SINTETICO ${P}`, ids['grupo'], agora],
        );
        const pf = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [`PACIENTE SINTETICO ${P}`],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [`PACIENTE SINTETICO ${P}`, agora],
        );
        ids['paciente'] = await garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pf],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pf, 921_030_001, agora],
        );
        const pp = await garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [`PROFISSIONAL SINTETICO ${P}`],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [`PROFISSIONAL SINTETICO ${P}`, agora],
        );
        ids['prof'] = await garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pp],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pp, agora],
        );
        ids['categoria'] = await g(
          'categoria_atendimento',
          P,
          "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
          [P, `CATEGORIA SINTETICA ${P}`, agora],
        );
        ids['tipoConta'] = await g(
          'tipo_conta',
          P,
          "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
          [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
        );
        ids['usuario'] = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [`${P.toLowerCase()}.fat`],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [`${P.toLowerCase()}.fat`, `USUARIO ${P}`, agora],
        );
        const carater = await garantir(
          e,
          'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
          ['FAE'],
          "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', FALSE, ?)",
          ['FAE', 'CARATER SINTETICO FAE', agora],
        );
        const plano = await g(
          'plano_contas',
          P,
          "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES (?, ?, 'contabil', '9.9.9', 3, '2000-01-01', ?)",
          [P, `PLANO SINTETICO ${P}`, agora],
        );
        const conta = (k: string, natureza: string, saldo: string) =>
          garantir(
            e,
            'SELECT id FROM conta_contabil WHERE plano_contas_id = ? AND classificacao = ?',
            [plano, k],
            `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, nivel, natureza,
             natureza_saldo, tipo, criado_em) VALUES (?, ?, ?, ?, 3, ?, ?, 'analitica', ?)`,
            [plano, k, `${P}${k.replace(/\./g, '')}`, `CONTA ${P} ${k}`, natureza, saldo, agora],
          );
        ids['receita'] = await conta('3.1.1', 'receita', 'credora');
        ids['prevista'] = await conta('1.1.5', 'ativo', 'devedora');
        ids['receber'] = await conta('1.1.2', 'ativo', 'devedora');
        ids['glosa'] = await conta('3.2.1', 'receita', 'devedora');
        ids['recuperacao'] = await conta('3.1.9', 'receita', 'credora');
        ids['deducao'] = await conta('3.2.2', 'receita', 'devedora');
        ids['caixaCc'] = await conta('1.1.1', 'ativo', 'devedora');
        ids['caixa'] = await e.inserir(
          'INSERT INTO caixa (estabelecimento_id, codigo, descricao, conta_contabil_id, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids['est'], `${P}CX`, `CAIXA ${P}`, ids['caixaCc'], agora],
        );
        const at = await e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-10-10 08:00:00', ?)`,
          [
            ids['est'],
            `${P}-AT1`,
            ids['paciente'],
            ids['categoria'],
            carater,
            ids['fonte'],
            ids['prof'],
            agora,
          ],
        );
        ids['conta'] = await e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-10-01', '2026-10-10 08:00:00', 'aberta', ?)`,
          [ids['est'], `${P}-C1`, at, ids['paciente'], ids['fonte'], ids['tipoConta'], agora],
        );
        const item = (seq: number, total: number, desconto: number, dia: string) =>
          e.inserir(
            `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, valor_desconto, situacao, criado_em)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'lancado', ?)`,
            [ids['conta'], seq, ids['itemF'], `${dia} 10:00:00`, total + desconto, total, desconto, agora],
          );
        ids['i1'] = await item(1, 90, 10, '2026-10-11');
        ids['i2'] = await item(2, 50, 0, '2026-10-12');
      });
    });

    afterAll(async () => {
      if (!nucleo) return;
      await escrever(async (e) => {
        await limpar(e);
        await limparTrilhaDaMassa(e, { ids: [ids['est']] });
      });
      await nucleo.encerrar?.();
    });

    it('sem regra ativa no estabelecimento, nada é gravado', async () => {
      expect(await apurar()).toMatchObject({ incluidos: 0, pendencias: 0 });
      expect(await eventos()).toEqual([]);
      ids['regra'] = await escrever((e) =>
        e.inserir(
          `INSERT INTO regra_contabil_receita (estabelecimento_id, fonte_pagadora_id, componente, conta_receita_id,
           conta_receita_prevista_id, conta_glosa_id, conta_glosa_aceita_id, conta_recuperacao_glosa_id, conta_deducao_id,
           conta_transitoria_cliente_id, prioridade, ativo, criado_em)
         VALUES (?, ?, 'todos', ?, ?, ?, NULL, ?, ?, ?, 10, TRUE, NOW(3))`,
          [
            ids['est'],
            ids['fonte'],
            ids['receita'],
            ids['prevista'],
            ids['glosa'],
            ids['recuperacao'],
            ids['deducao'],
            ids['receber'],
          ],
        ),
      );
    });

    it('conta aberta: a receita prevista de cada item, sem duplicar ao apurar de novo', async () => {
      expect(await apurar()).toMatchObject({ incluidos: 2, cancelados: 0 });
      const ev = await eventos();
      expect(ev).toHaveLength(2);
      expect(ev[0]).toMatchObject({
        chave_fato: `conta:${ids['conta']}:item:${ids['i1']}:previsao`,
        tipo_acao: 'previsao',
        situacao: 'pendente',
        d: ids['prevista'],
        c: ids['receita'],
        valor: '100.00',
        ref: '2026-10-11',
        criado_por: ids['usuario'],
      });
      expect(await apurar()).toMatchObject({ incluidos: 0, cancelados: 0 });
      expect(await eventos()).toHaveLength(2);
    });

    it('fechamento: receita do ciclo 1 transferida da prevista e desconto na dedução', async () => {
      await situacaoConta('fechada');
      await etapa('fechamento', 'fechada');
      expect(await apurar()).toMatchObject({ incluidos: 3, cancelados: 0 });
      const ev = (await eventos()).filter((x) => String(x['chave_fato']).includes(':ciclo:1:'));
      const hoje = new Date();
      const p2 = (x: number) => String(x).padStart(2, '0');
      const dHoje = `${hoje.getFullYear()}-${p2(hoje.getMonth() + 1)}-${p2(hoje.getDate())}`;
      expect(ev).toEqual([
        expect.objectContaining({
          chave_fato: `conta:${ids['conta']}:ciclo:1:item:${ids['i1']}:fechamento`,
          tipo_acao: 'receita',
          d: ids['receber'],
          c: ids['prevista'],
          valor: '100.00',
          ref: '2026-10-01',
          lanc: dHoje,
        }),
        expect.objectContaining({
          chave_fato: `conta:${ids['conta']}:ciclo:1:item:${ids['i1']}:desconto`,
          tipo_acao: 'desconto',
          d: ids['deducao'],
          c: ids['receber'],
          valor: '10.00',
        }),
        expect.objectContaining({
          chave_fato: `conta:${ids['conta']}:ciclo:1:item:${ids['i2']}:fechamento`,
          valor: '50.00',
        }),
      ]);
    });

    it('reabertura: cancela o pendente do ciclo e estorna uma vez o contabilizado', async () => {
      const pre = `conta:${ids['conta']}:ciclo:1:item:${ids['i1']}`;
      await contabilizar(`${pre}:fechamento`);
      await contabilizar(`${pre}:desconto`);
      await situacaoConta('aberta');
      await etapa('reabertura', 'aberta');
      expect(await apurar()).toMatchObject({ incluidos: 2, cancelados: 1 });
      const ev = await eventos();
      expect(
        ev.find((x) => x['chave_fato'] === `conta:${ids['conta']}:ciclo:1:item:${ids['i2']}:fechamento`),
      ).toMatchObject({ situacao: 'cancelado' });
      expect(ev.find((x) => x['chave_fato'] === `${pre}:reabertura`)).toMatchObject({
        tipo_acao: 'estorno',
        situacao: 'pendente',
        d: ids['prevista'],
        c: ids['receber'],
        valor: '100.00',
      });
      expect(ev.find((x) => x['chave_fato'] === `${pre}:reabertura-desconto`)).toMatchObject({
        d: ids['receber'],
        c: ids['deducao'],
        valor: '10.00',
      });
      expect(ev.find((x) => x['chave_fato'] === `${pre}:fechamento`)).toMatchObject({
        situacao: 'contabilizado',
      });
      expect(await apurar()).toMatchObject({ incluidos: 0, cancelados: 0 });
      expect((await eventos()).length).toBe(ev.length);
    });

    it('refechamento: ciclo 2; o contabilizado divergente abre a divergência e ela se resolve ao casar', async () => {
      await situacaoConta('fechada');
      await etapa('fechamento', 'fechada');
      expect(await apurar()).toMatchObject({ incluidos: 3 });
      const chave = `conta:${ids['conta']}:ciclo:2:item:${ids['i1']}:fechamento`;
      await contabilizar(chave);
      await exec('UPDATE conta_hospitalar_item SET valor_total = 120 WHERE id = ?', [ids['i1']]);
      // A previsão ainda pendente do item é trocada (cancela e inclui); o fechamento contabilizado não muda.
      expect(await apurar()).toMatchObject({ incluidos: 1, cancelados: 1, divergencias: 1 });
      const oc = () =>
        linhas(
          `SELECT tipo, chave_fato, fato, situacao, lancamento_contabil_receita_id AS lanc, motivo, resolvida_em
           FROM ocorrencia_contabil_receita WHERE estabelecimento_id = ? AND tipo = 'divergencia'`,
          [ids['est']],
        );
      const [div] = await oc();
      expect(div).toMatchObject({ chave_fato: chave, fato: 'fechamento', situacao: 'aberta' });
      expect(String(div!['motivo'])).toMatch(/reabertura/);
      expect(div!['lanc']).not.toBeNull();
      expect((await eventos()).find((x) => x['chave_fato'] === chave)).toMatchObject({
        situacao: 'contabilizado',
        valor: '100.00',
      });
      await exec('UPDATE conta_hospitalar_item SET valor_total = 90 WHERE id = ?', [ids['i1']]);
      expect(await apurar()).toMatchObject({ divergencias: 0 });
      const [res] = await oc();
      expect(res).toMatchObject({ situacao: 'resolvida' });
      expect(res!['resolvida_em']).not.toBeNull();
    });

    it('glosa em disputa, glosa aceita sem conta (pendência), recebido e estorno da baixa', async () => {
      await escrever(async (e) => {
        await e.executar('SET FOREIGN_KEY_CHECKS = 0');
        const glosa = await e.inserir(
          `INSERT INTO glosa (estabelecimento_id, numero, fonte_pagadora_id, procedencia, conta_hospitalar_id, data_glosa,
           valor_glosado, valor_aceito, situacao, criado_em)
         VALUES (?, ?, ?, 'demonstrativo', ?, '2026-11-05', 20, 5, 'aceita_parcial', NOW(3))`,
          [ids['est'], `${P}-G1`, ids['fonte'], ids['conta']],
        );
        await e.inserir(
          `INSERT INTO glosa_item (glosa_id, sequencia, conta_hospitalar_item_id, motivo_glosa_id, valor_glosado,
           valor_aceito, decisao, decidido_em, criado_em)
         VALUES (?, 1, ?, ?, 20, 5, 'aceitar_parcial', '2026-11-06 09:00:00', NOW(3))`,
          [glosa, ids['i2'], FALSO],
        );
        const receb = await e.inserir(
          `INSERT INTO recebimento (estabelecimento_id, numero, parcela_receber_id, data_recebimento, forma_recebimento_id,
           caixa_id, valor_recebido, situacao, estornado_em, criado_em)
         VALUES (?, ?, ?, '2026-11-10', ?, ?, 30, 'estornado', '2026-11-12 10:00:00', NOW(3))`,
          [ids['est'], `${P}-R1`, FALSO, FALSO, ids['caixa']],
        );
        await e.inserir(
          `INSERT INTO recebimento_item_conta (recebimento_id, sequencia, conta_hospitalar_item_id, valor_apresentado,
           valor_recebido, criado_em) VALUES (?, 1, ?, 50, 30, NOW(3))`,
          [receb, ids['i2']],
        );
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      });
      expect(await apurar()).toMatchObject({ incluidos: 3, pendencias: 1 });
      const ev = await eventos();
      const glosa = ev.find((x) => String(x['chave_fato']).endsWith(':glosa'));
      expect(glosa).toMatchObject({ tipo_acao: 'glosa', d: ids['glosa'], c: ids['receber'], valor: '15.00' });
      expect(glosa!['ref']).toBe('2026-11-05');
      expect(ev.find((x) => String(x['chave_fato']).endsWith(':recebimento'))).toMatchObject({
        tipo_acao: 'recebimento',
        d: ids['caixaCc'],
        c: ids['receber'],
        valor: '30.00',
        ref: '2026-11-10',
      });
      expect(
        ev.find(
          (x) => String(x['chave_fato']).startsWith('recebimento_item:') && x['tipo_acao'] === 'estorno',
        ),
      ).toMatchObject({ d: ids['receber'], c: ids['caixaCc'], ref: '2026-11-12' });
      const pend = await linhas(
        `SELECT fato, motivo, situacao, CAST(valor AS CHAR) AS valor, conta_hospitalar_item_id AS item
         FROM ocorrencia_contabil_receita WHERE estabelecimento_id = ? AND tipo = 'pendencia'`,
        [ids['est']],
      );
      expect(pend).toEqual([
        expect.objectContaining({ fato: 'glosa_aceita', situacao: 'aberta', valor: '5.00', item: ids['i2'] }),
      ]);
      expect(String(pend[0]!['motivo'])).toMatch(/glosa aceita/);
      // O painel da tela traz os eventos e as ocorrências do estabelecimento.
      const painel = await s.painel(
        { cliente: CLIENTE, estabelecimento: ids['est']!, usuario: null, correlacao: 'teste-c2103' },
        { conta: ids['conta'] },
      );
      expect(painel.regrasAtivas).toBe(1);
      expect(painel.eventos.length).toBe((await eventos()).length);
      expect(painel.ocorrencias.filter((o) => o.situacao === 'aberta').map((o) => o.tipo)).toEqual([
        'pendencia',
      ]);
    });
  },
);
