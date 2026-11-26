// Cancelamento de exame cuja marcação veio migrada sem situação na origem (recusas da carga, fase 2): a agenda de
// exames recusa cancelarExame com `marcacao-nao-informada` (a marcação está encerrada, só consulta), sem cancelamento
// gravado e com o horário como estava. Massa SINTÉTICA da recepção (rc0101a) mais uma agenda de exame própria deste
// arquivo ("RCNI"), apagada antes e depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  garantir,
  garantirCliente,
  hojeSP,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from '../recepcao/massa-recepcao.spec-util.js';
import { situacaoNaoInformada } from '../recepcao/marcacao-nao-informada.spec-util.js';
import { PortaExamePropria } from './porta-propria.js';

const AGENDA = 'Agenda SINTETICA RCNI EXAME';

async function limpar(e: Escritor): Promise<void> {
  const ag = `SELECT id FROM agenda_servico WHERE nome = '${AGENDA}'`;
  const hs = `SELECT id FROM horario_agenda WHERE agenda_servico_id IN (${ag})`;
  const ms = `SELECT id FROM marcacao_horario WHERE horario_agenda_id IN (${hs})`;
  for (const sql of [
    `DELETE FROM cancelamento_marcacao WHERE marcacao_horario_id IN (${ms})`,
    `DELETE FROM marcacao_horario_historico WHERE marcacao_horario_id IN (${ms})`,
    `DELETE FROM marcacao_horario WHERE horario_agenda_id IN (${hs})`,
    `DELETE FROM horario_agenda WHERE agenda_servico_id IN (${ag})`,
    `DELETE FROM agenda_servico WHERE nome = '${AGENDA}'`,
    "DELETE FROM categoria_agenda WHERE codigo = 'rcni_exame'",
  ])
    await e.executar(sql, []);
}

describe.skipIf(SEM_BANCO)(
  'cancelamento de exame com marcação migrada sem situação na origem (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaExamePropria;
    let m: Massa;
    let marcacao = 0;
    let horario = 0;
    let ctx: ContextoNucleo;
    const correlacao = { cliente: CLIENTE, correlacao: 'teste-exame-nao-informada' };
    const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      nucleo.lerSomente(correlacao, (l) => l.consultar<T>(sql, p));

    beforeAll(async () => {
      garantirCliente();
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo);
      const situacao = await situacaoNaoInformada(nucleo);
      await nucleo.escrever(correlacao, async (e) => {
        await limpar(e);
        const id = async (sql: string) => Number((await e.uma<{ id: unknown }>(sql, []))?.id);
        const cat = await garantir(
          e,
          'categoria_agenda',
          { codigo: 'rcni_exame' },
          { descricao: 'Exame sintético', natureza: 'exame' },
        );
        const agenda = await garantir(
          e,
          'agenda_servico',
          { estabelecimento_id: m.est, nome: AGENDA },
          { categoria_agenda_id: cat, profissional_id: m.profissional, duracao_horario_minutos: 15 },
        );
        const hoje = hojeSP();
        const inicio = new Date(`${hoje}T14:00:00Z`);
        horario = await garantir(
          e,
          'horario_agenda',
          { agenda_servico_id: agenda, inicio_em: inicio, encaixe_ordem: 0 },
          {
            estabelecimento_id: m.est,
            data_referencia: hoje,
            fim_em: new Date(inicio.getTime() + 15 * 60_000),
            situacao: 'ocupado',
            vagas_ocupadas: 1,
          },
        );
        marcacao = await garantir(
          e,
          'marcacao_horario',
          { estabelecimento_id: m.est, numero: `RCNI-${hoje}` },
          {
            horario_agenda_id: horario,
            paciente_id: m.paciente,
            tipo_marcacao_id: await id("SELECT id FROM tipo_marcacao WHERE codigo = 'rc0101_primeira'"),
            situacao_marcacao_id: situacao,
            canal_marcacao_id: await id("SELECT id FROM canal_marcacao WHERE codigo = 'rc0101_presencial'"),
            fonte_pagadora_id: await id("SELECT id FROM fonte_pagadora WHERE codigo = 'rc0101_part'"),
            duracao_minutos: 15,
            marcado_em: new Date(),
            responsavel_usuario_id: m.usuario,
            origem: 'migracao',
          },
        );
      });
      ctx = {
        cliente: CLIENTE,
        estabelecimento: m.est,
        usuario: m.usuario,
        correlacao: 'teste-exame-nao-informada',
      };
      porta = new PortaExamePropria(nucleo);
    });
    afterAll(async () => {
      if (m) await nucleo.escrever(correlacao, limpar);
      await nucleo?.encerrar();
    });

    it('cancelarExame recusa a marcação "nao_informada" com marcacao-nao-informada; nada gravado', async () => {
      await expect(
        porta.executar(
          ctx,
          'agenda.cancelarExame',
          { marcacao, motivo: 'PAC-DESISTIU', solicitante: 'paciente' },
          { ...ctx, chaveIdempotencia: `rcni-${randomUUID()}` },
        ),
      ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'marcacao-nao-informada' }) });
      const [c] = await ler<{ n: unknown }>(
        'SELECT COUNT(*) AS n FROM cancelamento_marcacao WHERE marcacao_horario_id = ?',
        [marcacao],
      );
      expect(Number(c?.n)).toBe(0);
      const [h] = await ler<{ situacao: unknown; vagas_ocupadas: unknown }>(
        'SELECT situacao, vagas_ocupadas FROM horario_agenda WHERE id = ?',
        [horario],
      );
      expect(h).toMatchObject({ situacao: 'ocupado' });
      expect(Number(h?.vagas_ocupadas)).toBe(1);
    });
  },
);
