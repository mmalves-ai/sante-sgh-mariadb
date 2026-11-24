// F3 (motores, integrador): o fluxo do paciente de ponta a ponta contra o MariaDB real, cliente f22_o3, massa
// SINTÉTICA (massa-adt.spec-util.ts, marca P). Contrato de efeito, com contagens no banco: internar abre UMA conta na
// mesma transação, com o vínculo atendimento_conta e a diária do dia (lançamento automático); a rotina diária não lança
// de novo; o mat/med e o procedimento entram na MESMA conta pelo lançamento de item; o procedimento com executor gera
// a produção do repasse na mesma transação, ligada ao mesmo item e à mesma conta (prévia pela regra do convênio); a
// alta não abre outra conta; o fechamento recalcula o total pelos itens (diária, mat/med e procedimento), marca a conta
// calculada e não duplica a produção: a conta fica pronta para faturar. SGH_NUCLEO_SEM_BANCO=1 pula.
import { instanteParaDataHora } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apurarLancamentosDoDia } from '../faturamento/conta-entrada.js';
import { versaoTexto } from '../faturamento/esquemas.js';
import { fecharConta, lancarItem } from '../faturamento/operacoes.js';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
} from './massa-adt.spec-util.js';
import { carimboVersao } from './operacoes.js';
import { PortaAdtPropria } from './porta-propria.js';

const P = 'L0301P';
const PRECO = { diaria: 150, med: 12.5, proc: 300 } as const;
// O código do item na conta é numérico (contrato do lançamento): faixa sintética própria da marca P.
const COD = { diaria: 99_304_001, med: 99_304_002, proc: 99_304_003 } as const;

