// Contrato do eSocial (M53-F5): catálogo dos eventos, parâmetros do empregador, ficha do vínculo e retorno do lote.
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_EVENTOS_ESOCIAL,
  definicaoEventoEsocial,
  esquemaEmpregadorEsocial,
  esquemaFichaEsocialVinculo,
  esquemaGerarEventoTrabalhador,
  esquemaRetornoLoteEsocial,
  EVENTOS_ESOCIAL,
} from './folha-esocial.js';

const ficha = {
  sexo: 'M',
  racaCor: 1,
  estadoCivil: null,
  grauInstrucao: '07',
  nomeSocial: null,
  nascimento: '1985-01-02',
  paisNascimento: '105',
  paisNacionalidade: '105',
  endereco: {
    tipoLogradouro: null,
    logradouro: 'Rua A',
    numero: 'S/N',
    complemento: null,
    bairro: null,
    cep: '30110000',
    municipio: '3106200',
    uf: 'MG',
  },
  categoria: '101',
  cboCargo: '322205',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: '12x36',
  tipoAdmissao: 1,
  indicativoAdmissao: 1,
  cnpjSindicato: null,
  estagio: null,
};

describe('contrato do eSocial (M53-F5)', () => {
  it('catálogo: um item por evento, com grupo e raiz do XML', () => {
    expect(CATALOGO_EVENTOS_ESOCIAL.map((e) => e.codigo)).toEqual([...EVENTOS_ESOCIAL]);
    expect(definicaoEventoEsocial('S-2299')).toMatchObject({ grupo: 'nao-periodico', raiz: 'evtDeslig' });
    expect(definicaoEventoEsocial('S-1010').grupo).toBe('tabela');
  });

  it('ficha: contrato a prazo exige término; estagiário exige o estágio; jornada só nos códigos do leiaute', () => {
    expect(esquemaFichaEsocialVinculo.safeParse(ficha).success).toBe(true);
    const prazo = esquemaFichaEsocialVinculo.safeParse({ ...ficha, tipoContrato: 2 });
    expect(prazo.success ? [] : prazo.error.issues.map((i) => i.path.join('.'))).toEqual(['terminoContrato']);
    const est = esquemaFichaEsocialVinculo.safeParse({ ...ficha, categoria: '901' });
    expect(est.success ? [] : est.error.issues.map((i) => i.path.join('.'))).toEqual(['estagio']);
    expect(esquemaFichaEsocialVinculo.safeParse({ ...ficha, tipoJornada: 8 }).success).toBe(false);
    expect(esquemaFichaEsocialVinculo.safeParse({ ...ficha, extra: 1 }).success).toBe(false);
  });

  it('empregador: FAP entre 0,5 e 2,0; CNPJ do sindicato de 14 posições', () => {
    const e = {
      empresa: 1,
      inicio: '2026-11',
      transmissor: 'sante',
      leiaute: 'v_S_01_03_00',
      classTrib: '99',
      indCoop: null,
      indConstr: null,
      indDesFolha: 0,
      indOptRegEletron: 0,
      cnaePrep: '8610101',
      aliqRat: 2,
      fap: 10_000,
      codLotacao: 'L1',
      fpas: '515',
      codTercs: '0115',
      ideTabRubr: 'SGH',
      cnpjSindicato: null,
      motivosAfastamento: { '3': '01' },
    };
    expect(esquemaEmpregadorEsocial.safeParse(e).success).toBe(true);
    expect(esquemaEmpregadorEsocial.safeParse({ ...e, fap: 4_999 }).success).toBe(false);
    expect(esquemaEmpregadorEsocial.safeParse({ ...e, cnpjSindicato: '123' }).success).toBe(false);
  });

  it('gerar evento do trabalhador: referência, data e retificação nulas por padrão', () => {
    expect(
      esquemaGerarEventoTrabalhador.parse({ evento: 'S-2200', empresa: 1, vinculo: '5', gravar: false }),
    ).toEqual({
      evento: 'S-2200',
      empresa: 1,
      vinculo: 5,
      referencia: null,
      data: null,
      retificar: null,
      gravar: false,
    });
  });

  it('retorno: aceito exige recibo no formato do eSocial', () => {
    const base = { versao: 0, protocolo: null };
    const ev = {
      evento: 1,
      aceito: true,
      recibo: '1.2.0000000000000000001',
      codigo: '201',
      descricao: 'Sucesso',
    };
    expect(esquemaRetornoLoteEsocial.safeParse({ ...base, eventos: [ev] }).success).toBe(true);
    expect(esquemaRetornoLoteEsocial.safeParse({ ...base, eventos: [{ ...ev, recibo: null }] }).success).toBe(
      false,
    );
    expect(
      esquemaRetornoLoteEsocial.safeParse({ ...base, eventos: [{ ...ev, recibo: '123' }] }).success,
    ).toBe(false);
    expect(
      esquemaRetornoLoteEsocial.safeParse({
        ...base,
        eventos: [{ ...ev, aceito: false, recibo: null, codigo: '401' }],
      }).success,
    ).toBe(true);
  });
});
