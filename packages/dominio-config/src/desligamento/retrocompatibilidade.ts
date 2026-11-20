// Decisão sobre a retrocompatibilidade e plano de evolução do modelo (M59-F6; ficha, regras 1, 6, 11 e 12; ADR 0033).
// Puro: recebe o registro versionado, os fatos das outras etapas (fim do M43, passos do M58, contingência da DP-6) e o
// catálogo lido do banco; devolve as condições, a decisão vigente, os passos do plano e o inventário medido. Nada aqui
// muda o banco nem a decisão: a extinção é do dono, por ADR, e cada passo vira marco próprio.
import {
  type CondicaoAvaliada,
  type CondicaoExtincao,
  CONDICOES_EXTINCAO,
  type EstadoOperacao,
  ESTADOS_QUE_CUMPREM_RETIRADA,
  type EstadoRetiradaEsperado,
  FONTE_CONDICAO_EXTINCAO,
  type InventarioRetrocompatibilidade,
  type MedidaEvolucao,
  type MotivoBloqueioEvolucao,
  OPERACOES_DE_RETIRADA,
  type OperacaoDeRetirada,
  PASSOS_EVOLUCAO,
  type PassoEvolucaoAvaliado,
  PLANO_EVOLUCAO,
  type RegistroRetrocompatibilidade,
} from '@sgh/contratos';

/** O que as outras etapas registraram para o hospital (datas AAAA-MM-DD; null: não registrado). */
export interface FatosRetrocompatibilidade {
  /** O fim da coexistência registrado pelo dono (M43): a migração completa dos usuários. */
  readonly fimRegistradoEm: string | null;
  /** O passo "desligamento" do M58 executado pela TI. */
  readonly desligamentoExecutadoEm: string | null;
  /** A DP-6 decidida no registro do fim (M43). */
  readonly dp6DecididaEm: string | null;
  /** `legado.contingencia` do estabelecimento (ligado na dúvida: falha fechada). */
  readonly contingenciaLigada: boolean;
}

/** As quatro condições da extinção (regra 11; regra 1 e DP-6), na ordem do contrato. */
export function avaliarCondicoesExtincao(f: FatosRetrocompatibilidade): CondicaoAvaliada[] {
  const datas: Readonly<Record<CondicaoExtincao, string | null>> = {
    'fim-da-coexistencia-registrado': f.fimRegistradoEm,
    'outro-sistema-desligado': f.desligamentoExecutadoEm,
    'dp6-decidida': f.dp6DecididaEm,
    'contingencia-encerrada': null,
  };
  return CONDICOES_EXTINCAO.map((condicao) => ({
    condicao,
    cumprida: condicao === 'contingencia-encerrada' ? !f.contingenciaLigada : datas[condicao] !== null,
    em: datas[condicao],
    fonte: FONTE_CONDICAO_EXTINCAO[condicao],
  }));
}

export interface DecisaoAvaliada {
  readonly vigente: 'mantida' | 'extinta';
  /** A extinção registrada que não vale, com as condições que faltam. */
  readonly extincaoSemCondicoes: CondicaoExtincao[];
}

/** A decisão que vale: extinta só com a decisão do dono E as quatro condições; o resto é "mantida". */
export function decisaoVigente(
  r: RegistroRetrocompatibilidade,
  condicoes: readonly CondicaoAvaliada[],
): DecisaoAvaliada {
  if (r.decisao.situacao !== 'extinta') return { vigente: 'mantida', extincaoSemCondicoes: [] };
  const faltam = condicoes.filter((c) => !c.cumprida).map((c) => c.condicao);
  return faltam.length > 0
    ? { vigente: 'mantida', extincaoSemCondicoes: faltam }
    : { vigente: 'extinta', extincaoSemCondicoes: [] };
}

