// Regra 8 do M27 contra o MariaDB (cliente de teste f22_o2): o aviso é gravado na transação da mensagem e o canal avisa
// só DEPOIS do COMMIT (a gravação que falha não avisa); o canal só diz "mudou" e o cliente relê o estado gravado, então
// a reconexão (outro serviço, outro canal) não perde aviso. Massa sintética; só contagens na saída.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AvisosAtendimento } from '../../atendimento/avisos.js';
import type { PortaComunicacao } from '../comunicacao-porta.js';
import { PortaComunicacaoPropria } from '../comunicacao-porta-propria.js';
import { chaveDoCanal, ServicoComunicacao } from './comunicacao.js';
import { type MassaComunicacao, montarMassaComunicacao, SEM_BANCO } from './massa-comunicacao.spec-util.js';

describe.skipIf(SEM_BANCO)('aviso em tempo real sobre o banco próprio (f22_o2)', () => {
  let m: MassaComunicacao;
  beforeAll(async () => {
    m = await montarMassaComunicacao('t');
    await m.limpar();
  });
  afterAll(async () => {
    await m?.limpar();
    await m?.nucleo.encerrar();
  });

  it('avisa depois do COMMIT; a falha não avisa; a releitura traz o aviso', async () => {
    const base = new PortaComunicacaoPropria(m.nucleo);
    let dentro = false;
    const porta: PortaComunicacao = Object.assign(Object.create(base) as PortaComunicacao, {
      async gravarSgh(...args: Parameters<PortaComunicacao['gravarSgh']>) {
        dentro = true;
        try {
          return await base.gravarSgh(...args);
        } finally {
          dentro = false;
        }
      },
    });
    const canal = new AvisosAtendimento(null);
    const vistos: { versao: number; dentro: boolean }[] = [];
    const cancelar = canal.assinar(chaveDoCanal(m.codA, m.login.d1), (versao) => vistos.push({ versao, dentro }));
    const s = new ServicoComunicacao(porta, canal);
    const autor = { login: m.login.rem, estacao: 'INT-M27', correlacao: 'int-m27-aviso-1' };
    const msg = (destino: string) => ({
      assunto: 'Aviso M27',
      texto: 'Mensagem sintética do teste do aviso.',
      destinos: [{ tipo: 'usuario' as const, valor: destino }],
      cienciaObrigatoria: false,
      contextoAtendimento: null,
    });
    await expect(s.enviar(m.ctx('rem'), autor, msg('f2201.ninguem'), 'int-m27-aviso-falha')).rejects.toBeTruthy();
    expect(vistos).toEqual([]);
    const inicio = performance.now();
    const r = await s.enviar(m.ctx('rem'), autor, msg(m.login.d1), `int-m27-aviso-${Date.now()}`);
    expect(vistos).toEqual([{ versao: 1, dentro: false }]);
    cancelar();
    const outro = new ServicoComunicacao(new PortaComunicacaoPropria(m.nucleo), null);
    const central = await outro.avisos(m.ctx('d1'), m.login.d1, 0);
    expect(central.avisos.find((x) => x.link === `/mensagens?id=${r.id}`)?.estado).toBe('novo');
    expect(central.novos).toBeGreaterThan(0);
    console.log(`[int-m27] do envio à releitura do aviso: ${Math.round(performance.now() - inicio)} ms`);
  });
});
