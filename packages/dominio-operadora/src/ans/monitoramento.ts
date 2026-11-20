// Monitoramento TISS (M56, etapa 7, F6): as guias das contas médicas cuja análise foi concluída na competência (F5:
// analisadas ou pagas), com o prestador, o beneficiário, as datas, os procedimentos e os valores informado, glosado e
// liberado. A guia sem beneficiário da operadora identificado vai com a carteirinha apresentada e fica listada como
// pendência do item (a ANS critica no recebimento).
import type { ParcelaAns, ProblemaAns, QuadroAns } from '@sgh/contratos';
import { emCentavos, documentoXml, el, opcional, problema, deCentavos, valorNoArquivo } from './comum.js';
import { type CabecalhoAns, cabecalhoXml } from './sib.js';

export interface ItemGuiaMonitoramento {
  readonly tabela: string;
  readonly codigo: string;
  readonly quantidade: number;
  readonly informado: number;
  readonly glosado: number;
}

export interface GuiaMonitoramento {
  readonly protocolo: string;
  readonly prestadorDocumento: string;
  readonly prestadorCnes: string | null;
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora: string | null;
  readonly tipoGuia: string;
  readonly carater: string | null;
  readonly inicio: string;
  readonly fim: string;
  readonly beneficiario: {
    readonly carteirinha: string;
    readonly cns: string | null;
    readonly sexo: string | null;
    readonly nascimento: string | null;
    readonly municipio: number | null;
    readonly cco: string | null;
  } | null;
  readonly carteirinhaApresentada: string;
  readonly itens: readonly ItemGuiaMonitoramento[];
}

export function problemasMonitoramento(guias: readonly GuiaMonitoramento[]): ProblemaAns[] {
  return guias
    .filter((g) => !g.beneficiario)
    .map((g) => problema('guia-sem-beneficiario', 'item', `${g.protocolo}/${g.numeroGuiaPrestador}`));
}

const somaItens = (g: GuiaMonitoramento, k: 'informado' | 'glosado') =>
  g.itens.reduce((a, i) => a + emCentavos(i[k]), 0);

export function quadrosMonitoramento(guias: readonly GuiaMonitoramento[]): QuadroAns[] {
  const informado = guias.reduce((a, g) => a + somaItens(g, 'informado'), 0);
  const glosado = guias.reduce((a, g) => a + somaItens(g, 'glosado'), 0);
  const parcelas: ParcelaAns[] = [
    { rotulo: 'Valor informado pelos prestadores', valor: deCentavos(informado), quantidade: guias.length },
    { rotulo: 'Glosa (menos)', valor: deCentavos(-glosado) },
  ];
  return [
    {
      titulo: 'Guias processadas na competência',
      parcelas,
      total: { rotulo: 'Valor liberado', valor: deCentavos(informado - glosado), quantidade: guias.length },
    },
  ];
}

export function arquivoMonitoramento(cab: CabecalhoAns, guias: readonly GuiaMonitoramento[]): string {
  return documentoXml(
    el('mensagemMonitoramento', [
      cabecalhoXml(cab, guias.length),
      el(
        'guias',
        guias.map((g, k) =>
          el(
            'guia',
            [
              el('protocolo', g.protocolo),
              el('prestador', [el('documento', g.prestadorDocumento), opcional('cnes', g.prestadorCnes)]),
              el('numeroGuiaPrestador', g.numeroGuiaPrestador),
              opcional('numeroGuiaOperadora', g.numeroGuiaOperadora),
              el('tipoGuia', g.tipoGuia),
              opcional('carater', g.carater),
              el('dataInicio', g.inicio),
              el('dataFim', g.fim),
              el('beneficiario', [
                el('matricula', g.beneficiario?.carteirinha ?? g.carteirinhaApresentada),
                opcional('cco', g.beneficiario?.cco ?? null),
                opcional('cns', g.beneficiario?.cns ?? null),
                opcional('sexo', g.beneficiario?.sexo ?? null),
                opcional('dataNascimento', g.beneficiario?.nascimento ?? null),
                opcional('codigoMunicipio', g.beneficiario?.municipio ?? null),
              ]),
              el(
                'procedimentos',
                g.itens.map((i) =>
                  el('procedimento', [
                    el('tabela', i.tabela),
                    el('codigo', i.codigo),
                    el('quantidade', i.quantidade),
                    el('valorInformado', valorNoArquivo(i.informado)),
                    el('valorGlosado', valorNoArquivo(i.glosado)),
                    el(
                      'valorLiberado',
                      valorNoArquivo(deCentavos(emCentavos(i.informado) - emCentavos(i.glosado))),
                    ),
                  ]),
                ),
              ),
              el('valorInformado', valorNoArquivo(deCentavos(somaItens(g, 'informado')))),
              el('valorGlosado', valorNoArquivo(deCentavos(somaItens(g, 'glosado')))),
            ],
            { ordem: k + 1 },
          ),
        ),
      ),
    ]),
  );
}
