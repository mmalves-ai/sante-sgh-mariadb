import { PAPEIS_TRIAGEM, REGRAS_TRIAGEM } from '@sgh/dominio-relatorio';
import { describe, expect, it } from 'vitest';
import {
  AREAS_TRIAGEM,
  areaDoPapelDono,
  esquemaInventario,
  esquemaProposta,
  propostaDoRelatorio,
} from './relatorios-triagem-banco.ts';

/** Módulos do editor com destino padrão, mais um desconhecido (cai em "sem-regra"). */
export const MODULOS_DA_TRIAGEM = [0, 1, 4, 7, 8, 9, 10, 14, 15, 22, 23, 27, 99] as const;

describe('triagem dos relatórios: proposta gravável (puro)', () => {
  const r = {
    id: 42,
    nome: 'Relatorio de teste',
    modulo: -1,
    tipo: 2,
    quantidadeParametros: 3,
    acessoRestrito: true,
  };

  it('leva a proposta do domínio ao formato da tabela, com o id de origem como código e a área dona por chave', () => {
    const p = propostaDoRelatorio(r);
    expect(p.codigo).toBe('42');
    expect(p.quantidadeParametros).toBe(3);
    expect(p.acessoRestrito).toBe(true);
    expect(p.regra.length).toBeGreaterThan(0);
    expect(AREAS_TRIAGEM).toContain(p.areaDona);
    expect(esquemaProposta.safeParse(p).success).toBe(true);
  });

  it('toda regra do domínio e todo módulo padrão dão área dona válida (chave até 30 caracteres)', () => {
    for (const a of AREAS_TRIAGEM) expect(a.length).toBeLessThanOrEqual(30);
    for (const x of REGRAS_TRIAGEM)
      expect(AREAS_TRIAGEM, x.regra).toContain(areaDoPapelDono(x.proposta.papelDono));
    for (const modulo of MODULOS_DA_TRIAGEM) {
      const p = propostaDoRelatorio({
        id: 1000 + modulo,
        nome: 'Relatorio generico',
        modulo,
        tipo: 2,
        quantidadeParametros: 0,
        acessoRestrito: false,
      });
      expect(esquemaProposta.safeParse(p).success, `módulo ${modulo}`).toBe(true);
    }
    expect(areaDoPapelDono(PAPEIS_TRIAGEM.pep)).toBe('pep');
    expect(areaDoPapelDono(PAPEIS_TRIAGEM.bloco)).toBe('bloco');
    expect(() => areaDoPapelDono('papel inventado')).toThrow(/fora das áreas/);
  });

  it('recusa inventário fora do formato e proposta com marco, onda, destino ou área inválidos', () => {
    expect(esquemaInventario.safeParse({ formato: 2, estabelecimento: 'x', relatorios: [] }).success).toBe(
      false,
    );
    expect(esquemaInventario.safeParse({ formato: 1, estabelecimento: 'x', relatorios: [r] }).success).toBe(
      true,
    );
    const p = propostaDoRelatorio(r);
    expect(esquemaProposta.safeParse({ ...p, marco: 'X9' }).success).toBe(false);
    expect(esquemaProposta.safeParse({ ...p, onda: 5 }).success).toBe(false);
    expect(esquemaProposta.safeParse({ ...p, destino: 'outro' }).success).toBe(false);
    expect(esquemaProposta.safeParse({ ...p, areaDona: 'coordenação médica do prontuário' }).success).toBe(
      false,
    );
  });
});
