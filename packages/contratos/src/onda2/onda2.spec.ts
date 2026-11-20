import { describe, expect, it } from 'vitest';
import { recursoDesligado } from '../liberacao/recursos.js';
import { operacoesDoSetor, SETORES_PRONTIDAO } from '../prontidao/catalogo.js';
import {
  CODIGOS_BAIXA_CONFIANCA_ONDA_2,
  esquemaAcompanhamentoOnda2,
  esquemaJanelaSemVersao,
  esquemaConsultaAcompanhamento,
  esquemaGravarItensOnda2,
  esquemaPedidoContingencia,
  ITENS_CALCULADOS_ONDA_2,
  ITENS_REGISTRAVEIS_ONDA_2,
  EXCECOES_REGRA_15,
  ITENS_CRITERIO_GERAIS,
  ITENS_CRITERIO_LIBERACAO,
  ITENS_CRITERIO_POR_SETOR_ONDA_2,
  JANELAS_SEM_VERSAO_PADRAO,
  OPERACOES_CATALOGO_ONDA_2,
  OPERACOES_FICHA_ONDA_2,
  ORDEM_SETORES_ONDA_2,
  RECURSOS_SO_NO_NOVO,
  ROTULOS_CRITERIO_LIBERACAO,
  SETORES_ONDA_2,
  TABELAS_NUNCA_GRAVADAS,
} from './onda2.js';

describe('onda 2: setores e ordem (campo 12)', () => {
  it('os setores da ordem são os setores da onda 2 do catálogo de prontidão, sem faltar nem repetir', () => {
    const doCatalogo = SETORES_PRONTIDAO.filter((s) => s.onda === 2).map((s) => s.id);
    expect([...SETORES_ONDA_2].sort()).toEqual([...doCatalogo].sort());
    expect(new Set(SETORES_ONDA_2).size).toBe(SETORES_ONDA_2.length);
    expect(ORDEM_SETORES_ONDA_2[0]).toEqual(['internacao-leitos', 'same']);
    expect(ORDEM_SETORES_ONDA_2.at(-1)).toEqual(['higienizacao']);
  });
});

describe('onda 2: operações da ficha (campos 5 e 9)', () => {
  it('cada operação tem ao menos um nome do catálogo, com o formato modulo.operacao', () => {
    for (const o of OPERACOES_FICHA_ONDA_2) {
      expect(o.catalogo.length).toBeGreaterThan(0);
      for (const n of o.catalogo) expect(n).toMatch(/^[a-z]+\.[a-z][A-Za-z0-9]+$/);
      if (o.setor) expect(SETORES_ONDA_2).toContain(o.setor);
    }
  });
  it('nome diferente do catálogo vem com nota', () => {
    for (const o of OPERACOES_FICHA_ONDA_2)
      if (o.catalogo.length !== 1 || o.catalogo[0] !== o.ficha) expect(o.nota).toBeTruthy();
  });
  it('cenários em kebab-case, sem repetir dentro da operação', () => {
    for (const o of OPERACOES_FICHA_ONDA_2) {
      for (const c of o.cenariosMinimos) expect(c).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(new Set(o.cenariosMinimos).size).toBe(o.cenariosMinimos.length);
    }
  });
  it('a lista do catálogo não repete', () => {
    expect(new Set(OPERACOES_CATALOGO_ONDA_2).size).toBe(OPERACOES_CATALOGO_ONDA_2.length);
    expect(OPERACOES_CATALOGO_ONDA_2).toContain('hotelaria.solicitarLimpeza');
    expect(OPERACOES_CATALOGO_ONDA_2).toContain('acesso.revogarOpcoesGrupo');
  });
});

describe('onda 2: critério de liberação (regra 1 e condições da onda)', () => {
  it('todo item tem rótulo de produto, sem citar o outro sistema pelo nome', () => {
    for (const i of ITENS_CRITERIO_LIBERACAO) {
      expect(ROTULOS_CRITERIO_LIBERACAO[i]).toBeTruthy();
      expect(ROTULOS_CRITERIO_LIBERACAO[i]).not.toMatch(/spdata|legado/i);
    }
  });
  it('itens por setor são de setores da onda e não repetem os gerais', () => {
    for (const [setor, itens] of Object.entries(ITENS_CRITERIO_POR_SETOR_ONDA_2)) {
      expect(SETORES_ONDA_2).toContain(setor);
      for (const i of itens) expect(ITENS_CRITERIO_GERAIS).not.toContain(i);
    }
  });
  it('recursos que só existem no novo são chaves declaradas', () => {
    for (const chave of Object.keys(RECURSOS_SO_NO_NOVO)) expect(recursoDesligado(chave)?.chave).toBe(chave);
  });
});

