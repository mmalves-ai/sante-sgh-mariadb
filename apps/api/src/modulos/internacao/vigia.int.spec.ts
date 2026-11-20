// Vigia de mudanças sobre a cópia (ficha do M16, regra 15 e seção 10): carga fixa — 50 telas escutando geram as
// mesmas consultas por ciclo que 1 (a contagem de consultas do próprio vigia e o MON$ das conexões do novo); a
// marca d'água perdida (apagada do armazém) faz o canal recomeçar do zero e avisar; o painel e os indicadores sobre
// a fonte do legado (READ ONLY) no tempo de tela. Saída só com contagens.
import { resolve } from 'node:path';
import { ambienteEfetivo, caminhoArquivoAmbiente, lerConfiguracaoNucleo, NucleoLegado } from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { PARAMETROS_PADRAO } from './configuracao.js';
import { fonteInternacaoLegado } from './fonte.js';
import { ServicoInternacao } from './servico.js';
import { MotorVigia } from './vigia.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const nucleo = new NucleoLegado({
  env: { ...env, FB_POOL_TETO: '3' },
  driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
  pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
});
const cod = nucleo.estabelecimentos[0]?.codigo ?? 'pc';
const fonte = fonteInternacaoLegado(nucleo);
afterAll(async () => {
  await nucleo.encerrar();
});

async function rodar(telas: number, ciclos: number) {
  const armazem = new ArmazemMemoria();
  let consultas = 0;
  const vigia = new MotorVigia({
    rede: nucleo.rede,
    lerCanal: async (h, c, m) => {
      const r = await fonte.canal({ rede: nucleo.rede, hospital: h, traceId: 'int-vigia' }, c, m);
      consultas += r.consultas;
      return r;
    },
    armazem,
    tipoArmazem: 'memoria',
    intervaloMs: 1_000,
  });
  let eventos = 0;
  const saidas = Array.from({ length: telas }, () => vigia.assinar(cod, 'leitos', () => void eventos++));
  vigia.parar();
  for (let k = 0; k < ciclos; k++) await vigia.cicloAgora(cod, 'leitos');
  for (const s of saidas) s();
  return { consultas, vigia, armazem, eventos };
}

describe('vigia sobre a cópia', () => {
  it('50 telas = as mesmas consultas que 1 (carga fixa por ciclo)', async () => {
    const um = await rodar(1, 5);
    const cinquenta = await rodar(50, 5);
    console.log(`[${cod}] consultas em 5 ciclos: 1 tela ${um.consultas}; 50 telas ${cinquenta.consultas}`);
    expect(cinquenta.consultas).toBe(um.consultas);
    expect(um.consultas).toBe(5);
    // Cada ciclo numa transação nova; sem gravação, nenhum aviso (nem no ciclo que segue o da marca zero).
    expect(um.eventos).toBe(0);
    expect(cinquenta.eventos).toBe(0);
    const s = um.vigia.saude().canais[0]!;
    console.log(`[${cod}] último ciclo do canal leitos: ${s.duracaoUltimoMs} ms`);
    expect(s.duracaoUltimoMs ?? 9_999).toBeLessThan(2_000);
  });

  it("marca d'água perdida: recomeça do zero, conta a releitura e avisa a mudança", async () => {
    const r = await rodar(1, 2);
    const eventos: number[] = [];
    r.vigia.assinar(cod, 'leitos', (e) => eventos.push(e.versao));
    r.vigia.parar();
    await r.armazem.apagar(`sgh:${nucleo.rede}:vigia:${cod}:leitos`);
    await r.vigia.cicloAgora(cod, 'leitos');
    expect(r.vigia.saude().canais[0]?.releituras).toBe(1);
    expect(eventos).toHaveLength(1);
  });

  it('painel, censo e indicadores pela fonte do legado (tempos de tela)', async () => {
    const s = new ServicoInternacao(fonte, null);
    const c = { rede: nucleo.rede, hospital: cod, traceId: 'int-m16-api' };
    const t: Record<string, number> = {};
    const medir = async <T>(n: string, f: () => Promise<T>) => {
      const i = performance.now();
      const v = await f();
      t[n] = Math.round(performance.now() - i);
      return v;
    };
    const p = await medir('painel', () => s.painel(c, PARAMETROS_PADRAO));
    const censo = await medir('censo', () => s.censo(c, PARAMETROS_PADRAO, undefined));
    await medir('indicadores', () => s.indice(c, PARAMETROS_PADRAO));
    await medir('serie', () =>
      s.serieIndicador(c, PARAMETROS_PADRAO, 'taxaOcupacao', { recorte: 'acomodacao' }),
    );
    console.log(
      `[${cod}] tempos (ms) ${JSON.stringify(t)}; internados no dia em aberto ${censo.totais.internados}; ocupados ${p.totais.ocupados}`,
    );
    expect(censo.totais.internados).toBe(
      p.totais.ocupados -
        p.avisos.filter((a) => a.tipo === 'leito-ocupado-sem-internacao').length +
        p.avisos.filter((a) => a.tipo === 'internacao-sem-leito-ocupado').length,
    );
    expect(t['painel']!).toBeLessThan(2_000);
  });
});
