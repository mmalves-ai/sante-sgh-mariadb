// Montagem dos eventos do eSocial (M53-F5): pendências que impedem o evento, identificador, ciclo do evento e do lote,
// ambiente do lote (regra 3) e os detalhes do XML (os casos válidos estão em xsd.spec.ts, conferidos no XSD).
import { describe, expect, it } from 'vitest';
import { ambienteDoLote, conferirLote, decidirEnvio, podeTransitar, tpAmbDoAmbiente } from './ciclo.js';
import { idEventoEsocial, namespaceEvento, raizCnpj, xmlDoEvento } from './comum.js';
import {
  fapDecimal,
  montarS1000,
  montarS1010,
  pendenciasRubrica,
  TIPO_RUBRICA_ESOCIAL,
} from './eventos-tabela.js';
import {
  CATEGORIA_SUGERIDA,
  matriculaEsocial,
  montarS2200,
  montarS2205,
  montarS2206,
  montarS2230,
  montarS2299,
  montarS2300,
  montarS2399,
  montarS3000,
  pendenciasTrabalhador,
  verbasDaRescisao,
} from './eventos-trabalhador.js';
import { ctx, empregador, ficha, rubrica, trabalhador } from './fixtures-esocial.spec-util.js';
import { decimalDeCentavos, el, obrig, serializarNo, textoCampo } from './xml.js';

const codigos = (r: { ok: boolean; pendencias?: readonly { codigo: string }[] }) =>
  r.ok ? [] : r.pendencias!.map((p) => p.codigo);

describe('XML', () => {
  it('opcional vazio some; texto e atributo escapados; obrigatório vazio é erro', () => {
    expect(el('a', null)).toBeNull();
    expect(el('a', undefined)).toBeNull();
    expect(el('a', '')).toBeNull();
    expect(el('a', [null, false, undefined])).toBeNull();
    expect(serializarNo(obrig('a', [el('b', 'x<&>y'), el('c', 0)], { k: 'a"b' }))).toBe(
      '<a k="a&quot;b"><b>x&lt;&amp;&gt;y</b><c>0</c></a>',
    );
    expect(() => obrig('a', null)).toThrow(/a\./);
  });

  it('valores e textos do leiaute', () => {
    expect(decimalDeCentavos(512_345)).toBe('5123.45');
    expect(decimalDeCentavos(-5)).toBe('-0.05');
    expect(textoCampo('  a   b  ', 3)).toBe('a b');
    expect(textoCampo('   ', 3)).toBeNull();
    expect(textoCampo(null, 3)).toBeNull();
    expect(fapDecimal(10_000)).toBe('1.0000');
    expect(fapDecimal(5_123)).toBe('0.5123');
  });
});

describe('identificador do evento', () => {
  it('ID + 1 + raiz com zeros à direita + instante + sequência (36 posições)', () => {
    const id = idEventoEsocial(raizCnpj('11222333000181'), '2026-10-27T10:15:30', 7);
    expect(id).toBe('ID1112223330000002026102710153000007');
    expect(id).toHaveLength(36);
    expect(() => idEventoEsocial('11222333', '2026-10-27T10:15:30', 0)).toThrow(/Sequência/);
    expect(() => idEventoEsocial('11222333', '2026-10-27 10:15', 1)).toThrow(/Instante/);
    expect(namespaceEvento('evtDeslig', 'v_S_01_03_00')).toBe(
      'http://www.esocial.gov.br/schema/evt/evtDeslig/v_S_01_03_00',
    );
  });
});

