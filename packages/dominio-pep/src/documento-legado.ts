// Documento da trilha documental de cada ato do M23 (ficha, seção 5; ref 04 §1.1-1.2): o XML do documento emitido
// (cabeçalho comum e a parte do tipo de ato) que vai, comprimido (zlib) e em base64, em DOCUMENTO_ORIGINAL. A parte do
// tipo segue os nomes de marca vistos no legado (só a estrutura: receita_texto e receita_rtf na receita 41;
// conteudo_texto e conteudo no atestado 40; controle, seq e itens no pedido 79; realização, achado crítico, resultado
// e itens no exame lançado 54). O ID da linha de origem entra pelo marcador (o banco dá o ID na gravação).
import type { CabecalhoDocumento, CampoDocumento } from './gravador/xml.js';
import { xmlDocumentoEmitido } from './gravador/xml.js';

export const MARCADOR_ORIGEM = '{{ORIGEM}}';

/** Hora no formato das colunas e marcas *_UTC do legado (hora local + ".0000-03:00"). */
export function horaUtc(local: string): string {
  return `${local.length === 16 ? `${local}:00` : local.slice(0, 19)}.0000-03:00`;
}

export interface CabecalhoLido {
  readonly hospital: readonly CampoDocumento[];
  readonly paciente: readonly CampoDocumento[];
  readonly atendimento: readonly CampoDocumento[];
  readonly profissional: readonly CampoDocumento[];
  readonly tipoAssinatura: string | null;
  readonly situacao: string | null;
}

export interface Suspensao {
  readonly profissional: readonly CampoDocumento[];
  readonly justificativa: string;
  /** Hora local (AAAA-MM-DDTHH:MM). */
  readonly em: string;
  readonly gravadoEm: string;
}

/** Cabeçalho do documento com o lançamento (evento) e, na suspensão, os dados da suspensão. */
export function cabecalhoDoAto(
  cab: CabecalhoLido,
  evento: string,
  suspensao?: Suspensao,
): CabecalhoDocumento {
  return {
    hospital: cab.hospital,
    paciente: cab.paciente,
    atendimento: cab.atendimento,
    lancamento: [
      ['id_tabela_origem', MARCADOR_ORIGEM],
      ['tipo_assinatura', cab.tipoAssinatura],
      ['situacao_documento', cab.situacao],
      ['data_hora_evento', horaUtc(evento)],
      ['profissional_evento', cab.profissional],
      ...(suspensao
        ? ([
            ['profissional_suspensao', suspensao.profissional],
            ['justificativa_suspensao', suspensao.justificativa],
            ['data_hora_suspensao', horaUtc(suspensao.em)],
            ['data_hora_gravacao_suspensao', horaUtc(suspensao.gravadoEm)],
          ] as CampoDocumento[])
        : []),
    ],
  };
}

export function documentoReceita(cab: CabecalhoDocumento, texto: string, rtf: string): string {
  return xmlDocumentoEmitido(cab, [
    ['receita_texto', texto],
    ['receita_rtf', rtf],
  ]);
}

export function documentoAtestado(cab: CabecalhoDocumento, texto: string, conteudoXml: string): string {
  return xmlDocumentoEmitido(cab, [
    ['conteudo_texto', texto],
    ['conteudo', conteudoXml],
  ]);
}

export interface ItemPedidoDocumento {
  readonly controle: number | string;
  readonly codigoAlfa: string | null;
  readonly descricao: string;
  readonly material: string | null;
  readonly seq: number;
  readonly ato: string;
  readonly previsaoColeta: string | null;
  readonly urgente: boolean;
  readonly informacoes: string | null;
}

export function documentoPedidoExame(
  cab: CabecalhoDocumento,
  controle: number | string,
  itens: readonly ItemPedidoDocumento[],
): string {
  return xmlDocumentoEmitido(cab, [
    ['controle', controle],
    ['seq', 1],
    [
      'itens',
      itens.map((i): CampoDocumento => [
        'item',
        [
          ['controle', i.controle],
          ['codigo_alfa', i.codigoAlfa],
          ['bateria', 0],
          ['descricao_exame', i.descricao],
          ['material', i.material],
          ['seq', i.seq],
          ['tipo_de_ato', i.ato],
          ['previsao_de_coleta', i.previsaoColeta],
          ['exame_de_urgencia', i.urgente ? 'Sim' : 'Não'],
          ['recem_nato', 'Não'],
          ['exame_fora_instituicao', 'Não'],
          ['informacoes_complementares', i.informacoes],
        ],
      ]),
    ],
  ]);
}

export interface ItemExameExterno {
  readonly elemento: string;
  readonly tipo: 'N' | 'T';
}

export function documentoExameExterno(
  cab: CabecalhoDocumento,
  realizadoEm: string,
  critico: boolean,
  rtf: string | null,
  itens: readonly ItemExameExterno[],
): string {
  return xmlDocumentoEmitido(cab, [
    ['data_hora_realizacao', horaUtc(realizadoEm)],
    ['achadocritico', critico ? 'T' : 'F'],
    ['resultado_rtf', rtf],
    [
      'itens',
      itens.map((i): CampoDocumento => [
        'item',
        [
          ['elemento', i.elemento],
          ['tipo_resultado', i.tipo],
        ],
      ]),
    ],
  ]);
}

/** O documento com o ID da linha de origem no lugar do marcador. */
export function comOrigem(xml: string, id: number): string {
  return xml.split(MARCADOR_ORIGEM).join(String(id));
}
