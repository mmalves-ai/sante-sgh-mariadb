import type { Assinatura } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  CENARIO_DO_TIPO_EVENTO,
  comparacoesDaReferencia,
  diferencasDaGravacao,
  type EstruturaGravacao,
  referenciaPorEvento,
  vigiarDia,
  vigiarHospitalDia,
} from './vigia.js';

const ref: Assinatura = {
  formato: 1,
  operacao: 'auditoria.registrarEventoLegado',
  cenario: 'consulta-res',
  origem: 'perfil',
  hospitais: ['pc'],
  impressaoSchema: null,
  tabelas: [
    {
      tabela: 'TBCABTRILHA',
      acao: 'INSERT',
      linhas: 1,
      colunas: {
        ID: { classe: 'generator', formato: 'numero' },
        FUSO_HORARIO_LOCAL: { classe: 'constante:-03:00', formato: 'texto' },
        ID_TBTPACAOAUDIT: { classe: 'dominio:1|6', formato: 'numero' },
        ID_HTPACIENTE: { classe: 'vazio' },
        USUARIO: { classe: 'entrada', formato: 'texto' },
      },
    },
    {
      tabela: 'TBLANTRILHASGH',
      acao: 'INSERT',
      linhas: 1,
      colunas: { ID_TBCABTRILHA: { classe: 'copia:TBCABTRILHA.ID', formato: 'numero' } },
    },
  ],
  ligacoes: [],
  efeitosTrigger: [],
  diferencas_aceitas: [],
};

const sim = { preenchida: true, confere: null };
const ok = (): EstruturaGravacao => ({
  tabelas: [
    {
      tabela: 'TBCABTRILHA',
      acao: 'INSERT',
      linhas: [
        {
          ID: sim,
          FUSO_HORARIO_LOCAL: { preenchida: true, confere: true },
          ID_TBTPACAOAUDIT: { preenchida: true, confere: true },
          ID_HTPACIENTE: { preenchida: false, confere: null },
          USUARIO: sim,
        },
      ],
    },
    {
      tabela: 'TBLANTRILHASGH',
      acao: 'INSERT',
      linhas: [{ ID_TBCABTRILHA: { preenchida: true, confere: true } }],
    },
  ],
});

describe('vigilância: comparações pedidas ao banco', () => {
  it('constante, domínio e cópia viram parâmetro; as demais não comparam', () => {
    const c = comparacoesDaReferencia(ref, 'TBCABTRILHA');
    expect(c['FUSO_HORARIO_LOCAL']).toEqual({ tipo: 'igual', valores: ['-03:00'] });
    expect(c['ID_TBTPACAOAUDIT']).toEqual({ tipo: 'igual', valores: ['1', '6'] });
    expect(c['USUARIO']).toEqual({ tipo: 'nenhuma' });
    expect(comparacoesDaReferencia(ref, 'TBLANTRILHASGH')['ID_TBCABTRILHA']).toEqual({
      tipo: 'copia',
      tabela: 'TBCABTRILHA',
      coluna: 'ID',
    });
    expect(comparacoesDaReferencia(ref, 'OUTRA')).toEqual({});
  });
});

describe('vigilância: diferenças de uma gravação', () => {
  it('a gravação igual à referência não tem diferença', () => {
    expect(diferencasDaGravacao(ref, ok())).toEqual([]);
  });

  it('coluna vazia preenchida, valor fora da constante e detalhe ausente, sem valor no obtido', () => {
    const g = ok();
    const cab = g.tabelas[0]!.linhas[0]!;
    const difs = diferencasDaGravacao(ref, {
      tabelas: [
        {
          ...g.tabelas[0]!,
          linhas: [
            {
              ...cab,
              ID_HTPACIENTE: { preenchida: true, confere: null },
              FUSO_HORARIO_LOCAL: { preenchida: true, confere: false },
            },
          ],
        },
      ],
    });
    expect(difs.map((d) => [d.tipo, d.elemento, d.obtido])).toEqual([
      ['classe', 'TBCABTRILHA:INSERT.colunas.FUSO_HORARIO_LOCAL', 'outro-valor'],
      ['colunas', 'TBCABTRILHA:INSERT.colunas.ID_HTPACIENTE', 'preenchida'],
      ['tabela', 'TBLANTRILHASGH:INSERT', 'ausente'],
    ]);
  });

  it('número de linhas, coluna esperada vazia e tabela a mais', () => {
    const g = ok();
    const cab = g.tabelas[0]!.linhas[0]!;
    const difs = diferencasDaGravacao(ref, {
      tabelas: [
        { ...g.tabelas[0]!, linhas: [{ ...cab, USUARIO: { preenchida: false, confere: null } }] },
        { ...g.tabelas[1]!, linhas: [g.tabelas[1]!.linhas[0]!, g.tabelas[1]!.linhas[0]!] },
        { tabela: 'TBUSERS', acao: 'UPDATE', linhas: [{ DATALOG: sim }] },
      ],
    });
    expect(difs.map((d) => `${d.tipo} ${d.elemento} ${d.esperado} ${d.obtido}`)).toEqual([
      'colunas TBCABTRILHA:INSERT.colunas.USUARIO entrada vazia',
      'linhas TBLANTRILHASGH:INSERT.linhas 1 2',
      'tabela TBUSERS:UPDATE ausente 1 linha(s)',
    ]);
  });

  it('a sentinela que some é troca de classe; a diferença aceita na referência passa', () => {
    const r: Assinatura = {
      ...ref,
      tabelas: [
        {
          ...ref.tabelas[0]!,
          colunas: { ...ref.tabelas[0]!.colunas, ID_HTPACIENTE: { classe: 'sentinela:0' } },
        },
        ref.tabelas[1]!,
      ],
      diferencas_aceitas: [
        {
          elemento: 'TBCABTRILHA:INSERT.colunas.ID_HTPACIENTE',
          tipo: 'classe',
          esperado: 'sentinela:0',
          obtido: 'vazia',
          motivo: 'teste',
          decisao: 'ADR 0012',
          data: '2026-10-23',
          papel: 'dono do projeto',
        },
      ],
    };
    const difs = diferencasDaGravacao(r, ok());
    expect(difs).toEqual([
      {
        tipo: 'classe',
        elemento: 'TBCABTRILHA:INSERT.colunas.ID_HTPACIENTE',
        esperado: 'sentinela:0',
        obtido: 'vazia',
        aceita: true,
      },
    ]);
  });

  it('referência por evento: o cenário de dois eventos vale por um', () => {
    const dois = { ...ref, tabelas: [{ ...ref.tabelas[0]!, linhas: 2 }] };
    expect(referenciaPorEvento(dois).tabelas[0]!.linhas).toBe(1);
    expect(CENARIO_DO_TIPO_EVENTO[8]).toBe(CENARIO_DO_TIPO_EVENTO[9]);
  });
});