describe('pendências que impedem o evento', () => {
  it('empresa sem CNPJ: nenhum evento', () => {
    const e = { ...empregador, cnpj: null };
    expect(codigos(montarS1000(ctx, e, 'inclusao', '2026-11'))).toEqual(['empregador-sem-cnpj']);
    expect(codigos(montarS2200(ctx, e, trabalhador, null))).toEqual(['empregador-sem-cnpj']);
    expect(codigos(montarS1000(ctx, { ...empregador, cnpj: '123' }, 'inclusao', '2026-11'))).toEqual([
      'empregador-sem-cnpj',
    ]);
  });

  it('rubrica sem natureza, tipo ou incidência; a exclusão não pede os dados', () => {
    const r = rubrica({ tipo: null, esocial: { inss: null, irrf: null, fgts: null, sindical: null } });
    expect(pendenciasRubrica(r, null).map((p) => p.codigo)).toEqual([
      'rubrica-sem-natureza',
      'rubrica-sem-tipo',
      'rubrica-sem-incidencia-inss',
      'rubrica-sem-incidencia-irrf',
      'rubrica-sem-incidencia-fgts',
    ]);
    expect(codigos(montarS1010(ctx, empregador, 'inclusao', '2026-11', r, '12'))).toContain(
      'rubrica-sem-natureza',
    );
    expect(montarS1010(ctx, empregador, 'exclusao', '2026-11', r, null).ok).toBe(true);
    expect(TIPO_RUBRICA_ESOCIAL.informativaDedutora).toBe(4);
  });

  it('ficha, CPF e nome são exigidos em todo evento do trabalhador', () => {
    const t = { ...trabalhador, ficha: null, cpf: null, nome: ' ' };
    expect(pendenciasTrabalhador(t).map((p) => p.codigo)).toEqual([
      'ficha-ausente',
      'cpf-ausente',
      'nome-ausente',
    ]);
    expect(codigos(montarS2205(ctx, empregador, t, '2026-10-20', null))).toEqual([
      'ficha-ausente',
      'cpf-ausente',
      'nome-ausente',
    ]);
  });

  it('S-2200: categoria sem vínculo, CBO, cargo, salário e sindicato', () => {
    const t = {
      ...trabalhador,
      cargo: null,
      salario: null,
      ficha: { ...ficha, categoria: '901', cboCargo: null, cnpjSindicato: null },
    };
    expect(codigos(montarS2200(ctx, { ...empregador, cnpjSindicato: null }, t, null))).toEqual([
      'categoria-sem-vinculo',
      'cbo-ausente',
      'cargo-ausente',
      'salario-ausente',
      'sindicato-ausente',
    ]);
    // O S-2206 não exige o sindicato e recusa data anterior à admissão.
    expect(
      codigos(montarS2206(ctx, { ...empregador, cnpjSindicato: null }, trabalhador, '2026-09-01', null)),
    ).toEqual(['data-antes-admissao']);
  });

  it('S-2230: motivo sem código do eSocial nos parâmetros', () => {
    expect(
      codigos(
        montarS2230(
          ctx,
          empregador,
          trabalhador,
          { id: 1, motivo: 99, inicio: '2026-10-10', fim: null },
          null,
        ),
      ),
    ).toEqual(['motivo-sem-codigo']);
  });

  it('S-2299 e S-2399: categoria trocada; S-2399 sem término; S-2300 de empregado', () => {
    const tsv = { ...trabalhador, ficha: { ...ficha, categoria: '901' } };
    const resc = {
      id: 1,
      desligamento: '2026-10-20',
      modalidade: 'justa-causa' as const,
      diasIndenizados: 0,
      projecao: '2026-10-20',
      linhas: [],
    };
    expect(codigos(montarS2299(ctx, empregador, tsv, resc, null))).toEqual(['categoria-sem-vinculo']);
    expect(codigos(montarS2399(ctx, empregador, trabalhador, null, null))).toEqual([
      'termino-ausente',
      'categoria-empregado',
    ]);
    expect(codigos(montarS2300(ctx, empregador, trabalhador, null))).toEqual(['categoria-empregado']);
    const muitas = Array.from({ length: 201 }, (_, i) => ({
      papel: 'saldoSalario',
      tipo: 'provento',
      rubrica: i + 1,
      codigoRubrica: i + 1,
      quantidade: 1,
      unidade: 'valor',
      valor: 100,
      memoria: '',
    })) as never;
    expect(codigos(montarS2299(ctx, empregador, trabalhador, { ...resc, linhas: muitas }, null))).toEqual([
      'verbas-demais',
    ]);
  });

  it('S-3000: só evento aceito do trabalhador, com CPF; tabela não', () => {
    expect(
      codigos(
        montarS3000(
          ctx,
          empregador,
          { evento: 'S-1010', recibo: null, cpf: null, dataReferencia: '2026-11' },
          '2026-10-27',
        ),
      ),
    ).toEqual(['evento-sem-recibo', 'evento-de-tabela']);
    expect(
      codigos(
        montarS3000(
          ctx,
          empregador,
          { evento: 'S-2230', recibo: '1.2.0000000000000000001', cpf: null, dataReferencia: '2026-10-01' },
          '2026-10-27',
        ),
      ),
    ).toEqual(['cpf-ausente']);
  });
});

