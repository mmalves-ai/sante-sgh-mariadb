// Envios regulatórios por competência (M48, etapa 5; ficha, regra 10; cap-12 §12.4; DP-47.8; manual m26): o arquivo é
// montado aqui de forma determinística (as mesmas linhas dão os mesmos bytes e o mesmo resumo SHA-256, que a API
// calcula); a transmissão é manual no portal de cada programa e fica registrada com o protocolo. Nenhum envio automático
// (nenhum canal autorizado pelo dono). Sem dado de pessoa nas linhas: só agregados e números de notificação do Sante.
// Leiaute: CSV com ponto e vírgula, cabeçalho, decimal com vírgula e CRLF (D-LEIAUTE-ENVIO-48.5: os portais recebem
// por formulário; o arquivo é a planilha conferida de onde a transcrição sai, não um leiaute oficial).
import type {
  DenominadorSetor,
  IndicadorDaCompetencia,
  SituacaoEnvioRegulatorio,
  TipoEnvioRegulatorio,
} from '@sgh/contratos';
import { competenciaFechada, noFuturo } from './comum.js';
import { msLocal } from '../nsp/prazos.js';

export type CelulaCsv = string | number | boolean | null;

/** O número no CSV (decimal com vírgula, sem milhar; nulo vazio). */
function celula(v: CelulaCsv): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'S' : 'N';
  if (typeof v === 'number')
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ',');
  const t = v.replace(/\r\n|\r|\n/g, ' ').trim();
  return /[;"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** O CSV: cabeçalho e linhas com ponto e vírgula e CRLF (inclusive depois da última linha). */
export function montarCsv(cabecalho: readonly string[], linhas: readonly (readonly CelulaCsv[])[]): string {
  for (const l of linhas)
    if (l.length !== cabecalho.length)
      throw new Error('Linha do envio com número de colunas diferente do cabeçalho.');
  return [cabecalho.join(';'), ...linhas.map((l) => l.map(celula).join(';'))].map((l) => `${l}\r\n`).join('');
}

export function nomeArquivoEnvio(
  tipo: TipoEnvioRegulatorio,
  competencia: string,
  revisao: number,
  hospital: string,
) {
  return `${tipo}-${hospital}-${competencia}-r${revisao}.csv`;
}

export interface ArquivoEnvio {
  readonly conteudo: string;
  readonly linhas: number;
  readonly resumo: Readonly<Record<string, number>>;
}

/** IRAS: uma linha por setor e a do total, com os dispositivos-dia, as infecções e as densidades (parcelas inteiras). */
export function arquivoIras(
  competencia: string,
  setores: readonly DenominadorSetor[],
  todos: DenominadorSetor,
): ArquivoEnvio {
  const cab = [
    'competencia',
    'setor',
    'pacientes_dia',
    'cvc_dia',
    'ipcs_cvc',
    'densidade_ipcs_cvc',
    'svd_dia',
    'itu_svd',
    'densidade_itu_svd',
    'vm_dia',
    'pav',
    'densidade_pav',
  ];
  const linha = (s: DenominadorSetor, nome: string): CelulaCsv[] => [
    competencia,
    nome,
    s.pacientesDia,
    s.dispositivosDia.cvc,
    s.iras.ipcs,
    s.densidade.ipcs.valor,
    s.dispositivosDia.sondaVesical,
    s.iras.itu,
    s.densidade.itu.valor,
    s.dispositivosDia.ventilacaoMecanica,
    s.iras.pav,
    s.densidade.pav.valor,
  ];
  const linhas = [...setores.map((s) => linha(s, s.setor)), linha(todos, 'TOTAL')];
  return {
    conteudo: montarCsv(cab, linhas),
    linhas: linhas.length,
    resumo: {
      setores: setores.length,
      pacientesDia: todos.pacientesDia,
      ipcs: todos.iras.ipcs,
      itu: todos.iras.itu,
      pav: todos.iras.pav,
    },
  };
}

/** PM-QUALISS: os indicadores do programa na competência, com as parcelas, a meta e a análise registrada. */
export function arquivoPmQualiss(
  competencia: string,
  indicadores: readonly IndicadorDaCompetencia[],
): ArquivoEnvio {
  const doPrograma = indicadores
    .filter((i) => i.ficha.programas.includes('pmQualiss'))
    .sort((a, b) => a.ficha.codigo.localeCompare(b.ficha.codigo));
  const cab = [
    'competencia',
    'indicador',
    'nome',
    'numerador',
    'denominador',
    'valor',
    'meta',
    'situacao_meta',
    'analise_critica',
  ];
  const linhas = doPrograma.map((i): CelulaCsv[] => [
    competencia,
    i.ficha.codigo,
    i.ficha.nome,
    i.numerador,
    i.denominador,
    i.valor,
    i.meta,
    i.situacaoMeta,
    i.analise !== null,
  ]);
  return {
    conteudo: montarCsv(cab, linhas),
    linhas: linhas.length,
    resumo: {
      indicadores: linhas.length,
      semValor: doPrograma.filter((i) => i.valor === null).length,
      semAnalise: doPrograma.filter((i) => i.analise === null).length,
      foraDaMeta: doPrograma.filter((i) => i.situacaoMeta === 'fora-da-meta').length,
    },
  };
}

/** Uma notificação de incidente da competência como o envio a mostra (sem paciente nem notificador). */
export interface NotificacaoParaEnvio {
  readonly numero: string;
  readonly ocorridoEm: string;
  readonly tipo: string;
  readonly classificacao: string | null;
  readonly grauDano: string | null;
  readonly obito: boolean;
  readonly prazoEm: string | null;
  readonly transcritaEm: string | null;
  readonly numeroNotivisa: string | null;
}

/** Notivisa: os incidentes ocorridos na competência que vão ao portal, com o prazo e a transcrição. */
export function arquivoNotivisa(competencia: string, itens: readonly NotificacaoParaEnvio[]): ArquivoEnvio {
  const ordenados = [...itens].sort(
    (a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm) || a.numero.localeCompare(b.numero),
  );
  const cab = [
    'competencia',
    'notificacao',
    'ocorrido_em',
    'tipo',
    'classificacao',
    'grau_dano',
    'obito',
    'prazo',
    'transcrita_em',
    'numero_notivisa',
  ];
  const linhas = ordenados.map((n): CelulaCsv[] => [
    competencia,
    n.numero,
    n.ocorridoEm.slice(0, 16).replace('T', ' '),
    n.tipo,
    n.classificacao,
    n.grauDano,
    n.obito,
    n.prazoEm ? n.prazoEm.slice(0, 16).replace('T', ' ') : null,
    n.transcritaEm ? n.transcritaEm.slice(0, 16).replace('T', ' ') : null,
    n.numeroNotivisa,
  ]);
  return {
    conteudo: montarCsv(cab, linhas),
    linhas: linhas.length,
    resumo: {
      notificacoes: linhas.length,
      obitos: ordenados.filter((n) => n.obito).length,
      transcritas: ordenados.filter((n) => n.transcritaEm !== null).length,
      pendentes: ordenados.filter((n) => n.transcritaEm === null).length,
    },
  };
}

export type RecusaEnvio =
  | 'competencia-aberta'
  | 'ja-transmitido'
  | 'envio-nao-pendente'
  | 'versao-desatualizada'
  | 'hash-diferente'
  | 'transmissao-antes-da-geracao'
  | 'transmissao-futura'
  | 'envio-inexistente';

/** A geração: só de competência terminada; a já transmitida não se gera de novo (a retificação fica para o portal). */
export function recusaGeracaoEnvio(
  competencia: string,
  agora: string,
  anteriores: readonly { readonly situacao: SituacaoEnvioRegulatorio }[],
): RecusaEnvio | null {
  if (!competenciaFechada(competencia, agora)) return 'competencia-aberta';
  if (anteriores.some((a) => a.situacao === 'transmitido')) return 'ja-transmitido';
  return null;
}

/** A transmissão: do envio gerado, na versão lida, com o mesmo resumo, depois da geração e não no futuro. */
export function recusaTransmissaoEnvio(
  envio: {
    readonly versao: number;
    readonly situacao: SituacaoEnvioRegulatorio;
    readonly hash: string;
    readonly geradoEm: string;
  },
  e: { readonly versao: number; readonly hash: string; readonly transmitidoEm: string },
  agora: string,
): RecusaEnvio | null {
  if (envio.situacao !== 'gerado') return 'envio-nao-pendente';
  if (envio.versao !== e.versao) return 'versao-desatualizada';
  if (envio.hash !== e.hash) return 'hash-diferente';
  if (msLocal(e.transmitidoEm) < msLocal(envio.geradoEm.slice(0, 16))) return 'transmissao-antes-da-geracao';
  if (noFuturo(e.transmitidoEm, agora)) return 'transmissao-futura';
  return null;
}
