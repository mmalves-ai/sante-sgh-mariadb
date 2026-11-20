// M58-F4 sobre a cópia, sob a trava da cópia (com-copia.sh): o serviço da fachada com a porta do núcleo real.
//   - READ ONLY: GET /health/db (a tripla de charset), GET /convenios (o cadastro inteiro, filtro e busca) e
//     GET /convenios/{codigo}, o retrato e o impacto do convênio; tempos dentro do teto;
//   - regra 9 numa transação desfeita: a ação de situação do convênio em dois tempos pela receita
//     convenio.alterarSituacao (executor), assinada por hal-ai: a proposta não escreve, a confirmação grava e relê,
//     a inversa devolve o estado; a trilha (SGH_TRILHA) e a autoria (SGH_PRECO_AUTORIA) de cada confirmação saem
//     com o usuário hal-ai e a estação fachada-hal-ai; depois do ROLLBACK, a situação e as contagens de SGH_TRILHA,
//     SGH_PRECO_AUTORIA e HTCONVEN do convênio como antes.
// Saída só com contagens (abaixo de 5 vira <5); nenhum nome de convênio, login ou dado de paciente.
import { resolve } from 'node:path';
import type { ValorParametro } from '@sgh/contratos';
import {
  ambienteEfetivo,
  auditoriaSituacaoConvenioFachada,
  contagensSituacaoConvenioFachada,
  cortesConferenciaFachada,
  caminhoArquivoAmbiente,
  exigirTravaDaCopia,
  fonteCatalogoArquivo,
  lerConfiguracaoNucleo,
  NucleoLegado,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaFachadaLegado, portaFachadaNaTransacao } from './porta-legado.js';
import type { PortaFachada } from './porta.js';
import { type PedidoFachada, ServicoFachada } from './servico.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env: base } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const env: Record<string, string> = {
  ...(base as Record<string, string>),
  AMBIENTE: 'dev',
  FB_POOL_TETO: '2',
};
const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
const TOKEN = 'i'.repeat(40);
const catalogo = fonteCatalogoArquivo(resolve(raiz, 'docs/operacoes/catalogo'));

let nucleo: NucleoLegado;
let hospital = '';

beforeAll(async () => {
  exigirTravaDaCopia();
  nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const saude = await nucleo.partida();
  hospital = saude.find((s) => s.disponivel)?.codigo ?? '';
  if (!hospital) throw new Error('Nenhum estabelecimento da cópia disponível.');
}, 120_000);
afterAll(async () => {
  await nucleo?.encerrar();
});

const valores = (escrita: boolean): ValorParametro[] =>
  [
    ['integracao.fachada.ligada', 'sim'],
    ['integracao.fachada.escrita', escrita ? 'sim' : 'nao'],
  ].map(([chave, valor]) => ({
    id: chave!,
    chave: chave!,
    nivel: 'estabelecimento' as const,
    alvo: hospital,
    valor: valor!,
    vigenteDesde: '2026-01-01T00:00:00.000Z',
    vigenteAte: null,
    justificativa: 'integração da fachada',
    autor: 'SGH.TESTE',
  }));

const servico = (porta: PortaFachada, escrita: boolean) =>
  new ServicoFachada({
    porta,
    tokens: { principal: TOKEN, gestao: null, auditoria: null },
    valores: async () => valores(escrita),
    raizEnsaios: null,
    cacheMs: 0,
  });

const pedido = (metodo: string, caminho: string, corpo?: unknown): PedidoFachada => {
  const [c, consulta = ''] = caminho.split('?');
  return {
    rede: nucleo.rede,
    hospital,
    metodo,
    caminho: c!,
    consulta,
    query: Object.fromEntries(new URLSearchParams(consulta)),
    corpo,
    cabecalhos: { authorization: `Bearer ${TOKEN}` },
  };
};

