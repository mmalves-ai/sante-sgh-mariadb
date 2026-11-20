// Regras do ensaio da conversão para UTF-8 na cópia em Firebird 5 (M58-F3; ficha, seções 4, 5, 8, 10 e 11): contar as
// colunas por classe, achar os índices cuja chave estoura a página em UTF-8, resumir a revisão dos literais, comparar a
// equivalência antes e depois, explicar o desvio da impressão digital pelo charset, estimar a janela e avaliar cada
// etapa. Puro: recebe o que o ensaio mediu (legado) e devolve o relatório avaliado; nada aqui conecta a banco algum nem
// decide pelo dono (o registro do ensaio aprovado é do coordenador, por PR).
import { createHash } from 'node:crypto';
import {
  BLOCO_JANELA_MIN,
  BYTES_POR_CARACTERE_UTF8,
  type ClasseConversao,
  ETAPAS_ENSAIO_UTF8,
  type EtapaEnsaioUtf8Avaliada,
  type EtapasRelatorioUtf8,
  type IndiceEstourado,
  MARGEM_JANELA,
  type RelatorioEnsaioUtf8,
  TAMANHOS_PAGINA_FIREBIRD,
  TETO_NOMES_ENSAIO,
} from '@sgh/contratos';

const ordenar = (xs: Iterable<string>) => [...xs].sort((a, b) => a.localeCompare(b));
const teto = <T>(xs: readonly T[]) => xs.slice(0, TETO_NOMES_ENSAIO);
const NOME = /^[A-Z][A-Z0-9_$]{0,62}$/;

// ── Inventário (classes de conversão) ────────────────────────────────────────────────────────────────────

export function contarClasses(colunas: readonly { readonly classe: ClasseConversao }[]): {
  cp1252: number;
  utf8Catalogada: number;
  bytes: number;
} {
  const n = (c: ClasseConversao) => colunas.filter((x) => x.classe === c).length;
  return { cp1252: n('cp1252'), utf8Catalogada: n('utf8-catalogada'), bytes: n('bytes') };
}

/** As catalogadas como UTF-8 (`TABELA.COLUNA`) que o banco tem e as que ele não tem (a lista ficou velha). */
export function conferirCatalogadas(
  lidas: readonly { readonly tabela: string; readonly coluna: string }[],
  catalogo: Iterable<string>,
): { catalogadas: string[]; ausentes: string[] } {
  const banco = new Set(lidas.map((c) => `${c.tabela}.${c.coluna}`.toUpperCase()));
  const cat = ordenar(new Set([...catalogo].map((c) => c.toUpperCase())));
  return { catalogadas: cat.filter((c) => banco.has(c)), ausentes: cat.filter((c) => !banco.has(c)) };
}

// ── Índices (chave em UTF-8) ─────────────────────────────────────────────────────────────────────────────

/** O maior tamanho de chave de índice que a página comporta (bytes): um quarto da página menos 9. */
export function limiteChaveIndice(tamanhoPagina: number): number {
  return Math.floor(tamanhoPagina / 4) - 9;
}

export interface SegmentoIndiceMedido {
  /** `texto` (CHAR/VARCHAR) conta em caracteres; `outro` em bytes. */
  readonly tipo: 'texto' | 'outro';
  readonly tamanho: number;
}

/** A chave no pior caso depois da conversão: texto a 4 bytes por caractere; composto em grupos de 5 a cada 4. */
export function chaveIndiceUtf8(segmentos: readonly SegmentoIndiceMedido[]): number {
  const bytes = segmentos.map((s) => (s.tipo === 'texto' ? s.tamanho * BYTES_POR_CARACTERE_UTF8 : s.tamanho));
  if (bytes.length === 1) return bytes[0] ?? 0;
  return bytes.reduce((t, b) => t + Math.ceil(b / 4) * 5, 0);
}

export type PaginaFirebird = (typeof TAMANHOS_PAGINA_FIREBIRD)[number];

/** A menor página que comporta a chave; null se nenhuma comporta. */
export function paginaMinima(chaveBytes: number): PaginaFirebird | null {
  return TAMANHOS_PAGINA_FIREBIRD.find((p) => chaveBytes <= limiteChaveIndice(p)) ?? null;
}

