// Regra offline da prescrição (M24): sem conexão a tela não grava, e nada da prescrição vai ao armazenamento local.
import { describe, expect, it } from 'vitest';
import { conectado } from './conexao.js';
import { agoraLocal, descreverItem } from './descricao-item.js';

describe('prescrição sem conexão (M24)', () => {
  it('o navegador sem conexão desliga a gravação; sem a informação, considera conectado', () => {
    expect(conectado({ onLine: false })).toBe(false);
    expect(conectado({ onLine: true })).toBe(true);
    expect(conectado({})).toBe(true);
    expect(conectado(undefined)).toBe(true);
  });

  it('os módulos da prescrição não usam o armazenamento local do navegador', async () => {
    const fontes = import.meta.glob(
      ['./api-prescricao.ts', './telas/Prescricao*.vue', './componentes/prescricao/*.vue'],
      {
        query: '?raw',
        import: 'default',
        eager: true,
      },
    ) as Record<string, string>;
    expect(Object.keys(fontes).length).toBeGreaterThan(3);
    for (const [arquivo, texto] of Object.entries(fontes)) {
      expect(texto, arquivo).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });
});

describe('descrição do item (M24)', () => {
  const nomes = {
    produtos: new Map([[501, 'DIPIRONA']]),
    dominio: (l: string, id: string | number | null | undefined) =>
      l === 'vias' && id === 'EV' ? 'Endovenosa' : l === 'frequencias' && id === 11 ? '06/06' : null,
  };
  it('medicamento: produto, dose, via e frequência', () => {
    expect(
      descreverItem(
        {
          chave: 'm1',
          detalhe: {
            tipo: 'medicamento',
            item: { produto: 501 },
            dose: 2.5,
            unidade: 'ML',
            via: 'EV',
            frequencia: 11,
            relativos: [],
            iniciarAgora: true,
            naoAjustar: false,
          },
          autopreenchido: [],
          decisoes: [],
        },
        nomes,
      ),
    ).toBe('DIPIRONA · 2,5 ML · Endovenosa · 06/06 · agora');
  });
  it('hora local no formato da prescrição', () => {
    expect(agoraLocal(new Date(2026, 9, 21, 7, 5))).toBe('2026-10-21T07:05');
  });
});
