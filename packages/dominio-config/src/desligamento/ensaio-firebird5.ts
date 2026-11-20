// Regras do ensaio do Firebird 5 na cópia (M58-F2; ficha, seções 5, 8, 10 e 11): comparar o antes e o depois da
// restauração, propor a resolução das funções externas, explicar o desvio da impressão digital, estimar a janela e
// avaliar cada etapa. Puro: recebe o que o ensaio mediu (legado) e devolve o relatório avaliado; nada aqui conecta a
// banco algum nem decide pelo dono (o registro do ensaio aprovado é do coordenador, por PR).
import { createHash } from 'node:crypto';
import {
  BLOCO_JANELA_MIN,
  ETAPAS_ENSAIO_FIREBIRD5,
  type EtapaEnsaioAvaliada,
  type EtapasRelatorioFirebird5,
  type FuncaoEnsaio,
  MARGEM_JANELA,
  type ResolucaoFuncaoExterna,
  type RelatorioEnsaioFirebird5,
  TETO_NOMES_ENSAIO,
} from '@sgh/contratos';

const ordenar = (xs: Iterable<string>) => [...xs].sort((a, b) => a.localeCompare(b));
const teto = (xs: readonly string[]) => xs.slice(0, TETO_NOMES_ENSAIO);

// ── Contagens por tabela ─────────────────────────────────────────────────────────────────────────────────

/** SHA-256 da lista "TABELA=linhas" em ordem (as contagens nunca vão ao relatório, só este resumo). */
export function resumoContagens(contagens: Readonly<Record<string, number>>): string {
  const linhas = ordenar(Object.keys(contagens)).map((t) => `${t}=${contagens[t]}`);
  return createHash('sha256').update(linhas.join('\n')).digest('hex');
}

export interface ComparacaoContagens {
  readonly tabelas: number;
  readonly iguais: number;
  readonly diferentes: string[];
  readonly ausentes: string[];
  readonly hashAntes: string;
  readonly hashDepois: string;
}

/** O antes (Firebird 3) contra o depois (Firebird 5): a restauração não pode ganhar nem perder linha. */
export function compararContagens(
  antes: Readonly<Record<string, number>>,
  depois: Readonly<Record<string, number>>,
): ComparacaoContagens {
  const todas = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  const diferentes: string[] = [];
  const ausentes: string[] = [];
  let iguais = 0;
  for (const t of todas) {
    if (!(t in antes) || !(t in depois)) ausentes.push(t);
    else if (antes[t] !== depois[t]) diferentes.push(t);
    else iguais++;
  }
  return {
    tabelas: todas.size,
    iguais,
    diferentes: ordenar(diferentes),
    ausentes: ordenar(ausentes),
    hashAntes: resumoContagens(antes),
    hashDepois: resumoContagens(depois),
  };
}

/** O registro de um script SGH_ aplicado (SGH_VERSAO_SCRIPT: número e hash). */
export interface ScriptRegistrado {
  readonly numero: number;
  readonly hash: string;
}

/** Tabela do próprio Sante (scripts SGH_ versionados); as demais são do banco de origem. */
export const tabelaSgh = (t: string): boolean => t.startsWith('SGH_');

/** O resumo das contagens só das tabelas que não são do Sante (as do banco de origem). */
export function resumoContagensLegado(contagens: Readonly<Record<string, number>>): string {
  return resumoContagens(Object.fromEntries(Object.entries(contagens).filter(([t]) => !tabelaSgh(t))));
}

/**
 * A cópia de dev é compartilhada e continua viva depois do backup: os scripts SGH_ e o movimento do próprio Sante
 * seguem nela (outros marcos integram), enquanto a restaurada fica parada no instante do backup. A cópia "andou"
 * só quando o registro dos scripts da restaurada está contido no da origem (os mesmos números com o mesmo hash) e a
 * origem tem mais (os scripts são numerados por marco e entram em qualquer ordem: não se exige prefixo). Então as tabelas SGH_ que divergem (ou que só existem na origem) são o movimento
 * posterior do Sante e não reprovam; qualquer tabela do banco de origem que diverja continua reprovando, e as
 * contagens delas têm de bater pelo resumo próprio. Na janela de produção os dois lados estão parados: a regra
 * não se aplica (copiaMoveu falso ⇒ a comparação inteira vale).
 */
