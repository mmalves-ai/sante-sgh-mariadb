// Regras puras e recusas do gravador próprio das férias e obrigações da folha (folha-porta-propria-obrigacoes.ts), sem
// banco: prazo de entrega, período no banco, soma de meses, falha fechada sem armazenamento e catálogo pendente.
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  gravadorFolhaObrigacoes,
  lerCatalogosObrigacoes,
  periodoNoBanco,
  prazoEntregaObrigacao,
  somarMeses,
} from './folha-porta-propria-obrigacoes.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? `${e.problema.status}:${String(e.problema.codigo)}` : String(e);
  }
};

/** Transação falsa: cada consulta devolve a próxima resposta da fila; o resto falha (nada é gravado). */
function txFalsa(respostas: Record<string, unknown>[][] = []): TxOperacao {
  const fila = [...respostas];
  const proxima = async () => fila.shift() ?? [];
  return {
    consultar: proxima,
    consultarParaAtualizar: proxima,
    uma: async () => (await proxima())[0] ?? null,
    incluir: async () => {
      throw new Error('não devia gravar');
    },
    alterar: async () => {
      throw new Error('não devia gravar');
    },
  } as unknown as TxOperacao;
}

const obrigacao = {
  empresa: 7,
  tipo: 'fgts-digital' as const,
  periodo: '2025-01',
  numero: 1,
  leiaute: '1.0',
  leiauteConferido: true,
  nomeArquivo: 'fgts.txt',
  conteudoCifrado: 'cifrado',
  tamanho: 10,
  resumo: 'a'.repeat(64),
  totais: {
    trabalhadores: 1,
    remuneracao: 1000,
    remuneracaoDecimo: 0,
    baseFgts: 1000,
    fgts: 80,
    rescisorio: 0,
    admissoes: 0,
    desligamentos: 0,
  },
  fechamentos: [],
  por: 'dp',
};

describe('férias e obrigações da folha no banco próprio (regras puras)', () => {
  it('soma meses sem passar do último dia do mês', () => {
    expect(somarMeses('2024-02-29', 12)).toBe('2025-02-28');
    expect(somarMeses('2025-01-31', 1)).toBe('2025-02-28');
    expect(somarMeses('2025-12-15', 1)).toBe('2026-01-15');
  });

  it('prazo legal de entrega por tipo e período no banco', () => {
    expect(prazoEntregaObrigacao('fgts-digital', '2025-12')).toBe('2026-01-20');
    expect(prazoEntregaObrigacao('sefip', '2024-01')).toBe('2024-02-07');
    expect(prazoEntregaObrigacao('caged', '2019-11')).toBe('2019-12-07');
    expect(prazoEntregaObrigacao('rais', '2018')).toBe('2019-03-31');
    expect(periodoNoBanco('rais', '2018')).toBe('2018-01-01');
    expect(periodoNoBanco('caged', '2019-11')).toBe('2019-11-01');
  });

  it('recusa empresa fora da sessão, dias inválidos e resumo que não é SHA-256, sem gravar', async () => {
    const g = gravadorFolhaObrigacoes(txFalsa(), 7, { cliente: 'x', arquivos: null });
    const ferias = {
      vinculo: 1,
      empresa: 7,
      aquisitivoInicio: '2024-01-01',
      aquisitivoFim: '2024-12-31',
      inicio: '2025-03-01',
      fim: '2025-03-03',
      dias: 3,
      abono: 0,
      dobra: 0,
      adiantarDecimo: false,
      pagamento: '2025-02-27',
      por: 'dp',
    };
    expect(await codigo(g.incluirFerias({ ...ferias, empresa: 8 }))).toBe('409:empresa-fora-da-sessao');
    expect(await codigo(g.incluirFerias(ferias))).toBe('409:ferias-dias-invalidos');
    expect(await codigo(g.incluirObrigacao({ ...obrigacao, resumo: 'x' }))).toBe('409:resumo-invalido');
    expect(await codigo(g.obrigacoesEmVigorComTrava(8, 'sefip', '2024-01'))).toBe(
      '409:empresa-fora-da-sessao',
    );
  });

  it('sem o armazenamento de arquivos, gravar a obrigação falha fechado (503)', async () => {
    // Sem repetida; a conta existe; sem fechamentos.
    const g = gravadorFolhaObrigacoes(txFalsa([[], [{ id: 3 }]]), 7, { cliente: 'x', arquivos: null });
    expect(await codigo(g.incluirObrigacao(obrigacao))).toBe('503:armazenamento-indisponivel');
  });

  it('trocar a situação de obrigação já entregue recusa como desatualizada', async () => {
    const g = gravadorFolhaObrigacoes(txFalsa([[{ id: 1, situacao: 'transmitida', versao: 2 }]]), 7, {
      cliente: 'x',
      arquivos: null,
    });
    expect(await codigo(g.cancelarObrigacao({ id: 1, versao: 2, motivo: 'erro', por: 'dp' }))).toBe(
      '409:desatualizado',
    );
  });

  it('catálogo oficial não carregado recusa com catalogo-pendente (nunca lista vazia)', async () => {
    const parcial = [{ fonte: 'sefip', codigo_oficial: 'categoria', codigo_esocial: '1' }];
    const l = { consultar: async () => parcial, uma: async () => null };
    expect(await codigo(lerCatalogosObrigacoes(l as never))).toBe('409:catalogo-pendente');
  });
});
