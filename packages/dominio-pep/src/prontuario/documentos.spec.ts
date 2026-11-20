// D-DOC-1 (revisão do M15): sem a permissão de ver documentos, CPF, cartão de saúde e identidade não aparecem
// inteiros no formulário da época, no documento emitido nem nas respostas. Só dados SINTÉTICOS (CPF 000.000.001-91).
import type { ItemResposta } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { xmlDocumento, xmlEvolucao } from './corpus.spec-util.js';
import {
  mascararDocumento,
  ocultarDocumentosDasRespostas,
  ocultarDocumentosDosCampos,
  pareceDocumentoPessoal,
} from './documentos.js';
import { lerDocumentoEmitido, lerLayoutEpoca } from './formulario.js';
import { rtfParaTexto } from './rtf.js';

const COMPONENTES = [
  { classe: 'TfRespEdit', nome: 'cmp1', titulo: 'CPF do responsável', valor: '00000000191', top: 0 },
  { classe: 'TfRespEdit', nome: 'cmp2', titulo: 'Cartão SUS', valor: '898 0000 0000 0007', top: 20 },
  { classe: 'TfRespEdit', nome: 'cmp3', titulo: 'PA', valor: '120x80', top: 40 },
  {
    classe: 'TfRespCheckListBox',
    nome: 'cmp4',
    titulo: 'Documentos conferidos',
    itens: ['000.000.001-91', 'Carteirinha'],
    top: 60,
  },
];

const textoDe = (v: { tipo: string; texto?: unknown; itens?: readonly string[] }) =>
  v.tipo === 'texto' ? v.texto : v.tipo === 'lista' ? v.itens : null;

describe('documentos pessoais no registro', () => {
  it('máscara do cadastro: CPF com os 5 últimos dígitos; os outros, os 4 últimos', () => {
    expect(mascararDocumento('000.000.001-91')).toBe('***.***.001-91');
    expect(mascararDocumento('898000000000007')).toBe('***********0007');
    expect(mascararDocumento('12')).toBe('****');
    expect(mascararDocumento('sem número')).toBe('sem número');
  });

  it('reconhece o campo de documento pelo título ou pelo nome', () => {
    expect(pareceDocumentoPessoal('CPF')).toBe(true);
    expect(pareceDocumentoPessoal(null, 'numero_cns')).toBe(true);
    expect(pareceDocumentoPessoal('Cartão Nacional de Saúde')).toBe(true);
    expect(pareceDocumentoPessoal('RG do acompanhante')).toBe(true);
    expect(pareceDocumentoPessoal('Pressão arterial', 'cmp9')).toBe(false);
  });

  it('formulário da época: mascarado sem a permissão, inteiro com ela (e por padrão, na conferência)', () => {
    const sem = lerLayoutEpoca(xmlEvolucao(COMPONENTES, 61), { mostrarDocumentos: false });
    expect(sem.campos.map((c) => textoDe(c.valor))).toEqual([
      '***.***.001-91',
      '***********0007',
      '120x80',
      ['***.***.001-91', 'Carteirinha'],
    ]);
    const com = lerLayoutEpoca(xmlEvolucao(COMPONENTES, 61), { mostrarDocumentos: true });
    expect(textoDe(com.campos[0]!.valor)).toBe('00000000191');
    expect(textoDe(lerLayoutEpoca(xmlEvolucao(COMPONENTES, 61)).campos[0]!.valor)).toBe('00000000191');
  });

  it('documento emitido: os campos do formulário também saem mascarados', () => {
    const d = lerDocumentoEmitido(xmlDocumento(COMPONENTES), { mostrarDocumentos: false });
    expect(JSON.stringify(d)).not.toContain('00000000191');
    expect(JSON.stringify(d)).not.toContain('000.000.001-91');
  });

  it('texto formatado dentro do campo: o CPF formatado é mascarado, o resto fica', () => {
    const t = rtfParaTexto('{\\rtf1\\ansi Responsável 000.000.001-91, filho\\par}');
    const [c] = ocultarDocumentosDosCampos([
      {
        nome: 'cmp',
        classe: 'TfRespTexto',
        titulo: 'Observação',
        secao: false,
        valor: { tipo: 'formatado', texto: t },
        topo: 0,
        esquerda: 0,
        colunas: 12,
        autopreenchido: false,
        naoMapeado: false,
      },
    ]);
    expect(JSON.stringify(c)).toContain('***.***.001-91');
    expect(JSON.stringify(c)).toContain('filho');
    expect(ocultarDocumentosDosCampos([{ ...c!, valor: { tipo: 'vazio' } }])[0]!.valor).toEqual({
      tipo: 'vazio',
    });
  });

  it('respostas: a pergunta do tipo CPF, as que se declaram documento e a grade, em toda a árvore', () => {
    const no = (p: Partial<ItemResposta>): ItemResposta => ({
      ordem: '01',
      titulo: 'Título',
      tipo: 'Texto',
      valores: [],
      grade: null,
      autopreenchido: false,
      aConfirmar: null,
      itens: [],
      ...p,
    });
    const r = ocultarDocumentosDasRespostas([
      no({
        titulo: 'IDENTIFICAÇÃO',
        tipo: 'Título',
        itens: [
          no({ tipo: 'CPF', titulo: 'Documento', valores: ['00000000191'] }),
          no({ titulo: 'Identidade', valores: ['1234567'] }),
          no({ titulo: 'Queixa', valores: ['Dor; CPF 000.000.001-91 conferido'] }),
          no({
            tipo: 'Grade',
            titulo: 'Acompanhantes',
            grade: { colunas: ['Nome', 'Documento'], linhas: [['SINTETICO', '000.000.001-91']] },
          }),
        ],
      }),
    ]);
    const filhos = r[0]!.itens;
    expect(filhos.map((x) => x.valores[0] ?? null)).toEqual([
      '***.***.001-91',
      '***4567',
      'Dor; CPF ***.***.001-91 conferido',
      null,
    ]);
    expect(filhos[3]!.grade!.linhas).toEqual([['SINTETICO', '***.***.001-91']]);
  });
});
