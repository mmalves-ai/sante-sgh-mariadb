// Contrato de efeito do horário especial na conta, 3ª volta (F3.7, 06-FAT linha 17) contra o MariaDB real. Massa
// SINTÉTICA com códigos "F376" (nenhuma pessoa real):
// - lançar o item já aplica o acréscimo (sem botão): a faixa só de urgência vale na conta do atendimento urgente e não
//   na do eletivo; o total da conta sai refeito na mesma transação;
// - mesmo ato: o item acoplado ao principal segue a faixa do principal quando ela replica, mesmo fora do horário;
// - anestesia: o item da função de anestesista leva o percentual de anestesia da faixa;
// - a faixa grava as marcas novas (só urgência, replica nos vinculados).
// No fim, a massa é apagada. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoAjustesConta } from './conta-ajustes.controller.js';
import type { ContextoFaturamento } from './porta.js';
import { PortaFaturamentoPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F376';
const CODIGO_ITEM = 83_760_001;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)(
  'horário especial na conta: lançamento, urgência, mesmo ato e anestesia (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let s: ServicoAjustesConta;
    let porta: PortaFaturamentoPropria;
    let c: ContextoFaturamento;
    const ids: Record<string, number> = {};
    const op = (): ContextoOperacao => ({
      cliente: CLIENTE,
      estabelecimento: ids['est']!,
      usuario: ids['usuario']!,
      correlacao: 'teste-f376',
      chaveIdempotencia: `f376-${randomUUID()}`,
      reautenticadoEm: Date.now(),
    });
    const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f376' }, fn);
    const linhas = (sql: string, p: unknown[]) =>
      escrever((e) => e.consultar<Record<string, unknown>>(sql, p));

    const limpar = async (e: Escritor) => {
      if (!ids['est']) return;
      const contas = await e.consultar<{ id: number }>(
        'SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ? AND numero LIKE ?',
        [ids['est'], `${P}%`],
      );
      for (const { id } of contas) {
        await e.executar(
          'DELETE m FROM conta_hospitalar_item_memoria m JOIN conta_hospitalar_item i ON i.id = m.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?',
          [id],
        );
        await e.executar(
          'UPDATE conta_hospitalar_item SET item_pai_id = NULL WHERE conta_hospitalar_id = ?',
          [id],
        );
        await e.executar('DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?', [id]);
        await e.executar('DELETE FROM conta_hospitalar_etapa WHERE conta_hospitalar_id = ?', [id]);
        await e.executar('DELETE FROM conta_hospitalar WHERE id = ?', [id]);
      }
      await e.executar('DELETE FROM acrescimo_horario_especial WHERE estabelecimento_id = ?', [ids['est']]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids['est']]);
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
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
          `${P}FP`,
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
        );
        const pessoa = (nome: string) =>
          garantir(
            e,
            'SELECT id FROM pessoa_fisica WHERE nome = ?',
            [nome],
            'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
            [nome, agora],
          );
        const pp = await pessoa(`PACIENTE SINTETICO ${P}`);
        ids['paciente'] = await garantir(
          e,
          'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
          [pp],
          'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
          [pp, 837_601, agora],
        );
        const pf = await pessoa(`PROFISSIONAL SINTETICO ${P}`);
        ids['prof'] = await garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
          [pf, agora],
        );
        ids['categoria'] = await g(
          'categoria_atendimento',
          P,
          "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
          [P, `CATEGORIA SINTETICA ${P}`, agora],
        );
        const carater = (cod: string, urgencia: boolean) =>
          garantir(
            e,
            'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
            [cod],
            "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, urgencia, criado_em) VALUES (?, ?, 'teste', ?, ?)",
            [cod, `CARATER SINTETICO ${cod}`, urgencia, agora],
          );
        ids['urgente'] = await carater('F6U', true);
        ids['eletivo'] = await carater('F6E', false);
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
        ids['grupo'] = await g(
          'grupo_faturamento',
          `${P}G`,
          "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
          [`${P}G`, `GRUPO ${P}`, agora],
        );
        ids['item'] = await g(
          'item_faturavel',
          String(CODIGO_ITEM),
          "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
          [String(CODIGO_ITEM), `PROCEDIMENTO SINTETICO ${P}`, ids['grupo'], agora],
        );
        ids['anestesista'] = await g(
          'funcao_equipe_cobranca',
          `${P}AN`,
          "INSERT INTO funcao_equipe_cobranca (codigo, descricao, tipo_funcao, criado_em) VALUES (?, ?, 'anestesista', ?)",
          [`${P}AN`, `ANESTESISTA SINTETICO ${P}`, agora],
        );
        ids['tabela'] = await g(
          'tabela_preco',
          `${P}T`,
          `INSERT INTO tabela_preco (codigo, descricao, tipo_item, referencia, situacao, fonte_pagadora_id, criado_em)
         VALUES (?, ?, 'servico_hospitalar', 'propria', 'ativa', ?, ?)`,
          [`${P}T`, `TABELA SINTETICA ${P}`, ids['fonte'], agora],
        );
        const pp2 = await garantir(
          e,
          'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
          [ids['tabela'], ids['item']],
          'INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, criado_em) VALUES (?, 1, ?, ?)',
          [ids['tabela'], ids['item'], agora],
        );
        await garantir(
          e,
          'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
          [pp2],
          `INSERT INTO preco_procedimento_valor (preco_procedimento_id, operacao, ocorrido_em, vigencia_inicio,
           valor_honorario, valor_custo_operacional, valor_filme, valor_total, criado_em)
         VALUES (?, 'inclusao', ?, '2020-01-01', 0, 100, 0, 100, ?)`,
          [pp2, agora, agora],
        );
        const atendimento = (num: string, car: number) =>
          e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', '2026-01-20 11:00:00', ?)`,
            [ids['est'], num, ids['paciente'], ids['categoria'], car, ids['fonte'], ids['prof'], agora],
          );
        ids['atUrg'] = await atendimento(`${P}-U`, ids['urgente']);
        ids['atElet'] = await atendimento(`${P}-E`, ids['eletivo']);
        const conta = (num: string, at: number) =>
          e.inserir(
            `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, tabela_preco_id, natureza, competencia, inicio_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', '2026-01-01', '2026-01-20 11:00:00', ?)`,
            [ids['est'], num, at, ids['paciente'], ids['fonte'], ids['tipoConta'], ids['tabela'], agora],
          );
        ids['contaUrg'] = await conta(`${P}-CU`, ids['atUrg']);
        ids['contaElet'] = await conta(`${P}-CE`, ids['atElet']);
        ids['contaAto'] = await conta(`${P}-CA`, ids['atElet']);
      });
      s = new ServicoAjustesConta(nucleo);
      porta = new PortaFaturamentoPropria(nucleo, CLIENTE);
      c = {
        cliente: CLIENTE,
        estabelecimento: ids['est']!,
        usuario: ids['usuario']!,
        correlacao: 'teste-f376',
        rede: 'rede-teste',
        hospital: `${P}A`,
      };
    });

    afterAll(async () => {
      if (!nucleo) return;
      await escrever(async (e) => {
        await limpar(e);
        await limparTrilhaDaMassa(e, { ids: [ids['est']] });
      });
      await nucleo.encerrar();
    });

    const faixa = (codigo: string, x: Record<string, unknown>) =>
      s.gravar('horario.faixa', op(), {
        codigo,
        descricao: `FAIXA ${codigo}`,
        vigenciaInicio: '2026-01-01',
        tipoHorario: 'noturno',
        horaInicio: '19:00',
        horaFim: '07:00',
        ...x,
      });

    it('lançar aplica o acréscimo: a faixa só de urgência vale no urgente e não no eletivo; total refeito', async () => {
      await faixa(`${P}U`, { percentual: 40, exigeUrgencia: true });
      const gravada = await linhas(
        'SELECT exige_urgencia, aplica_procedimentos_vinculados FROM acrescimo_horario_especial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids['est'], `${P}U`],
      );
      expect(
        gravada.map((r) => [Number(r['exige_urgencia']), Number(r['aplica_procedimentos_vinculados'])]),
      ).toEqual([[1, 0]]);
      const lancar = (conta: number) =>
        porta.executar(
          c,
          'faturamento.lancarItem',
          {
            conta,
            tipo: 3,
            codigo: CODIGO_ITEM,
            quantidade: 1,
            data: '2026-01-20',
            hora: '23:00',
            local: 0,
            ato: 0,
          },
          op(),
        );
      const urg = await lancar(ids['contaUrg']!);
      expect(urg.resultado).toMatchObject({ conta: ids['contaUrg'], valor: 100, horarioEspecial: 1 });
      const elet = await lancar(ids['contaElet']!);
      expect(elet.resultado).toMatchObject({ conta: ids['contaElet'], valor: 100 });
      expect(elet.resultado['horarioEspecial']).toBeUndefined();
      const itens = await linhas(
        `SELECT c.numero, i.horario_especial, i.valor_acrescimo_horario, i.valor_acrescimo, i.valor_total,
              c.valor_itens, c.valor_total AS total_conta
         FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
        WHERE c.id IN (?, ?) ORDER BY c.numero`,
        [ids['contaUrg'], ids['contaElet']],
      );
      expect(
        itens.map((r) => [
          String(r['numero']),
          Number(r['horario_especial']),
          Number(r['valor_acrescimo_horario']),
          Number(r['valor_acrescimo']),
          Number(r['valor_total']),
          Number(r['total_conta']),
        ]),
      ).toEqual([
        [`${P}-CE`, 0, 0, 0, 100, 100],
        [`${P}-CU`, 1, 40, 40, 140, 140],
      ]);
    });

    it('mesmo ato e anestesia: o acoplado segue o principal; o anestesista leva o percentual de anestesia', async () => {
      await faixa(`${P}V`, { percentual: 30, percentualAnestesia: 50, aplicaProcedimentosVinculados: true });
      // Instantes em UTC (relógio do hospital UTC-3): 23h local = 02h UTC do dia seguinte.
      const ins = (seq: number, quando: string, valor: number, pai: number | null, funcao: number | null) =>
        escrever((e) =>
          e.inserir(
            `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, grupo_faturamento_id,
             item_pai_id, funcao_equipe_cobranca_id, realizado_em, quantidade, valor_unitario, valor_total, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
            [ids['contaAto'], seq, ids['item'], ids['grupo'], pai, funcao, quando, valor, valor, new Date()],
          ),
        );
      const principal = await ins(1, '2026-01-21 02:00:00', 100, null, null);
      await ins(2, '2026-01-21 11:00:00', 50, principal, null); // 08h local: fora da faixa, mas do mesmo ato
      await ins(3, '2026-01-21 02:30:00', 200, null, ids['anestesista']!);
      await ins(4, '2026-01-21 13:00:00', 100, null, null); // 10h local, sem vínculo: sem acréscimo
      const r = await s.gravar('horario.aplicar', op(), { contaId: ids['contaAto'] });
      expect(r).toMatchObject({ alterados: 3, comAcrescimo: 3 });
      const itens = await linhas(
        'SELECT sequencia, valor_acrescimo_horario, valor_total FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? ORDER BY sequencia',
        [ids['contaAto']],
      );
      expect(
        itens.map((x) => [
          Number(x['sequencia']),
          Number(x['valor_acrescimo_horario']),
          Number(x['valor_total']),
        ]),
      ).toEqual([
        [1, 30, 130],
        [2, 15, 65],
        [3, 100, 300],
        [4, 0, 100],
      ]);
      const conta = await linhas('SELECT valor_total FROM conta_hospitalar WHERE id = ?', [ids['contaAto']]);
      expect(Number(conta[0]!['valor_total'])).toBe(595);
    });
  },
);
