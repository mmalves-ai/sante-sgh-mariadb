// M52.2, D-ESCALA-REDE-52: a Rede da regra 7 no núcleo segue o HS-1 (como o MPI do M57): um estabelecimento configurado
// fora de `liberados` não tem o banco lido; dentro, só se o pedido o liberar. Núcleo falso, sem banco.
import { describe, expect, it } from 'vitest';
import { portaEscalaLegado } from './porta-escala-legado.js';

function nucleoFalso() {
  const lidos: string[] = [];
  const nucleo = {
    estabelecimentos: [
      { codigo: 'pc', nome: 'Estabelecimento A' },
      { codigo: 'hs', nome: 'Estabelecimento B' },
    ],
    lerSomente: (ctx: { hospital: string }) => {
      lidos.push(ctx.hospital);
      return Promise.reject(new Error('sem banco no teste'));
    },
  };
  return { nucleo: nucleo as never, lidos };
}

const c = { rede: 'rede-sintetica', hospital: 'pc' };
const janela = { de: '2026-11-01T00:00', ate: '2026-11-30T23:59', inicioDesde: '2026-10-31T00:00' };

describe('portaEscalaLegado: a Rede da regra 7 (M52.2)', () => {
  it('estabelecimento configurado mas fora do HS-1 não é consultado nem conta como sem resposta', async () => {
    const { nucleo, lidos } = nucleoFalso();
    const porta = portaEscalaLegado(nucleo, { liberados: new Set(['pc']) });
    expect(await porta.plantoesNaRede(c, 1, janela)).toEqual({ intervalos: [], semResposta: 0 });
    expect(lidos).toEqual([]);
  });

  it('dentro do HS-1, o estabelecimento que o pedido não liberou também não é consultado', async () => {
    const { nucleo, lidos } = nucleoFalso();
    const porta = portaEscalaLegado(nucleo);
    expect(await porta.plantoesNaRede(c, 1, janela, async () => false)).toEqual({
      intervalos: [],
      semResposta: 0,
    });
    expect(lidos).toEqual([]);
  });

  it('liberado, segue para a consulta (começa pelo vínculo no banco da sessão)', async () => {
    const { nucleo, lidos } = nucleoFalso();
    const porta = portaEscalaLegado(nucleo);
    await expect(porta.plantoesNaRede(c, 1, janela, async () => true)).rejects.toThrow();
    expect(lidos).toEqual(['pc']);
  });
});
