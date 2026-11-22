// Vigia de mudanças sobre o banco próprio (ficha do M16, regra 15): carga fixa — 50 telas escutando geram as mesmas
// consultas por ciclo que 1 (a contagem de consultas do próprio vigia); a marca d'água perdida (apagada do armazém)
// faz o canal recomeçar do zero e avisar; o painel, o censo e os indicadores pela fonte própria no tempo de tela.
// Cliente de teste f22_o2 (onda 2), massa SINTÉTICA: só um estabelecimento "L0211V" (nenhuma pessoa real). Saída só
// com contagens. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { PARAMETROS_PADRAO } from './configuracao.js';
import type { CtxInternacao } from './fonte.js';
import { FonteInternacaoPropria } from './fonte-propria.js';
import { ServicoInternacao } from './servico.js';
import { MotorVigia } from './vigia.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const COD = 'L0211V';

describe.skipIf(SEM_BANCO)('vigia sobre o banco próprio (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteInternacaoPropria;
  let alvo: ContextoNucleo;
  let criado = false;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    const est = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: 'preparo-teste-02-11-vigia' },
      async (e) => {
        const l = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [COD]);
        if (l) return Number(l.id);
        criado = true;
        return e.inserir(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [COD, 'ESTAB SINTETICO VIGIA', 'ESTAB SINTETICO VIGIA', new Date()],
        );
      },
    );
    alvo = { cliente: CLIENTE, estabelecimento: est, usuario: null, correlacao: 'teste-02-11-vigia' };
    fonte = new FonteInternacaoPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (criado)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-11-vigia' }, (e) =>
        e.executar('DELETE FROM estabelecimento WHERE id = ?', [alvo.estabelecimento]),
      );
    await nucleo.encerrar();
  });

  async function rodar(telas: number, ciclos: number) {
    const armazem = new ArmazemMemoria();
    let consultas = 0;
    const vigia = new MotorVigia({
      lerCanal: async (ctx, canal, marca) => {
        const r = await fonte.canal(ctx, canal, marca);
        consultas += r.consultas;
        return r;
      },
      armazem,
      tipoArmazem: 'memoria',
      intervaloMs: 1_000,
    });
    let eventos = 0;
    const saidas = Array.from({ length: telas }, () => vigia.assinar(alvo, 'leitos', () => void eventos++));
    vigia.parar();
    for (let k = 0; k < ciclos; k++) await vigia.cicloAgora(alvo, 'leitos');
    for (const s of saidas) s();
    return { consultas, vigia, armazem, eventos };
  }

  it('50 telas = as mesmas consultas que 1 (carga fixa por ciclo)', async () => {
    const um = await rodar(1, 5);
    const cinquenta = await rodar(50, 5);
    expect(cinquenta.consultas).toBe(um.consultas);
    expect(um.consultas).toBe(5);
    // Sem gravação nas tabelas do canal, nenhum aviso (nem no ciclo que segue o da marca zero).
    expect(um.eventos).toBe(0);
    expect(cinquenta.eventos).toBe(0);
    const s = um.vigia.saude().canais[0]!;
    expect(s.duracaoUltimoMs ?? 9_999).toBeLessThan(2_000);
  });

  it("marca d'água perdida: recomeça do zero, conta a releitura e avisa a mudança", async () => {
    const r = await rodar(1, 2);
    const eventos: number[] = [];
    r.vigia.assinar(alvo, 'leitos', (e) => eventos.push(e.versao));
    r.vigia.parar();
    await r.armazem.apagar(`sgh:${CLIENTE}:vigia:${alvo.estabelecimento}:leitos`);
    await r.vigia.cicloAgora(alvo, 'leitos');
    expect(r.vigia.saude().canais[0]?.releituras).toBe(1);
    expect(eventos).toHaveLength(1);
  });

  it('painel, censo e indicadores pela fonte própria (tempos de tela)', async () => {
    const s = new ServicoInternacao(fonte, null);
    const c: CtxInternacao = { rede: CLIENTE, hospital: COD, traceId: 'int-02-11-m16', porta: alvo };
    const t: Record<string, number> = {};
    const medir = async <T>(n: string, f: () => Promise<T>) => {
      const i = performance.now();
      const v = await f();
      t[n] = Math.round(performance.now() - i);
      return v;
    };
    const p = await medir('painel', () => s.painel(c, PARAMETROS_PADRAO));
    const censo = await medir('censo', () => s.censo(c, PARAMETROS_PADRAO, undefined));
    // Estabelecimento sem movimento: o período vai explícito (o padrão é o dos 12 meses até o último movimento).
    await medir('indicadores', () => s.indice(c, PARAMETROS_PADRAO, '2025-01', '2025-12'));
    await medir('serie', () =>
      s.serieIndicador(c, PARAMETROS_PADRAO, 'taxaOcupacao', {
        recorte: 'acomodacao',
        de: '2025-01',
        ate: '2025-12',
      }),
    );
    expect(censo.totais.internados).toBe(
      p.totais.ocupados -
        p.avisos.filter((a) => a.tipo === 'leito-ocupado-sem-internacao').length +
        p.avisos.filter((a) => a.tipo === 'internacao-sem-leito-ocupado').length,
    );
    expect(t['painel']!).toBeLessThan(2_000);
  });
});
