// Contrato de efeito da regra de campo do cadastro na ADMISSÃO da internação (F3.1, 02-CAD linha 2) contra o MariaDB
// real (cliente de teste; f22_o3 por padrão), massa SINTÉTICA (massa-adt.spec-util.ts, marca G). Prova o que fica no
// banco: com o cadastro do paciente incompleto no escopo da internação (tipo "internacao" ou o convênio), a operação
// internacao.internar é recusada com os campos que faltam e NADA é gravado (nem atendimento, nem internação, nem
// ocupação de leito; o leito continua na mesma situação); a regra de outro tipo de atendimento não vale na admissão;
// a mãe declarada desconhecida atende a regra do nome da mãe; o cadastro provisório (não identificado) não é barrado;
// sem a regra, a mesma admissão grava. As regras são só do estabelecimento da massa e saem no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { PortaAdtPropria } from './porta-propria.js';

const ROTULO = 'REGRA ADMISSAO L0301G';

describe.skipIf(SEM_BANCO_ADT)(
  `regra de campo do cadastro na admissão da internação (MariaDB, cliente ${CLIENTE_ADT})`,
  () => {
    let m: MassaAdt | null = null;
    let porta: PortaAdtPropria;
    const M = () => m!;
    const num = async (sql: string, p: unknown[]) =>
      Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
    const escrever = <T>(fn: Parameters<MassaAdt['nucleo']['escrever']>[1]) =>
      M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-f31-01-preparo' }, fn) as Promise<T>;
    const limparRegras = () =>
      escrever(async (e) => {
        await e.executar('DELETE FROM regra_campo_cadastro WHERE estabelecimento_id = ? AND rotulo = ?', [
          M().est,
          ROTULO,
        ]);
      });
    const regra = (campo: string, r: { tipo?: string; fonte?: number | null } = {}) =>
      escrever(async (e) => {
        await e.executar(
          `INSERT INTO regra_campo_cadastro (estabelecimento_id, entidade, campo, modulo_recepcao_id, tipo_atendimento,
                                             fonte_pagadora_id, exigencia, rotulo, ativo, criado_em)
           VALUES (?, 'paciente', ?, NULL, ?, ?, 'obrigatorio', ?, TRUE, ?)`,
          [M().est, campo, r.tipo ?? 'todos', r.fonte ?? null, ROTULO, new Date()],
        );
      });
    const internar = (paciente: number, leito: string) =>
      porta
        .executar(
          contextoAdt(M()),
          'internacao.internar',
          {
            paciente,
            leito: { bloco: 'B1', acomodacao: 'Q1', leito },
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
          },
          { ...operacaoAdt(M()), reautenticadoEm: Date.now() },
        )
        .then((r) => r.resultado as Record<string, unknown>);
    // O que a admissão deixa no banco para o paciente e para o estabelecimento da massa.
    const retrato = async (paciente: number) => ({
      atendimentos: await num('SELECT COUNT(*) AS n FROM atendimento WHERE paciente_id = ?', [paciente]),
      internacoes: await num('SELECT COUNT(*) AS n FROM internacao WHERE paciente_id = ?', [paciente]),
      ocupacoes: await num('SELECT COUNT(*) AS n FROM ocupacao_leito WHERE estabelecimento_id = ?', [
        M().est,
      ]),
      leitosLivres: await num(
        `SELECT COUNT(*) AS n FROM leito_hospitalar l JOIN situacao_leito s ON s.id = l.situacao_leito_id
          WHERE l.estabelecimento_id = ? AND s.id = (SELECT situacao_leito_id FROM leito_hospitalar
                                                      WHERE estabelecimento_id = ? AND codigo = '03')`,
        [M().est, M().est],
      ),
    });
    const maeEEmail = (paciente: number, mae: string | null, desconhecida: boolean) =>
      escrever(async (e) => {
        await e.executar(
          `UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id
              SET pf.nome_mae = ?, pf.mae_desconhecida = ? WHERE p.id = ?`,
          [mae, desconhecida, paciente],
        );
      });
    const incompleto = (campos: string[]) => ({
      problema: expect.objectContaining({ codigo: 'cadastro-incompleto', campos }),
    });

    beforeAll(async () => {
      m = await prepararMassaAdt('G');
      porta = new PortaAdtPropria(M().nucleo);
      await limparRegras();
      for (const p of M().pacientes) await maeEEmail(p, null, false);
    });

    afterAll(async () => {
      if (m) {
        await limparRegras().catch(() => undefined);
        await escrever(async (e) => {
          await e.executar(
            `UPDATE paciente SET situacao = 'ativo' WHERE id IN (${M()
              .pacientes.map(() => '?')
              .join(',')})`,
            [...M().pacientes],
          );
        }).catch(() => undefined);
      }
      await encerrarMassaAdt(m);
    });

    it('cadastro incompleto no escopo da internação: a admissão é recusada com os campos e nada é gravado', async () => {
      const [p1] = M().pacientes;
      // A regra da consulta ambulatorial não vale na admissão; a da internação e a do convênio valem.
      await regra('celular', { tipo: 'ambulatorial' });
      await regra('nomeMae', { tipo: 'internacao' });
      await regra('email', { fonte: M().convenio });
      const antes = await retrato(p1!);
      await expect(internar(p1!, '01')).rejects.toMatchObject(incompleto(['email', 'nomeMae']));
      expect(await retrato(p1!)).toEqual(antes);
    });

    it('a mãe declarada desconhecida atende a regra; sem a regra do convênio, a admissão grava', async () => {
      const [p1] = M().pacientes;
      await maeEEmail(p1!, null, true);
      const antes = await retrato(p1!);
      // Ainda falta o e-mail exigido pelo convênio: só ele volta na recusa.
      await expect(internar(p1!, '01')).rejects.toMatchObject(incompleto(['email']));
      expect(await retrato(p1!)).toEqual(antes);
      await limparRegras();
      await regra('nomeMae', { tipo: 'internacao' });
      const r = await internar(p1!, '01');
      expect(Number(r['internacao'])).toBeGreaterThan(0);
      const depois = await retrato(p1!);
      expect(depois.atendimentos).toBe(antes.atendimentos + 1);
      expect(depois.internacoes).toBe(antes.internacoes + 1);
      expect(depois.ocupacoes).toBe(antes.ocupacoes + 1);
    });

    it('o cadastro provisório (paciente não identificado) não é barrado; o identificado continua recusado', async () => {
      const [, p2, p3] = M().pacientes;
      await escrever(async (e) => {
        await e.executar("UPDATE paciente SET situacao = 'provisorio' WHERE id = ?", [p2]);
      });
      const antes = await retrato(p3!);
      await expect(internar(p3!, '03')).rejects.toMatchObject(incompleto(['nomeMae']));
      expect(await retrato(p3!)).toEqual(antes);
      const r = await internar(p2!, '02');
      expect(Number(r['internacao'])).toBeGreaterThan(0);
      expect((await retrato(p2!)).internacoes).toBe(1);
    });
  },
);
