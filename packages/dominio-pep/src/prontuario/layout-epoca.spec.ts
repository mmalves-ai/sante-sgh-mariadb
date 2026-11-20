// Regra 7 da ficha do M15: o registro abre com o layout que ele mesmo carrega (o formulário gravado com ele).
import { describe, expect, it } from 'vitest';
import { RTF_SINTETICO, xmlDocumento, xmlEvolucao } from './corpus.spec-util.js';
import {
  CAMPOS_DOCUMENTO_PESSOAL,
  dataDoDocumento,
  lerDocumentoEmitido,
  lerLayoutEpoca,
  textoDoValor,
} from './formulario.js';

const COMPONENTES = [
  { classe: 'TGroupBoxPep', nome: 'cmp1', titulo: 'ADMISSÃO', top: 0 },
  {
    classe: 'TfRespTexto',
    nome: 'cmp2',
    titulo: 'Queixa principal',
    valor: RTF_SINTETICO,
    top: 20,
    width: 740,
  },
  { classe: 'TfRespEdit', nome: 'cmp3', titulo: 'PA', valor: '120x80', top: 40, width: 160, auto: true },
  { classe: 'TfRespCheckListBox', nome: 'cmp4', titulo: 'Sintomas', itens: ['Febre', 'Tosse'], top: 60 },
  { classe: 'TfRespComboBox', nome: 'cmp5', titulo: 'Dor', valor: 'Sim', top: 80, width: 350 },
  { classe: 'TComponenteNovoX', nome: 'cmp6', titulo: 'Campo antigo', valor: 'valor', top: 100 },
  { classe: 'TfRespData', nome: 'cmp7', titulo: 'Data', valor: '', top: 120 },
];

describe('layout da época', () => {
  const l = lerLayoutEpoca(xmlEvolucao(COMPONENTES, 61));

  it('lê o modelo e os campos na ordem do próprio XML', () => {
    expect(l.modelo).toBe(61);
    expect(l.composicao).toBe('EVOLUCAO SINTETICA');
    expect(l.campos.map((c) => c.nome)).toEqual(['cmp1', 'cmp2', 'cmp3', 'cmp4', 'cmp5', 'cmp6', 'cmp7']);
  });

  it('seção, texto formatado, lista, colunas pela largura e autopreenchido', () => {
    const [sec, queixa, pa, sintomas, dor, antigo, data] = l.campos;
    expect(sec).toMatchObject({ secao: true, valor: { tipo: 'vazio' } });
    expect(queixa!.valor.tipo).toBe('formatado');
    expect(textoDoValor(queixa!.valor)).toContain('dor torácica');
    expect(pa).toMatchObject({ colunas: 3, autopreenchido: true, valor: { tipo: 'texto', texto: '120x80' } });
    expect(sintomas!.valor).toEqual({ tipo: 'lista', itens: ['Febre', 'Tosse'] });
    expect(dor!.colunas).toBe(6);
    // Classe que o leitor não conhece aparece (não some), marcada.
    expect(antigo).toMatchObject({ naoMapeado: true, valor: { tipo: 'texto', texto: 'valor' } });
    expect(data!.valor).toEqual({ tipo: 'vazio' });
  });

  it('o XML pode vir dentro de outro elemento', () => {
    const x = lerLayoutEpoca(`<raiz>${xmlEvolucao(COMPONENTES.slice(0, 2))}</raiz>`);
    expect(x.campos).toHaveLength(2);
  });
});

describe('documento como emitido', () => {
  it('cabeçalho congelado em blocos e os campos; sem os documentos pessoais sem a permissão', () => {
    const d = lerDocumentoEmitido(xmlDocumento(COMPONENTES.slice(1, 3)), { mostrarDocumentos: false });
    expect(d.blocos.map((b) => b.titulo)).toEqual([
      'Estabelecimento',
      'Paciente',
      'Atendimento',
      'Responsável',
      'Lançamento',
    ]);
    const paciente = d.blocos[1]!.campos;
    expect(paciente).toContainEqual({ rotulo: 'Nascimento', valor: '03/02/1980' });
    expect(paciente.some((c) => c.rotulo === 'CPF')).toBe(false);
    const atendimento = d.blocos[2]!.campos;
    expect(atendimento).toContainEqual({
      rotulo: 'Médico assistente',
      valor: 'DRA SINTETICA (CRM 12345 RJ)',
    });
    expect(atendimento).toContainEqual({ rotulo: 'Entrada', valor: '01/05/2024 08:30' });
    // Identificadores internos não aparecem.
    expect(JSON.stringify(d.blocos)).not.toContain('900001');
    expect(d.campos.map((c) => c.titulo)).toEqual(['Queixa principal', 'PA']);
    expect(CAMPOS_DOCUMENTO_PESSOAL.has('cpf')).toBe(true);
  });

  it('com a permissão, o CPF aparece', () => {
    const d = lerDocumentoEmitido(xmlDocumento([]), { mostrarDocumentos: true });
    expect(d.blocos[1]!.campos).toContainEqual({ rotulo: 'CPF', valor: '00000000191' });
    expect(d.campos).toEqual([]);
  });

  it('datas do documento: sentinela vira vazio', () => {
    expect(dataDoDocumento('1899-12-30 00:00:00')).toBe('');
    expect(dataDoDocumento('30/12/1899')).toBe('');
    expect(dataDoDocumento('2021-03-04')).toBe('04/03/2021');
    expect(dataDoDocumento('outra')).toBe('outra');
  });
});