/** O tamanho de cada passo no inventário (null sem medida). */
export function tamanhoDoPasso(
  medida: MedidaEvolucao,
  inv: InventarioRetrocompatibilidade | null,
): number | null {
  if (!inv) return null;
  switch (medida) {
    case 'tabelas-clinicas':
      return inv.tabelasClinicas.presentes;
    case 'gatilhos':
      return inv.gatilhos.ativos;
    case 'colunas-de-uma-letra':
      return inv.colunasDeUmaLetra.colunas;
    case 'pares-data-hora':
      return inv.paresDataHora.pares;
    case 'chaves-em-texto':
      return inv.chavesEmTexto.chaves;
  }
}

/**
 * Os cinco passos avaliados na ordem. Um passo só fica pronto para o dono autorizar com a retrocompatibilidade extinta
 * (vigente), o anterior executado, a ficha escrita, o combinado com a Hal-AI quando muda o que a sante-api lê (regra 12)
 * e a regressão aprovada. Executado continua executado.
 */
export function avaliarPassosEvolucao(
  r: RegistroRetrocompatibilidade,
  vigente: 'mantida' | 'extinta',
  inv: InventarioRetrocompatibilidade | null,
): PassoEvolucaoAvaliado[] {
  return PLANO_EVOLUCAO.map((d, i) => {
    const x = r.passos[d.passo];
    const base = {
      passo: d.passo,
      ordem: d.ordem,
      titulo: d.titulo,
      descricao: d.descricao,
      medida: d.medida,
      tamanho: tamanhoDoPasso(d.medida, inv),
      mudaLeituraSanteApi: d.mudaLeituraSanteApi,
      ficha: x.ficha,
    };
    if (x.execucao) return { ...base, situacao: 'executado' as const, motivos: [] };
    const m: MotivoBloqueioEvolucao[] = [];
    if (vigente !== 'extinta') m.push('retrocompatibilidade-nao-extinta');
    const anterior = i > 0 ? PASSOS_EVOLUCAO[i - 1] : undefined;
    if (anterior && !r.passos[anterior].execucao) m.push('passo-anterior-pendente');
    if (!x.ficha) m.push('sem-ficha');
    if (d.mudaLeituraSanteApi && !x.combinadoHalAi) m.push('sem-combinado-hal-ai');
    if (x.regressao?.resultado !== 'aprovado') m.push('regressao-nao-aprovada');
    if (m.length > 0) return { ...base, situacao: 'bloqueado' as const, motivos: m };
    return {
      ...base,
      situacao: x.autorizacao ? ('autorizado' as const) : ('pronto-para-autorizar' as const),
      motivos: [],
    };
  });
}

/**
 * O estado esperado das operações que retiram o que o outro sistema lê (ficha, seção 5): "especificada" se o dono
 * manteve a retrocompatibilidade com contingência longa; "verde" no resto (elas já recusam com a contingência ligada).
 * Compara com o estado declarado no catálogo de operações (`estadoAtual`; null: sem leitura, que conta como
 * divergência, falha fechada) para o painel avisar quando o catálogo não acompanha a decisão.
 */
export function estadoEsperadoRetiradas(
  r: RegistroRetrocompatibilidade,
  estadoAtual: (operacao: OperacaoDeRetirada) => EstadoOperacao | null = () => null,
): {
  operacao: OperacaoDeRetirada;
  estadoEsperado: EstadoRetiradaEsperado;
  estadoAtual: EstadoOperacao | null;
  divergente: boolean;
}[] {
  const longa = r.decisao.situacao === 'mantida' && r.decisao.contingenciaLonga;
  return OPERACOES_DE_RETIRADA.map((operacao) => {
    const estadoEsperado: EstadoRetiradaEsperado = longa ? 'especificada' : 'verde';
    let atual: EstadoOperacao | null;
    try {
      atual = estadoAtual(operacao);
    } catch {
      atual = null;
    }
    return {
      operacao,
      estadoEsperado,
      estadoAtual: atual,
      divergente: atual === null || !ESTADOS_QUE_CUMPREM_RETIRADA[estadoEsperado].includes(atual),
    };
  });
}

// ── Inventário pelo catálogo ─────────────────────────────────────────────────────────────────────────────────

