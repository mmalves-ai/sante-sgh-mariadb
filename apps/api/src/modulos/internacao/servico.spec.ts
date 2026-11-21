// Serviço e configuração do M16: cada estabelecimento no seu banco e no seu cache (regra 18); o painel relido uma
// vez por mudança do vigia (50 telas → 1 leitura); a chave desligada recusa com o motivo (POL-3); os parâmetros
// pelo resolvedor do M08, com o padrão quando a fonte falha.
import type { ValorParametro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import type { ChaveLiberacao, FonteConfiguracao } from '../config/public-api.js';
import { ConfiguracaoM16, PARAMETROS_PADRAO, tiposDoTexto } from './configuracao.js';
import { FonteInternacaoMemoria } from './fonte-memoria.js';
import type { CtxInternacao, FonteInternacao } from './fonte.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { planilhaDaSerieCenso, planilhaDasMarcadas, ServicoInternacao, somarLinhas } from './servico.js';

function contando(f: FonteInternacao) {
  const hospitais: string[] = [];
  const proxy = new Proxy(f, {
    get(alvo, nome, r) {
      const v = Reflect.get(alvo, nome, r) as unknown;
      if (typeof v !== 'function') return v;
      return (c: CtxInternacao, ...resto: unknown[]) => {
        hospitais.push(`${String(nome)}:${c.hospital}`);
        return (v as (...a: unknown[]) => unknown).call(alvo, c, ...resto);
      };
    },
  });
  return { fonte: proxy, hospitais };
}

// O contexto do núcleo (cliente e estabelecimento por id) é a chave do cache e do vigia.
const ctx = (hospital: string): CtxInternacao => ({
  rede: 'r',
  hospital,
  traceId: 't',
  porta: { cliente: 'r', estabelecimento: hospital === 'pc' ? 1 : 2, usuario: null, correlacao: 't' },
});

describe('serviço do M16', () => {
  it('cada estabelecimento no seu banco; o painel relido só quando o vigia muda a versão', async () => {
    const { fonte, hospitais } = contando(new FonteInternacaoMemoria());
    let versao = 0;
    const s = new ServicoInternacao(fonte, { versao: () => versao, ultimoCiclo: () => null });
    await Promise.all(Array.from({ length: 50 }, () => s.painel(ctx('pc'), PARAMETROS_PADRAO)));
    expect(hospitais.filter((h) => h === 'leiturasPainel:pc')).toHaveLength(1);
    await s.painel(ctx('hs'), PARAMETROS_PADRAO);
    expect(hospitais).toContain('leiturasPainel:hs');
    versao = 1;
    await s.painel(ctx('pc'), PARAMETROS_PADRAO);
    expect(hospitais.filter((h) => h === 'leiturasPainel:pc')).toHaveLength(2);
    // Sem vigia: o cache vale pelo tempo.
    const sem = new ServicoInternacao(fonte, null);
    await sem.motor(ctx('pc'), PARAMETROS_PADRAO);
    await sem.motor(ctx('pc'), PARAMETROS_PADRAO);
    expect(hospitais.filter((h) => h === 'movimento:pc')).toHaveLength(1);
  });

  it('falha da leitura não fica no cache', async () => {
    let falhar = true;
    const f = new FonteInternacaoMemoria();
    const fonte: FonteInternacao = Object.assign(Object.create(f) as FonteInternacao, {
      leiturasPainel: () => (falhar ? Promise.reject(new Error('x')) : f.leiturasPainel()),
    });
    const s = new ServicoInternacao(fonte, null);
    await expect(s.painel(ctx('pc'), PARAMETROS_PADRAO)).rejects.toThrow('x');
    falhar = false;
    await expect(s.painel(ctx('pc'), PARAMETROS_PADRAO)).resolves.toMatchObject({ destino: 'memoria' });
  });

  it('painéis da cópia diária no armazém compartilhado: a segunda réplica não relê a cópia', async () => {
    const armazem = new ArmazemMemoria();
    const a = contando(new FonteInternacaoMemoria());
    const b = contando(new FonteInternacaoMemoria());
    const r1 = new ServicoInternacao(a.fonte, null, undefined, armazem);
    const r2 = new ServicoInternacao(b.fonte, null, undefined, armazem);
    const p1 = await r1.painelGerencial(ctx('pc'), PARAMETROS_PADRAO, 'financeiro');
    const p2 = await r2.painelGerencial(ctx('pc'), PARAMETROS_PADRAO, 'financeiro');
    expect(p2).toEqual(p1);
    expect(a.hospitais.filter((h) => /^(financeiro|dataDaCopia):/.test(h))).toHaveLength(2);
    // A réplica 2 só lê o movimento (motor do processo); a cópia diária veio do armazém.
    expect(b.hospitais.filter((h) => /^(financeiro|dataDaCopia):/.test(h))).toEqual([]);
    // Armazém fora do ar: lê da cópia (a memória do processo é a reserva).
    const fora = Object.assign(new ArmazemMemoria(), {
      obter: () => Promise.reject(new Error('fora')),
      gravar: () => Promise.reject(new Error('fora')),
    });
    const c = contando(new FonteInternacaoMemoria());
    const r3 = new ServicoInternacao(c.fonte, null, undefined, fora);
    await expect(r3.painelGerencial(ctx('pc'), PARAMETROS_PADRAO, 'operacional')).resolves.toMatchObject({
      fonte: 'copia-diaria',
    });
    await r3.painelGerencial(ctx('pc'), PARAMETROS_PADRAO, 'operacional');
    expect(c.hospitais.filter((h) => h.startsWith('operacional:'))).toHaveLength(1);
  });

  it('planilha das internações marcadas: número e marca', () => {
    const csv = planilhaDasMarcadas(
      { casos: [{ internacao: 7, marca: 'trecho-invertido' }], marcas: {}, dadosAte: 'x' },
      (m) => (m === 'trecho-invertido' ? 'Trecho "invertido"' : m),
    );
    expect(csv).toBe('internacao;marca\r\n7;"Trecho ""invertido"""\r\n');
  });

  it('planilhas e totais', async () => {
    const s = new ServicoInternacao(new FonteInternacaoMemoria(), null);
    const c = await s.censo(ctx('pc'), PARAMETROS_PADRAO, '2025-03-10');
    expect(somarLinhas(c.linhas)).toEqual(c.totais);
    const serie = await s.serieCenso(ctx('pc'), PARAMETROS_PADRAO, '2025-03-01', '2025-03-02', 'dia');
    expect(planilhaDaSerieCenso(serie).split('\r\n')[1]).toMatch(/^2025-03-01;1;\d+;/);
    await expect(
      s.serieCenso(ctx('pc'), PARAMETROS_PADRAO, '2025-03-02', '2025-03-01', 'dia'),
    ).rejects.toThrow();
    await expect(
      s.serieCenso(ctx('pc'), PARAMETROS_PADRAO, '2023-01-01', '2025-03-01', 'dia'),
    ).rejects.toThrow();
  });
});

function configuracao(
  chaves: Partial<ChaveLiberacao>[],
  valores: Partial<ValorParametro>[] = [],
): FonteConfiguracao {
  return {
    chaves: async () => chaves as ChaveLiberacao[],
    prerequisitos: async () => [],
    valoresParametro: async () => valores as ValorParametro[],
  } as unknown as FonteConfiguracao;
}

const sujeito = { rede: 'r', hospital: 'pc', login: 'SINT.X', setor: 2 };
const ligada = (chave: string): Partial<ChaveLiberacao> => ({
  tipo: 'recurso',
  chave,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
});

describe('configuração do M16', () => {
  it('chave desligada: 403 recurso-desligado com o motivo; ligada: segue', async () => {
    const c = new ConfiguracaoM16(configuracao([ligada('internacao.leitos.painel')]), null);
    await expect(c.exigir(sujeito, 'painel')).resolves.toBeUndefined();
    await expect(c.exigir(sujeito, 'paineis')).rejects.toMatchObject({ status: 403 });
    const l = await c.liberacao(sujeito);
    expect(l).toMatchObject({ painel: true, paineis: false });
    expect(l.motivos['paineis']).toMatch(/Funcionalidades por estabelecimento/);
    // BI ligado sem os pré-requisitos: o motivo é o pré-requisito.
    const bi = await new ConfiguracaoM16(configuracao([ligada('relatorio.bi')]), null).liberacao({
      ...sujeito,
      setor: null,
    });
    expect(bi.bi).toBe(false);
    expect(bi.motivos['bi']).toMatch(/pré-requisito/);
  });

  it('sem a fonte (ou com falha): tudo desligado', async () => {
    const l = await new ConfiguracaoM16(null, null).liberacao(sujeito);
    expect(l).toMatchObject({ painel: false, paineis: false, fechamento: false, bi: false });
    const falha = { chaves: () => Promise.reject(new Error('x')) } as unknown as FonteConfiguracao;
    expect((await new ConfiguracaoM16(falha, null).liberacao(sujeito)).painel).toBe(false);
  });

  it('parâmetros: hora de fechamento, tipos de terapia intensiva e metas; padrão sem a fonte', async () => {
    const v = (chave: string, valor: string): Partial<ValorParametro> => ({
      chave,
      valor,
      nivel: 'estabelecimento',
      alvo: 'pc',
      vigenteDesde: '2026-01-01T00:00:00.000Z',
      vigenteAte: null,
    });
    const c = new ConfiguracaoM16(
      configuracao(
        [],
        [
          v('internacao.censo.horaFechamento', '18'),
          v('internacao.acomodacao.intensiva', '3, 9'),
          v('relatorio.meta.taxaOcupacao', '85,5'),
        ],
      ),
      null,
    );
    const p = await c.parametros(sujeito);
    expect(p.horaFechamento).toBe(18);
    expect(p.intensivas).toEqual([3, 9]);
    expect(p.metas.taxaOcupacao).toBe(85.5);
    expect(await new ConfiguracaoM16(null, null).parametros(sujeito)).toEqual(PARAMETROS_PADRAO);
    expect(tiposDoTexto('x')).toEqual([3, 7, 8, 9, 17]);
  });
});
