// Aviso do equipamento crítico parado (M55) sobre a porta própria no MariaDB (cliente f22_o3): a abertura da OS com a
// parada, a regra do domínio (alertaDeParada) pelo controlador e o aviso na central (notificacao_usuario) para os
// usuários da unidade do setor, na MESMA operação do Executor, com a trilha; repetir não avisa de novo. Massa
// SINTÉTICA (massa.spec-util.ts). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManutencaoController } from './manutencao.controller.js';
import {
  CLIENTE_MAN,
  contextoMan,
  encerrarMassaManutencao,
  lerBanco,
  type MassaManutencao,
  prepararMassaManutencao,
  SEM_BANCO_MAN,
  trilhaMan,
} from './massa.spec-util.js';
import type { GravadorManutencao } from './porta.js';
import { PortaManutencaoPropria } from './porta-propria.js';

type AvisarParada = (
  g: GravadorManutencao,
  eq: NonNullable<Awaited<ReturnType<GravadorManutencao['equipamento']>>>,
  os: { id: number; numero: string },
) => Promise<{ alerta: unknown; avisados: number }>;
const avisarParada = (ManutencaoController as unknown as { avisarParada: AvisarParada }).avisarParada.bind(
  ManutencaoController,
);

describe.skipIf(SEM_BANCO_MAN)(`aviso do crítico parado na porta própria (cliente ${CLIENTE_MAN})`, () => {
  let m: MassaManutencao | null = null;
  let porta: PortaManutencaoPropria;
  beforeAll(async () => {
    m = await prepararMassaManutencao('A');
    porta = new PortaManutencaoPropria(m.nucleo);
  }, 120_000);
  afterAll(async () => {
    await encerrarMassaManutencao(m);
  });

  it('OS + evento + aviso + trilha na mesma operação; o mesmo objeto não é avisado duas vezes', async () => {
    const M = m!;
    const c = contextoMan(M);
    const r = await porta.gravarSgh(
      c,
      (x: { os: number }) => trilhaMan(M, 'ordem_servico_manutencao', x.os),
      async (g) => {
        // O desligado da unidade (usuario_unidade excluído) fica fora: só o vínculo vigente recebe o aviso.
        expect(await g.loginsDoSetor(M.centro)).toEqual([M.loginAvisado]);
        const { agora } = await g.relogio();
        const novo = await g.incluirEquipamento({
          codigo: 'L0303-AVISO',
          nome: 'MONITOR SINTETICO AVISO',
          tipo: 'medico',
          criticidade: 'critica',
          classeRisco: 'III',
          fabricante: null,
          modelo: null,
          numeroSerie: null,
          registroAnvisa: null,
          unidade: null,
          centroCusto: M.centro,
          localizacao: null,
          recurso: { tipo: 'agendaExame', id: M.recurso },
          bemPatrimonial: null,
          instalacao: '2025-01-10',
          garantiaAte: null,
          situacao: 'ativo',
          motivo: null,
          usuario: M.loginUsuario,
        });
        const os = await g.abrirOs({
          natureza: 'corretiva',
          equipamento: novo.id,
          centroCusto: M.centro,
          local: null,
          descricao: 'Parou durante o uso (teste sintético)',
          contato: null,
          prioridadeSugerida: 'emergencia',
          prioridade: 'emergencia',
          solicitante: M.loginUsuario,
          registro: agora,
          parado: true,
          plano: null,
          nota: null,
        });
        const eq = await g.equipamento(novo.id);
        if (!eq) throw new Error('equipamento sintético não relido');
        const aviso = await avisarParada(g, eq, os);
        const repetido = await avisarParada(g, eq, os);
        return { os: os.id, avisados: aviso.avisados, repetidos: repetido.avisados, alerta: aviso.alerta };
      },
    );
    expect(r.alerta).not.toBeNull();
    expect(r.avisados).toBe(1);
    expect(r.repetidos).toBe(0);
    expect(
      await lerBanco(
        M,
        'SELECT COUNT(*) AS n, MAX(entidade_id) AS os, MAX(gravidade) AS g FROM notificacao_usuario WHERE estabelecimento_id = ? AND usuario_id = ?',
        [M.est, M.avisado],
      ),
    ).toMatchObject({ n: 1, os: r.os, g: 'alta' });
    expect(
      await lerBanco(
        M,
        'SELECT COUNT(*) AS n FROM notificacao_usuario WHERE estabelecimento_id = ? AND usuario_id = ?',
        [M.est, M.desligado],
      ),
    ).toMatchObject({ n: 0 });
    expect(
      await lerBanco(
        M,
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'ordem_servico_manutencao' AND entidade_id = ?",
        [r.os],
      ),
    ).toMatchObject({ n: 1 });
    expect((await porta.eventos(c, r.os)).map((e) => e.para)).toEqual(['aberta']);
  });
});
