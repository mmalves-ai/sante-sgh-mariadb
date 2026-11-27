// Arquivo oficial das habilitações do cadastro nacional de estabelecimentos (C2-123): quando a rede de saída não
// alcança a fonte oficial, o cliente baixa a base pública do mês e envia na tela o arquivo das habilitações. A tela
// lê o arquivo, guarda só as linhas do próprio estabelecimento e a API grava no catálogo da competência, com a
// mesma tabela que o carregador versionado (catalogos/carregadores/cnes.py) alimenta.

/** Onde o cliente baixa a base oficial do mês. */
export const ONDE_BAIXAR_CNES =
  'Baixe a base pública do mês (BASE_DE_DADOS_CNES_AAAAMM.ZIP) no FTP do DATASUS, ftp.datasus.gov.br/cnes, ' +
  'ou em cnes.datasus.gov.br > Serviços > Base de dados; abra o ZIP e envie aqui o arquivo das habilitações ' +
  '(rlEstabHabilitacao…csv ou rlEstabSipac…csv).';

export interface HabilitacaoArquivoCnes {
  readonly codigo: string;
  /** Competência inicial (AAAAMM) ou nulo. */
  readonly competenciaInicio: string | null;
  /** Competência final (AAAAMM) ou nulo enquanto vigente. */
  readonly competenciaFim: string | null;
  readonly numeroPortaria: string | null;
  readonly leitosHabilitados: number | null;
}

export interface LeituraArquivoCnes {
  readonly habilitacoes: readonly HabilitacaoArquivoCnes[];
  /** Linhas lidas do arquivo (de todos os estabelecimentos). */
  readonly linhas: number;
  /** Vazio quando o arquivo foi reconhecido; senão, o motivo. */
  readonly problemas: readonly string[];
}

const COLUNAS = {
  unidade: ['CO_UNIDADE'],
  cnes: ['CO_CNES'],
  codigo: ['CO_HABILITACAO', 'CO_CODIGO_GRUPO', 'CO_GRUPO_HABILITACAO'],
  inicio: ['NU_COMPETENCIA_INICIAL', 'CO_COMPETENCIA_INICIAL', 'DT_COMPETENCIA_INICIAL'],
  fim: ['NU_COMPETENCIA_FINAL', 'CO_COMPETENCIA_FINAL', 'DT_COMPETENCIA_FINAL'],
  portaria: ['NU_PORTARIA'],
  leitos: ['QT_LEITOS'],
} as const;

const limpar = (v: string | undefined): string => (v ?? '').trim().replace(/^"|"$/g, '').trim();

function competencia(v: string): string | null {
  const s = v.replace(/\D/g, '');
  if (s.length < 6) return null;
  const mes = Number(s.slice(4, 6));
  return mes >= 1 && mes <= 12 ? s.slice(0, 6) : null;
}

/**
 * Lê o arquivo das habilitações (CSV com cabeçalho, separado por ponto e vírgula) e devolve só as do estabelecimento
 * do número nacional dado (7 dígitos): pela coluna do número ou pelo fim do código da unidade (município + número).
 */
export function lerHabilitacoesDoArquivoCnes(texto: string, codigoCnes: string): LeituraArquivoCnes {
  const cnes = codigoCnes.replace(/\D/g, '');
  if (cnes.length !== 7)
    return { habilitacoes: [], linhas: 0, problemas: ['O estabelecimento não tem CNES de 7 dígitos.'] };
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cab = (linhas[0] ?? '').split(';').map((c) => limpar(c).toUpperCase());
  const idx = (aceitos: readonly string[]) => cab.findIndex((c) => aceitos.includes(c));
  const i = Object.fromEntries(Object.entries(COLUNAS).map(([k, v]) => [k, idx(v)])) as Record<
    keyof typeof COLUNAS,
    number
  >;
  const faltam: string[] = [];
  if (i.codigo < 0) faltam.push('código da habilitação');
  if (i.unidade < 0 && i.cnes < 0) faltam.push('código da unidade ou CNES');
  if (faltam.length)
    return {
      habilitacoes: [],
      linhas: Math.max(linhas.length - 1, 0),
      problemas: [`Arquivo não reconhecido como habilitações do CNES: falta ${faltam.join(' e ')}.`],
    };
  const doEstab = new Map<string, HabilitacaoArquivoCnes>();
  for (const linha of linhas.slice(1)) {
    const v = linha.split(';').map(limpar);
    const daUnidade = i.cnes >= 0 ? v[i.cnes] === cnes : (v[i.unidade] ?? '').endsWith(cnes);
    if (!daUnidade) continue;
    const codigo = v[i.codigo] ?? '';
    if (!/^\d{1,6}$/.test(codigo)) continue;
    const leitos = i.leitos >= 0 ? Number(v[i.leitos]) : NaN;
    doEstab.set(codigo, {
      codigo,
      competenciaInicio: i.inicio >= 0 ? competencia(v[i.inicio] ?? '') : null,
      competenciaFim: i.fim >= 0 ? competencia(v[i.fim] ?? '') : null,
      numeroPortaria: i.portaria >= 0 && v[i.portaria] ? v[i.portaria]!.slice(0, 30) : null,
      leitosHabilitados: Number.isInteger(leitos) && leitos >= 0 && v[i.leitos] !== '' ? leitos : null,
    });
  }
  return { habilitacoes: [...doEstab.values()], linhas: linhas.length - 1, problemas: [] };
}