export interface IndiceMedido {
  readonly nome: string;
  readonly tabela: string;
  readonly segmentos: readonly SegmentoIndiceMedido[];
}

/**
 * Os índices que não cabem na página atual depois da conversão e a página do banco convertido: a maior entre a atual
 * e a mínima de cada estourado; null quando algum não cabe em página nenhuma (o índice tem de mudar).
 */
export function avaliarIndicesUtf8(
  indices: readonly IndiceMedido[],
  tamanhoPagina: number,
): { limiteChave: number; estouram: IndiceEstourado[]; paginaAlvo: number | null } {
  const limiteChave = limiteChaveIndice(tamanhoPagina);
  const estouram = indices
    .map((i) => ({ i, chave: chaveIndiceUtf8(i.segmentos) }))
    .filter((x) => x.chave > limiteChave && NOME.test(x.i.nome) && NOME.test(x.i.tabela))
    .map((x) => ({
      nome: x.i.nome,
      tabela: x.i.tabela,
      chaveBytes: x.chave,
      paginaMinima: paginaMinima(x.chave),
    }))
    .sort((a, b) => b.chaveBytes - a.chaveBytes || a.nome.localeCompare(b.nome));
  const paginaAlvo = estouram.some((e) => e.paginaMinima === null)
    ? null
    : Math.max(tamanhoPagina, ...estouram.map((e) => e.paginaMinima ?? 0));
  return { limiteChave, estouram: teto(estouram), paginaAlvo };
}

// ── Literais (fontes PSQL com byte alto) ─────────────────────────────────────────────────────────────────

export interface FonteMedida {
  readonly nome: string;
  readonly tipo: 'gatilho' | 'procedure';
  readonly emComentario: number;
  readonly emLiteral: number;
  readonly emCodigo: number;
  readonly aRever: boolean;
  readonly idaEVolta: boolean;
}

export function resumirLiterais(
  fontes: readonly FonteMedida[],
): Omit<EtapasRelatorioUtf8['literais'], 'situacao' | 'bloqueio' | 'observacao' | 'revistos'> {
  return {
    gatilhos: fontes.filter((f) => f.tipo === 'gatilho').length,
    procedures: fontes.filter((f) => f.tipo === 'procedure').length,
    soComentario: fontes.filter((f) => f.emComentario > 0 && f.emLiteral === 0 && f.emCodigo === 0).length,
    emLiteral: fontes.filter((f) => f.emLiteral > 0).length,
    aRever: teto(ordenar(fontes.filter((f) => f.aRever || f.emCodigo > 0).map((f) => f.nome))).filter((n) =>
      NOME.test(n),
    ),
    idaEVoltaOk: fontes.filter((f) => f.idaEVolta).length,
  };
}

// ── Equivalência antes e depois ──────────────────────────────────────────────────────────────────────────

export interface TabelaResumida {
  readonly linhas: number;
  /** COLUNA → resumo; null: a tabela não pôde ser percorrida. */
  readonly resumos: Readonly<Record<string, string>> | null;
}

/** SHA-256 da lista "TABELA.COLUNA=resumo" em ordem (o texto nunca vai ao relatório, só este resumo). */
export function resumoEquivalencia(tabelas: Readonly<Record<string, TabelaResumida>>): string {
  const linhas: string[] = [];
  for (const t of ordenar(Object.keys(tabelas))) {
    const r = tabelas[t]!;
    linhas.push(`${t}#${r.linhas}`);
    for (const c of ordenar(Object.keys(r.resumos ?? {}))) linhas.push(`${t}.${c}=${r.resumos![c]}`);
  }
  return createHash('sha256').update(linhas.join('\n')).digest('hex');
}

