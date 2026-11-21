// Contratos da gestão de pessoas, fatia F1 (M52): permissões no catálogo, parâmetro do alerta do conselho e as
// entradas (CPF com dígito verificador, datas, motivo, lotação). CPFs gerados para o teste (sintéticos).
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_PESSOAS_M52_F1 } from '../permissoes/pessoas.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { PARAMETROS_NOVOS } from '../parametros/definicoes.js';
import { PARAMETROS_PESSOAS } from '../parametros/pessoas.js';
import {
  esquemaAdmitirColaborador,
  esquemaAlterarVinculo,
  esquemaDependente,
  esquemaDesligarColaborador,
  esquemaFiltroColaboradores,
  esquemaFiltroHabilitacoes,
  esquemaPreviaAdmissao,
  esquemaRegistrarHabilitacao,
} from './entradas.js';
import {
  CODIGOS_TIPO_VINCULO,
  JANELA_ALERTA_CONSELHO_DIAS,
  SITUACOES_PROFISSIONAL_LEGADO,
  TIPOS_VINCULO,
  VINCULOS_PRESTADOR,
} from './vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

// CPF sintético com os verificadores válidos (base 123456789 → 12345678909).
const CPF = '123.456.789-09';

const admissao = {
  cpf: CPF,
  nome: 'COLABORADOR SINTETICO M52',
  tipo: 'clt',
  admissao: '2026-11-03',
  cargo: 'Técnico de enfermagem',
  cargaSemanalHoras: 36,
  lotacao: { centroCusto: 12 },
} as const;

describe('permissões da F1', () => {
  it('as três da ficha estão no catálogo, com origem no outro sistema', () => {
    const codigos = PERMISSOES_PESSOAS_M52_F1.map((p) => p.codigo);
    expect(codigos).toEqual([
      'pessoas.colaborador.ler',
      'pessoas.colaborador.admitir',
      'pessoas.colaborador.desligar',
      'pessoas.cargos.ler',
      'pessoas.cargos.gerir',
      'pessoas.avaliacao.ler',
      'pessoas.avaliacao.gerir',
      'pessoas.avaliacao.ciencia',
      'pessoas.autoatendimento.solicitar',
      'pessoas.autoatendimento.aprovar',
      'pessoas.atestado.verCid',
      'pessoas.indicadores.ler',
    ]);
    for (const p of PERMISSOES_PESSOAS_M52_F1) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      // A ciência da própria avaliação é recurso de toda pessoa (sem opção no outro sistema).
      if (p.concessaoPorPerfil !== 'todos-os-perfis-de-pessoa')
        expect(opcoesDoMapa(p.codigo).length).toBeGreaterThan(0);
      expect(p.categoria).toBe('administrativa');
      expect(CATALOGO_DECLARADO).toContain(p);
    }
    const unicos = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
    expect(unicos.size).toBe(CATALOGO_DECLARADO.length);
  });

  it('desligar é crítico (reautenticação) e admitir é sensível', () => {
    const por = new Map(PERMISSOES_PESSOAS_M52_F1.map((p) => [p.codigo, p]));
    expect(por.get('pessoas.colaborador.desligar')?.criticidade).toBe('critica');
    expect(por.get('pessoas.colaborador.admitir')?.criticidade).toBe('sensivel');
    expect(por.get('pessoas.colaborador.ler')?.criticidade).toBe('normal');
    expect(por.get('pessoas.cargos.gerir')?.criticidade).toBe('sensivel');
    expect(opcoesDoMapa(por.get('pessoas.cargos.ler')?.codigo)).toEqual([362]);
    expect(por.get('pessoas.avaliacao.gerir')?.criticidade).toBe('sensivel');
    expect(opcoesDoMapa(por.get('pessoas.avaliacao.ler')?.codigo)).toEqual([358]);
    expect(por.get('pessoas.avaliacao.ciencia')?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
    // W0-06, M3: pedir é de toda pessoa; aprovar é do gestor; o CID é restrito a quem lê o ASO.
    expect(por.get('pessoas.autoatendimento.solicitar')?.concessaoPorPerfil).toBe(
      'todos-os-perfis-de-pessoa',
    );
    expect(opcoesDoMapa(por.get('pessoas.autoatendimento.aprovar')?.codigo)).toEqual([5069, 5074]);
    expect(por.get('pessoas.autoatendimento.aprovar')?.perfis).toEqual(['gestor-escala']);
    expect(opcoesDoMapa(por.get('pessoas.atestado.verCid')?.codigo)).toEqual([572]);
    expect(por.get('pessoas.atestado.verCid')?.criticidade).toBe('sensivel');
    // W0-06, M4: o painel de indicadores é de quem tem o cadastro de funcionários.
    expect(opcoesDoMapa(por.get('pessoas.indicadores.ler')?.codigo)).toEqual([358]);
  });
});

