// Contratos do repasse médico (M33): permissões no catálogo, parâmetros com o padrão dentro do formato e as entradas.
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { PERMISSOES_REPASSE_M33 } from '../permissoes/repasse.js';
import { PARAMETROS_NOVOS } from '../parametros/definicoes.js';
import { PARAMETROS_REPASSE } from '../parametros/repasse.js';
import {
  esquemaApurarRepasse,
  esquemaDecidirApuracao,
  esquemaEmitirRpa,
  esquemaLancarEventoRepasse,
  esquemaProporRegraRepasse,
  esquemaSimularRepasse,
} from './entradas.js';
import { DIMENSOES_REGRA, TIPOS_PRESTADOR_REPASSE } from './vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const regraBase = {
  vigencia: '2026-11-01',
  beneficiario: 'M',
  profissional: 10,
  convenio: 301,
  percentual: 70,
  base: 'cobrado',
  evento: 1,
  justificativa: 'Nova versão pactuada com a equipe',
} as const;

describe('permissões do repasse', () => {
  it('as 17 da ficha estão no catálogo, com código válido e origem no outro sistema ou por perfil', () => {
    const codigos = PERMISSOES_REPASSE_M33.map((p) => p.codigo);
    expect(codigos).toHaveLength(17);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const p of PERMISSOES_REPASSE_M33) {
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(opcoesDoMapa(p.codigo).length > 0 || p.concessaoPorPerfil !== null).toBe(true);
      expect(CATALOGO_DECLARADO).toContain(p);
    }
    for (const c of [
      'repasse.regra.ler',
      'repasse.regra.propor',
      'repasse.regra.aprovar',
      'repasse.apuracao.ler',
      'repasse.apuracao.apurar',
      'repasse.apuracao.aprovar',
      'repasse.lancamento.ler',
      'repasse.lancamento.criar',
      'repasse.rpa.ler',
      'repasse.rpa.emitir',
      'repasse.evento.ler',
      'repasse.evento.editar',
      'repasse.parametro.ler',
      'repasse.parametro.editar',
      'repasse.cooperativa.ler',
      'repasse.cooperativa.editar',
      'repasse.extrato.ler',
    ])
      expect(codigos).toContain(c);
  });

  it('aprovar exige reautenticação e o extrato não depende de opção do outro sistema', () => {
    const por = new Map(PERMISSOES_REPASSE_M33.map((p) => [p.codigo, p]));
    expect(por.get('repasse.regra.aprovar')?.criticidade).toBe('critica');
    expect(por.get('repasse.apuracao.aprovar')?.criticidade).toBe('critica');
    expect(por.get('repasse.rpa.emitir')?.criticidade).toBe('critica');
    expect(por.get('repasse.extrato.ler')?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
  });
});

describe('parâmetros do repasse', () => {
  it('estão no registro, com chave do módulo e padrão dentro do formato e das opções', () => {
    for (const d of PARAMETROS_REPASSE) {
      expect(PARAMETROS_NOVOS).toContain(d);
      expect(d.chave.startsWith('repasse.')).toBe(true);
      if (d.formato) expect(new RegExp(d.formato.expressao, 'i').test(d.padrao)).toBe(true);
      if (d.opcoes) expect(d.opcoes).toContain(d.padrao);
    }
    expect(new Set(PARAMETROS_NOVOS.map((d) => d.chave)).size).toBe(PARAMETROS_NOVOS.length);
  });

  it('a tabela do IRRF aceita faixas até:alíquota:dedução e recusa texto solto', () => {
    const d = PARAMETROS_REPASSE.find((x) => x.chave === 'repasse.irrfTabela');
    const re = new RegExp(d?.formato?.expressao ?? '$^');
    expect(re.test('2428.80:0:0;2826.65:7.5:182.16;0:27.5:908.73')).toBe(true);
    expect(re.test('isento até 2 mil')).toBe(false);
  });
});

describe('entradas do repasse', () => {
  it('regra: percentual ou valor fixo, nunca os dois; faixa de procedimento em ordem', () => {
    expect(esquemaProporRegraRepasse.safeParse(regraBase).success).toBe(true);
    expect(esquemaProporRegraRepasse.safeParse({ ...regraBase, valorFixo: 50 }).success).toBe(false);
    expect(esquemaProporRegraRepasse.safeParse({ ...regraBase, percentual: 0 }).success).toBe(false);
    expect(esquemaProporRegraRepasse.safeParse({ ...regraBase, percentual: 0, valorFixo: 50 }).success).toBe(
      true,
    );
    expect(
      esquemaProporRegraRepasse.safeParse({
        ...regraBase,
        procedimentoInicial: 200,
        procedimentoFinal: 100,
      }).success,
    ).toBe(false);
    expect(esquemaProporRegraRepasse.safeParse({ ...regraBase, justificativa: 'curta' }).success).toBe(false);
  });

  it('apuração, decisão, evento, RPA e simulador', () => {
    expect(esquemaApurarRepasse.safeParse({ empresa: 1, competencia: '2026-10' }).success).toBe(true);
    expect(esquemaApurarRepasse.safeParse({ empresa: 1, competencia: '2026-13' }).success).toBe(false);
    expect(esquemaDecidirApuracao.safeParse({ apuracao: 1, acao: 'aprovar' }).success).toBe(true);
    expect(esquemaDecidirApuracao.safeParse({ apuracao: 1, acao: 'devolver' }).success).toBe(false);
    const evento = {
      origem: 'estorno',
      empresa: 1,
      competencia: '2026-10',
      data: '2026-10-10',
      evento: 2,
      tipo: 'M',
      prestador: 5,
      profissional: 9,
      valor: -12.5,
      estornaDe: 77,
      justificativa: 'Estorno da glosa mantida',
    };
    expect(esquemaLancarEventoRepasse.safeParse(evento).success).toBe(true);
    expect(esquemaLancarEventoRepasse.safeParse({ ...evento, valor: 0 }).success).toBe(false);
    // Só o estorno é negativo; o médico exige o registro; a apuração aponta a apuração aprovada.
    expect(esquemaLancarEventoRepasse.safeParse({ ...evento, origem: 'ajuste' }).success).toBe(false);
    expect(esquemaLancarEventoRepasse.safeParse({ ...evento, profissional: null }).success).toBe(false);
    expect(
      esquemaLancarEventoRepasse.safeParse({ ...evento, origem: 'apuracao', valor: 10, estornaDe: null })
        .success,
    ).toBe(false);
    const rpa = {
      empresa: 1,
      competencia: '2026-10',
      prestador: 5,
      profissional: 9,
      lancamentos: [1],
      emissao: '2026-10-31',
      vencimento: '2026-11-10',
    };
    expect(esquemaEmitirRpa.safeParse(rpa).success).toBe(true);
    expect(esquemaEmitirRpa.safeParse({ ...rpa, lancamentos: [] }).success).toBe(false);
    expect(esquemaEmitirRpa.safeParse({ ...rpa, profissional: null }).success).toBe(false);
    expect(
      esquemaSimularRepasse.safeParse({
        data: '2026-10-10',
        convenio: 301,
        procedimento: 10101012,
        tipoConta: 'I',
        valorCobrado: 100,
      }).success,
    ).toBe(true);
  });

  it('vocabulário: seis tipos de prestador e o convênio como a dimensão mais geral', () => {
    expect(Object.keys(TIPOS_PRESTADOR_REPASSE)).toEqual(['E', 'F', 'M', 'P', 'V', 'I']);
    expect(DIMENSOES_REGRA[0]).toBe('profissional');
    expect(DIMENSOES_REGRA.at(-1)).toBe('convenio');
  });
});