export function compararEquivalencia(
  antes: Readonly<Record<string, TabelaResumida>>,
  depois: Readonly<Record<string, TabelaResumida>>,
): Omit<EtapasRelatorioUtf8['equivalencia'], 'situacao' | 'bloqueio' | 'observacao' | 'segundos'> {
  const todas = ordenar(new Set([...Object.keys(antes), ...Object.keys(depois)]));
  const tabelasDiferentes: string[] = [];
  const naoVerificadas: string[] = [];
  const diferentes: string[] = [];
  let tabelasIguais = 0;
  let colunas = 0;
  let colunasIguais = 0;
  for (const t of todas) {
    const a = antes[t];
    const d = depois[t];
    if (!a || !d || a.linhas !== d.linhas) tabelasDiferentes.push(t);
    else tabelasIguais++;
    if (!a || !d) continue;
    if (a.resumos === null || d.resumos === null) {
      naoVerificadas.push(t);
      continue;
    }
    for (const c of ordenar(new Set([...Object.keys(a.resumos), ...Object.keys(d.resumos)]))) {
      colunas++;
      if (a.resumos[c] !== undefined && a.resumos[c] === d.resumos[c]) colunasIguais++;
      else diferentes.push(`${t}.${c}`);
    }
  }
  const nomeOk = (x: string) => NOME.test(x);
  return {
    tabelas: todas.length,
    tabelasIguais,
    colunas,
    colunasIguais,
    diferentes: teto(diferentes.filter((x) => x.split('.').every(nomeOk) && x.split('.').length === 2)),
    tabelasDiferentes: teto(tabelasDiferentes.filter(nomeOk)),
    naoVerificadas: teto(naoVerificadas.filter(nomeOk)),
    hashAntes: resumoEquivalencia(antes),
    hashDepois: resumoEquivalencia(depois),
  };
}

// ── Impressão digital (desvio explicado só pelo charset) ─────────────────────────────────────────────────

export interface DiferencaSchemaUtf8 {
  readonly categoria: string;
  readonly ausentes: number;
  readonly novos: number;
  readonly alterados: number;
  readonly nomes: readonly string[];
  readonly doCharset?: number;
}

const doMotor = (chave: string) => /^(RDB|MON|SEC)\$/.test(chave);

/**
 * A comparação crua de uma categoria contra a impressão da base: os alterados que a conversão tocou (tabelas com
 * coluna de texto, domínios de texto, fontes com byte alto) contam como `doCharset`; os do motor ficam fora.
 */
export function separarDesvioDoCharset(
  categoria: string,
  d: {
    readonly ausentes: readonly string[];
    readonly novos: readonly string[];
    readonly alterados: readonly string[];
  },
  tocados: ReadonlySet<string>,
): DiferencaSchemaUtf8 & { nomes: string[]; doCharset: number } {
  const fora = (xs: readonly string[]) => xs.filter((x) => !doMotor(x));
  const [au, no, al] = [fora(d.ausentes), fora(d.novos), fora(d.alterados)];
  return {
    categoria,
    ausentes: au.length,
    novos: no.length,
    alterados: al.length,
    nomes: teto(ordenar([...au, ...no, ...al.filter((x) => !tocados.has(x))]).filter((x) => NOME.test(x))),
    doCharset: al.filter((x) => tocados.has(x)).length,
  };
}

/** O desvio é só do charset quando não há ausente nem novo e todo alterado foi tocado pela conversão. */
export function explicarDesvioCharset(diferencas: readonly DiferencaSchemaUtf8[]): string[] {
  const achados: string[] = [];
  for (const d of diferencas) {
    if (d.ausentes > 0) achados.push(`schema-ausentes:${d.categoria}`);
    if (d.novos > 0) achados.push(`schema-novos:${d.categoria}`);
    if (d.alterados > (d.doCharset ?? 0)) achados.push(`schema-alterados:${d.categoria}`);
  }
  return achados;
}

// ── Janela ───────────────────────────────────────────────────────────────────────────────────────────────

/** A janela da conversão: (bombeamento + verificação) × margem, em blocos; sem o bombeamento medido, null. */
export function estimarJanelaUtf8Minutos(
  conversaoS: number | null,
  verificacaoS: number | null,
): number | null {
  if (conversaoS === null) return null;
  const min = ((conversaoS + (verificacaoS ?? 0)) * MARGEM_JANELA) / 60;
  return Math.max(BLOCO_JANELA_MIN, Math.ceil(min / BLOCO_JANELA_MIN) * BLOCO_JANELA_MIN);
}

// ── Avaliação das etapas ─────────────────────────────────────────────────────────────────────────────────