describe.skipIf(SEM_BANCO_ADT)(
  `fluxo do paciente: internação à conta pronta (MariaDB, cliente ${CLIENTE_ADT})`,
  () => {
    let m: MassaAdt | null = null;
    let porta: PortaAdtPropria;
    const M = () => m!;
    const cfg = { evento: 0, regra: 0 };
    const num = async (sql: string, p: unknown[]) =>
      Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
    const escrever = <T>(fn: Parameters<MassaAdt['nucleo']['escrever']>[1]) =>
      M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-fluxo-paciente' }, fn) as Promise<T>;
    const adt = (op: string, entrada: unknown) =>
      porta
        .executar(contextoAdt(M()), op, entrada, { ...operacaoAdt(M()), reautenticadoEm: Date.now() })
        .then((r) => r.resultado as Record<string, unknown>);
    const exec = async (
      op: Parameters<ReturnType<MassaAdt['nucleo']['criarExecutor']>['executar']>[0],
      e: unknown,
    ) =>
      (await M().nucleo.criarExecutor().executar(op, CLIENTE_ADT, e, operacaoAdt(M()))).resultado as Record<
        string,
        unknown
      >;

    beforeAll(async () => {
      m = await prepararMassaAdt('P');
      porta = new PortaAdtPropria(M().nucleo);
      Object.assign(
        cfg,
        await escrever(async (e) => {
          const agora = new Date();
          const id = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
            const l = await e.uma<{ id: number }>(sel, p);
            return l ? Number(l.id) : e.inserir(ins, pi);
          };
          const grupo = Number(
            (await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM grupo_faturamento', []))?.id,
          );
          const categoria = Number(
            (
              await e.uma<{ id: number }>('SELECT id FROM categoria_acomodacao WHERE codigo = ?', [
                `${P}-ENF`,
              ])
            )?.id,
          );
          // O mat/med do catálogo faturável aponta o insumo (CHECK ck_item_faturavel_insumo).
          const grupoInsumo = await id(
            'SELECT id FROM grupo_insumo WHERE codigo = ?',
            [`${P}-GI`],
            "INSERT INTO grupo_insumo (codigo, descricao, natureza, criado_em) VALUES (?, 'GRUPO SINTETICO FLUXO', 'medicamento', ?)",
            [`${P}-GI`, agora],
          );
          const unidade = await id(
            'SELECT id FROM unidade_medida WHERE codigo = ?',
            [`${P}-UN`],
            "INSERT INTO unidade_medida (codigo, descricao, sigla, uso_estoque, criado_em) VALUES (?, 'UNIDADE SINTETICA FLUXO', 'UF', TRUE, ?)",
            [`${P}-UN`, agora],
          );
          const insumo = await id(
            'SELECT id FROM insumo WHERE codigo = ?',
            [`${P}-MED`],
            "INSERT INTO insumo (codigo, nome, tipo, grupo_insumo_id, estoque_unidade_medida_id, criado_em) VALUES (?, 'MEDICAMENTO SINTETICO FLUXO', 'medicamento', ?, ?, ?)",
            [`${P}-MED`, grupoInsumo, unidade, agora],
          );
          const itemDe = (codigo: string, tipo: string) =>
            id(
              'SELECT id FROM item_faturavel WHERE codigo = ?',
              [codigo],
              "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, insumo_id, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 'ativo', ?)",
              [
                codigo,
                `ITEM SINTETICO ${codigo}`,
                tipo,
                grupo,
                tipo === 'medicamento' ? insumo : null,
                agora,
              ],
            );
          const tabela = await id(
            'SELECT id FROM tabela_preco WHERE codigo = ?',
            [`${P}-TAB`],
            "INSERT INTO tabela_preco (estabelecimento_id, codigo, descricao, tipo_item, referencia, fonte_pagadora_id, situacao, criado_em) VALUES (?, ?, 'TABELA SINTETICA', 'diaria_taxa', 'propria', ?, 'ativa', ?)",
            [M().est, `${P}-TAB`, M().convenio, agora],
          );
          const precoDe = async (item: number, valor: number) => {
            const pp = await id(
              'SELECT id FROM preco_procedimento WHERE tabela_preco_id = ? AND item_faturavel_id = ?',
              [tabela, item],
              "INSERT INTO preco_procedimento (tabela_preco_id, sequencia, item_faturavel_id, modelo_valor, criado_em) VALUES (?, ?, ?, 'valor', ?)",
              [tabela, item % 100000, item, agora],
            );
            await id(
              'SELECT id FROM preco_procedimento_valor WHERE preco_procedimento_id = ?',
              [pp],
              "INSERT INTO preco_procedimento_valor (preco_procedimento_id, vigencia_inicio, valor_total, ocorrido_em, criado_em) VALUES (?, '2020-01-01', ?, ?, ?)",
              [pp, valor, agora, agora],
            );
          };
          const diaria = await itemDe(String(COD.diaria), 'diaria');
          await precoDe(diaria, PRECO.diaria);
          await precoDe(await itemDe(String(COD.med), 'medicamento'), PRECO.med);
          await precoDe(await itemDe(String(COD.proc), 'procedimento'), PRECO.proc);
          await e.inserir(
            "INSERT INTO regra_diaria (estabelecimento_id, categoria_acomodacao_id, item_faturavel_id, quantidade, hora_virada, vigencia_inicio, ativo, criado_em) VALUES (?, ?, ?, 1, '12:00:00', '2020-01-01', TRUE, ?)",
            [M().est, categoria, diaria, agora],
          );
          // A regra do repasse do convênio da massa: 60% do cobrado.
          const evento = await e.inserir(
            "INSERT INTO evento_repasse (estabelecimento_id, codigo, nome, natureza, tipo_lancamento, vigencia_inicio, criado_em) VALUES (?, ?, 'HONORARIOS FLUXO', 'rendimento', 'credito', '2020-01-01', ?)",
            [M().est, `${P}-EV`, agora],
          );
          const regra = await e.inserir(
            "INSERT INTO regra_repasse (estabelecimento_id, codigo, descricao, evento_repasse_id, base_calculo, vigencia_inicio, criado_em) VALUES (?, ?, 'Regra fluxo', ?, 'cobrado', '2020-01-01', ?)",
            [M().est, `${P}-RR`, evento, agora],
          );
          await e.inserir(
            'INSERT INTO regra_repasse_item (regra_repasse_id, sequencia, fonte_pagadora_id, percentual, criado_em) VALUES (?, 1, ?, 60, ?)',
            [regra, M().convenio, agora],
          );
          return { evento, regra };
        }),
      );
    }, 120_000);

    afterAll(async () => {
      if (m)
        await escrever(async (e) => {
          await e.executar(`DELETE FROM estorno_repasse WHERE estabelecimento_id = ?`, [M().est]);
          await e.executar(`DELETE FROM producao_repasse WHERE estabelecimento_id = ?`, [M().est]);
          await e.executar('DELETE FROM regra_repasse_item WHERE regra_repasse_id = ?', [cfg.regra]);
          await e.executar('DELETE FROM regra_repasse WHERE id = ?', [cfg.regra]);
          await e.executar('DELETE FROM evento_repasse WHERE id = ?', [cfg.evento]);
        });
      await encerrarMassaAdt(m);
    }, 120_000);

    it('internar → diária → mat/med → procedimento com executor → produção do repasse → alta → conta pronta', async () => {
      const paciente = M().pacientes[0]!;
      await adt('internacao.internar', {
        paciente,
        leito: { bloco: 'B1', acomodacao: 'Q1', leito: M().leitos[0]! },
        convenio: M().convenio,
        acomodacaoPlano: 'ENFERMARIA',
        carater: 'urgencia',
        clinica: 'M',
        especialidade: M().especialidade,
        medicoAssistente: M().medico,
        medicoSolicitante: M().medico,
        cidPrincipal: M().cid,
        procedimento: M().procedimento,
        procedimentoOrigem: 'sigtap',
        centroCusto: 1,
        unidade: 1,
        origem: 'ambulatorio',
        caraterAdmissao: M().carater,
        caraterTiss: M().caraterTiss,
        categoriaAtendimento: M().categoria,
        modalidade: M().modalidade,
      });
      const int = await lerAdt<{ id: number; atendimento_id: number }>(
        M(),
        'SELECT id, atendimento_id FROM internacao WHERE paciente_id = ? AND estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
        [paciente, M().est],
      );
      const atendimento = Number(int?.atendimento_id);
      const contasDo = () =>
        num(
          "SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ? AND situacao <> 'cancelada'",
          [atendimento],
        );
      // Conta aberta: uma só, com o vínculo do atendimento.
      expect(await contasDo()).toBe(1);
      const conta = Number(
        (
          await lerAdt<{ id: number }>(M(), 'SELECT id FROM conta_hospitalar WHERE atendimento_id = ?', [
            atendimento,
          ])
        )?.id,
      );
      expect(
        await num("SELECT COUNT(*) AS n FROM conta_hospitalar WHERE id = ? AND situacao = 'aberta'", [conta]),
      ).toBe(1);
      expect(
        await num('SELECT COUNT(*) AS n FROM atendimento_conta WHERE conta_hospitalar_id = ?', [conta]),
      ).toBe(1);
      // Diária do dia, uma vez; a rotina diária não lança de novo.
      const diarias = () =>
        num(
          "SELECT COUNT(*) AS n FROM lancamento_automatico_conta WHERE conta_hospitalar_id = ? AND situacao = 'lancado' AND chave = 'diaria'",
          [conta],
        );
      expect(await diarias()).toBe(1);
      await exec(apurarLancamentosDoDia, {});
      expect(await diarias()).toBe(1);

      const agora = instanteParaDataHora(new Date().toISOString(), 'America/Sao_Paulo');
      const lancar = (
        tipo: 3 | 4,
        codigo: number,
        quantidade: number,
        executante: number | null,
        origem: unknown,
      ) =>
        exec(lancarItem, {
          conta,
          tipo,
          codigo,
          quantidade,
          data: agora.data,
          hora: agora.hora.slice(0, 5),
          local: 0,
          ato: 0,
          executante,
          origem,
        });
      // Mat/med da dispensação e procedimento com executor: mesma conta, mesmo lançamento de item.
      const med = await lancar(4, COD.med, 2, null, { tipo: 'dispensacao', id: 0 });
      expect(Number(med['conta'])).toBe(conta);
      expect(
        await num('SELECT COUNT(*) AS n FROM producao_repasse WHERE conta_hospitalar_item_id = ?', [
          Number(med['id']),
        ]),
      ).toBe(0);
      const proc = await lancar(3, COD.proc, 1, M().medico, null);
      expect(Number(proc['conta'])).toBe(conta);
      const item = Number(proc['id']);
      expect(
        await num(
          'SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE id = ? AND executante_profissional_id = ?',
          [item, M().medico],
        ),
      ).toBe(1);
      const producao = () =>
        num(
          "SELECT COUNT(*) AS n FROM producao_repasse WHERE conta_hospitalar_id = ? AND conta_hospitalar_item_id = ? AND profissional_id = ? AND situacao = 'pendente'",
          [conta, item, M().medico],
        );
      expect(await producao()).toBe(1);
      // Prévia da produção: base = cobrado do procedimento (300), 60% da regra da massa = 180.
      const previa = async () =>
        lerAdt<{
          valor_base: string;
          percentual: string | null;
          valor_repasse: string | null;
          situacao: string;
        }>(
          M(),
          'SELECT valor_base, percentual, valor_repasse, situacao FROM producao_repasse WHERE conta_hospitalar_item_id = ?',
          [item],
        );
      const p1 = await previa();
      expect(Number(p1?.valor_base)).toBe(PRECO.proc);
      expect(Number(p1?.percentual)).toBe(60);
      expect(Number(p1?.valor_repasse)).toBe(180);
      // A regra aplicada é a da massa (evento da massa, percentual do convênio) e é a única do estabelecimento.
      expect(
        await num(
          `SELECT COUNT(*) AS n FROM regra_repasse r JOIN regra_repasse_item i ON i.regra_repasse_id = r.id
            WHERE r.id = ? AND r.evento_repasse_id = ? AND i.fonte_pagadora_id = ? AND i.percentual = ?`,
          [cfg.regra, cfg.evento, M().convenio, Number(p1?.percentual)],
        ),
      ).toBe(1);
      expect(
        await num('SELECT COUNT(*) AS n FROM regra_repasse WHERE estabelecimento_id = ?', [M().est]),
      ).toBe(1);

      // Alta: nenhuma conta nova. Sem horaSaida: a hora "HH:MM" do mesmo minuto da entrada cairia antes dela (segundos).
      const v = await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM internacao WHERE id = ?', [
        Number(int?.id),
      ]);
      await adt('internacao.darAlta', {
        internacao: Number(int?.id),
        motivo: M().motivoSaida,
        medicoAlta: M().medico,
        versao: carimboVersao(v?.versao),
      });
      expect(await contasDo()).toBe(1);

      // Fechamento: total pelos itens cobrados, conta calculada, produção sem duplicata.
      const vc = await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM conta_hospitalar WHERE id = ?', [
        conta,
      ]);
      await exec(fecharConta, { conta, versao: versaoTexto(Number(vc?.versao)) });
      const c = await lerAdt<{
        situacao: string;
        calculada: number;
        valor_total: string;
        soma: string;
        itens: number;
      }>(
        M(),
        `SELECT c.situacao, c.calculada, c.valor_total,
              (SELECT COALESCE(SUM(i.valor_total), 0) FROM conta_hospitalar_item i WHERE i.conta_hospitalar_id = c.id
                  AND i.excluido_em IS NULL AND i.situacao NOT IN ('estornado','transferido','sem_cobranca')) AS soma,
              (SELECT COUNT(*) FROM conta_hospitalar_item i WHERE i.conta_hospitalar_id = c.id
                  AND i.excluido_em IS NULL AND i.situacao NOT IN ('estornado','transferido','sem_cobranca')) AS itens
         FROM conta_hospitalar c WHERE c.id = ?`,
        [conta],
      );
      expect(c?.situacao).toBe('fechada');
      expect(Number(c?.calculada)).toBe(1);
      expect(Number(c?.valor_total)).toBe(Number(c?.soma));
      // Valores exatos: n diárias lançadas (1 ou mais, conforme a hora da alta), o mat/med (2 × 12,5) e o
      // procedimento (300). Uma diária em dobro ou um item sem preço não fecha a conta.
      const n = await diarias();
      expect(n).toBeGreaterThanOrEqual(1);
      expect(Number(c?.itens)).toBe(n + 2);
      expect(Number(c?.soma)).toBe(n * PRECO.diaria + 2 * PRECO.med + PRECO.proc);
      const valorDo = async (id: number) =>
        Number(
          (
            await lerAdt<{ v: string }>(
              M(),
              'SELECT valor_total AS v FROM conta_hospitalar_item WHERE id = ?',
              [id],
            )
          )?.v,
        );
      expect(await valorDo(Number(med['id']))).toBe(2 * PRECO.med);
      expect(await valorDo(item)).toBe(PRECO.proc);
      // Repasse: uma produção só (o mat/med sem executor fica fora), com a base e o valor da regra; nenhum estorno.
      expect(await producao()).toBe(1);
      expect(
        await num('SELECT COUNT(*) AS n FROM producao_repasse WHERE conta_hospitalar_id = ?', [conta]),
      ).toBe(1);
      expect(
        await num('SELECT COUNT(*) AS n FROM producao_repasse WHERE conta_hospitalar_item_id = ?', [
          Number(med['id']),
        ]),
      ).toBe(0);
      const p2 = await previa();
      expect(p2?.situacao).toBe('pendente');
      expect(Number(p2?.valor_base)).toBe(PRECO.proc);
      expect(Number(p2?.valor_repasse)).toBe(180);
      expect(
        await num('SELECT COUNT(*) AS n FROM estorno_repasse WHERE conta_hospitalar_id = ?', [conta]),
      ).toBe(0);
      expect(
        await num(
          'SELECT COUNT(*) AS n FROM estorno_repasse e JOIN producao_repasse p ON p.id = e.producao_repasse_id WHERE p.conta_hospitalar_id = ?',
          [conta],
        ),
      ).toBe(0);
    }, 120_000);
  },
);
