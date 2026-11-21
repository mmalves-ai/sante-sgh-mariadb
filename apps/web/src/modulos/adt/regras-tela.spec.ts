// @vitest-environment jsdom
// Regras de tela do M21: o agrupamento do mapa como o painel (bloco › acomodação, com o filtro), a hora HHMM, o prazo da
// limpeza, a leitura da etiqueta do SAME, as etapas que o aplicativo oferece e o item do menu com a permissão da rota.
import { ARVORE_MENU, type MapaOperacional } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { criarRoteador } from '../../roteador.js';
import { itensComPermissaoDiferente } from '../atendimento/regras-tela.js';
import {
  agruparMapa,
  codigoDaEtiqueta,
  hhmm,
  leitoTexto,
  minutosAtePrazo,
  proximasEtapas,
} from './regras-tela.js';

const totais = { leitos: 2, ativos: 2, inativos: 0, ocupados: 1, livres: 1 };
const MAPA: MapaOperacional = {
  painel: {
    lidoEm: '2026-10-22T10:00:00Z',
    dadosAte: '2026-10-22T10:00:00Z',
    destino: 'memoria',
    totais: {
      ...totais,
      ocupacao: 50,
      intensivos: { leitos: 0, ativos: 0, inativos: 0, ocupados: 0, livres: 0 },
    },
    blocos: [
      {
        bloco: '1',
        nome: 'Bloco sintético A',
        totais,
        acomodacoes: [
          {
            acomodacao: 'ENF1',
            nome: 'Enfermaria sintética',
            tipo: { id: 1, nome: 'Enfermaria' },
            intensiva: false,
            totais,
            leitos: [
              { id: 1, leito: '01', situacao: 'livre', ramal: null, cartao: null },
              {
                id: 2,
                leito: '02',
                situacao: 'ocupado',
                ramal: null,
                cartao: {
                  internacao: 70001,
                  iniciais: 'S.S.',
                  idade: 50,
                  sexo: 'F',
                  diasInternacao: 2,
                  convenio: null,
                  tipoTrecho: null,
                  intensivo: false,
                },
              },
            ],
          },
        ],
      },
    ],
    avisos: [],
  },
  leitos: [
    {
      chave: '1|ENF1|01',
      leito: { bloco: '1', acomodacao: 'ENF1', leito: '01' },
      situacao: 'bloqueado',
      estados: [],
      admissivel: false,
      motivo: null,
      limpeza: null,
      conflito: null,
      atributos: null,
    },
    {
      chave: '1|ENF1|02',
      leito: { bloco: '1', acomodacao: 'ENF1', leito: '02' },
      situacao: 'ocupado',
      estados: [],
      admissivel: false,
      motivo: null,
      limpeza: null,
      conflito: null,
      atributos: null,
    },
  ],
  resumo: { bloqueados: 1, emHigienizacao: 0, conflitos: 0, admissiveis: 0 },
};

describe('mapa operacional na tela', () => {
  it('agrupa como o painel, com o cartão do ocupado, e filtra pela situação do mapa (não a do painel)', () => {
    const g = agruparMapa(MAPA);
    expect(g).toHaveLength(1);
    expect(
      g[0]?.acomodacoes[0]?.leitos.map((l) => [l.mapa.chave, l.mapa.situacao, l.cartao?.internacao ?? null]),
    ).toEqual([
      ['1|ENF1|01', 'bloqueado', null],
      ['1|ENF1|02', 'ocupado', 70001],
    ]);
    expect(agruparMapa(MAPA, { situacao: 'bloqueado' })[0]?.acomodacoes[0]?.leitos).toHaveLength(1);
    expect(agruparMapa(MAPA, { bloco: '2' })).toEqual([]);
    expect(leitoTexto({ bloco: '1', acomodacao: 'ENF1', leito: '01' })).toBe('1 · ENF1 · 01');
  });
});

describe('horas, prazo e etiqueta', () => {
  it('hora para exibir; prazo em minutos (negativo atrasado); a etiqueta só com dígitos', () => {
    expect(hhmm('1430')).toBe('14:30');
    expect(hhmm('14:30')).toBe('14:30');
    expect(hhmm('')).toBe('');
    expect(hhmm(null)).toBe('');
    const agora = Date.parse('2026-10-22T10:00:00Z');
    expect(minutosAtePrazo('2026-10-22T10:30:00', agora)).toBe(30);
    expect(minutosAtePrazo('2026-10-22T09:45:00', agora)).toBe(-15);
    expect(minutosAtePrazo(null, agora)).toBeNull();
    expect(codigoDaEtiqueta(' 000123456\n')).toBe('000123456');
    expect(codigoDaEtiqueta('abc')).toBeNull();
    expect(codigoDaEtiqueta('1234567890123')).toBeNull();
  });

  it('o aplicativo oferece só a etapa seguinte; a inspeção e a liberação ficam com o supervisor', () => {
    expect(proximasEtapas('solicitado')).toEqual(['atribuido']);
    expect(proximasEtapas('emExecucao')).toEqual(['pausado', 'concluido']);
    expect(proximasEtapas('reprovado')).toEqual(['emExecucao']);
    expect(proximasEtapas('concluido')).toEqual([]);
    expect(proximasEtapas('inspecionado')).toEqual([]);
  });
});

describe('menu × rota', () => {
  it('os itens do menu do M21 exigem a permissão da rota de destino (ninguém cai em "sem permissão")', () => {
    const r = criarRoteador(async () => Promise.reject(new Error('sem sessão')), {
      historico: createMemoryHistory(),
      desenvolvimento: false,
    });
    const permissaoDaRota = (caminho: string) => {
      const x = r.resolve(caminho);
      if (x.name === 'nao-encontrada') return undefined;
      const m = [...x.matched].reverse().find((y) => y.meta?.permissao);
      return (m?.meta?.permissao as string | undefined) ?? undefined;
    };
    // M48 (etapa 3): "Isolamento e precauções no mapa de leitos" é da CCIH, não do M21.
    const doMarco = ARVORE_MENU.filter(
      (i) =>
        i.id.startsWith('internacao-e-leitos.internacao.') ||
        (!i.id.startsWith('qualidade-e-seguranca.') &&
          ['mapa-de-leitos', 'transferencia-de-leito', 'historico-de-ocupacao'].some((p) =>
            i.id.includes(p),
          )) ||
        i.id.startsWith('hotelaria-e-apoio.higienizacao.') ||
        i.id.startsWith('hotelaria-e-apoio.same-e-arquivo.movimentacao') ||
        i.id.endsWith('higienizacao-fila-por-prazo-celular'),
    );
    expect(doMarco.filter((i) => i.rota && i.permissao).length).toBe(17);
    expect(itensComPermissaoDiferente(doMarco, permissaoDaRota)).toEqual([]);
  });
});
