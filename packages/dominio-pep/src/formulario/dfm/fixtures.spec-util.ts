// Componentes DFM sintéticos (formato do Delphi, rótulos fictícios) para os testes do parser.
// Nenhum conteúdo vem do banco: as formas reproduzem as 13 classes descritas na ref 04 §3.
import type { ComponenteLegado, EntradaModelo } from './mapeamento.js';

export function grupo(nome: string, ordem: string, caption: string, largura = 744): string {
  return [
    `inherited ${nome}: TGroupBoxPep`,
    '  Left = 4',
    '  Top = 0',
    `  Width = ${largura}`,
    '  Height = 300',
    `  Caption = '${caption}'`,
    `  Description = '${caption}'`,
    `  Ordem = '${ordem}'`,
    '  CampoObrigatorio = False',
    "  Fonte = 'name=Arial'#13#10'size=8'#13#10",
    'end',
  ].join('\r\n');
}

export function combo(
  nome: string,
  ordem: string,
  descricao: string,
  rotulos: readonly string[],
  ids: readonly string[] | null,
  extra: readonly string[] = [],
): string {
  const lista = (xs: readonly string[]) => xs.map((x) => `      '${x.replace(/'/g, "''")}'`).join('\r\n');
  return [
    `inherited ${nome}: TfRespComboBox`,
    '  Left = 388',
    '  Top = 94',
    '  Width = 135',
    '  Height = 40',
    `  Description = '${descricao}'`,
    `  Ordem = '${ordem}'`,
    '  Id_resposta = 24',
    '  CampoObrigatorio = False',
    ...extra,
    ...(ids
      ? [
          '  inherited cbxId_Resposta: TComboBox',
          '    Visible = False',
          '    Items.Strings = (',
          lista(ids) + ')',
          '  end',
        ]
      : []),
    '  inherited cbxResp: TValidadeComboBox',
    '    Items.Strings = (',
    lista(rotulos) + ')',
    '    EditLabel.Caption = ' + `'${descricao}'`,
    '  end',
    '  inherited ExParser1: TExParser',
    '    Left = 86',
    '  end',
    'end',
  ].join('\r\n');
}

export function campo(
  nome: string,
  classe: string,
  ordem: string,
  descricao: string,
  largura: number,
  extra: readonly string[] = [],
): string {
  return [
    `inherited ${nome}: ${classe}`,
    `  Width = ${largura}`,
    '  Height = 40',
    `  Description = '${descricao}'`,
    `  Ordem = '${ordem}'`,
    '  MaxLength = 12',
    '  CampoObrigatorio = False',
    ...extra,
    'end',
  ].join('\r\n');
}

let proximoId = 1000;
export function componente(idVinculo: number, classe: string, dfm: string, pai = 'jvsBox'): ComponenteLegado {
  return { id: proximoId++, idVinculo, classe, pai, ordemCriacao: idVinculo, dfm };
}

/** Modelo sintético com grupo, combo Sim/Não, combo de escolhas, data, texto e um vínculo inativo. */
export function modeloSintetico(): EntradaModelo {
  return {
    modelo: { id: 9001, codigo: 'TESTE01', descricao: 'MODELO FICTICIO DE TESTE', fase: 2 },
    vinculos: [
      { id: 1, idPergunta: 101, ordem: '01', obrigatorio: 'F', ativo: 'T' },
      { id: 2, idPergunta: 102, ordem: '0101', obrigatorio: 'F', ativo: 'T' },
      { id: 3, idPergunta: 103, ordem: '0102', obrigatorio: 'T', ativo: 'T' },
      { id: 4, idPergunta: 104, ordem: '010201', obrigatorio: 'F', ativo: 'T' },
      { id: 5, idPergunta: 105, ordem: '0103', obrigatorio: 'F', ativo: 'F' },
      { id: 6, idPergunta: 106, ordem: '0104', obrigatorio: 'F', ativo: 'F' },
    ],
    perguntas: [
      {
        id: 101,
        codPergunta: 1,
        descricao: 'SECAO FICTICIA',
        tipo: '1',
        unidade: null,
        ativo: 'T',
        manterHist: null,
      },
      {
        id: 102,
        codPergunta: 2,
        descricao: 'Queda recente',
        tipo: '4',
        unidade: null,
        ativo: 'T',
        manterHist: 0,
      },
      {
        id: 103,
        codPergunta: 3,
        descricao: 'Nivel ficticio',
        tipo: '13',
        unidade: null,
        ativo: 'T',
        manterHist: 1,
      },
      { id: 104, codPergunta: 4, descricao: 'Desde', tipo: '2', unidade: null, ativo: 'T', manterHist: null },
      {
        id: 105,
        codPergunta: 5,
        descricao: 'Observacao antiga',
        tipo: '5',
        unidade: null,
        ativo: 'T',
        manterHist: null,
      },
      {
        id: 106,
        codPergunta: 6,
        descricao: 'Sem layout',
        tipo: '5',
        unidade: null,
        ativo: 'F',
        manterHist: null,
      },
    ],
    respostas: [
      { id: 2001, idPergunta: 102, cod: null, ordem: 0, ativo: true, descricao: null },
      { id: 3001, idPergunta: 103, cod: 31, ordem: 1, ativo: true, descricao: 'Leve' },
      { id: 3002, idPergunta: 103, cod: 32, ordem: 2, ativo: true, descricao: 'Moderado' },
      { id: 3003, idPergunta: 103, cod: 33, ordem: 3, ativo: true, descricao: 'Grave' },
    ],
    componentes: [
      componente(1, 'TGroupBoxPep', grupo('cmp1', '01', 'SECAO FICTICIA')),
      componente(
        2,
        'TfRespComboBox',
        combo('cmp2', '0101', 'Queda recente', ['', 'Não', 'Sim'], ['0', '2001', '2001']),
      ),
      componente(
        3,
        'TfRespComboBox',
        combo(
          'cmp3',
          '0102',
          'Nivel ficticio',
          ['', 'Leve', 'Moderado', 'Grave'],
          ['0', '3001', '3002', '9999'],
        ),
      ),
      componente(
        4,
        'TfRespData',
        campo('cmp4', 'TfRespData', '010201', 'Desde', 350, [
          '  ExpressionEnabled = ',
          "    '   if (cmp2ItemIndex = 1) then'#13#10'  result := false'#13#10'    else'#13#10'  ' +",
          "    'result := true;'#13#10",
        ]),
      ),
      componente(5, 'TfRespTexto', campo('cmp5', 'TfRespTexto', '0103', 'Observacao antiga', 160)),
    ],
    versoes: [{ versao: 1, componentes: 5 }],
  };
}