describe('onda 2: regras 14, 15 e 16', () => {
  it('códigos de baixa confiança com valores vistos', () => {
    for (const c of CODIGOS_BAIXA_CONFIANCA_ONDA_2) expect(c.vistos.length).toBeGreaterThan(0);
  });
  it('exceções da regra 15 só em tabelas proibidas e operações de setores da onda', () => {
    const setores = SETORES_PRONTIDAO.filter((s) => SETORES_ONDA_2.includes(s.id));
    for (const e of EXCECOES_REGRA_15) {
      expect(TABELAS_NUNCA_GRAVADAS).toContain(e.tabela);
      expect(
        setores.some((s) => operacoesDoSetor(s, [e.operacao]).length > 0),
        e.operacao,
      ).toBe(true);
    }
  });
  it('janelas sem versão válidas; a invertida é recusada', () => {
    for (const j of JANELAS_SEM_VERSAO_PADRAO) expect(esquemaJanelaSemVersao.parse(j)).toEqual(j);
    expect(() =>
      esquemaJanelaSemVersao.parse({ de: '2026-12-27', ate: '2026-12-24', motivo: 'x x' }),
    ).toThrow();
  });
});

describe('registro do critério por setor (campo 11; D-REG-40)', () => {
  const ok = {
    itens: [
      { item: 'aceite-jornada', situacao: 'cumprido', evidencia: 'ata 12 do comitê', em: '2026-11-30' },
    ],
    justificativa: 'aceite registrado na reunião do comitê',
  };
  it('os itens calculados ficam fora dos registráveis e o conjunto cobre o critério', () => {
    expect(ITENS_CALCULADOS_ONDA_2).toEqual(['operacoes-conferidas', 'pentest-sem-critico']);
    expect([...ITENS_REGISTRAVEIS_ONDA_2, ...ITENS_CALCULADOS_ONDA_2].sort()).toEqual(
      [...ITENS_CRITERIO_LIBERACAO].sort(),
    );
  });
  it('aceita o item cumprido com evidência e data', () => {
    expect(esquemaGravarItensOnda2.parse(ok).itens[0]?.item).toBe('aceite-jornada');
  });
  it('recusa item calculado, cumprido sem evidência, evidência com documento ou e-mail e item repetido', () => {
    const com = (i: object) => ({ ...ok, itens: [{ ...ok.itens[0], ...i }] });
    expect(esquemaGravarItensOnda2.safeParse(com({ item: 'operacoes-conferidas' })).success).toBe(false);
    expect(esquemaGravarItensOnda2.safeParse(com({ item: 'pentest-sem-critico' })).success).toBe(false);
    expect(esquemaGravarItensOnda2.safeParse(com({ evidencia: '' })).success).toBe(false);
    expect(esquemaGravarItensOnda2.safeParse(com({ em: null })).success).toBe(false);
    expect(esquemaGravarItensOnda2.safeParse(com({ evidencia: 'cpf 123.456.789-00' })).success).toBe(false);
    expect(esquemaGravarItensOnda2.safeParse(com({ evidencia: 'fulana@exemplo.com' })).success).toBe(false);
    expect(esquemaGravarItensOnda2.safeParse({ ...ok, itens: [ok.itens[0], ok.itens[0]] }).success).toBe(
      false,
    );
    expect(esquemaGravarItensOnda2.safeParse({ ...ok, justificativa: 'curta' }).success).toBe(false);
  });
  it('pendente dispensa evidência e data', () => {
    expect(
      esquemaGravarItensOnda2.safeParse({
        ...ok,
        itens: [{ item: 'unidade-piloto', situacao: 'pendente' }],
      }).success,
    ).toBe(true);
  });
});

describe('consulta do acompanhamento e pedido do relatório de contingência', () => {
  it('período até 62 dias, início antes do fim', () => {
    expect(esquemaConsultaAcompanhamento.safeParse({ de: '2026-11-01', ate: '2026-11-07' }).success).toBe(
      true,
    );
    expect(esquemaConsultaAcompanhamento.safeParse({ de: '2026-11-07', ate: '2026-11-01' }).success).toBe(
      false,
    );
    expect(esquemaConsultaAcompanhamento.safeParse({ de: '2026-01-01', ate: '2026-06-01' }).success).toBe(
      false,
    );
  });
  it('unidade com o formato do bloco e horizonte de 2 a 12 horas', () => {
    expect(esquemaPedidoContingencia.parse({ unidade: 'UTI' }).horas).toBe(6);
    expect(esquemaPedidoContingencia.safeParse({ unidade: "UTI'; --" }).success).toBe(false);
    expect(esquemaPedidoContingencia.safeParse({ unidade: 'UTI', horas: 24 }).success).toBe(false);
    expect(esquemaPedidoContingencia.safeParse({ unidade: 'UTI', extra: 1 }).success).toBe(false);
  });
});

describe('acompanhamento da onda (campo 4)', () => {
  it('aceita só agregados', () => {
    const a = {
      estabelecimento: 'pc',
      de: '2026-12-01',
      ate: '2026-12-01',
      checagem: [{ dia: '2026-12-01', unidade: 'CTI', horarios: 10, checados: 5, percentual: 50 }],
      higienizacao: [],
      registros: [{ dia: '2026-12-01', tipo: 'evolucao', total: 3, peloNovo: 1, peloOutro: 2 }],
    };
    expect(esquemaAcompanhamentoOnda2.parse(a)).toEqual(a);
    expect(() =>
      esquemaAcompanhamentoOnda2.parse({ ...a, checagem: [{ ...a.checagem[0], paciente: 'x' }] }),
    ).toThrow();
  });
});
