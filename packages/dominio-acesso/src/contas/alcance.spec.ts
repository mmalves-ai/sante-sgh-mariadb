// M59-F1, regra 4: alcance de cada módulo (receitas, código do grupo, núcleo e generators dos gatilhos).
import { describe, expect, it } from 'vitest';
import { calcularAlcances, moduloDoGrupo, versaoDoAlcance, type EntradaAlcance } from './alcance.js';
import { planejarPrivilegios } from './privilegio-minimo.js';

const base: EntradaAlcance = {
  receitas: [
    {
      nome: 'acesso.alterarUsuario',
      grupo: 'acesso',
      passos: [{ tabela: 'TBUSERS', acao: 'UPDATE' }],
      efeitos: [{ tabela: 'TBHISTSENHA', acao: 'INSERT' }],
    },
    {
      nome: 'cadastro.cadastrarPaciente',
      grupo: 'cadastro',
      passos: [{ tabela: 'TBPACIENTE', acao: 'insert' }],
      efeitos: [],
    },
  ],
  usosPorGrupo: {
    acesso: { TBGRUUSU: ['SELECT'], SGH_ACESSO_SEGUNDO_FATOR: ['SELECT', 'INSERT', 'UPDATE'] },
    cadastro: { TBCONVEN: ['SELECT'], SGH_TRILHA: ['UPDATE'] },
    nucleo: { SGH_VERSAO_SCRIPT: ['SELECT'] },
  },
  comum: { SGH_TRILHA: ['SELECT', 'INSERT'], SGH_IDEMPOTENCIA: ['SELECT', 'INSERT'] },
  generatorsPorTabela: {
    TBHISTSENHA: ['GEN_TBHISTSENHA'],
    TBPACIENTE: ['GEN_TBPACIENTE'],
    TBUSERS: ['GEN_TBUSERS'],
  },
  proceduresPorTabela: { TBUSERS: ['SP_HIST_USUARIO'] },
  gruposFora: ['nucleo'],
};

describe('moduloDoGrupo', () => {
  it('converte para camelCase e recusa nome fora do padrão', () => {
    expect(moduloDoGrupo('acesso')).toBe('acesso');
    expect(moduloDoGrupo('cadastro-paciente')).toBe('cadastroPaciente');
    expect(moduloDoGrupo('faturamento_tiss')).toBe('faturamentoTiss');
    expect(() => moduloDoGrupo('9x')).toThrow(/Grupo inválido/);
  });
});

describe('calcularAlcances', () => {
  const r = calcularAlcances(base);
  const de = (m: string) => r.alcances.find((a) => a.modulo === m)?.objetos ?? {};

  it('um alcance por grupo, sem os grupos de fora', () => {
    expect(r.alcances.map((a) => a.modulo)).toEqual(['acesso', 'cadastro']);
  });

  it('passo dá SELECT e a ação; efeito dá a ação; INSERT dá USAGE no generator do gatilho', () => {
    expect(de('acesso')['TBUSERS']).toEqual(['SELECT', 'UPDATE']);
    expect(de('acesso')['TBHISTSENHA']).toEqual(['INSERT']);
    expect(de('acesso')['GEN_TBHISTSENHA']).toEqual(['USAGE']);
    expect(de('cadastro')['TBPACIENTE']).toEqual(['SELECT', 'INSERT']);
    expect(de('cadastro')['GEN_TBPACIENTE']).toEqual(['USAGE']);
    expect(de('cadastro')['GEN_TBHISTSENHA']).toBeUndefined();
    // UPDATE também puxa o que os gatilhos da tabela usam (generator e procedure).
    expect(de('acesso')['GEN_TBUSERS']).toEqual(['USAGE']);
    expect(de('acesso')['SP_HIST_USUARIO']).toEqual(['EXECUTE']);
  });

  it('o código do grupo e o comum do núcleo entram em todo módulo', () => {
    expect(de('acesso')['SGH_ACESSO_SEGUNDO_FATOR']).toEqual(['SELECT', 'INSERT', 'UPDATE']);
    expect(de('acesso')['SGH_TRILHA']).toEqual(['SELECT', 'INSERT']);
    expect(de('cadastro')['SGH_IDEMPOTENCIA']).toEqual(['SELECT', 'INSERT']);
    expect(de('cadastro')['TBCONVEN']).toEqual(['SELECT']);
    expect(de('acesso')['TBCONVEN']).toBeUndefined();
  });

  it('UPDATE na trilha visto no código é descartado com motivo, e o plano sai aceito', () => {
    expect(de('cadastro')['SGH_TRILHA']).toEqual(['SELECT', 'INSERT']);
    expect(r.descartes.some((d) => d.includes('UPDATE em SGH_TRILHA'))).toBe(true);
    expect(() => planejarPrivilegios(r.alcances)).not.toThrow();
  });

  it('procedure e generator não se misturam com DML; ação estranha e nome inválido são descartados', () => {
    const x = calcularAlcances({
      receitas: [
        { nome: 'a.b', grupo: 'pep', passos: [{ tabela: 'TBX', acao: 'MERGE' }], efeitos: [] },
        { nome: 'a.c', grupo: 'pep', passos: [], efeitos: [{ tabela: 'TBY', acao: 'SELECT' }] },
      ],
      usosPorGrupo: { pep: { SP_X: ['EXECUTE'], 'tb y': ['SELECT'] } },
      comum: { SP_X: ['SELECT'] },
    });
    expect(x.alcances[0]?.objetos).toEqual({ SP_X: ['EXECUTE'] });
    expect(x.descartes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ação MERGE em TBX'),
        expect.stringContaining('ação SELECT em TBY (efeito)'),
        expect.stringContaining('nome inválido'),
        expect.stringContaining('SELECT em SP_X descartado'),
      ]),
    );
  });

  it('INSERT visto no código também puxa o generator do gatilho', () => {
    const x = calcularAlcances({
      receitas: [],
      usosPorGrupo: { recepcao: { TBSENHA: ['SELECT', 'INSERT'] } },
      comum: {},
      generatorsPorTabela: { TBSENHA: ['GEN_SENHA'] },
    });
    expect(x.alcances[0]?.objetos['GEN_SENHA']).toEqual(['USAGE']);
  });
});

