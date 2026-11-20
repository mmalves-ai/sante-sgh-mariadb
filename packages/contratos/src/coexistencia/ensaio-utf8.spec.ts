import { describe, expect, it } from 'vitest';
import {
  caminhoRelatorioEnsaioUtf8,
  CLASSES_CONVERSAO,
  esquemaIndiceEstourado,
  esquemaRelatorioEnsaioUtf8,
  ETAPAS_ENSAIO_UTF8,
} from './ensaio-utf8.js';

const b = { situacao: 'nao-executada', bloqueio: null, observacao: null } as const;
const vazio = () => ({
  formato: 1,
  estabelecimento: 'pc',
  em: '2026-10-27',
  origem: { versaoMotor: '5.0.3', charset: 'NONE' },
  alvo: { versaoMotor: '5.0.3', charset: 'UTF8' },
  etapas: {
    base: { ...b, impressao: null, integridadeOk: null },
    inventario: { ...b, tabelas: 0, cp1252: 0, utf8Catalogada: 0, bytes: 0, catalogadas: [] },
    indices: { ...b, tamanhoPagina: 8192, limiteChave: 2039, comTexto: 0, estouram: [], paginaAlvo: null },
    literais: { ...b, gatilhos: 0, procedures: 0, soComentario: 0, emLiteral: 0, aRever: [], idaEVoltaOk: 0 },
    conversao: {
      ...b,
      metodo: 'bombeamento',
      segundos: null,
      tabelas: 0,
      linhas: 0,
      valoresByteIndefinido: 0,
      valoresMistos: 0,
      tabelasRejeitadas: [],
    },
    equivalencia: {
      ...b,
      segundos: null,
      tabelas: 0,
      tabelasIguais: 0,
      colunas: 0,
      colunasIguais: 0,
      diferentes: [],
      tabelasDiferentes: [],
      naoVerificadas: [],
      hashAntes: null,
      hashDepois: null,
    },
    'utf8-catalogadas': { ...b, colunas: 0, idaEVoltaOk: 0, valoresInvalidos: 0 },
    rtf: { ...b, colunas: 0, bytesIguais: 0, amostra: 0, abrem: 0 },
    objetos: { ...b, gatilhos: 0, procedures: 0, invalidos: [], invalidosNaOrigem: [] },
    codec: { ...b, corpusBytes: 0, idaEVoltaOk: null, charsetConfere: null },
    schema: { ...b, impressaoBase: null, impressaoEnsaio: null, diferencas: [] },
    assinaturas: { ...b, operacoes: 0, cenarios: 0, diferencas: 0, relatorio: null },
    carga: { ...b, slosAtendidos: null },
    'sante-api': { ...b, contratosQuebrados: null, referencia: null },
    parceiros: { ...b, alvos: [] },
    'volta-atras': { ...b, segundos: null, integridadeOk: null },
  },
});

describe('ensaio do UTF-8 (M58-F3): vocabulário e relatório', () => {
  it('as 16 etapas, começando pela base em Firebird 5 e terminando na volta atrás', () => {
    expect(new Set(ETAPAS_ENSAIO_UTF8).size).toBe(16);
    expect(ETAPAS_ENSAIO_UTF8[0]).toBe('base');
    expect(ETAPAS_ENSAIO_UTF8.at(-1)).toBe('volta-atras');
    expect(CLASSES_CONVERSAO).toEqual(['cp1252', 'utf8-catalogada', 'bytes']);
    expect(caminhoRelatorioEnsaioUtf8('pc')).toBe('docs/marcos/M58/pc/utf8.json');
  });

  it('o relatório vazio vale; etapa bloqueada exige o motivo, e só ela', () => {
    expect(esquemaRelatorioEnsaioUtf8.safeParse(vazio()).success).toBe(true);
    const r = vazio();
    (r.etapas['sante-api'] as { situacao: string }).situacao = 'bloqueada';
    expect(esquemaRelatorioEnsaioUtf8.safeParse(r).success).toBe(false);
    (r.etapas['sante-api'] as { bloqueio: string | null }).bloqueio = 'equipe-hal-ai';
    expect(esquemaRelatorioEnsaioUtf8.safeParse(r).success).toBe(true);
  });

  it('nomes só de estrutura: coluna é TABELA.COLUNA, texto sem dado pessoal', () => {
    const r = vazio();
    r.etapas.equivalencia.diferentes = ['PACIENTE.NOME' as never];
    expect(esquemaRelatorioEnsaioUtf8.safeParse(r).success).toBe(true);
    r.etapas.equivalencia.diferentes = ['Maria da Silva' as never];
    expect(esquemaRelatorioEnsaioUtf8.safeParse(r).success).toBe(false);
    const s = vazio();
    (s.etapas.base as { observacao: string | null }).observacao = 'contato fulano@exemplo.com';
    expect(esquemaRelatorioEnsaioUtf8.safeParse(s).success).toBe(false);
  });

  it('índice estourado: página mínima só entre as do motor, ou nenhuma', () => {
    const i = { nome: 'IX_A', tabela: 'T', chaveBytes: 4000, paginaMinima: 16384 };
    expect(esquemaIndiceEstourado.safeParse(i).success).toBe(true);
    expect(esquemaIndiceEstourado.safeParse({ ...i, paginaMinima: null }).success).toBe(true);
    expect(esquemaIndiceEstourado.safeParse({ ...i, paginaMinima: 4096 }).success).toBe(false);
  });
});