function achadosDaEtapa(e: EtapasRelatorioUtf8, etapa: keyof EtapasRelatorioUtf8): string[] {
  switch (etapa) {
    case 'base': {
      const a: string[] = [];
      if (e.base.impressao === null) a.push('sem-impressao-base');
      if (e.base.integridadeOk !== true) a.push('integridade-nao-verificada');
      return a;
    }
    case 'inventario': {
      const x = e.inventario;
      const a = x.cp1252 + x.utf8Catalogada + x.bytes === 0 ? ['sem-inventario'] : [];
      return [...a, ...x.catalogadasAusentes.map((c) => `catalogada-ausente:${c}`)];
    }
    case 'indices': {
      const x = e.indices;
      const a = x.estouram.filter((i) => i.paginaMinima === null).map((i) => `indice-sem-pagina:${i.nome}`);
      const precisa = Math.max(x.tamanhoPagina, ...x.estouram.map((i) => i.paginaMinima ?? 0));
      if (x.tamanhoPagina === 0) a.push('sem-pagina');
      else if (x.paginaAlvo === null || x.paginaAlvo < precisa) a.push('pagina-alvo-insuficiente');
      return a;
    }
    case 'literais': {
      const x = e.literais;
      const revistos = new Map(x.revistos.map((r) => [r.nome, r.mesmaLetra]));
      const a = x.aRever.filter((n) => revistos.get(n) !== true).map((n) => `literal-a-rever:${n}`);
      for (const r of x.revistos) if (!r.mesmaLetra) a.push(`literal-mudou:${r.nome}`);
      if (x.idaEVoltaOk < x.gatilhos + x.procedures) a.push('fonte-sem-ida-e-volta');
      return a;
    }
    case 'conversao': {
      const x = e.conversao;
      const a = x.tabelasRejeitadas.map((t) => `tabela-rejeitada:${t}`);
      if (x.segundos === null) a.push('sem-tempo');
      if (x.tabelas === 0) a.push('sem-tabelas');
      return a;
    }
    case 'equivalencia': {
      const x = e.equivalencia;
      const a = [
        ...x.tabelasDiferentes.map((t) => `tabela-diferente:${t}`),
        ...x.diferentes.map((c) => `coluna-diferente:${c}`),
        ...x.naoVerificadas.map((t) => `tabela-nao-verificada:${t}`),
      ];
      if (x.hashAntes === null || x.hashDepois === null) a.push('sem-resumo');
      else if (x.hashAntes !== x.hashDepois) a.push('resumo-diferente');
      if (x.tabelas === 0) a.push('sem-tabelas');
      if (a.length === 0 && (x.colunasIguais < x.colunas || x.tabelasIguais < x.tabelas))
        a.push('contagem-diferente');
      return a;
    }
    case 'utf8-catalogadas': {
      const x = e['utf8-catalogadas'];
      if (x.colunas === 0) return ['sem-catalogadas'];
      return x.idaEVoltaOk < x.colunas ? ['catalogada-sem-ida-e-volta'] : [];
    }
    case 'rtf': {
      const x = e.rtf;
      const a: string[] = [];
      if (x.colunas === 0) a.push('sem-blobs');
      if (x.bytesIguais < x.colunas) a.push('blob-diferente');
      if (x.abrem < x.amostra) a.push('rtf-nao-abre');
      return a;
    }
    case 'objetos': {
      const x = e.objetos;
      const origem = new Set(x.invalidosNaOrigem);
      const a = x.invalidos.filter((n) => !origem.has(n)).map((n) => `invalido:${n}`);
      for (const f of x.funcoesPorByte) if (f.dependentes > 0) a.push(`funcao-por-byte:${f.funcao}`);
      return x.gatilhos + x.procedures === 0 ? ['sem-objetos', ...a] : a;
    }
    case 'codec': {
      const x = e.codec;
      const a: string[] = [];
      if (x.corpusBytes < 256) a.push('corpus-incompleto');
      if (x.idaEVoltaOk !== true) a.push('corpus-sem-ida-e-volta');
      if (x.charsetConfere !== true) a.push('charset-nao-conferido');
      return a;
    }
    case 'schema': {
      const s = e.schema;
      const a: string[] = [];
      if (s.impressaoBase === null || s.impressaoEnsaio === null) a.push('sem-impressao');
      return [...a, ...explicarDesvioCharset(s.diferencas)];
    }
    case 'assinaturas':
      return e.assinaturas.operacoes === 0
        ? ['sem-operacoes']
        : e.assinaturas.diferencas > 0
          ? ['assinaturas-diferentes']
          : [];
    case 'carga':
      return e.carga.slosAtendidos === true ? [] : ['slo-nao-medido-ou-falhou'];
    case 'sante-api':
      return e['sante-api'].contratosQuebrados === 0 ? [] : ['contratos-nao-verdes'];
    case 'parceiros': {
      const p = e.parceiros.alvos;
      const a = p.filter((x) => x.lidosSemErro < x.objetos).map((x) => `parceiro-com-erro:${x.alvo}`);
      if (p.some((x) => !x.avisado)) a.push('parceiros-nao-avisados');
      return p.length === 0 ? ['sem-parceiros'] : a;
    }
    case 'volta-atras': {
      const x = e['volta-atras'];
      const a: string[] = [];
      if (x.segundos === null) a.push('sem-tempo');
      if (x.integridadeOk !== true) a.push('integridade-nao-verificada');
      return a;
    }
  }
}

