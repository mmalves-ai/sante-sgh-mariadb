// M61: as conferências ao ligar, as mesmas da tela de chaves e do comando liberacao:ligar-tudo.
import { describe, expect, it } from 'vitest';
import {
  conferirFonteUnicaDeCor,
  conferirLigarEmProducao,
  conferirPrerequisitosDeLigar,
  conferirRegrasDeLigar,
} from './conferencias-ligar.js';

const semAvaliador = { criterioSetor: null, regraFarmacia: null, regraEntradaUtf8: null };

describe('conferências ao ligar', () => {
  it('produção: operação só liberada no catálogo; e a autorização do dono', () => {
    const base = { ambiente: 'producao', estadoEfetivo: () => 'verde', referenciaAutorizacao: 'linha' };
    expect(conferirLigarEmProducao({ ...base, tipo: 'operacao' })?.problema).toBe('operacao-bloqueada');
    expect(conferirLigarEmProducao({ ...base, tipo: 'recurso' })).toBeNull();
    expect(conferirLigarEmProducao({ ...base, tipo: 'recurso', referenciaAutorizacao: null })?.status).toBe(
      400,
    );
    expect(
      conferirLigarEmProducao({ ...base, ambiente: 'dev', tipo: 'operacao', referenciaAutorizacao: null }),
    ).toBeNull();
  });
  it('farmácia e UTF-8 em todo ambiente, falha fechada sem avaliador', async () => {
    const nomes = () => [];
    const farm = await conferirRegrasDeLigar({
      ambiente: 'dev',
      tipo: 'recurso',
      chave: 'suprimentos.dispensacao',
      nomesOperacoes: nomes,
      avaliadores: semAvaliador,
    });
    expect(farm?.codigo).toBe('farmacia-sem-prescricao');
    const utf8 = await conferirRegrasDeLigar({
      ambiente: 'dev',
      tipo: 'recurso',
      chave: 'entrada.utf8',
      nomesOperacoes: nomes,
      avaliadores: { ...semAvaliador, regraEntradaUtf8: async () => null },
    });
    expect(utf8).toBeNull();
  });
  it('critério do setor só fora de dev/ci', async () => {
    const p = {
      tipo: 'recurso' as const,
      chave: 'pep.prescricao.cpoe',
      nomesOperacoes: () => [],
      avaliadores: semAvaliador,
    };
    expect(await conferirRegrasDeLigar({ ...p, ambiente: 'dev' })).toBeNull();
    expect((await conferirRegrasDeLigar({ ...p, ambiente: 'producao' }))?.codigo).toMatch(/^criterio-onda/);
    expect(
      await conferirRegrasDeLigar({
        ...p,
        ambiente: 'producao',
        avaliadores: { ...semAvaliador, criterioSetor: async () => null },
      }),
    ).toBeNull();
  });
  it('pré-requisito pendente recusa', () => {
    const agora = new Date('2026-10-30T12:00:00Z');
    expect(conferirPrerequisitosDeLigar('sessoes', [], agora)?.codigo).toBe('prerequisito-pendente');
    expect(
      conferirPrerequisitosDeLigar(
        'sessoes',
        [{ tipo: 'aprovacao', situacao: 'dispensado', validade: null }],
        agora,
      ),
    ).toBeNull();
  });
  it('fonte única de cor: a própria desliga a externa; a externa é recusada onde a própria está', () => {
    const externa = {
      tipo: 'recurso' as const,
      chave: 'integracao.classificacaoExterna',
      escopo: 'hospital' as const,
      valor: '*',
      ligada: true,
    };
    const propria = { ...externa, chave: 'pa.classificacao' };
    const pedido = { escopo: 'hospital' as const, valores: ['*'] };
    expect(conferirFonteUnicaDeCor([externa], { ...pedido, chave: 'pa.classificacao' })).toEqual({
      recusa: null,
      desligarExterna: true,
    });
    expect(conferirFonteUnicaDeCor([propria], { ...pedido, chave: externa.chave }).recusa?.codigo).toBe(
      'fonte-de-cor-unica',
    );
  });
});
