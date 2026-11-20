import { describe, expect, it } from 'vitest';
import {
  buscarPainelAssinaturas,
  filtrarOperacoes,
  resumoPorTipo,
  rotuloCodigo,
  buscarEstabelecimentos,
  buscarVerificacaoSchema,
  resumoDiferencas,
  rotuloEstado,
  verificarSchemaAgora,
} from './api.js';

const resposta = (corpo: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('cliente das telas de coexistência', () => {
  it('valida a resposta pelos contratos', async () => {
    const v = await buscarVerificacaoSchema(resposta({ marcas: [], entreBancos: null }));
    expect(v.entreBancos).toBeNull();
    expect((await verificarSchemaAgora(resposta({ marcas: [], entreBancos: [] }))).entreBancos).toEqual([]);
    const e = await buscarEstabelecimentos(resposta({ rede: 'rede-teste', estabelecimentos: [] }));
    expect(e.rede).toBe('rede-teste');
    await expect(buscarEstabelecimentos(resposta({ x: 1 }))).rejects.toThrow();
    await expect(buscarVerificacaoSchema(resposta({}, 503))).rejects.toThrow(/503/);
  });

  it('rótulos e resumo das diferenças', () => {
    expect(rotuloEstado('homologado')).toBe('Igual ao homologado');
    expect(rotuloEstado(null)).toBe('Não verificado');
    expect(rotuloEstado('outro')).toBe('outro');
    expect(resumoDiferencas({})).toBe('nenhuma');
    expect(resumoDiferencas({ triggers: { ausentes: [], novos: ['A'], alterados: ['B', 'C'] } })).toBe(
      'triggers: 1 novo(s), 2 alterado(s)',
    );
  });
});

describe('cliente da tela de testes de assinatura (M03)', () => {
  const op = (nome: string, modulo: string, estados: Record<string, string>) => ({
    nome,
    modulo,
    descricao: 'd',
    origem: 'sante-api',
    cenarios: ['a'],
    estados,
    ultimasExecucoes: {},
  });

  it('valida o painel e filtra por módulo, estado e estabelecimento', async () => {
    const painel = {
      estabelecimentos: ['aa', 'bb'],
      operacoes: [
        op('agenda.x', 'agenda', { aa: 'verde', bb: 'especificada' }),
        op('preco.y', 'preco', { aa: 'especificada', bb: 'especificada' }),
      ],
    };
    const p = await buscarPainelAssinaturas(resposta(painel));
    expect(p.operacoes).toHaveLength(2);
    await expect(buscarPainelAssinaturas(resposta({ operacoes: 1 }))).rejects.toThrow();
    const f = (modulo: string, estado: string, estabelecimento: string) =>
      filtrarOperacoes(p.operacoes, { modulo, estado, estabelecimento }).map((o) => o.nome);
    expect(f('', '', '')).toEqual(['agenda.x', 'preco.y']);
    expect(f('agenda', '', '')).toEqual(['agenda.x']);
    expect(f('', 'verde', '')).toEqual(['agenda.x']);
    expect(f('', 'verde', 'bb')).toEqual([]);
    expect(f('', 'especificada', 'bb')).toEqual(['agenda.x', 'preco.y']);
  });

  it('rótulos', () => {
    const textos: Record<string, string> = {
      'config.assinaturas.estadosOperacao.conferida': 'Conferida manualmente',
      'config.assinaturas.origens.perfil_passivo': 'Perfil passivo',
      'config.assinaturas.resultados.sem_executor': 'sem executor',
    };
    const t = (k: string) => textos[k] ?? k;
    const te = (k: string) => k in textos;
    expect(rotuloCodigo('estadosOperacao', 'conferida', t, te)).toBe('Conferida manualmente');
    expect(rotuloCodigo('estadosOperacao', 'x', t, te)).toBe('x');
    expect(rotuloCodigo('origens', 'perfil-passivo', t, te)).toBe('Perfil passivo');
    expect(rotuloCodigo('resultados', 'sem-executor', t, te)).toBe('sem executor');
    expect(resumoPorTipo({ formato: 1, classe: 2 })).toBe('classe: 2; formato: 1');
  });
});