/** Cada etapa avaliada: "aprovada" com achado vira "reprovada" (falha fechada); bloqueada e não executada ficam. */
export function avaliarEtapasEnsaioUtf8(r: RelatorioEnsaioUtf8): EtapaEnsaioUtf8Avaliada[] {
  return ETAPAS_ENSAIO_UTF8.map((etapa) => {
    const x = r.etapas[etapa];
    const achados = teto(achadosDaEtapa(r.etapas, etapa));
    const situacao = x.situacao === 'aprovada' && achados.length > 0 ? 'reprovada' : x.situacao;
    return { etapa, situacao, bloqueio: x.bloqueio, achados: situacao === 'aprovada' ? [] : achados };
  });
}

export function ensaioUtf8Aprovavel(etapas: readonly EtapaEnsaioUtf8Avaliada[]): boolean {
  return etapas.length === ETAPAS_ENSAIO_UTF8.length && etapas.every((e) => e.situacao === 'aprovada');
}

/** A situação que os números sustentam para uma etapa medida pela obra. */
export function situacaoMedidaUtf8(
  r: RelatorioEnsaioUtf8,
  etapa: keyof EtapasRelatorioUtf8,
): 'aprovada' | 'reprovada' {
  return achadosDaEtapa(r.etapas, etapa).length === 0 ? 'aprovada' : 'reprovada';
}

/** O relatório vazio (todas as etapas não executadas): o ponto de partida do ensaio e a falha fechada da API. */
export function relatorioEnsaioUtf8Vazio(
  estabelecimento: string,
  em: string,
  origem: { versaoMotor: string; charset: string },
  alvo: { versaoMotor: string; charset: string },
): RelatorioEnsaioUtf8 {
  const b = { situacao: 'nao-executada' as const, bloqueio: null, observacao: null };
  return {
    formato: 1,
    estabelecimento,
    em,
    origem,
    alvo,
    etapas: {
      base: { ...b, impressao: null, integridadeOk: null },
      inventario: {
        ...b,
        tabelas: 0,
        cp1252: 0,
        utf8Catalogada: 0,
        bytes: 0,
        catalogadas: [],
        catalogadasAusentes: [],
      },
      indices: { ...b, tamanhoPagina: 0, limiteChave: 0, comTexto: 0, estouram: [], paginaAlvo: null },
      literais: {
        ...b,
        gatilhos: 0,
        procedures: 0,
        soComentario: 0,
        emLiteral: 0,
        aRever: [],
        idaEVoltaOk: 0,
        revistos: [],
      },
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
      objetos: { ...b, gatilhos: 0, procedures: 0, invalidos: [], invalidosNaOrigem: [], funcoesPorByte: [] },
      codec: { ...b, corpusBytes: 0, idaEVoltaOk: null, charsetConfere: null },
      schema: { ...b, impressaoBase: null, impressaoEnsaio: null, diferencas: [] },
      assinaturas: {
        ...b,
        operacoes: 0,
        cenarios: 0,
        diferencas: 0,
        iguaisABase: 0,
        relatorio: null,
        operacoesComDiferenca: [],
        funcoesACorrigir: [],
      },
      carga: { ...b, slosAtendidos: null },
      'sante-api': { ...b, contratosQuebrados: null, referencia: null },
      parceiros: { ...b, alvos: [] },
      'volta-atras': { ...b, segundos: null, integridadeOk: null },
    },
  };
}
