// Contrato de efeito do módulo de recepção da ADMISSÃO da internação pela origem (F3.1, 02-CAD linha 2) contra o MariaDB
// real (cliente de teste; f22_o3 por padrão), massa SINTÉTICA (massa-adt.spec-util.ts, marca K). A admissão não tem
// local de atendimento: internacao.internar passa o usuário da sessão, e o módulo sai do canal de entrada "internacao"
// (modulo_recepcao.canal_entrada) ANTES do guichê que o usuário ocupa (o ato decide: quem interna no balcão do guichê
// está internando); sem canal declarado, vale o guichê. Prova o que fica no banco: recusada pela regra do módulo que
// vence, NADA é gravado (nem atendimento, nem internação, nem ocupação de leito). Módulos, local, guichê, ocupação e
// regras saem no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
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

const ROTULO = 'REGRA ORIGEM ADMISSAO L0301K';
const COD_INT = 'ORIG-INT-L0301K';
const COD_GUI = 'ORIG-GUI-L0301K';
const NUMERO_GUICHE = 9872;

describe.skipIf(SEM_BANCO_ADT)(
  `módulo de recepção da admissão pela origem (MariaDB, cliente ${CLIENTE_ADT})`,
  () => {
    let m: MassaAdt | null = null;
    let porta: PortaAdtPropria;
    let moduloInt = 0;
    let moduloGui = 0;
    let ponto = 0;
    let local = 0;
    let guiche = 0;
    const M = () => m!;
    const num = async (sql: string, p: unknown[]) =>
      Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
    const escrever = <T>(fn: Parameters<MassaAdt['nucleo']['escrever']>[1]) =>
      M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-f31-01-origem' }, fn) as Promise<T>;
    const limparRegras = () =>
      escrever(async (e) => {
        await e.executar('DELETE FROM regra_campo_cadastro WHERE estabelecimento_id = ? AND rotulo = ?', [
          M().est,
          ROTULO,
        ]);
      });
    const regra = (campo: string, modulo: number) =>
      escrever(async (e) => {
        await e.executar(
          `INSERT INTO regra_campo_cadastro (estabelecimento_id, entidade, campo, modulo_recepcao_id, tipo_atendimento,
                                             fonte_pagadora_id, exigencia, rotulo, ativo, criado_em)
           VALUES (?, 'paciente', ?, ?, 'todos', NULL, 'obrigatorio', ?, TRUE, ?)`,
          [M().est, campo, modulo, ROTULO, new Date()],
        );
      });
    const canal = (id: number, c: string | null) =>
      escrever(async (e) => {
        await e.executar('UPDATE modulo_recepcao SET canal_entrada = ? WHERE id = ?', [c, id]);
      });
    const ocupar = (sim: boolean) =>
      escrever(async (e) => {
        await e.executar('DELETE FROM ocupacao_guiche WHERE guiche_recepcao_id = ?', [guiche]);
        if (sim)
          await e.executar(
            `INSERT INTO ocupacao_guiche (guiche_recepcao_id, operacao, ocorrido_em, usuario_id, ocupante_usuario_id,
                                          local_atendimento_id, inicio_em, criado_em)
             VALUES (?, 'inclusao', ?, ?, ?, NULL, ?, ?)`,
            [guiche, new Date(), M().usuario, M().usuario, new Date(), new Date()],
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
    const retrato = async (paciente: number) => ({
      atendimentos: await num('SELECT COUNT(*) AS n FROM atendimento WHERE paciente_id = ?', [paciente]),
      internacoes: await num('SELECT COUNT(*) AS n FROM internacao WHERE paciente_id = ?', [paciente]),
      ocupacoes: await num('SELECT COUNT(*) AS n FROM ocupacao_leito WHERE estabelecimento_id = ?', [
        M().est,
      ]),
    });
    const incompleto = (campos: string[]) => ({
      problema: expect.objectContaining({ codigo: 'cadastro-incompleto', campos }),
    });

    beforeAll(async () => {
      m = await prepararMassaAdt('K');
      porta = new PortaAdtPropria(M().nucleo);
      await limparRegras();
      const ids = await escrever<{ i: number; g: number; p: number; l: number; gu: number }>(async (e) => {
        const agora = new Date();
        const modulo = async (codigo: string) => {
          const x = await e.uma<{ id: unknown }>('SELECT id FROM modulo_recepcao WHERE codigo = ?', [codigo]);
          return x
            ? Number(x.id)
            : await e.inserir('INSERT INTO modulo_recepcao (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
                codigo,
                `MODULO SINTETICO ${codigo}`,
                agora,
              ]);
        };
        const i = await modulo(COD_INT);
        const g = await modulo(COD_GUI);
        const px = await e.uma<{ id: unknown }>(
          'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?',
          [M().est, 'ORIGK'],
        );
        const p = px
          ? Number(px.id)
          : await e.inserir(
              'INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
              [M().est, 'ORIGK', 'PONTO SINTETICO L0301K', agora],
            );
        const lx = await e.uma<{ id: unknown }>(
          'SELECT id FROM local_atendimento WHERE estabelecimento_id = ? AND codigo = ?',
          [M().est, 'ORIGK'],
        );
        const l = lx
          ? Number(lx.id)
          : await e.inserir(
              `INSERT INTO local_atendimento (estabelecimento_id, codigo, descricao, ponto_recepcao_id, criado_em)
               VALUES (?, ?, ?, ?, ?)`,
              [M().est, 'ORIGK', 'LOCAL SINTETICO L0301K', p, agora],
            );
        await e.executar('UPDATE local_atendimento SET modulo_recepcao_id = ? WHERE id = ?', [g, l]);
        const gx = await e.uma<{ id: unknown }>(
          'SELECT id FROM guiche_recepcao WHERE ponto_recepcao_id = ? AND numero = ?',
          [p, NUMERO_GUICHE],
        );
        const gu = gx
          ? Number(gx.id)
          : await e.inserir(
              `INSERT INTO guiche_recepcao (ponto_recepcao_id, numero, descricao, local_atendimento_id, criado_em)
               VALUES (?, ?, ?, ?, ?)`,
              [p, NUMERO_GUICHE, 'GUICHE SINTETICO L0301K', l, agora],
            );
        return { i, g, p, l, gu };
      });
      moduloInt = ids.i;
      moduloGui = ids.g;
      ponto = ids.p;
      local = ids.l;
      guiche = ids.gu;
      for (const p of M().pacientes)
        await escrever(async (e) => {
          await e.executar(
            `UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id
                SET pf.nome_mae = NULL, pf.mae_desconhecida = FALSE WHERE p.id = ?`,
            [p],
          );
        });
    });

    afterAll(async () => {
      if (m) {
        await limparRegras().catch(() => undefined);
        await escrever(async (e) => {
          if (guiche) {
            await e.executar('DELETE FROM ocupacao_guiche WHERE guiche_recepcao_id = ?', [guiche]);
            await e.executar('DELETE FROM guiche_recepcao WHERE id = ?', [guiche]);
          }
          if (local) await e.executar('DELETE FROM local_atendimento WHERE id = ?', [local]);
          if (ponto) await e.executar('DELETE FROM ponto_recepcao WHERE id = ?', [ponto]);
          await e.executar('DELETE FROM modulo_recepcao WHERE id IN (?, ?)', [moduloInt, moduloGui]);
        }).catch(() => undefined);
      }
      await encerrarMassaAdt(m);
    });

    it('canal "internacao" com guichê ocupado: vale o canal; sem canal, vale o guichê; recusada, nada é gravado', async () => {
      const [p1] = M().pacientes;
      await regra('nomeMae', moduloInt);
      await regra('email', moduloGui);
      try {
        await ocupar(true);
        // Sem canal declarado, a admissão do usuário no guichê usa o módulo do guichê.
        const antes = await retrato(p1!);
        await expect(internar(p1!, '01')).rejects.toMatchObject(incompleto(['email']));
        expect(await retrato(p1!)).toEqual(antes);
        // O módulo declara o canal da internação: ele vale sobre o guichê ocupado (só a regra dele volta).
        await canal(moduloInt, 'internacao');
        await expect(internar(p1!, '01')).rejects.toMatchObject(incompleto(['nomeMae']));
        expect(await retrato(p1!)).toEqual(antes);
        // Sem guichê ocupado, o canal continua valendo.
        await ocupar(false);
        await expect(internar(p1!, '01')).rejects.toMatchObject(incompleto(['nomeMae']));
        expect(await retrato(p1!)).toEqual(antes);
        // Sem canal e sem guichê: as regras dos módulos não valem, e a admissão grava.
        await canal(moduloInt, null);
        const r = await internar(p1!, '01');
        expect(Number(r['internacao'])).toBeGreaterThan(0);
        const depois = await retrato(p1!);
        expect(depois.atendimentos).toBe(antes.atendimentos + 1);
        expect(depois.internacoes).toBe(antes.internacoes + 1);
        expect(depois.ocupacoes).toBe(antes.ocupacoes + 1);
      } finally {
        await ocupar(false);
        await canal(moduloInt, null);
        await limparRegras();
      }
    });
  },
);
