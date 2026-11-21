// M44, regra 6 (uma fonte de cor no PA; cap-12 §12.4, Nota): ligar a classificação externa onde a própria está ligada é
// recusado; ligar a própria desliga, no mesmo pedido, a externa ligada nos mesmos escopos; sem externa ligada, nada a
// desligar. A regra é a de config/fonte-de-cor.ts (domínio de @sgh/dominio-config), provada aqui sobre uma fonte das
// chaves em memória (a gravação do lote é da porta de configuração, com a trilha). Dados sintéticos.
import { CHAVE_CLASSIFICACAO_EXTERNA, CHAVE_LIBERACAO_CLASSIFICACAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import type { ChaveLiberacao } from '../../config/configuracao-fonte.js';
import { aplicarFonteUnicaDeCor, fonteDeCor, type FonteChavesCor } from '../../config/fonte-de-cor.js';

const chave = (c: string, ligada: boolean): ChaveLiberacao =>
  ({
    id: `${c}:hospital:*`,
    tipo: 'recurso',
    chave: c,
    escopo: 'hospital',
    valor: '*',
    ligada,
    ligadaAntes: null,
    lote: null,
    justificativa: null,
    alteradoPor: 'SINT.ADMIN',
    alteradoEm: '2026-11-20T08:00:00',
  }) as ChaveLiberacao;

function fonte(chaves: ChaveLiberacao[]): FonteChavesCor & { lotes: number } {
  const f = {
    lotes: 0,
    chaves: async () => chaves,
    desligarExterna: async (planejar: Parameters<FonteChavesCor['desligarExterna']>[0]) => {
      // A porta de configuração aplica o lote de UMA chave: a externa, relida com trava.
      const plano = planejar({ chaves: chaves.filter((c) => c.chave === CHAVE_CLASSIFICACAO_EXTERNA) });
      f.lotes++;
      return { alteradas: plano.length };
    },
  };
  return f;
}

const pedido = (c: string) => ({ chave: c, escopo: 'hospital' as const, valores: ['*'] });

describe('regra 6: uma fonte de cor no pronto atendimento', () => {
  it('a externa não liga onde a própria está ligada', async () => {
    const f = fonte([chave(CHAVE_LIBERACAO_CLASSIFICACAO, true)]);
    const erro = await aplicarFonteUnicaDeCor(f, pedido(CHAVE_CLASSIFICACAO_EXTERNA)).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroProblema);
    expect((erro as ErroProblema).extras).toMatchObject({ codigo: 'fonte-de-cor-unica' });
    expect(f.lotes).toBe(0);
  });

  it('ligar a própria com a externa ligada desliga a externa no mesmo pedido', async () => {
    const chaves = [chave(CHAVE_LIBERACAO_CLASSIFICACAO, false), chave(CHAVE_CLASSIFICACAO_EXTERNA, true)];
    expect(fonteDeCor(chaves, 'hospital', ['*'])).toEqual({ propriaLigada: false, externaLigada: true });
    const f = fonte(chaves);
    expect(await aplicarFonteUnicaDeCor(f, pedido(CHAVE_LIBERACAO_CLASSIFICACAO))).toBeGreaterThanOrEqual(1);
    expect(f.lotes).toBe(1);
  });

  it('sem externa ligada, ligar a própria não desliga nada', async () => {
    const f = fonte([chave(CHAVE_LIBERACAO_CLASSIFICACAO, false)]);
    expect(await aplicarFonteUnicaDeCor(f, pedido(CHAVE_LIBERACAO_CLASSIFICACAO))).toBe(0);
    expect(f.lotes).toBe(0);
  });
});
