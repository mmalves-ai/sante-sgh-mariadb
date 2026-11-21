// Documento da trilha da prescrição (documento original da assinatura, tipo 37: XML Windows-1252, comprimido e
// em base64 pelo adaptador), na estrutura que o executável grava (medida na cópia `pc`, documentos de 2026-06, só os
// nomes dos elementos): o cabeçalho congelado (hospital, paciente, atendimento) e `<prescricao>` com um
// `<lancamento>` por item (a prescrição, o tipo de assinatura, o profissional do evento, a gravação, o item, o tipo,
// as doses, a frequência e a via) e o detalhe do tipo (`<medicamento>` com os horários e os itens do kit,
// `<procedimento_enfermagem>`, `<dieta>`, `<solucao>` com o esquema), cada horário com a linha de checagem. Os IDs que
// só existem depois da gravação vão como marcadores ({{PRESCRICAO}}, {{ITEM:k}}, {{DETALHE:k}}, {{CHECAGEM:chave}},
// {{GRAVACAO}}), trocados pelo adaptador na mesma transação. A ventilação e a hemoterapia seguem o mesmo padrão
// (o documento medido não as tinha: conferência na Fase 4).
import {
  MARCADOR_GRAVACAO,
  MARCADOR_PRESCRICAO,
  marcadorChecagem,
  marcadorDetalhe,
  marcadorItem,
} from '@sgh/contratos';
import { type CampoDocumento, escaparXml } from '../gravador/xml.js';

/** Chaves das linhas de checagem na ordem em que o adaptador as grava (a mesma no documento). */
export const chaveChecagem = {
  principal: (item: string, h: number) => `${item}:${h}`,
  kit: (item: string, h: number, j: number) => `${item}:${h}:kit${j}`,
  faixa: (item: string, h: number, f: number) => `${item}:${h}:faixa${f}`,
  componente: (item: string, c: number) => `${item}:esq${c}`,
};

export interface HorarioDocumento {
  readonly chave: string;
  readonly dataHora: string;
  readonly relativo: { readonly id: number; readonly nome: string } | null;
}

export interface ItemDocumentoBase {
  readonly chave: string;
  readonly plano: number;
  readonly planoNome: string;
  readonly numDoses: number;
  readonly frequencia: { readonly id: number; readonly nome: string } | null;
  readonly via: { readonly id: string; readonly nome: string } | null;
}

export type DetalheDocumento =
  | {
      readonly tipo: 'medicamento';
      readonly produto: number;
      readonly nome: string;
      readonly dose: number;
      readonly unidade: string;
      readonly agora: boolean;
      readonly horarios: readonly HorarioDocumento[];
      readonly kit: readonly {
        readonly produto: number;
        readonly nome: string;
        readonly quantidade: number;
        readonly unidade: string;
        readonly horarios: readonly HorarioDocumento[];
      }[];
    }
  | {
      readonly tipo: 'procedimento';
      readonly procedimento: number;
      readonly nome: string;
      readonly agora: boolean;
      readonly horarios: readonly HorarioDocumento[];
    }
  | {
      readonly tipo: 'dieta';
      readonly dieta: number;
      readonly nome: string;
      readonly quantidade: number | null;
      readonly unidade: string | null;
      readonly horarios: readonly HorarioDocumento[];
    }
  | {
      readonly tipo: 'solucao';
      readonly unidade: string;
      readonly tipoInfusao: { readonly id: number; readonly nome: string };
      readonly agora: boolean;
      readonly componentes: readonly {
        readonly produto: number;
        readonly nome: string;
        readonly principal: boolean;
        readonly etapa: number;
        readonly dose: number;
        readonly unidade: string;
        readonly horario: HorarioDocumento;
      }[];
    }
  | {
      readonly tipo: 'ventilacao';
      readonly modo: { readonly id: number; readonly nome: string };
      readonly horarios: readonly HorarioDocumento[];
    }
  | {
      readonly tipo: 'hemoterapia';
      readonly codigo: string;
      readonly nome: string;
      readonly dose: number;
      readonly unidade: string;
      readonly horarios: readonly HorarioDocumento[];
    };

export interface ItemDocumento extends ItemDocumentoBase {
  readonly detalhe: DetalheDocumento;
}

export interface CabecalhoPrescricaoDocumento {
  readonly hospital: readonly CampoDocumento[];
  readonly paciente: readonly CampoDocumento[];
  readonly atendimento: readonly CampoDocumento[];
  readonly profissional: readonly CampoDocumento[];
  readonly tipoAssinatura: string;
}

const CRLF = '\r\n';

function bloco(campos: readonly CampoDocumento[], nivel: number): string {
  const tab = '\t'.repeat(nivel);
  return campos
    .filter(([, v]) => v !== null && v !== '')
    .map(([n, v]) =>
      Array.isArray(v)
        ? `${tab}<${n}>${CRLF}${bloco(v, nivel + 1)}${tab}</${n}>${CRLF}`
        : `${tab}<${n}>${escaparXml(String(v))}</${n}>${CRLF}`,
    )
    .join('');
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));
const dataHoraUtc = (local: string) => `${local.slice(0, 16)}:00.0000-03:00`;

function horarios(hs: readonly HorarioDocumento[]): CampoDocumento {
  return [
    'horarios',
    hs.map((h): CampoDocumento => [
      'horario',
      [
        ['id_prchkgeral', marcadorChecagem(h.chave)],
        ['data_hora_checar', dataHoraUtc(h.dataHora)],
        ...(h.relativo
          ? ([
              ['id_prhrrelativa', h.relativo.id],
              ['horario_relativo', h.relativo.nome],
            ] as CampoDocumento[])
          : []),
        ['situacao_checagem', 'Prescrito'],
        ['data_hora_gravacao', MARCADOR_GRAVACAO],
        ['medicamento_urgente', 'F'],
      ],
    ]),
  ];
}

