// Regra 10 (ficha do M54; cap-07 §7.2): exportação da apuração pelos destinos dos grupos de exportação do banco
// (1 Próprio, 2 ApuraSUS, 3 Federassantas). O arquivo é só GERADO (para download e conferência); o envio ao destino
// existe apenas em `producao` e não é feito por esta etapa. Leiaute provisório, a conferir pelo analista de custos com o
// destino (D-LEIAUTE-545): CSV com ponto e vírgula, decimal com vírgula, sem separador de milhar, CRLF, cabeçalho na
// primeira linha; valores em reais com 2 casas. Nenhum dado pessoal: só centro de custo e valores.
import type { ClasseCentroCusto, DestinoExportacaoCustos, LinhaApuracaoCentro } from '@sgh/contratos';

/** O envio ao destino só existe em produção (regra 10); em dev, ci, homolog e treino, nunca. */
export function envioPermitido(ambiente: string): boolean {
  return ambiente === 'producao';
}

export interface CentroParaExportacao {
  readonly id: number;
  /** Código do centro no programa nacional de apuração de custos. */
  readonly codigoApurasus: string | null;
  /** Código da unidade de mensuração do centro no programa nacional de apuração de custos. */
  readonly unidadeApurasus: string | null;
}

export interface EntradaExportacao {
  readonly destino: DestinoExportacaoCustos;
  readonly competencia: string;
  readonly hospital: string;
  readonly rotuloParcial: string | null;
  readonly linhas: readonly LinhaApuracaoCentro[];
  readonly centros: ReadonlyMap<number, CentroParaExportacao>;
}

export interface ArquivoGerado {
  readonly nomeArquivo: string;
  readonly conteudo: string;
  readonly linhas: number;
  readonly semCodigo: number[];
  readonly avisos: string[];
}

const SIGLA_CLASSE: Readonly<Record<ClasseCentroCusto, string>> = {
  produtivo: 'PRODUTIVO',
  auxiliar: 'APOIO',
  administrativo: 'ADMINISTRATIVO',
};

/** Reais com 2 casas e vírgula, a partir de centavos (sem separador de milhar). */
export function reais(centavos: number): string {
  const neg = centavos < 0;
  const a = Math.abs(Math.round(centavos));
  const s = `${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Quantidade em centésimos para texto com 2 casas e vírgula. */
const quantidade = (cent: number | null | undefined) =>
  cent === null || cent === undefined ? '' : reais(cent);

/** Texto seguro para o CSV: sem ponto e vírgula, aspas nem quebra de linha. */
export function campo(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[;"\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CABECALHOS: Readonly<Record<DestinoExportacaoCustos, readonly string[]>> = {
  proprio: [
    'COMPETENCIA',
    'CODIGO_CENTRO',
    'CENTRO',
    'CLASSE',
    'ORDEM_RATEIO',
    'PESSOAL',
    'MATERIAIS',
    'DESPESAS',
    'DESPESAS_GERAIS',
    'CUSTO_DIRETO',
    'RATEIOS_RECEBIDOS',
    'REPASSADO',
    'NAO_RATEADO',
    'CUSTO_FINAL',
    'PRODUCAO',
    'QUANTIDADE',
    'CUSTO_UNITARIO',
  ],
  apurasus: [
    'COMPETENCIA',
    'COD_CENTRO_APURASUS',
    'CENTRO',
    'TIPO_CENTRO',
    'PESSOAL',
    'MATERIAIS',
    'SERVICOS_E_GERAIS',
    'CUSTO_DIRETO',
    'CUSTO_INDIRETO',
    'CUSTO_TOTAL',
    'QUANTIDADE_PRODUCAO',
    'UNIDADE_PRODUCAO',
  ],
  federassantas: [
    'competencia',
    'codigo_centro',
    'centro',
    'classe',
    'custo_direto',
    'custo_indireto',
    'custo_total',
    'producao',
    'quantidade',
    'custo_unitario',
  ],
};

function linhaDe(e: EntradaExportacao, l: LinhaApuracaoCentro): string[] {
  const x = e.centros.get(l.centro);
  const total = l.diretoTotal + l.recebidoTotal;
  switch (e.destino) {
    case 'proprio':
      return [
        e.competencia,
        String(l.codigo),
        campo(l.nome),
        SIGLA_CLASSE[l.classe],
        l.ordemRateio === null ? '' : String(l.ordemRateio),
        reais(l.direto.pessoal),
        reais(l.direto.materiais),
        reais(l.direto.despesas),
        reais(l.despesasGerais),
        reais(l.diretoTotal),
        reais(l.recebidoTotal),
        reais(l.repassado),
        reais(l.naoRateado),
        reais(l.custoFinal),
        l.producao?.codigo ?? '',
        quantidade(l.producao?.quantidadeCent),
        l.custoUnitario === null ? '' : reais(l.custoUnitario),
      ];
    case 'apurasus':
      return [
        e.competencia.replace('-', ''),
        campo(x?.codigoApurasus),
        campo(l.nome),
        SIGLA_CLASSE[l.classe],
        reais(l.direto.pessoal),
        reais(l.direto.materiais),
        reais(l.direto.despesas + l.despesasGerais),
        reais(l.diretoTotal),
        reais(l.recebidoTotal),
        reais(total),
        quantidade(l.producao?.quantidadeCent),
        campo(x?.unidadeApurasus),
      ];
    case 'federassantas':
      return [
        e.competencia,
        String(l.codigo),
        campo(l.nome),
        l.classe,
        reais(l.diretoTotal),
        reais(l.recebidoTotal),
        reais(total),
        l.producao?.codigo ?? '',
        quantidade(l.producao?.quantidadeCent),
        l.custoUnitario === null ? '' : reais(l.custoUnitario),
      ];
  }
}

export function gerarArquivoExportacao(e: EntradaExportacao): ArquivoGerado {
  const avisos: string[] = [];
  const semCodigo =
    e.destino === 'apurasus'
      ? e.linhas.filter((l) => !e.centros.get(l.centro)?.codigoApurasus).map((l) => l.centro)
      : [];
  if (semCodigo.length > 0)
    avisos.push(
      `${semCodigo.length} centro(s) sem o código do ApuraSUS no cadastro do centro de custo: saem com o código em branco.`,
    );
  if (e.rotuloParcial) avisos.push(`Apuração ${e.rotuloParcial}: o arquivo sai com a mesma marca no nome.`);
  avisos.push(
    'Leiaute provisório, a conferir com o destino antes do primeiro envio (o envio só existe em produção).',
  );
  const corpo = e.linhas.map((l) => linhaDe(e, l).join(';'));
  const conteudo = [CABECALHOS[e.destino].join(';'), ...corpo].join('\r\n') + '\r\n';
  const sufixo = e.rotuloParcial ? '-parcial' : '';
  return {
    nomeArquivo: `custos-${e.destino}-${e.hospital}-${e.competencia}${sufixo}.csv`,
    conteudo,
    linhas: corpo.length,
    semCodigo,
    avisos,
  };
}