describe('vigilância: um dia de uma operação', () => {
  const base = {
    hospital: 'pc',
    data: '2026-11-03',
    operacao: 'auditoria.registrarEventoLegado',
    referencias: { 'consulta-res': ref },
  };

  it('amostra, compara e resume; o evento sem cenário diverge pelo tipo', async () => {
    const lidos: string[] = [];
    const r = await vigiarDia({
      ...base,
      tamanho: 10,
      gravacoes: [
        { id: '11', cenario: 'consulta-res' },
        { id: '12', cenario: 'consulta-res' },
        { id: '13', cenario: null },
      ],
      lerEstrutura: async (id) => {
        lidos.push(id);
        return ok();
      },
    });
    expect(lidos.sort()).toEqual(['11', '12']);
    expect(r.amostradas).toBe(3);
    expect(r.divergentes).toBe(1);
    expect(r.elementos).toEqual([
      {
        tipo: 'classe',
        tabela: 'TBCABTRILHA',
        coluna: 'ID_TBTPACAOAUDIT',
        classe: 'dominio',
        ocorrencias: 1,
      },
    ]);
  });

  it('dia sem gravação: zero amostradas; amostra zero com gravações é recusada', async () => {
    const lerEstrutura = async () => ok();
    const vazio = await vigiarDia({ ...base, tamanho: 50, gravacoes: [], lerEstrutura });
    expect([vazio.amostradas, vazio.divergentes]).toEqual([0, 0]);
    await expect(
      vigiarDia({ ...base, tamanho: 0, gravacoes: [{ id: '1', cenario: 'consulta-res' }], lerEstrutura }),
    ).rejects.toThrow(/amostra vazia/);
  });

  it('a amostra respeita o teto e é a mesma na reexecução', async () => {
    const gravacoes = Array.from({ length: 30 }, (_, i) => ({
      id: String(100 + i),
      cenario: 'consulta-res',
    }));
    const lidos: string[][] = [[], []];
    for (const i of [0, 1])
      await vigiarDia({
        ...base,
        tamanho: 5,
        gravacoes,
        lerEstrutura: async (id) => {
          lidos[i]!.push(id);
          return ok();
        },
      });
    expect(lidos[0]).toHaveLength(5);
    expect(lidos[1]).toEqual(lidos[0]);
  });

  it('sem nenhuma referência, o elemento vai com a tabela desconhecida', async () => {
    const r = await vigiarDia({
      ...base,
      referencias: {},
      tamanho: 1,
      gravacoes: [{ id: '1', cenario: 'login-ok' }],
      lerEstrutura: async () => ok(),
    });
    expect(r.elementos[0]?.tabela).toBe('DESCONHECIDO');
  });
});

describe('vigilância: um dia de um hospital', () => {
  it('compara as localizáveis, grava a linha e devolve as sem localizador e os alertas', async () => {
    const gravadas: string[] = [];
    const g = ok();
    const r = await vigiarHospitalDia({
      hospital: 'pc',
      data: '2026-11-03',
      tamanho: 5,
      operacoes: ['acesso.trocarSenha', 'auditoria.registrarEventoLegado'],
      localizavel: (op) => op === 'auditoria.registrarEventoLegado',
      gravacoesDoDia: async () => [{ id: '1', cenario: 'consulta-res' }],
      referencias: () => ({ 'consulta-res': ref }),
      lerEstrutura: async () => ({ tabelas: [g.tabelas[0]!] }),
      gravar: async (x) => gravadas.push(`${x.operacao}:${x.divergentes}`),
    });
    expect(r.semLocalizador).toEqual(['acesso.trocarSenha']);
    expect(gravadas).toEqual(['auditoria.registrarEventoLegado:1']);
    expect(r.alertas[0]).toMatch(/^pc 2026-11-03 auditoria.registrarEventoLegado: 1 de 1/);
  });
});