describe('detalhes do XML do trabalhador', () => {
  it('matrícula do eSocial: a do vínculo ou V + ID; categoria sugerida pelo tipo', () => {
    expect(matriculaEsocial({ matricula: ' 77 ', vinculo: 5 })).toBe('77');
    expect(matriculaEsocial({ matricula: null, vinculo: 5 })).toBe('V5');
    expect(CATEGORIA_SUGERIDA.clt).toBe('101');
    expect(CATEGORIA_SUGERIDA.pj).toBeNull();
  });

  it('S-2200 com contrato a prazo leva o término; retificação leva o recibo', () => {
    const t = {
      ...trabalhador,
      matricula: null,
      funcao: 'Coordenação',
      ficha: { ...ficha, tipoContrato: 2, terminoContrato: '2027-01-29', cboFuncao: '223505' },
    };
    const r = montarS2200(ctx, empregador, t, '1.2.0000000000000000009');
    if (!r.ok) throw new Error('montagem');
    const xml = xmlDoEvento(r.raiz);
    expect(xml).toContain('<duracao><tpContr>2</tpContr><dtTerm>2027-01-29</dtTerm></duracao>');
    expect(xml).toContain('<indRetif>2</indRetif><nrRecibo>1.2.0000000000000000009</nrRecibo>');
    expect(xml).toContain('<matricula>V501</matricula>');
    expect(xml).toContain('<nmFuncao>Coordenação</nmFuncao><CBOFuncao>223505</CBOFuncao>');
    expect(xml).toContain('<cnpjSindCategProf>33444555000106</cnpjSindCategProf>');
    expect(r.dataReferencia).toBe('2026-10-01');
  });

  it('verbas da rescisão: só proventos e descontos com rubrica e valor, somados por rubrica', () => {
    const l = (codigoRubrica: number | null, tipo: string, valor: number) =>
      ({
        papel: 'x',
        tipo,
        rubrica: 1,
        codigoRubrica,
        quantidade: 0,
        unidade: 'valor',
        valor,
        memoria: '',
      }) as never;
    expect(
      verbasDaRescisao([
        l(10, 'provento', 100),
        l(10, 'provento', 50),
        l(2, 'desconto', 7),
        l(null, 'provento', 9),
        l(3, 'base', 9),
        l(4, 'provento', 0),
      ]),
    ).toEqual([
      { codigo: '2', valor: 7 },
      { codigo: '10', valor: 150 },
    ]);
  });
});

describe('ciclo do evento e do lote', () => {
  it('transições válidas', () => {
    expect(podeTransitar('gerado', 'validado')).toBe(true);
    expect(podeTransitar('validado', 'em-lote')).toBe(true);
    expect(podeTransitar('enviado', 'aceito')).toBe(true);
    expect(podeTransitar('aceito', 'excluido')).toBe(true);
    expect(podeTransitar('aceito', 'descartado')).toBe(false);
    expect(podeTransitar('excluido', 'aceito')).toBe(false);
  });

  it('lote: de 1 a 50 validados do mesmo empregador e grupo', () => {
    const ev = (
      id: number,
      evento: 'S-2200' | 'S-1010',
      situacao: 'validado' | 'gerado' = 'validado',
      empresa = 1,
    ) => ({ id, empresa, evento, situacao });
    expect(conferirLote(1, [ev(1, 'S-2200'), ev(2, 'S-2200')])).toEqual({ ok: true, grupo: 'nao-periodico' });
    expect(conferirLote(1, [])).toMatchObject({ ok: false, codigo: 'lote-vazio' });
    expect(
      conferirLote(
        1,
        Array.from({ length: 51 }, (_, i) => ev(i + 1, 'S-1010')),
      ),
    ).toMatchObject({ codigo: 'lote-vazio' });
    expect(conferirLote(1, [ev(1, 'S-2200', 'gerado')])).toEqual({
      ok: false,
      codigo: 'situacao-invalida',
      ids: [1],
    });
    expect(conferirLote(1, [ev(1, 'S-2200'), ev(2, 'S-1010')])).toMatchObject({
      ok: false,
      codigo: 'lote-misto',
    });
    expect(conferirLote(1, [ev(1, 'S-2200', 'validado', 2)])).toEqual({
      ok: false,
      codigo: 'lote-misto',
      ids: [1],
    });
  });

  it('regra 3: fora de produção o lote vai ao coletor, sem depender da chave; em produção, chave e serviço', () => {
    expect(ambienteDoLote('homolog')).toBe('coletor');
    expect(ambienteDoLote('producao')).toBe('producao');
    expect(tpAmbDoAmbiente('coletor')).toBe(2);
    expect(tpAmbDoAmbiente('producao')).toBe(1);
    expect(decidirEnvio('dev', false, false)).toEqual({ ok: true, ambiente: 'coletor' });
    expect(decidirEnvio('producao', false, true)).toMatchObject({ ok: false, codigo: 'envio-desligado' });
    expect(decidirEnvio('producao', true, false)).toMatchObject({
      ok: false,
      codigo: 'transmissor-real-indisponivel',
    });
    expect(decidirEnvio('producao', true, true)).toEqual({ ok: true, ambiente: 'producao' });
  });
});