describe('calcularAlcances: tabelas dos gatilhos e receitas do núcleo (M59-F1, correção)', () => {
  const entrada: EntradaAlcance = {
    receitas: [
      {
        nome: 'auditoria.registrarEventoLegado',
        grupo: 'auditoria',
        passos: [
          { tabela: 'TBCABTRILHA', acao: 'INSERT' },
          { tabela: 'TBLANTRILHASGH', acao: 'INSERT' },
        ],
        efeitos: [],
      },
      {
        nome: 'atendimento.lancarConta',
        grupo: 'atendimento',
        passos: [{ tabela: 'FCCTAEXT', acao: 'UPDATE' }],
        efeitos: [],
      },
    ],
    usosPorGrupo: { pep: { TBCONVEN: ['SELECT'] } },
    comum: { SGH_TRILHA: ['SELECT', 'INSERT'] },
    generatorsPorTabela: { TBCABTRILHA: ['GEN_TBCABTRILHA_ID'] },
    tabelasPorTabela: {
      FCCTAEXT: { FCCTRLANCIHA: ['SELECT', 'INSERT'], FIPARAM: ['SELECT'] },
      SGH_TRILHA: { TBGATILHOTRILHA: ['SELECT'] },
    },
    receitasDoNucleo: ['auditoria.registrarEventoLegado'],
  };
  const r = calcularAlcances(entrada);
  const de = (m: string) => r.alcances.find((a) => a.modulo === m)?.objetos ?? {};

  it('escrita em tabela dá a ação nas tabelas que os gatilhos dela leem ou gravam', () => {
    expect(de('atendimento')).toMatchObject({
      FCCTAEXT: ['SELECT', 'UPDATE'],
      FCCTRLANCIHA: ['SELECT', 'INSERT'],
      FIPARAM: ['SELECT'],
    });
    expect(de('pep')['FCCTRLANCIHA']).toBeUndefined();
  });

  it('a receita do núcleo (evento na trilha do legado) vai a todo módulo, com o generator do gatilho', () => {
    for (const m of ['atendimento', 'auditoria', 'pep']) {
      expect(de(m), m).toMatchObject({
        TBCABTRILHA: ['SELECT', 'INSERT'],
        TBLANTRILHASGH: ['SELECT', 'INSERT'],
        GEN_TBCABTRILHA_ID: ['USAGE'],
      });
    }
  });

  it('escrita do comum do núcleo também puxa os gatilhos', () => {
    expect(de('pep')['TBGATILHOTRILHA']).toEqual(['SELECT']);
  });
});

describe('versaoDoAlcance', () => {
  it('estável, 12 hex, muda quando o alcance muda', () => {
    const a = calcularAlcances(base).alcances;
    const v = versaoDoAlcance(a);
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(versaoDoAlcance(calcularAlcances(base).alcances)).toBe(v);
    expect(versaoDoAlcance(a.slice(1))).not.toBe(v);
  });
});
