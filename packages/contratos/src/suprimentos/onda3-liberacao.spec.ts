// Contrato da liberação da onda 3 (ficha do M41, campos 5, 9, 10 e 12): operações da ficha × catálogo de operações e
// arquivos de assinatura, a ordem dos setores, os itens do critério e os esquemas das consultas.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ITENS_CRITERIO_LIBERACAO,
  ITENS_SEM_NAO_SE_APLICA_ONDA_2,
  esquemaGravarItensOnda2,
} from '../onda2/onda2.js';
import { SETORES_PRONTIDAO } from '../prontidao/catalogo.js';
import {
  ITENS_CRITERIO_POR_SETOR_ONDA_3,
  OPERACOES_CATALOGO_ONDA_3,
  OPERACOES_FICHA_ONDA_3,
  ORDEM_SETORES_ONDA_3,
  SETORES_ONDA3,
  esquemaConsultaPainelOnda3,
  esquemaPedidoConferenciaNumerica,
} from './onda3.js';

const raiz = resolve(import.meta.dirname, '../../../..');
// W0-01: o catálogo é a pasta docs/operacoes/catalogo/ (um arquivo por prefixo); o texto junto basta aqui.
const pastaCatalogo = resolve(raiz, 'docs/operacoes/catalogo');
const catalogo = readdirSync(pastaCatalogo)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => readFileSync(resolve(pastaCatalogo, f), 'utf8'))
  .join('\n');
const assinaturas = resolve(raiz, 'packages/legado/src/suprimentos/assinaturas');

describe('onda 3: ordem e setores (campo 12)', () => {
  it('a ordem é a do contrato da onda, um setor por passo, todos no catálogo de prontidão na onda 3', () => {
    expect(ORDEM_SETORES_ONDA_3).toEqual([
      ['almoxarifado-compras'],
      ['farmacia-central'],
      ['farmacias-satelites'],
      ['farmacia-clinica'],
    ]);
    for (const [id] of ORDEM_SETORES_ONDA_3) expect(SETORES_PRONTIDAO.find((s) => s.id === id)?.onda).toBe(3);
  });
});

describe('onda 3: operações da ficha (campos 5 e 9)', () => {
  it('cada nome do catálogo existe no catálogo de operações; P1 e P2 batem com os setores do contrato', () => {
    for (const nome of OPERACOES_CATALOGO_ONDA_3) expect(catalogo).toContain(`- nome: ${nome}\n`);
    for (const o of OPERACOES_FICHA_ONDA_3)
      for (const s of o.setores) {
        const def = SETORES_ONDA3.find((x) => x.id === s)!;
        const lista = o.prioridade === 'P1' ? def.operacoesP1 : def.operacoesP2;
        for (const n of o.catalogo) expect(lista).toContain(n);
      }
  });

  it('cenário mínimo da ficha: existe com o nome dela ou com o equivalente de perfil (D-CEN-41); o que falta está anotado', () => {
    const faltam: string[] = [];
    for (const o of OPERACOES_FICHA_ONDA_3)
      for (const c of o.cenariosMinimos) {
        const nome = o.equivalentes?.[c] ?? c;
        const arq = resolve(assinaturas, o.catalogo[0]!, `${nome}.assinatura.json`);
        if (!existsSync(arq)) faltam.push(`${o.ficha}/${c}`);
      }
    expect(faltam).toEqual(['suprimentos.confirmarEntrega/entrega-parcial']);
    expect(OPERACOES_FICHA_ONDA_3.find((o) => o.ficha === 'suprimentos.confirmarEntrega')?.nota).toContain(
      'cenário controlado',
    );
  });
});

describe('onda 3: critério (regra 1 do M40 com as condições da onda)', () => {
  it('os itens da onda estão no vocabulário e não admitem "não se aplica"', () => {
    for (const itens of Object.values(ITENS_CRITERIO_POR_SETOR_ONDA_3))
      for (const i of itens) {
        expect(ITENS_CRITERIO_LIBERACAO).toContain(i);
        expect(ITENS_SEM_NAO_SE_APLICA_ONDA_2).toContain(i);
      }
    const r = esquemaGravarItensOnda2.safeParse({
      itens: [
        { item: 'prescricao-na-unidade', situacao: 'nao-se-aplica', evidencia: 'ata 12', em: '2026-12-01' },
      ],
      justificativa: 'registro do comitê de coexistência',
    });
    expect(r.success).toBe(false);
  });
});

describe('onda 3: consultas', () => {
  it('painel: dia AAAA-MM-DD e local inteiro; nada além', () => {
    expect(esquemaConsultaPainelOnda3.safeParse({ dia: '2026-06-15', local: '10' }).success).toBe(true);
    expect(esquemaConsultaPainelOnda3.safeParse({ dia: '15/06/2026' }).success).toBe(false);
    expect(esquemaConsultaPainelOnda3.safeParse({ nome: 'x' }).success).toBe(false);
  });
  it('conferência numérica: até 500 itens, preço médio não negativo', () => {
    const ok = { dia: '2026-06-15', esperado: [{ item: 1, local: 10, saldo: 3, precoMedio: 1.25 }] };
    expect(esquemaPedidoConferenciaNumerica.safeParse(ok).success).toBe(true);
    expect(
      esquemaPedidoConferenciaNumerica.safeParse({ ...ok, esperado: [{ ...ok.esperado[0], precoMedio: -1 }] })
        .success,
    ).toBe(false);
    expect(esquemaPedidoConferenciaNumerica.safeParse({ dia: '2026-06-15', esperado: [] }).success).toBe(
      false,
    );
  });
});
