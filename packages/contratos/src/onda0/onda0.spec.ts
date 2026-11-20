import { describe, expect, it } from 'vitest';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import {
  AREAS_CONFERENCIA_LEITURAS,
  CHAVES_TELA_ONDA_0,
  ITENS_CONFERENCIA_LEITURAS,
  ESCRITAS_TELAS_ONDA_0,
  esquemaPainelVigia,
  esquemaSondasImplantacao,
  esquemaTelasOnda0,
  esquemaResultadoVigia,
  FONTES_PRIMEIRA_LIBERACAO,
  GRAVACOES_ONDA_0,
  ITENS_PRIMEIRA_LIBERACAO,
  OPERACOES_PERMITIDAS_ONDA_0,
  TELAS_ONDA_0,
} from './onda0.js';

const base = {
  hospital: 'pc',
  data: '2026-11-03',
  operacao: 'auditoria.registrarEventoLegado',
  amostradas: 50,
  divergentes: 0,
  elementos: [],
};

describe('onda 0: vocabulário', () => {
  it('a trilha dupla é a única gravação incondicional', () => {
    expect(GRAVACOES_ONDA_0.filter((g) => !g.condicional).map((g) => g.operacao)).toEqual([
      'auditoria.registrarEventoLegado',
    ]);
    expect(new Set(OPERACOES_PERMITIDAS_ONDA_0).size).toBe(GRAVACOES_ONDA_0.length);
  });

  it('as telas têm id único e as chaves citadas existem entre as funcionalidades', () => {
    expect(new Set(TELAS_ONDA_0.map((t) => t.id)).size).toBe(TELAS_ONDA_0.length);
    const chaves = new Set(RECURSOS_DESLIGADOS.map((r) => r.chave));
    for (const t of TELAS_ONDA_0) if (t.recurso) expect(chaves.has(t.recurso), t.id).toBe(true);
  });

  it('toda tela de consulta tem a sua chave (seção 12); só a busca global, da sessão, não tem', () => {
    expect(TELAS_ONDA_0.filter((t) => t.recurso === null).map((t) => t.id)).toEqual(['busca-global']);
    expect(CHAVES_TELA_ONDA_0).toHaveLength(7);
    const porChave = new Map(RECURSOS_DESLIGADOS.map((r) => [r.chave, r]));
    for (const c of CHAVES_TELA_ONDA_0) expect(porChave.get(c)?.marco, c).toBe('M38');
    const daTela = new Set(TELAS_ONDA_0.map((t) => t.recurso));
    for (const c of CHAVES_TELA_ONDA_0) expect(daTela.has(c), c).toBe(true);
    for (const id of Object.keys(ESCRITAS_TELAS_ONDA_0))
      expect(
        TELAS_ONDA_0.some((t) => t.id === id),
        id,
      ).toBe(true);
  });

  it('a resposta das telas, o painel da vigilância e as sondas são estritos', () => {
    const tela = {
      id: 'pacientes',
      recurso: 'cadastro.paciente.consulta',
      permissao: 'cadastro.paciente.ler',
      situacao: 'ligada',
      escritaLiberada: false,
    };
    expect(esquemaTelasOnda0.safeParse({ hospital: 'pc', telas: [tela] }).success).toBe(true);
    expect(esquemaTelasOnda0.safeParse({ hospital: 'pc', telas: [{ ...tela, situacao: 'x' }] }).success).toBe(
      false,
    );
    const painel = { hospital: 'pc', de: '2026-11-01', ate: '2026-11-07', estabelecimentos: ['pc'] };
    expect(
      esquemaPainelVigia.safeParse({
        ...painel,
        execucoes: [{ resultado: base, executadoEm: '2026-11-04T03:00:00.000Z' }],
      }).success,
    ).toBe(true);
    expect(esquemaPainelVigia.safeParse({ ...painel, execucoes: [], extra: 1 }).success).toBe(false);
    const sonda = { sonda: 'saude', ok: true, detalhe: 'ok', ms: 3 };
    expect(
      esquemaSondasImplantacao.safeParse({ hospital: 'pc', versao: '1.0.0', pronta: true, sondas: [sonda] })
        .success,
    ).toBe(true);
    expect(
      esquemaSondasImplantacao.safeParse({
        hospital: 'pc',
        versao: '1.0.0',
        pronta: true,
        sondas: [{ ...sonda, sonda: 'outra' }],
      }).success,
    ).toBe(false);
  });

  it('todo item da primeira liberação tem descrição e fonte', () => {
    for (const i of ITENS_PRIMEIRA_LIBERACAO) {
      expect(FONTES_PRIMEIRA_LIBERACAO[i].descricao.length).toBeGreaterThan(0);
      expect(FONTES_PRIMEIRA_LIBERACAO[i].fonte.length).toBeGreaterThan(0);
    }
  });
});

describe('onda 0: resultado da vigilância', () => {
  it('aceita o dia sem divergência', () => {
    expect(esquemaResultadoVigia.parse(base)).toEqual(base);
  });

  it('aceita a divergência com o elemento só de estrutura', () => {
    const r = {
      ...base,
      divergentes: 1,
      elementos: [
        { tipo: 'classe', tabela: 'TBCABTRILHA', coluna: 'USUARIO', classe: 'entrada', ocorrencias: 1 },
      ],
    };
    expect(esquemaResultadoVigia.safeParse(r).success).toBe(true);
  });

  it('recusa campo a mais (valor de linha), divergência sem elemento e elemento sem divergência', () => {
    expect(esquemaResultadoVigia.safeParse({ ...base, valor: 'x' }).success).toBe(false);
    expect(esquemaResultadoVigia.safeParse({ ...base, divergentes: 1 }).success).toBe(false);
    expect(
      esquemaResultadoVigia.safeParse({
        ...base,
        elementos: [{ tipo: 'tabela', tabela: 'TBCABTRILHA', coluna: null, classe: null, ocorrencias: 1 }],
      }).success,
    ).toBe(false);
    expect(esquemaResultadoVigia.safeParse({ ...base, divergentes: 51 }).success).toBe(false);
  });

  it('recusa classe com argumento (o valor da constante não sai)', () => {
    const r = {
      ...base,
      divergentes: 1,
      elementos: [
        {
          tipo: 'classe',
          tabela: 'TBCABTRILHA',
          coluna: 'USUARIO',
          classe: 'constante:ABC',
          ocorrencias: 1,
        },
      ],
    };
    expect(esquemaResultadoVigia.safeParse(r).success).toBe(false);
  });

  it('recusa nome de estrutura fora do padrão e data fora do formato', () => {
    const el = { tipo: 'tabela', tabela: 'tbcabtrilha', coluna: null, classe: null, ocorrencias: 1 };
    expect(esquemaResultadoVigia.safeParse({ ...base, divergentes: 1, elementos: [el] }).success).toBe(false);
    expect(esquemaResultadoVigia.safeParse({ ...base, data: '03/11/2026' }).success).toBe(false);
  });
});

describe('onda 0: conferência de leitura', () => {
  it('as áreas e os itens conferidos estão definidos', () => {
    expect(AREAS_CONFERENCIA_LEITURAS).toEqual(['nir', 'diretoria-clinica']);
    expect(Object.keys(ITENS_CONFERENCIA_LEITURAS)).toContain('leitos');
  });
});
