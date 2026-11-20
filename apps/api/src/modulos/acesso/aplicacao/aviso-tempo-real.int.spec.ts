// Regra 8 do M27 sobre a cópia (transação desfeita): o aviso é gravado na transação da mensagem e o canal avisa só
// DEPOIS que a transação termina (a gravação que falha não avisa); o canal só diz "mudou" e o cliente relê o estado
// gravado, então a reconexão (outro serviço, outro canal) não perde aviso. Na cópia compartilhada nada é confirmado
// (COMMIT proibido): o fim da transação aqui é o fim do `gravarSgh` da porta, como no COMMIT do `nucleo.gravarSgh`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AvisosAtendimento } from '../../atendimento/avisos.js';
import { type PortaComunicacao, portaComunicacaoNaTransacao } from '../comunicacao-porta.js';
import { chaveDoCanal, ServicoComunicacao } from './comunicacao.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER, usuariosAtivos } from './copia.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('aviso em tempo real na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('avisa depois do fim da transação; a falha não avisa; a releitura traz o aviso', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m27-aviso' }, async (e) => {
      const u = await usuariosAtivos(e);
      const base = portaComunicacaoNaTransacao(e, a.executor);
      let dentro = false;
      const porta: PortaComunicacao = {
        ...base,
        async gravarSgh(c, trilha, fn) {
          dentro = true;
          try {
            return await base.gravarSgh(c, trilha, fn);
          } finally {
            dentro = false;
          }
        },
      };
      const canal = new AvisosAtendimento(null);
      const vistos: { versao: number; dentro: boolean }[] = [];
      const cancelar = canal.assinar(chaveDoCanal(a.cod, u.b), (versao) => vistos.push({ versao, dentro }));
      const s = new ServicoComunicacao(porta, canal);
      const autor = { login: u.a, estacao: 'INT-M27', correlacao: 'int-m27-aviso-1' };
      const msg = (destino: string) => ({
        assunto: 'Aviso M27',
        texto: 'Mensagem sintética do teste do aviso.',
        destinos: [{ tipo: 'usuario' as const, valor: destino }],
        cienciaObrigatoria: false,
        contextoAtendimento: null,
      });
      // A falha (destino sem usuário ativo) não grava nem avisa.
      await expect(s.enviar(a.c, autor, msg('SGH.NINGUEM.M27'), 'int-m27-aviso-falha')).rejects.toBeTruthy();
      expect(vistos).toEqual([]);
      const inicio = performance.now();
      const r = await s.enviar(a.c, autor, msg(u.b), 'int-m27-aviso-ok');
      expect(vistos).toEqual([{ versao: 1, dentro: false }]);
      cancelar();
      // Reconexão: outro serviço (outro processo) relê do banco e encontra o aviso novo.
      const outro = new ServicoComunicacao(portaComunicacaoNaTransacao(e, a.executor), null);
      const central = await outro.avisos(a.c, u.b, 0);
      const ms = performance.now() - inicio;
      expect(central.avisos.find((x) => x.link === `/mensagens?id=${r.id}`)?.estado).toBe('novo');
      expect(central.novos).toBeGreaterThan(0);
      console.log(`[int-m27] do envio à releitura do aviso: ${Math.round(ms)} ms`);
    });
  });
});
