// Valor crítico sobre a cópia (ficha do M26, regra 7), em transação desfeita: com a faixa crítica do exame, a liberação
// feita aqui emite o aviso na mesma gravação (origem "novo"); a liberação feita "pelo outro sistema" (as marcas da
// liberação gravadas direto, como o executável grava) é achada pela vigia no ciclo seguinte e o aviso sai com a origem
// "outroSistema"; o tempo da liberação ao aviso é medido (meta: menos de 1 minuto). Só contagens e tempos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FonteConfiguracao } from '../../config/public-api.js';
import type { NovoAviso } from '@sgh/contratos';
import type { CentralDeAvisos } from './central-critico.js';
import { VigiaCriticos } from './vigia-criticos.js';
import { type AmbienteSadt, ambienteSadt, MassaSadt, PODE_ESCREVER } from './copia.spec-util.js';

/** A configuração com a funcionalidade do valor crítico ligada no estabelecimento (a aprovação dispensada). */
const configuracao = {
  chaves: async () => [
    { chave: 'sadt.critico', tipo: 'recurso', escopo: 'hospital', valor: '*', ligada: true },
  ],
  prerequisitos: async () => [
    {
      recurso: 'sadt.critico',
      tipo: 'aprovacao',
      situacao: 'dispensado',
      validade: null,
      evidencia: 'teste',
      alteradoPor: 'SGH.TESTE',
      alteradoEm: new Date().toISOString(),
    },
  ],
  valoresParametro: async () => [],
} as unknown as FonteConfiguracao;

describe.skipIf(!PODE_ESCREVER)('aviso de valor crítico na cópia (transação desfeita)', () => {
  let a: AmbienteSadt;
  beforeAll(async () => {
    a = await ambienteSadt();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a liberação daqui avisa na gravação; a do outro sistema, pela vigia em menos de 1 minuto', async () => {
    await a.nucleo.desfazendoNaCopia(
      { rede: a.nucleo.rede, hospital: a.cod, traceId: 'int-m26-critico' },
      async (e) => {
        const m = new MassaSadt(a, e);
        const resp = await m.profissional(['2212', '2234', '225335']);
        const ex = await m.lancar('E', resp);
        const cad = await m.exameLaboratorio();
        await m.faixaCritica(cad.codigo, 1);
        await m.digitar(ex.id, resp, 4.5);
        await m.liberar(ex.id, resp);
        const { hoje } = await m.porta.relogio(m.c);
        const avisos = await m.porta.avisos(m.c, { inicio: hoje, fim: hoje });
        const daqui = avisos.find((x) => x.exame === ex.id);
        expect(daqui).toMatchObject({ origem: 'novo', situacao: 'aguardandoCiencia', nivel: 0 });
        // A liberação do outro sistema: digitado pelo executor, liberado direto nas marcas do exame.
        const outro = await m.lancar('E', resp);
        await m.digitar(outro.id, resp, 4.8);
        // A central de avisos (revisão do M27): o médico do atendimento recebe o aviso depois do ciclo, uma vez.
        const emitidos: NovoAviso[] = [];
        const central: CentralDeAvisos = {
          emitir: async (_c, _a, novo) => {
            if (emitidos.some((x) => x.login === novo.login && x.objetoChave === novo.objetoChave))
              return null;
            emitidos.push(novo);
            return emitidos.length;
          },
        };
        const vigia = new VigiaCriticos(
          m.porta,
          a.nucleo.rede,
          [a.cod],
          configuracao,
          null,
          undefined,
          central,
        );
        await vigia.ciclo(a.cod); // marca o instante visto (nada novo)
        const t0 = Date.now();
        // A estação do outro sistema com o relógio 2 minutos atrasado: a marca fica abaixo do cursor da vigia, e a
        // releitura com sobreposição ainda a acha.
        await e.executar(
          "UPDATE SILANEXA SET RESLIB = 'T', USUARIOLIB = ?, DATA_HORA_LIBERA_EXAME = DATEADD(-120 SECOND TO CURRENT_TIMESTAMP) WHERE ID = ?",
          [resp.login, outro.id],
        );
        const r = await vigia.ciclo(a.cod);
        const ms = Date.now() - t0;
        expect(r.avisos).toBeGreaterThanOrEqual(1);
        // A sobreposição não repete o aviso (nem a trilha): o que já avisou sai da consulta.
        expect((await vigia.ciclo(a.cod)).avisos).toBe(0);
        const medico = await m.porta.responsavelDoAtendimento(m.c, outro.atendimento);
        const doOutro = emitidos.filter((x) => x.objetoChave.startsWith(`${outro.id}:`));
        expect(doOutro).toHaveLength(medico ? 1 : 0);
        if (medico)
          expect(doOutro[0]).toMatchObject({ login: medico, tipo: 'resultado-critico', modulo: 'sadt' });
        console.log(
          `[${a.cod}] central de avisos: ${doOutro.length} aviso (médico do atendimento ${medico ? 'com' : 'sem'} usuário)`,
        );
        // A API reiniciada (cursor vazio) acha a liberação feita enquanto estava fora.
        const fora = await m.lancar('E', resp);
        await m.digitar(fora.id, resp, 4.9);
        await e.executar(
          "UPDATE SILANEXA SET RESLIB = 'T', USUARIOLIB = ?, DATA_HORA_LIBERA_EXAME = DATEADD(-30 MINUTE TO CURRENT_TIMESTAMP) WHERE ID = ?",
          [resp.login, fora.id],
        );
        const reiniciada = new VigiaCriticos(m.porta, a.nucleo.rede, [a.cod], configuracao, null);
        expect((await reiniciada.ciclo(a.cod)).avisos).toBeGreaterThanOrEqual(1);
        expect((await reiniciada.ciclo(a.cod)).avisos).toBe(0);
        const depois = await m.porta.avisos(m.c, { inicio: hoje, fim: hoje });
        expect(depois.find((x) => x.exame === outro.id)).toMatchObject({ origem: 'outroSistema' });
        expect(depois.find((x) => x.exame === fora.id)).toMatchObject({ origem: 'outroSistema' });
        // O aviso da liberação daqui não se repete no ciclo da vigia (a chave única pela liberação).
        expect(depois.filter((x) => x.exame === ex.id)).toHaveLength(1);
        expect(ms).toBeLessThan(60_000);
        console.log(`[${a.cod}] aviso da liberação do outro sistema em ${ms} ms (meta < 60 s)`);
      },
    );
  });
});
