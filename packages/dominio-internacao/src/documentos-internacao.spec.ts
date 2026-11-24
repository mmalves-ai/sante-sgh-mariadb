import { describe, expect, it } from 'vitest';
import {
  documentosDaInternacao,
  marcadoresDesconhecidos,
  type ModeloDocumentoInternacao,
  modeloServe,
  modelosSobDemanda,
  momentoPadraoDaRegra,
  obrigatoriosPendentes,
  preencherMarcadores,
  type RegraDocumentoInternacao,
  validarModeloDocumento,
  validarRegraDocumento,
} from './documentos-internacao.js';

const modelo = (id: number, extra: Partial<ModeloDocumentoInternacao> = {}): ModeloDocumentoInternacao => ({
  id,
  titulo: `Modelo ${id}`,
  ativo: true,
  especialidade: null,
  idadeMinima: null,
  idadeMaxima: null,
  ...extra,
});
const regra = (
  id: number,
  m: number,
  extra: Partial<RegraDocumentoInternacao> = {},
): RegraDocumentoInternacao => ({
  id,
  modelo: m,
  momento: 'admissao',
  convenio: null,
  especialidade: null,
  modalidade: null,
  obrigatorio: false,
  selecionadoPorPadrao: true,
  copias: 1,
  ordem: 0,
  ativo: true,
  ...extra,
});
const internacao = { convenio: 10, especialidade: 20, modalidade: 30, idade: 40 };

describe('documentos da internação pela regra de convênio, especialidade e modalidade', () => {
  it('a regra geral vale para todos; a do outro convênio não sai', () => {
    const r = documentosDaInternacao(
      'admissao',
      internacao,
      [modelo(1), modelo(2)],
      [regra(1, 1), regra(2, 2, { convenio: 11 })],
    );
    expect(r.map((d) => d.modelo)).toEqual([1]);
  });

  it('a regra mais específica vence (cópias e obrigatoriedade dela), uma linha por modelo', () => {
    const r = documentosDaInternacao(
      'admissao',
      internacao,
      [modelo(1)],
      [
        regra(1, 1, { copias: 1 }),
        regra(2, 1, { convenio: 10, copias: 2 }),
        regra(3, 1, {
          convenio: 10,
          especialidade: 20,
          copias: 3,
          obrigatorio: true,
          selecionadoPorPadrao: false,
        }),
        regra(4, 1, { especialidade: 20, modalidade: 30, copias: 4 }),
      ],
    );
    expect(r).toEqual([
      { modelo: 1, titulo: 'Modelo 1', regra: 3, copias: 3, obrigatorio: true, selecionado: true },
    ]);
  });

  it('filtra pelo momento, pela regra inativa e pelo modelo inativo', () => {
    const modelos = [modelo(1), modelo(2, { ativo: false }), modelo(3)];
    const regras = [regra(1, 1, { momento: 'alta' }), regra(2, 2), regra(3, 3, { ativo: false })];
    expect(documentosDaInternacao('admissao', internacao, modelos, regras)).toEqual([]);
    expect(documentosDaInternacao('alta', internacao, modelos, regras).map((d) => d.modelo)).toEqual([1]);
  });

  it('o modelo filtra pela especialidade e pela faixa de idade; idade desconhecida não presume', () => {
    expect(modeloServe(modelo(1, { especialidade: 21 }), internacao)).toBe(false);
    expect(modeloServe(modelo(1, { idadeMaxima: 17 }), internacao)).toBe(false);
    expect(modeloServe(modelo(1, { idadeMinima: 18, idadeMaxima: 59 }), internacao)).toBe(true);
    expect(modeloServe(modelo(1, { idadeMinima: 60 }), { ...internacao, idade: 60 })).toBe(true);
    expect(modeloServe(modelo(1, { idadeMaxima: 12 }), { ...internacao, idade: null })).toBe(false);
    expect(modeloServe(modelo(1), { ...internacao, idade: null })).toBe(true);
  });

  it('ordena pela ordem da regra e, no empate, pelo título', () => {
    const r = documentosDaInternacao(
      'admissao',
      internacao,
      [modelo(1, { titulo: 'Termo' }), modelo(2, { titulo: 'Autorização' }), modelo(3, { titulo: 'Guia' })],
      [regra(1, 1, { ordem: 1 }), regra(2, 2, { ordem: 1 }), regra(3, 3, { ordem: 0 })],
    );
    expect(r.map((d) => d.titulo)).toEqual(['Guia', 'Autorização', 'Termo']);
  });

  it('valida o modelo e a regra na hora', () => {
    expect(
      validarModeloDocumento({
        codigo: '',
        titulo: ' ',
        conteudo: null,
        idadeMinima: 18,
        idadeMaxima: 10,
        copias: 0,
      }).map((p) => p.campo),
    ).toEqual(['codigo', 'titulo', 'conteudo', 'idadeMaxima', 'copias']);
    expect(
      validarModeloDocumento({
        codigo: 'T1',
        titulo: 'Termo',
        conteudo: 'x',
        idadeMinima: null,
        idadeMaxima: null,
        copias: 1,
      }),
    ).toEqual([]);
    expect(validarRegraDocumento({ momento: 'saida', copias: 21 }).map((p) => p.campo)).toEqual([
      'momento',
      'copias',
    ]);
    expect(validarRegraDocumento({ momento: 'alta', copias: 2 })).toEqual([]);
  });
});

