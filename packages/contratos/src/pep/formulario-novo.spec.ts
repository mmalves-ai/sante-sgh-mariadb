// Contrato do construtor de formulários novos (M45, etapa 1): forma da definição, limites das colunas do formulário
// de origem (CP1252) e entradas do ciclo de vida. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { eventoAuditavel } from '../auditoria/eventos.js';
import {
  esquemaCasoFormularioNovo,
  esquemaDefinicaoFormularioNovo,
  esquemaPublicarFormularioNovo,
  esquemaSalvarFormularioNovo,
  type PerguntaFormularioNovo,
} from './formulario-novo.js';

const pergunta = (p: Partial<PerguntaFormularioNovo> & Pick<PerguntaFormularioNovo, 'linkId'>) => ({
  tipo: 'texto' as const,
  titulo: 'Pergunta sintética',
  obrigatorio: false,
  unidade: null,
  minimo: null,
  maximo: null,
  opcoes: [],
  habilitar: null,
  calcular: null,
  reuso: null,
  itens: [],
  ...p,
});

const definicao = {
  codigo: 'SGHTESTE1',
  titulo: 'Formulário sintético de teste',
  tipoRegistro: 'evolucao' as const,
  especialidades: [],
  perguntas: [
    pergunta({
      linkId: 'secao_1',
      tipo: 'secao',
      titulo: 'Avaliação',
      itens: [
        pergunta({
          linkId: 'mobilidade',
          tipo: 'escolha',
          titulo: 'Mobilidade',
          opcoes: [
            { codigo: 'acamado', texto: 'Acamado', pontos: 1 },
            { codigo: 'deambula', texto: 'Deambula', pontos: 4 },
          ],
        }),
        pergunta({ linkId: 'total', tipo: 'inteiro', titulo: 'Total', calcular: { var: 'mobilidade' } }),
      ],
    }),
  ],
};

describe('definição do formulário novo', () => {
  it('aceita a definição sintética em árvore', () => {
    expect(esquemaDefinicaoFormularioNovo.parse(definicao).perguntas[0]?.itens).toHaveLength(2);
  });

  it('recusa código fora da forma do modelo (minúscula, longo demais)', () => {
    expect(esquemaDefinicaoFormularioNovo.safeParse({ ...definicao, codigo: 'teste' }).success).toBe(false);
    expect(esquemaDefinicaoFormularioNovo.safeParse({ ...definicao, codigo: 'ABCDEFGHIJK' }).success).toBe(
      false,
    );
  });

  it('recusa título acima de 100 caracteres e emoji (CP1252)', () => {
    expect(esquemaDefinicaoFormularioNovo.safeParse({ ...definicao, titulo: 'x'.repeat(101) }).success).toBe(
      false,
    );
    const r = esquemaDefinicaoFormularioNovo.safeParse({
      ...definicao,
      perguntas: [pergunta({ linkId: 'a', titulo: 'Dor 😀' })],
    });
    expect(r.success).toBe(false);
  });

  it('recusa tipo de pergunta fora do construtor (CID, grade, alergias)', () => {
    const r = esquemaDefinicaoFormularioNovo.safeParse({
      ...definicao,
      perguntas: [{ ...pergunta({ linkId: 'a' }), tipo: 'cid' }],
    });
    expect(r.success).toBe(false);
  });

  it('caso de teste e salvar', () => {
    const caso = esquemaCasoFormularioNovo.parse({
      nome: 'acamado',
      respostas: { mobilidade: 'acamado' },
      esperado: { total: 1 },
      habilitadasEsperadas: null,
    });
    expect(
      esquemaSalvarFormularioNovo.parse({
        id: null,
        baseadoEm: null,
        definicao,
        casos: [caso],
        versaoEsperada: null,
      }).casos,
    ).toHaveLength(1);
  });

  it('publicar exige o hash esperado em hexadecimal de 64', () => {
    expect(
      esquemaPublicarFormularioNovo.safeParse({
        id: 1,
        versaoEsperada: 'v1',
        contentHashEsperado: 'abc',
        senha: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('permissões e eventos do construtor', () => {
  const codigos = [
    'pep.formularioNovo.editar',
    'pep.formularioNovo.aprovar',
    'pep.formularioNovo.publicar',
    'pep.formularioNovo.aposentar',
  ];
  it('estão no catálogo declarado, no formato e com opção do legado', () => {
    for (const c of codigos) {
      const p = CATALOGO_DECLARADO.find((x) => x.codigo === c);
      expect(p, c).toBeDefined();
      expect(FORMATO_CODIGO_PERMISSAO.test(c)).toBe(true);
      expect(p?.opcoesLegado.length).toBeGreaterThan(0);
    }
    expect(CATALOGO_DECLARADO.find((x) => x.codigo === 'pep.formularioNovo.publicar')?.criticidade).toBe(
      'critica',
    );
  });
  it('eventos auditáveis do ciclo', () => {
    for (const e of [
      'pep.formularioNovo.salvo',
      'pep.formularioNovo.revisao',
      'pep.formularioNovo.publicado',
      'pep.formularioNovo.aposentado',
    ])
      expect(eventoAuditavel(e)?.legado ?? 'nulo').toBe('nulo');
  });
});