/** Uma coluna que interessa ao plano: de uma letra (CHAR/VARCHAR de 1), de data (DATE, ou TIMESTAMP com data e sem hora no nome) ou de hora. */
export interface ColunaCatalogoRetro {
  readonly tabela: string;
  readonly coluna: string;
  readonly classe: 'letra' | 'data' | 'hora';
}

export interface GatilhoCatalogoRetro {
  readonly nome: string;
  readonly tabela: string;
  readonly ativo: boolean;
}

/** Um segmento de chave estrangeira com o tipo da coluna (texto: CHAR ou VARCHAR). */
export interface SegmentoChaveRetro {
  readonly restricao: string;
  readonly tabela: string;
  readonly texto: boolean;
}

export interface CatalogoRetro {
  /** As tabelas do usuário (sem as do motor), com as SGH_. */
  readonly tabelas: readonly string[];
  readonly colunas: readonly ColunaCatalogoRetro[];
  readonly gatilhos: readonly GatilhoCatalogoRetro[];
  readonly chaves: readonly SegmentoChaveRetro[];
}

const ehSgh = (t: string) => t.toUpperCase().startsWith('SGH_');

/**
 * Mede o plano no banco: só as tabelas do outro sistema contam (as SGH_ já nascem no modelo novo). Pares de data e
 * hora: por tabela, o menor entre as colunas de data e as de hora (estimativa; a ficha de cada passo lista os pares
 * pelo nome). Chaves em texto: as chaves estrangeiras declaradas com algum segmento em texto (as não declaradas, que o
 * outro sistema usa sem restrição, entram na ficha do passo 5 pela matriz).
 */
export function medirInventarioRetrocompatibilidade(
  c: CatalogoRetro,
  tabelasClinicas: readonly string[],
): InventarioRetrocompatibilidade {
  const legadas = new Set(c.tabelas.filter((t) => !ehSgh(t)).map((t) => t.toUpperCase()));
  const legada = (t: string) => legadas.has(t.toUpperCase());

  const gat = c.gatilhos.filter((g) => legada(g.tabela));
  const letras = c.colunas.filter((x) => x.classe === 'letra' && legada(x.tabela));

  const porTabela = new Map<string, { d: number; h: number }>();
  for (const x of c.colunas) {
    if (!legada(x.tabela) || x.classe === 'letra') continue;
    const k = x.tabela.toUpperCase();
    const v = porTabela.get(k) ?? { d: 0, h: 0 };
    if (x.classe === 'data') v.d += 1;
    else v.h += 1;
    porTabela.set(k, v);
  }
  let pares = 0;
  let tabelasPares = 0;
  for (const v of porTabela.values()) {
    const n = Math.min(v.d, v.h);
    pares += n;
    if (n > 0) tabelasPares += 1;
  }

  const restricoes = new Map<string, { tabela: string; texto: boolean }>();
  for (const s of c.chaves) {
    if (!legada(s.tabela)) continue;
    const v = restricoes.get(s.restricao) ?? { tabela: s.tabela.toUpperCase(), texto: false };
    v.texto = v.texto || s.texto;
    restricoes.set(s.restricao, v);
  }
  const emTexto = [...restricoes.values()].filter((v) => v.texto);

  return {
    tabelas: legadas.size,
    gatilhos: {
      total: gat.length,
      ativos: gat.filter((g) => g.ativo).length,
      tabelas: new Set(gat.map((g) => g.tabela.toUpperCase())).size,
    },
    colunasDeUmaLetra: {
      colunas: letras.length,
      tabelas: new Set(letras.map((x) => x.tabela.toUpperCase())).size,
    },
    paresDataHora: { pares, tabelas: tabelasPares },
    chavesEmTexto: {
      chaves: emTexto.length,
      deTotal: restricoes.size,
      tabelas: new Set(emTexto.map((v) => v.tabela)).size,
    },
    tabelasClinicas: {
      matriz: tabelasClinicas.length,
      presentes: tabelasClinicas.filter((t) => legada(t)).length,
    },
    gatilhosSghEmTabelaLegada: gat.filter((g) => ehSgh(g.nome)).length,
  };
}