describe('sob demanda, momento padrão, obrigatórios e marcadores', () => {
  const int = { convenio: 1, especialidade: 2, modalidade: 3, idade: 40 };
  it('oferece o modelo sob demanda que serve e que nenhuma regra mandou, desmarcado e com as cópias do modelo', () => {
    const modelos = [
      modelo(1, { momento: 'sob_demanda', copias: 2, titulo: 'B' }),
      modelo(2, { momento: 'sob_demanda', titulo: 'A', especialidade: 9 }),
      modelo(3, { momento: 'sob_demanda', titulo: 'C' }),
      modelo(4, { momento: 'admissao', titulo: 'D' }),
    ];
    const ja = documentosDaInternacao('admissao', int, modelos, [regra(10, 3)]);
    expect(modelosSobDemanda(int, modelos, ja)).toEqual([
      {
        modelo: 1,
        titulo: 'B',
        regra: 0,
        copias: 2,
        obrigatorio: false,
        selecionado: false,
        sobDemanda: true,
      },
    ]);
  });
  it('o momento do modelo vira o padrão da regra; sob demanda cai na admissão', () => {
    expect(momentoPadraoDaRegra('alta')).toBe('alta');
    expect(momentoPadraoDaRegra('sob_demanda')).toBe('admissao');
    expect(momentoPadraoDaRegra(null)).toBe('admissao');
  });
  it('lista o obrigatório ainda não emitido', () => {
    const docs = documentosDaInternacao(
      'admissao',
      int,
      [modelo(1), modelo(2)],
      [regra(1, 1, { obrigatorio: true }), regra(2, 2)],
    );
    expect(obrigatoriosPendentes(docs, new Set()).map((d) => d.modelo)).toEqual([1]);
    expect(obrigatoriosPendentes(docs, new Set([1]))).toEqual([]);
  });
  it('recusa marcador fora da lista e preenche os conhecidos (ausente: não informado)', () => {
    expect(marcadoresDesconhecidos('Eu, {paciente}, {cpf} e {cpf}')).toEqual(['cpf']);
    expect(
      validarModeloDocumento({
        codigo: 'T',
        titulo: 'T',
        conteudo: '{senha}',
        idadeMinima: null,
        idadeMaxima: null,
        copias: 1,
      }).map((p) => p.campo),
    ).toEqual(['conteudo']);
    expect(
      preencherMarcadores('{paciente} no leito {leito}, {medico}. {outro}', {
        paciente: 'P',
        leito: 'B1-Q1-01',
      }),
    ).toBe('P no leito B1-Q1-01, não informado. {outro}');
  });
});
