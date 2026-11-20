// Portal sobre a cópia (ficha do M26, regra 9), em transação desfeita: só o liberado aparece; a liberação aberta traz o
// dono (paciente e atendimento) para a conferência; a visualização grava a data e o IP como o portal do outro sistema
// grava, e a segunda é recusada; o protocolo do paciente guarda só o resumo, e as tentativas erradas bloqueiam. Só
// contagens.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteSadt, ambienteSadt, MassaSadt, PODE_ESCREVER } from './copia.spec-util.js';

const trilha = (m: MassaSadt, id: string) => ({
  rede: m.c.rede,
  hospital: m.c.hospital,
  usuario: 'SGH.PORTAL',
  evento: 'sadt.portal.acesso',
  recurso: 'sadt.portal',
  operacao: 'portal (teste)',
  tabelaAlvo: 'SGH_SADT_PORTAL_ACESSO',
  idAlvo: id,
  chaveNaturalAlvo: null,
  resultado: 'sucesso' as const,
  estacao: 'teste',
  correlacao: `int-m26-portal-${id}`,
  idPaciente: null,
});

describe.skipIf(!PODE_ESCREVER)('portal na cópia (transação desfeita)', () => {
  let a: AmbienteSadt;
  beforeAll(async () => {
    a = await ambienteSadt();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('só o liberado do paciente; a visualização com data e IP; o protocolo pelo resumo e o bloqueio', async () => {
    await a.nucleo.desfazendoNaCopia(
      { rede: a.nucleo.rede, hospital: a.cod, traceId: 'int-m26-portal' },
      async (e) => {
        const m = new MassaSadt(a, e);
        const resp = await m.profissional(['2212', '2234', '225335']);
        const ex = await m.lancar('E', resp);
        await m.digitar(ex.id, resp, 4.4);
        const atos = await m.porta.atosPublicados(m.c);
        expect(atos).toContain(15);
        const exame = await m.porta.exame(m.c, ex.id);
        const antes = await m.porta.laudosPortalDoPaciente(m.c, {
          paciente: ex.paciente,
          reg: exame!.chave.reg,
          atos,
        });
        expect(antes.laudos.some((l) => l.exame === ex.id)).toBe(false);
        await m.liberar(ex.id, resp);
        const depois = await m.porta.laudosPortalDoPaciente(m.c, {
          paciente: ex.paciente,
          reg: exame!.chave.reg,
          atos,
        });
        const laudo = depois.laudos.find((l) => l.exame === ex.id);
        expect(laudo).toBeDefined();
        const aberto = await m.porta.laudoPortal(m.c, laudo!.liberacao);
        expect(aberto).toMatchObject({ paciente: ex.paciente, ato: 15 });
        await m.executar(
          'sadt.registrarVisualizacaoPortal',
          { liberacao: laudo!.liberacao, ip: '127.0.0.26', acao: 'visualizacao' },
          resp.login,
        );
        const [v] = await e.consultar(
          'SELECT DATA_HORA_VISUALIZACAO D, IP_VIZUALIZACAO I, ID_TBOPCOES_VIZUALIZACAO O FROM SILIBERACAOEXAME WHERE ID = ?',
          [laudo!.liberacao],
          { teto: 1 },
        );
        expect(v?.['D']).toBeInstanceOf(Date);
        expect(String(v?.['I'])).toBe('127.0.0.26');
        expect(Number(v?.['O'])).toBe(14);
        await expect(
          m.executar(
            'sadt.registrarVisualizacaoPortal',
            { liberacao: laudo!.liberacao, ip: '127.0.0.26', acao: 'visualizacao' },
            resp.login,
          ),
        ).rejects.toMatchObject({ problema: { codigo: 'ja-visto' } });
        // O protocolo do paciente: só o resumo guardado; a tentativa errada conta e bloqueia.
        const resumo = createHash('sha256').update('ABCDE23456').digest('hex');
        const id = await m.porta.gravarSgh(m.c, trilha(m, 'protocolo'), (g) =>
          g.criarProtocoloPortal({
            paciente: ex.paciente,
            reg: exame!.chave.reg,
            protocoloResumo: resumo,
            usuario: resp.login,
          }),
        );
        const acesso = await m.porta.acessoPorProtocolo(m.c, resumo);
        expect(acesso).toMatchObject({ id, perfil: 'paciente', paciente: ex.paciente, situacao: 'ativo' });
        const ate = new Date(Date.now() + 15 * 60_000);
        await m.porta.gravarSgh(m.c, trilha(m, String(id)), (g) =>
          g.registrarTentativaPortal({ id, tentativas: 5, bloqueadoAte: ate, acertou: false }),
        );
        expect((await m.porta.acessoPorId(m.c, id))?.tentativas).toBe(5);
      },
    );
  });
});