export function explicarContagensCopiaCompartilhada(
  c: Pick<ComparacaoContagens, 'diferentes'>,
  apenasNaOrigem: readonly string[],
  scriptsOrigem: readonly ScriptRegistrado[],
  scriptsAlvo: readonly ScriptRegistrado[],
): { copiaMoveu: boolean; posterioresSgh: string[] } {
  const naOrigem = new Map(scriptsOrigem.map((x) => [x.numero, x.hash]));
  const copiaMoveu =
    scriptsAlvo.length > 0 &&
    scriptsAlvo.length < scriptsOrigem.length &&
    scriptsAlvo.every((x) => naOrigem.get(x.numero) === x.hash);
  if (!copiaMoveu) return { copiaMoveu: false, posterioresSgh: [] };
  return {
    copiaMoveu,
    posterioresSgh: teto(ordenar(new Set([...c.diferentes, ...apenasNaOrigem].filter(tabelaSgh)))),
  };
}

// ── Gatilhos e procedures recompilados ───────────────────────────────────────────────────────────────────

/**
 * Os inválidos que a troca do motor causou: os inválidos depois da restauração que não estavam inválidos já na origem.
 * Os da origem vão ao relatório como estão (não reprovam a troca, mas não podem ser escondidos).
 */
export function invalidosDaTroca(antes: readonly string[], depois: readonly string[]): string[] {
  const ja = new Set(antes);
  return ordenar(depois.filter((x) => !ja.has(x)));
}

// ── Funções externas (regra 5) ───────────────────────────────────────────────────────────────────────────

export interface FuncaoMedida {
  readonly nome: string;
  readonly modulo: string;
  readonly bibliotecaPresente: boolean;
  readonly chamadaOk: boolean | null;
  readonly dependentes: number;
  readonly dependentesValidos: number;
}

/**
 * A resolução que o ensaio sustenta: biblioteca no servidor, chamada de prova com valor e todos os dependentes válidos
 * ⇒ `habilitada-por-configuracao` (`UdfAccess = Restrict UDF`). Qualquer outra coisa fica `pendente` (substituir por
 * função equivalente é decisão de ADR, porque mexe em objeto do banco do hospital; o ensaio não a presume).
 */
export function resolucaoProposta(f: FuncaoMedida): ResolucaoFuncaoExterna {
  return f.bibliotecaPresente && f.chamadaOk === true && f.dependentesValidos === f.dependentes
    ? 'habilitada-por-configuracao'
    : 'pendente';
}

export function avaliarFuncoesEnsaio(medidas: readonly FuncaoMedida[]): FuncaoEnsaio[] {
  return [...medidas]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((f) => ({ ...f, resolucaoProposta: resolucaoProposta(f) }));
}

/**
 * O motivo verdadeiro do bloqueio por biblioteca do fornecedor (D-VLR-MED-58.2). Sem dependente no banco
 * (`RDB$DEPENDENCIES`), o bloqueio não vem de gatilho nem de procedimento: vem da declaração, porque a função continua
 * chamável por comando enviado de fora do banco (o outro sistema, relatórios de parceiros), que o banco não registra, e
 * sem a biblioteca essa chamada falha. Por isso a função sem dependente segue `pendente` (não há "declarada sem uso").
 */
export function motivoBibliotecaDoFornecedor(pendentes: readonly FuncaoMedida[]): string {
  const partes = [...pendentes]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((f) =>
      f.dependentes === 0
        ? `${f.nome} (declarada no banco, 0 dependentes; sem a biblioteca, falha a chamada direta enviada de fora do banco)`
        : `${f.nome} (${f.dependentes} dependentes no banco)`,
    );
  return `sem a biblioteca do fornecedor na cópia: ${partes.join(', ')}`;
}

/** `UdfAccess` que libera as bibliotecas da pasta UDF do servidor (e só elas). */
export function udfAccessLibera(valor: string): boolean {
  return /^\s*restrict\s+udf\b/i.test(valor) || /^\s*full\s*$/i.test(valor);
}

// ── Impressão digital (critério de aceite: desvio explicado só por motor) ────────────────────────────────

export interface DiferencaSchemaMedida {
  readonly categoria: string;
  readonly ausentes: number;
  readonly novos: number;
  readonly alterados: number;
  readonly nomes: readonly string[];
  /** Diferenças em objetos do catálogo do próprio motor (RDB$, MON$, SEC$): explicadas pela troca de versão. */
  readonly doMotor?: number;
}

/** Objeto do catálogo do motor (tabelas de sistema RDB$, MON$ e SEC$ e o que pende delas). */
export const objetoDoMotor = (chave: string): boolean => /^(RDB|MON|SEC)\$/.test(chave);