describe('M58-F4: fachada da API de integração na cópia', () => {
  it('READ ONLY: saúde do banco, convênios (lista, filtro, busca, por código), retrato e impacto; tempos', async () => {
    const s = servico(portaFachadaLegado(nucleo, catalogo), false);
    const tempos: Record<string, number> = {};
    const medir = async <T>(nome: string, f: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const r = await f();
      tempos[nome] = Math.round(performance.now() - t0);
      return r;
    };
    const saude = await medir('saude', () => s.atender(pedido('GET', '/health/db')));
    expect(saude.status).toBe(200);
    expect(saude.corpo).toMatchObject({ status: 'ok', charset: { banco: 'NONE', efetivo: 'CP1252' } });
    const lista = await medir('convenios', () => s.atender(pedido('GET', '/convenios?limite=500')));
    const l = lista.corpo as { total: number; convenios: { codigo: number; ativo: boolean }[] };
    expect(lista.status).toBe(200);
    expect(l.total).toBeGreaterThan(5);
    const ativos = (await s.atender(pedido('GET', '/convenios?ativo=true&limite=500'))).corpo as {
      total: number;
    };
    expect(ativos.total).toBeLessThanOrEqual(l.total);
    const busca = await s.atender(pedido('GET', '/convenios?busca=particular'));
    expect(busca.status).toBe(200);
    const primeiro = l.convenios[0]!.codigo;
    const um = await medir('convenio', () => s.atender(pedido('GET', `/convenios/${primeiro}`)));
    expect(um.corpo).toMatchObject({ codigo: primeiro });
    expect((await s.atender(pedido('GET', '/convenios/32000'))).status).toBe(404);
    const porta = portaFachadaLegado(nucleo, catalogo);
    const c = { rede: nucleo.rede, hospital };
    const retrato = await medir('retrato', () => porta.retratoConvenio(c, primeiro));
    expect(retrato.existe).toBe(true);
    const impacto = await medir('impacto', () => porta.impactoConvenio(c, primeiro));
    expect(impacto.consulta).toBeGreaterThanOrEqual(0);
    for (const [k, ms] of Object.entries(tempos)) expect(ms, k).toBeLessThan(10_000);
    console.info(
      `[m58-f4] convênios=${menos5(l.total)} ativos=${menos5(ativos.total)} tempos=${JSON.stringify(tempos)}`,
    );
  }, 120_000);

  it('regra 9 numa transação desfeita: proposta não escreve; confirmação grava como hal-ai; inversa; ROLLBACK', async () => {
    const leitura = portaFachadaLegado(nucleo, catalogo);
    const c = { rede: nucleo.rede, hospital };
    const lista = (await servico(leitura, false).atender(pedido('GET', '/convenios?ativo=true&limite=500')))
      .corpo as { convenios: { codigo: number }[] };
    // Um convênio ativo cuja diária de acompanhante não trava a alteração.
    let alvo: number | null = null;
    for (const x of lista.convenios) {
      const d = await leitura.diariaConvenio(c, x.codigo);
      if (!d || ((d.tipo === null || d.tipo === 1) && (d.subtipo === null || d.subtipo === 5))) {
        alvo = x.codigo;
        break;
      }
    }
    expect(alvo).not.toBeNull();
    const antes = (await leitura.convenio(c, alvo!))?.situacao;
    expect(antes).toBe('A');
    const ctxLeitura = { rede: nucleo.rede, hospital, traceId: 'integracao-m58f4-retrato' };
    // O corte: só as linhas de SGH_TRILHA (desta operação neste estabelecimento) e de SGH_PRECO_AUTORIA acima das
    // maiores chaves de antes (o dev do dono, no ar sobre a mesma cópia, registra os acessos dele).
    const cortes = await nucleo.lerSomente(ctxLeitura, (l) => cortesConferenciaFachada(l));
    const contagens = () =>
      nucleo.lerSomente(ctxLeitura, (l) => contagensSituacaoConvenioFachada(l, hospital, alvo!, cortes));
    const contagensAntes = await contagens();
    const executor = nucleo.criarExecutor({ catalogo });
    const r = await nucleo.desfazendoNaCopia(
      { rede: nucleo.rede, hospital, traceId: 'integracao-m58f4' },
      async (e) => {
        const porta = portaFachadaNaTransacao(e, executor, catalogo);
        const s = servico(porta, true);
        const p = await s.atender(
          pedido('POST', '/acoes/convenios/situacao', { convenio: alvo, operacao: 'suspender' }),
        );
        expect(p.status).toBe(200);
        const id = (p.corpo as { propostaId: string }).propostaId;
        const naProposta = (await porta.convenio(c, alvo!))?.situacao;
        const conf = await s.atender(pedido('POST', '/acoes/confirmar', { propostaId: id }));
        const depois = (await porta.convenio(c, alvo!))?.situacao;
        const p2 = await s.atender(
          pedido('POST', '/acoes/convenios/situacao', { convenio: alvo, operacao: 'reativar' }),
        );
        const conf2 = await s.atender(
          pedido('POST', '/acoes/confirmar', { propostaId: (p2.corpo as { propostaId: string }).propostaId }),
        );
        // A auditoria das duas confirmações, na própria transação (antes do ROLLBACK).
        const aud = await auditoriaSituacaoConvenioFachada(e, hospital, alvo!, cortes);
        return {
          trilha: {
            linhas: menos5(aud.trilha.length),
            usuarios: [...new Set(aud.trilha.map((x) => x.usuario))],
            estacoes: [...new Set(aud.trilha.map((x) => x.estacao))],
          },
          autoria: aud.autoria.map((x) => `${x.autor}:${x.antes}>${x.depois}`),
          naProposta,
          conf: conf.status,
          situacaoAtual: (conf.corpo as { situacaoAtual?: string }).situacaoAtual,
          codigo: (conf.corpo as { codigo?: string }).codigo ?? null,
          depois,
          conf2: conf2.status,
          final: (await porta.convenio(c, alvo!))?.situacao,
        };
      },
    );
    console.info(`[m58-f4] dois tempos na transação desfeita: ${JSON.stringify(r)}`);
    expect(r).toEqual({
      trilha: { linhas: '<5', usuarios: ['hal-ai'], estacoes: ['fachada-hal-ai'] },
      autoria: ['hal-ai:A>I', 'hal-ai:I>A'],
      naProposta: 'A',
      conf: 200,
      situacaoAtual: 'I',
      codigo: null,
      depois: 'I',
      conf2: 200,
      final: 'A',
    });
    expect((await leitura.convenio(c, alvo!))?.situacao).toBe(antes);
    // Depois do ROLLBACK, fora da transação: nada ficou (trilha, autoria e histórico do convênio).
    const contagensDepois = await contagens();
    console.info(
      `[m58-f4] contagens antes/depois do ROLLBACK: ${JSON.stringify(
        Object.fromEntries(
          Object.entries(contagensAntes).map(([k, v]) => [
            k,
            `${menos5(v)}/${menos5(contagensDepois[k as keyof typeof contagensDepois])}`,
          ]),
        ),
      )}`,
    );
    expect(contagensDepois).toEqual(contagensAntes);
    expect(contagensDepois.trilha).toBe(0);
  }, 180_000);
});
