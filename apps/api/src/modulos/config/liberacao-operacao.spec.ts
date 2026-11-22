// A liberação da gravação por operação (lote 02-07): sem chave decide o catálogo; a chave da pessoa, do grupo e do setor
// decide; fora do catálogo, recusada; a falha ao ler as chaves rejeita. Dados sintéticos, fonte em memória.
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { catalogoOperacoesProprio } from './catalogo-operacoes.js';
import { type FonteConfiguracao, fonteConfiguracaoMemoria } from './configuracao-fonte.js';
import { operacaoLiberada } from './liberacao-operacao.js';

const H = 'aa';
const OP = 'cadastro.cadastrarPaciente';
const catalogo = catalogoOperacoesProprio();
const trilha = () => ({ correlacao: 'c', usuario: 'admin', estabelecimento: H, ip: '127.0.0.1' });
const nova = () => fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria(), { chavesIniciais: () => [] });
const lote = (
  fonte: FonteConfiguracao,
  escopo: 'hospital' | 'setor' | 'grupo' | 'pessoa',
  valor: string,
  ligada: boolean,
) =>
  fonte.aplicarLote(
    'r',
    {
      hospital: H,
      tipo: 'operacao',
      chave: OP,
      planejar: () => [{ escopo, valor, ligada, antes: null }],
      justificativa: 'Chave de teste',
      autor: 'admin',
    },
    trilha() as never,
  );

describe('liberação da gravação por operação', () => {
  it('sem chave que decida, a operação do catálogo está liberada; a chave desligada para a pessoa recusa', async () => {
    const fonte = nova();
    expect(await operacaoLiberada(fonte, catalogo, 'r', H, 'pessoa.a', OP)).toBe(true);
    await lote(fonte, 'pessoa', 'pessoa.a', false);
    expect(await operacaoLiberada(fonte, catalogo, 'r', H, 'pessoa.a', OP)).toBe(false);
    // Com chave da operação gravada, quem nenhuma chave alcança (nem a do estabelecimento) fica de fora.
    expect(await operacaoLiberada(fonte, catalogo, 'r', H, 'pessoa.b', OP)).toBe(false);
    await lote(fonte, 'hospital', '*', true);
    expect(await operacaoLiberada(fonte, catalogo, 'r', H, 'pessoa.b', OP)).toBe(true);
    expect(await operacaoLiberada(fonte, catalogo, 'r', H, 'pessoa.a', OP)).toBe(false);
  });

  it('operação fora do catálogo de operações é recusada', async () => {
    expect(await operacaoLiberada(nova(), catalogo, 'r', H, 'pessoa.a', 'cadastro.operacaoInexistente')).toBe(
      false,
    );
  });

  it.each(['setor', 'grupo'] as const)(
    'chave ligada só para o %s: libera o membro e recusa quem não é',
    async (escopo) => {
      const fonte = nova();
      await lote(fonte, escopo, 'X1', true);
      expect(
        await operacaoLiberada(fonte, catalogo, 'r', H, { pessoa: 'pessoa.a', [escopo]: 'X1' }, OP),
      ).toBe(true);
      expect(
        await operacaoLiberada(fonte, catalogo, 'r', H, { pessoa: 'pessoa.b', [escopo]: 'Y2' }, OP),
      ).toBe(false);
    },
  );

  it('a falha ao ler as chaves rejeita (não vira "não liberada")', async () => {
    const fonte = nova();
    const quebrada: FonteConfiguracao = { ...fonte, chaves: () => Promise.reject(new Error('sem tabela')) };
    await expect(operacaoLiberada(quebrada, catalogo, 'r', H, 'pessoa.a', OP)).rejects.toThrow('sem tabela');
  });
});