/** A comparação crua de uma categoria (chaves da impressão) com o que é do motor separado do resto. */
export function separarDesvioDoMotor(
  categoria: string,
  d: {
    readonly ausentes: readonly string[];
    readonly novos: readonly string[];
    readonly alterados: readonly string[];
  },
): DiferencaSchemaMedida & { nomes: string[]; doMotor: number } {
  const fora = (xs: readonly string[]) => xs.filter((x) => !objetoDoMotor(x));
  const [au, no, al] = [fora(d.ausentes), fora(d.novos), fora(d.alterados)];
  return {
    categoria,
    ausentes: au.length,
    novos: no.length,
    alterados: al.length,
    nomes: teto([...au, ...no, ...al].filter((x) => /^[A-Z][A-Z0-9_$]{0,62}$/.test(x))),
    doMotor: d.ausentes.length + d.novos.length + d.alterados.length - au.length - no.length - al.length,
  };
}

/**
 * O desvio da impressão em relação à homologada de Firebird 3 é explicado só pelo motor quando: não há categoria com
 * ausente ou novo, e os únicos alterados são funções que o registro dá como substituídas (a nova declaração muda o
 * objeto, de propósito). A impressão não inclui a versão do motor nem a ODS; com o mesmo charset, a restauração fiel
 * dá a mesma impressão. Devolve os achados (vazio ⇒ explicado).
 */
export function explicarDesvioSchema(
  diferencas: readonly DiferencaSchemaMedida[],
  funcoesSubstituidas: readonly string[],
): string[] {
  const sub = new Set(funcoesSubstituidas);
  const achados: string[] = [];
  for (const d of diferencas) {
    if (d.ausentes > 0) achados.push(`schema-ausentes:${d.categoria}`);
    if (d.novos > 0) achados.push(`schema-novos:${d.categoria}`);
    if (d.alterados > 0) {
      const explicados = d.categoria === 'funcoes' ? d.nomes.filter((x) => sub.has(x)).length : 0;
      if (explicados < d.alterados) achados.push(`schema-alterados:${d.categoria}`);
    }
  }
  return achados;
}

// ── Janela (regra 4) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A duração estimada da janela em produção, em minutos: (backup + restauração + verificação) × margem, arredondada
 * para cima no bloco. Sem backup ou sem restauração medidos: null (a janela não se marca sem ensaio).
 */
export function estimarJanelaMinutos(
  backupS: number | null,
  restauracaoS: number | null,
  verificacaoS: number | null,
): number | null {
  if (backupS === null || restauracaoS === null) return null;
  const min = ((backupS + restauracaoS + (verificacaoS ?? 0)) * MARGEM_JANELA) / 60;
  return Math.max(BLOCO_JANELA_MIN, Math.ceil(min / BLOCO_JANELA_MIN) * BLOCO_JANELA_MIN);
}

// ── Avaliação das etapas ─────────────────────────────────────────────────────────────────────────────────

/** Os achados medidos de cada etapa (o que reprova mesmo com a situação "aprovada" escrita no relatório). */
function achadosDaEtapa(e: EtapasRelatorioFirebird5, etapa: keyof EtapasRelatorioFirebird5): string[] {
  switch (etapa) {
    case 'backup':
      return e.backup.segundos === null ? ['sem-tempo'] : [];
    case 'restauracao': {
      const a: string[] = e.restauracao.segundos === null ? ['sem-tempo'] : [];
      return e.restauracao.integridadeOk === true ? a : [...a, 'integridade-nao-verificada'];
    }
    case 'contagens': {
      const c = e.contagens;
      const a: string[] = [];
      if (c.tabelas === 0) a.push('sem-tabelas');
      // O movimento posterior do Sante na cópia compartilhada (explicarContagensCopiaCompartilhada) não reprova.
      const posteriores = new Set(c.copiaMoveu ? c.posterioresSgh : []);
      if (c.diferentes.some((t) => !posteriores.has(t))) a.push('contagens-diferentes');
      if (c.ausentes.some((t) => !posteriores.has(t))) a.push('tabelas-ausentes');
      const [ra, rd] = posteriores.size
        ? [c.hashLegadoAntes, c.hashLegadoDepois]
        : [c.hashAntes, c.hashDepois];
      if (ra === null || ra !== rd) a.push('resumo-diferente');
      return a;
    }
    case 'objetos':
      return invalidosDaTroca(e.objetos.invalidosNaOrigem, e.objetos.invalidos).length > 0
        ? ['objetos-invalidos']
        : [];
    case 'funcoes-externas': {
      const f = e['funcoes-externas'];
      const a = f.funcoes
        .filter((x) => x.resolucaoProposta === 'pendente')
        .map((x) => `funcao-pendente:${x.nome}`);
      if (
        f.funcoes.some((x) => x.resolucaoProposta === 'habilitada-por-configuracao') &&
        !udfAccessLibera(f.udfAccess)
      )
        a.push('udf-access-fechado');
      return a;
    }
    case 'driver': {
      const d = e.driver;
      return d.conectou ? [] : ['sem-conexao'];
    }
    case 'schema': {
      const s = e.schema;
      const a: string[] = [];
      if (s.impressaoEnsaio === null) a.push('sem-impressao');
      if (s.impressaoHomologada === null) a.push('sem-homologada');
      const substituidas = e['funcoes-externas'].funcoes
        .filter((f) => f.resolucaoProposta === 'substituida')
        .map((f) => f.nome);
      return [...a, ...explicarDesvioSchema(s.diferencas, substituidas)];
    }
    case 'assinaturas':
      return e.assinaturas.operacoes === 0
        ? ['sem-operacoes']
        : e.assinaturas.diferencas > 0
          ? [
              'assinaturas-diferentes',
              ...e.assinaturas.gatilhosACorrigir.map((g) => `gatilho-a-corrigir:${g}`),
            ]
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
    case 'volta-atras':
      return e['volta-atras'].segundos === null ? ['sem-tempo'] : [];
    case 'restauracao-isolada':
      return e['restauracao-isolada'].integridadeOk === true ? [] : ['integridade-nao-verificada'];
  }
}