describe('parâmetro do alerta do conselho', () => {
  it('está no registro, com o padrão da ficha dentro dos limites', () => {
    const [d] = PARAMETROS_PESSOAS;
    expect(PARAMETROS_NOVOS).toContain(d);
    expect(d?.chave).toBe('pessoas.alertaConselhoDias');
    expect(Number(d?.padrao)).toBe(JANELA_ALERTA_CONSELHO_DIAS);
    expect(Number(d?.padrao)).toBeGreaterThanOrEqual(d?.minimo ?? 0);
    expect(Number(d?.padrao)).toBeLessThanOrEqual(d?.maximo ?? 0);
  });
});

describe('vocabulário', () => {
  it('sete tipos de vínculo; os de prestador são do vocabulário; a situação do outro sistema diz "a confirmar"', () => {
    expect(CODIGOS_TIPO_VINCULO).toHaveLength(7);
    for (const v of VINCULOS_PRESTADOR) expect(TIPOS_VINCULO[v]).toBeDefined();
    for (const r of Object.values(SITUACOES_PROFISSIONAL_LEGADO)) expect(r).toMatch(/a confirmar/);
  });
});

describe('entradas da admissão', () => {
  it('aceita a admissão com CPF mascarado e devolve só os dígitos', () => {
    const r = esquemaAdmitirColaborador.parse(admissao);
    expect(r.cpf).toBe('12345678909');
    expect(r.profissional).toBeNull();
    expect(r.usuario).toBeNull();
    expect(r.lotacao).toEqual({ centroCusto: 12, unidade: null, setor: null });
  });

  it('recusa CPF com dígito errado, sequência repetida, data inválida e campo a mais', () => {
    expect(esquemaAdmitirColaborador.safeParse({ ...admissao, cpf: '123.456.789-00' }).success).toBe(false);
    expect(esquemaAdmitirColaborador.safeParse({ ...admissao, cpf: '111.111.111-11' }).success).toBe(false);
    expect(esquemaAdmitirColaborador.safeParse({ ...admissao, admissao: '2026-13-01' }).success).toBe(false);
    expect(esquemaAdmitirColaborador.safeParse({ ...admissao, senha: 'x' }).success).toBe(false);
    expect(esquemaAdmitirColaborador.safeParse({ ...admissao, cargaSemanalHoras: 61 }).success).toBe(false);
    expect(esquemaAdmitirColaborador.safeParse({ ...admissao, tipo: 'avulso' }).success).toBe(false);
  });

  it('a prévia leva só o CPF', () => {
    expect(esquemaPreviaAdmissao.parse({ cpf: CPF })).toEqual({ cpf: '12345678909' });
    expect(esquemaPreviaAdmissao.safeParse({ cpf: CPF, nome: 'x' }).success).toBe(false);
  });
});

describe('mudança funcional, desligamento, dependente e conselho', () => {
  it('a mudança precisa de ao menos um campo e de motivo', () => {
    const base = {
      vinculo: 5,
      versao: 0,
      vigencia: '2026-12-01',
      motivo: 'Promoção aprovada pela diretoria',
    };
    expect(esquemaAlterarVinculo.safeParse(base).success).toBe(false);
    expect(esquemaAlterarVinculo.safeParse({ ...base, cargo: 'Enfermeiro' }).success).toBe(true);
    expect(esquemaAlterarVinculo.safeParse({ ...base, cargo: 'Enfermeiro', motivo: 'curto' }).success).toBe(
      false,
    );
  });

  it('o desligamento leva data, tipo de rescisão e motivo; nada de login', () => {
    const d = {
      vinculo: 5,
      data: '2026-12-01',
      tipoRescisao: 2,
      motivo: 'Pedido de demissão do colaborador',
    };
    expect(esquemaDesligarColaborador.parse(d)).toEqual(d);
    expect(esquemaDesligarColaborador.safeParse({ ...d, login: 'X' }).success).toBe(false);
    expect(esquemaDesligarColaborador.safeParse({ ...d, tipoRescisao: 10 }).success).toBe(false);
  });

  it('o dependente aceita CPF nulo e parentesco do eSocial', () => {
    const dep = { vinculo: 5, nome: 'DEPENDENTE SINTETICO', nascimento: '2026-01-10', parentesco: '03' };
    expect(esquemaDependente.parse(dep)).toMatchObject({ cpf: null, dependenteIr: false });
    expect(esquemaDependente.safeParse({ ...dep, parentesco: '05' }).success).toBe(false);
    expect(esquemaDependente.parse({ ...dep, cpf: CPF }).cpf).toBe('12345678909');
  });

  it('a validade do conselho pode ser nula (não informada)', () => {
    expect(
      esquemaRegistrarHabilitacao.parse({ registro: 9, validade: null, conferidoEm: '2026-10-24' }),
    ).toMatchObject({ validade: null, observacao: null });
  });

  it('os filtros convertem a query e limitam a página a 200', () => {
    expect(esquemaFiltroColaboradores.parse({ centroCusto: '12', limite: '200' })).toMatchObject({
      centroCusto: 12,
      limite: 200,
      estado: 'ativo',
    });
    expect(esquemaFiltroColaboradores.safeParse({ limite: '201' }).success).toBe(false);
    expect(esquemaFiltroHabilitacoes.parse({})).toMatchObject({ situacao: 'todas', limite: 50 });
  });
});