function detalhe(d: DetalheDocumento, chave: string): CampoDocumento {
  const det = marcadorDetalhe(chave);
  switch (d.tipo) {
    case 'medicamento':
      return [
        'medicamento',
        [
          ['id_prprescmed', det],
          ['id_geitens', d.produto],
          ['nome_item', d.nome],
          ['qtde_dose', num(d.dose)],
          ['unidade_prescricao', d.unidade],
          ['iniciar_adm_agora', d.agora ? 'T' : 'F'],
          horarios(d.horarios),
          ...(d.kit.length
            ? ([
                [
                  'itens',
                  d.kit.map((k): CampoDocumento => [
                    'item',
                    [
                      ['id_geitens', k.produto],
                      ['nome_item', k.nome],
                      ['qtde_dose', num(k.quantidade)],
                      ['unidade_prescricao', k.unidade],
                      ['dose_extra_antimicrobiano', 'F'],
                      horarios(k.horarios),
                    ],
                  ]),
                ],
              ] as CampoDocumento[])
            : []),
        ],
      ];
    case 'procedimento':
      return [
        'procedimento_enfermagem',
        [
          ['id_prprescproced', det],
          ['id_tbproenf', d.procedimento],
          ['nome_procedimento', d.nome],
          ['iniciar_adm_agora', d.agora ? 'T' : 'F'],
          horarios(d.horarios),
        ],
      ];
    case 'dieta':
      return [
        'dieta',
        [
          ['id_prprescdieta', det],
          ['id_tbdietas', d.dieta],
          ['nome_dieta', d.nome],
          ['qtde_dose', d.quantidade === null ? null : num(d.quantidade)],
          ['unidade_prescricao', d.unidade],
          horarios(d.horarios),
        ],
      ];
    case 'solucao':
      return [
        'solucao',
        [
          ['id_prprescsol', det],
          ['unidade_prescricao', d.unidade],
          ['id_prtpinfusao', d.tipoInfusao.id],
          ['tipo_infusao', d.tipoInfusao.nome],
          ['iniciar_adm_agora', d.agora ? 'T' : 'F'],
          [
            'esquema',
            d.componentes.map((c): CampoDocumento => [
              'item',
              [
                ['id_geitens', c.produto],
                ['nome_item', c.nome],
                ['item_principal', c.principal ? 1 : 0],
                ['etapa', c.etapa],
                ['qtde_dose', num(c.dose)],
                ['unidade_prescricao', c.unidade],
                ['dose_extra_antimicrobiano', 'F'],
                [
                  'horario',
                  [
                    ['id_prchkgeral', marcadorChecagem(c.horario.chave)],
                    ['data_hora_checar', dataHoraUtc(c.horario.dataHora)],
                    ['situacao_checagem', 'Prescrito'],
                    ['data_hora_gravacao', MARCADOR_GRAVACAO],
                    ['medicamento_urgente', 'F'],
                  ],
                ],
              ],
            ]),
          ],
        ],
      ];
    case 'ventilacao':
      return [
        'oxigenoterapia',
        [['id_prmodovent', d.modo.id], ['modo_ventilatorio', d.modo.nome], horarios(d.horarios)],
      ];
    case 'hemoterapia':
      return [
        'hemoterapia',
        [
          ['id_prpreschemo', det],
          ['codigo_hemocomponente', d.codigo],
          ['nome_hemocomponente', d.nome],
          ['qtde_dose', num(d.dose)],
          ['unidade_prescricao', d.unidade],
          horarios(d.horarios),
        ],
      ];
  }
}

/** O documento da prescrição (antes da compressão), com os marcadores dos IDs gravados. */
export function documentoPrescricao(
  cab: CabecalhoPrescricaoDocumento,
  itens: readonly ItemDocumento[],
): string {
  const lancamentos = itens.map((i): CampoDocumento => [
    'lancamento',
    [
      ['id_prpresc', MARCADOR_PRESCRICAO],
      ['tipo_assinatura', cab.tipoAssinatura],
      ['profissional_evento', cab.profissional],
      ['data_hora_gravacao', MARCADOR_GRAVACAO],
      ['id_prlangeral', marcadorItem(i.chave)],
      ['id_prtplan', i.plano],
      ['tipo_lancamento', i.planoNome],
      ['qtde_doses', i.numDoses],
      ...(i.frequencia
        ? ([
            ['id_prfrequencia', i.frequencia.id],
            ['frequencia', i.frequencia.nome],
          ] as CampoDocumento[])
        : []),
      ...(i.via
        ? ([
            ['id_getabvia', i.via.id],
            ['via', i.via.nome],
          ] as CampoDocumento[])
        : []),
      detalhe(i.detalhe, i.chave),
    ],
  ]);
  return (
    `<?xml version="1.0" encoding="Windows-1252" standalone="no"?>${CRLF}<documento>${CRLF}` +
    `\t<versaoXML>1</versaoXML>${CRLF}` +
    `\t<hospital>${CRLF}${bloco(cab.hospital, 2)}\t</hospital>${CRLF}` +
    `\t<paciente>${CRLF}${bloco(cab.paciente, 2)}\t</paciente>${CRLF}` +
    `\t<atendimento>${CRLF}${bloco(cab.atendimento, 2)}\t</atendimento>${CRLF}` +
    `\t<prescricao>${CRLF}${bloco(lancamentos, 2)}\t</prescricao>${CRLF}</documento>${CRLF}`
  );
}
