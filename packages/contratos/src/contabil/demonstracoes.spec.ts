import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  esquemaApurarResultado,
  esquemaFiltroBalancete,
  esquemaFiltroDiario,
  esquemaFiltroDre,
  esquemaGerarSped,
  esquemaSituacaoSped,
  FORMAS_ECF_GERADAS,
  ROTAS_CONTABIL_F3,
} from './demonstracoes.js';
import { ROTAS_CONTABIL_F2, TIPOS_LANCAMENTO } from './lancamentos.js';
import { ROTAS_CONTABIL_F1 } from './rotas.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const contador = {
  nome: 'Contador Sintético',
  cpf: '00000000191',
  qualificacao: '900',
  crc: 'SP-000000/O-0',
};
const diretor = { nome: 'Diretor Sintético', cpf: '00000000272', qualificacao: '203' };

describe('entradas da contabilidade (etapa 3)', () => {
  it('balancete: até 12 meses, início antes do fim; nível e centro de custo opcionais', () => {
    expect(esquemaFiltroBalancete.parse({ empresa: 1, de: '2027-01', ate: '2027-12' })).toMatchObject({
      nivel: null,
      incluirZeradas: false,
      centroCusto: null,
    });
    expect(esquemaFiltroBalancete.safeParse({ empresa: 1, de: '2027-01', ate: '2028-01' }).success).toBe(
      false,
    );
    expect(esquemaFiltroBalancete.safeParse({ empresa: 1, de: '2027-05', ate: '2027-04' }).success).toBe(
      false,
    );
  });

  it('diário: datas, até 12 meses, página; DRE de um só exercício', () => {
    expect(esquemaFiltroDiario.parse({ empresa: 1, de: '2027-01-01', ate: '2027-01-31' }).pagina).toBe(1);
    expect(esquemaFiltroDiario.safeParse({ empresa: 1, de: '2027-01-01', ate: '2028-01-01' }).success).toBe(
      false,
    );
    expect(esquemaFiltroDre.safeParse({ empresa: 1, de: '2026-12', ate: '2027-01' }).success).toBe(false);
    expect(esquemaFiltroDre.safeParse({ empresa: 1, de: '2027-01', ate: '2027-06' }).success).toBe(true);
  });

  it('apuração: conta de destino', () => {
    const a = esquemaApurarResultado.parse({
      empresa: 1,
      exercicio: 2027,
      contaDestino: '2.3.1.01.0001',
    });
    expect(a.observacao).toBeNull();
    expect(esquemaApurarResultado.safeParse({ ...a, contaDestino: 'x' }).success).toBe(false);
  });

  it('SPED: contador com registro e outro signatário; substituta com o hash; ECF com a forma de tributação', () => {
    const base = { empresa: 1, tipo: 'ecd', exercicio: 2027, signatarios: [contador, diretor] };
    expect(esquemaGerarSped.parse(base)).toMatchObject({ numeroOrdem: 1, substituta: false });
    expect(esquemaGerarSped.safeParse({ ...base, signatarios: [diretor, diretor] }).success).toBe(false);
    expect(
      esquemaGerarSped.safeParse({ ...base, signatarios: [{ ...contador, crc: null }, diretor] }).success,
    ).toBe(false);
    expect(esquemaGerarSped.safeParse({ ...base, substituta: true }).success).toBe(false);
    expect(esquemaGerarSped.safeParse({ ...base, tipo: 'ecf' }).success).toBe(false);
    expect(esquemaGerarSped.safeParse({ ...base, tipo: 'ecf', formaTributacao: '9' }).success).toBe(false);
    expect(
      esquemaGerarSped.safeParse({ ...base, tipo: 'ecf', formaTributacao: '9', tipoEntidadeEcf: '05' })
        .success,
    ).toBe(true);
    expect(FORMAS_ECF_GERADAS).toEqual(['8', '9']);
  });

  it('situação do arquivo: recibo com a data; cancelamento com justificativa', () => {
    expect(
      esquemaSituacaoSped.safeParse({
        acao: 'recibo',
        empresa: 1,
        id: 3,
        recibo: 'AB.12.34.56.78.90',
        transmitidoEm: '2028-05-20',
      }).success,
    ).toBe(true);
    expect(
      esquemaSituacaoSped.safeParse({ acao: 'cancelar', empresa: 1, id: 3, motivo: 'curto' }).success,
    ).toBe(false);
  });
});

describe('rotas, permissões e eventos da etapa 3', () => {
  it('as permissões estão no catálogo com opção do outro sistema; gerar o SPED é sensível', () => {
    const codigos = new Set(Object.values(ROTAS_CONTABIL_F3).map((r) => r.permissao));
    expect([...codigos].sort()).toEqual([
      'contabil.demonstracao.ler',
      'contabil.periodo.encerrar',
      'contabil.sped.gerar',
      'contabil.sped.ler',
    ]);
    for (const c of codigos) {
      const p = CATALOGO_DECLARADO.find((x) => x.codigo === c);
      expect(p, c).toBeDefined();
      expect(FORMATO_CODIGO_PERMISSAO.test(c)).toBe(true);
      expect(opcoesDoMapa(p!.codigo).length).toBeGreaterThan(0);
    }
    expect(CATALOGO_DECLARADO.find((x) => x.codigo === 'contabil.sped.gerar')!.criticidade).toBe('sensivel');
  });

  it('nenhum caminho repete o das etapas 1 e 2; o tipo de lançamento da apuração existe', () => {
    const antes = new Set<string>(
      [...Object.values(ROTAS_CONTABIL_F1), ...Object.values(ROTAS_CONTABIL_F2)].map((r) => r.caminho),
    );
    const f3 = Object.values(ROTAS_CONTABIL_F3).map((r) => r.caminho);
    expect(f3.filter((c) => antes.has(c))).toEqual([]);
    expect(new Set(f3).size).toBe(f3.length);
    expect(TIPOS_LANCAMENTO.apuracao).toBe('Apuração do resultado');
  });

  it('os eventos auditáveis existem', () => {
    const codigos = new Set<string>(Object.values(EVENTOS_AUDITAVEIS).map((e) => e.codigo));
    for (const c of [
      'contabil.demonstracao.exportada',
      'contabil.resultado.apurado',
      'contabil.sped.gerado',
      'contabil.sped.baixado',
      'contabil.sped.situacao',
    ])
      expect(codigos.has(c), c).toBe(true);
  });
});