/**
 * Cada etapa avaliada: a situação do relatório vale só se os números a sustentam (falha fechada). Uma etapa
 * "aprovada" com achado vira "reprovada"; bloqueada e não executada ficam como estão, com os achados para a tela.
 */
export function avaliarEtapasEnsaio(r: RelatorioEnsaioFirebird5): EtapaEnsaioAvaliada[] {
  return ETAPAS_ENSAIO_FIREBIRD5.map((etapa) => {
    const x = r.etapas[etapa];
    const achados = teto(achadosDaEtapa(r.etapas, etapa));
    const situacao = x.situacao === 'aprovada' && achados.length > 0 ? 'reprovada' : x.situacao;
    return { etapa, situacao, bloqueio: x.bloqueio, achados: situacao === 'aprovada' ? [] : achados };
  });
}

/** Todas as etapas aprovadas (o ensaio pode ir ao registro como aprovado). */
export function ensaioAprovavel(etapas: readonly EtapaEnsaioAvaliada[]): boolean {
  return etapas.length === ETAPAS_ENSAIO_FIREBIRD5.length && etapas.every((e) => e.situacao === 'aprovada');
}

/** O relatório vazio de um hospital (todas as etapas não executadas): o ponto de partida do ensaio. */
export function relatorioEnsaioVazio(
  estabelecimento: string,
  em: string,
  origem: { versaoMotor: string; ods: string },
  alvo: { versaoMotor: string; ods: string },
): RelatorioEnsaioFirebird5 {
  const b = { situacao: 'nao-executada' as const, bloqueio: null, observacao: null };
  return {
    formato: 1,
    estabelecimento,
    em,
    origem,
    alvo,
    etapas: {
      backup: { ...b, segundos: null, bytes: null },
      restauracao: { ...b, segundos: null, integridadeOk: null, verificacaoSegundos: null },
      contagens: {
        ...b,
        segundos: null,
        tabelas: 0,
        iguais: 0,
        diferentes: [],
        ausentes: [],
        hashAntes: null,
        hashDepois: null,
        copiaMoveu: false,
        scriptsOrigem: 0,
        scriptsAlvo: 0,
        posterioresSgh: [],
        hashLegadoAntes: null,
        hashLegadoDepois: null,
      },
      objetos: { ...b, gatilhos: 0, procedures: 0, invalidos: [], invalidosNaOrigem: [] },
      'funcoes-externas': { ...b, udfAccess: 'None', funcoes: [] },
      driver: { ...b, conectou: false, autenticacao: null, canalCifrado: null },
      schema: { ...b, impressaoHomologada: null, impressaoEnsaio: null, diferencas: [] },
      assinaturas: {
        ...b,
        operacoes: 0,
        cenarios: 0,
        diferencas: 0,
        relatorio: null,
        iguaisAo3: 0,
        operacoesComDiferenca: [],
        gatilhosACorrigir: [],
      },
      carga: { ...b, slosAtendidos: null },
      'sante-api': { ...b, contratosQuebrados: null, referencia: null },
      parceiros: { ...b, alvos: [] },
      'volta-atras': { ...b, segundos: null },
      'restauracao-isolada': { ...b, integridadeOk: null },
    },
  };
}

/** A situação que os números sustentam para uma etapa medida pela obra (aprovada sem achado; senão reprovada). */
export function situacaoMedida(
  r: RelatorioEnsaioFirebird5,
  etapa: keyof EtapasRelatorioFirebird5,
): 'aprovada' | 'reprovada' {
  return achadosDaEtapa(r.etapas, etapa).length === 0 ? 'aprovada' : 'reprovada';
}
