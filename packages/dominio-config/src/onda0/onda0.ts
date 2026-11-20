// Onda 0: consultas ao vivo (ficha do M38). Regras puras, sem Nest, banco ou disco:
// - critério de aceite de `pnpm operacoes:estado` na onda (campo 11): só as gravações do campo 5 `liberada`, e só
//   nos hospitais em que a onda começou (DP-4: o pc primeiro);
// - lista da primeira liberação de todas (regra 1; cap-15 §15.3.2), cada item com a evidência;
// - escopo da onda pelo grupo do usuário (regra 3);
// - argumentos de `pnpm assinatura:vigiar -- --hospital=<pc|hs> --data=<AAAA-MM-DD>` (entrega 2);
// - amostra determinística do dia e o resumo da vigilância (SGH_CFG_COEX_VIGIA), sem valor de linha.
import {
  AREAS_CONFERENCIA_LEITURAS,
  type ConferenciaLeiturasOnda0,
  type Diferenca,
  type ElementoVigia,
  esquemaResultadoVigia,
  type EstadoOperacao,
  estadoEm,
  GRAVACOES_ONDA_0,
  GRUPOS_ONDA_0,
  ITENS_PRIMEIRA_LIBERACAO,
  type ItemPrimeiraLiberacao,
  OPERACOES_PERMITIDAS_ONDA_0,
  partesClasse,
  RE_CLASSE,
  type ResultadoVigia,
  type SondaImplantacao,
  SONDAS_IMPLANTACAO,
} from '@sgh/contratos';

/** O que a conferência precisa de cada operação do catálogo. */
export interface OperacaoNaOnda {
  readonly nome: string;
  readonly estado: EstadoOperacao | Readonly<Record<string, EstadoOperacao>>;
}

export interface EntradaEstadoOnda0 {
  readonly operacoes: readonly OperacaoNaOnda[];
  /** Estabelecimentos com cópia (ou produção) configurada. */
  readonly hospitais: readonly string[];
  /** Hospitais em que a onda 0 já começou (DP-4: só o pc até todas as ondas prontas nele). */
  readonly iniciados: readonly string[];
}

/**
 * Critério de aceite do campo 11: nenhuma operação de negócio `liberada`; nos hospitais em que a onda começou,
 * só as do campo 5, e as obrigatórias (a trilha dupla: sem trilha, sem dado) `liberada` neles; nos demais, nenhuma.
 * As condicionais (login) seguem "liberada ou fora (Desvios)" e não são exigidas. Estado único (sem mapa por
 * hospital) `liberada` vale para todos e, por isso, é recusado: a onda libera hospital a hospital.
 */
export function conferirEstadoOnda0(e: EntradaEstadoOnda0): string[] {
  const problemas: string[] = [];
  const iniciados = new Set(e.iniciados);
  for (const g of GRAVACOES_ONDA_0.filter((x) => !x.condicional)) {
    const op = e.operacoes.find((o) => o.nome === g.operacao);
    for (const h of e.iniciados) {
      const estado = op ? estadoEm(op, h) : null;
      if (estado !== 'liberada')
        problemas.push(
          `${g.operacao}: ${estado ?? 'fora do catálogo'} em ${h}, onde a onda 0 começou (a trilha dupla tem de estar liberada)`,
        );
    }
  }
  for (const op of e.operacoes) {
    if (typeof op.estado === 'string' && op.estado === 'liberada') {
      problemas.push(`${op.nome}: liberada sem estado por hospital (a onda libera hospital a hospital)`);
      continue;
    }
    for (const h of e.hospitais) {
      if (estadoEm(op, h) !== 'liberada') continue;
      if (!OPERACOES_PERMITIDAS_ONDA_0.includes(op.nome))
        problemas.push(`${op.nome}: operação de negócio liberada em ${h} (a onda 0 não grava negócio)`);
      else if (!iniciados.has(h)) problemas.push(`${op.nome}: liberada em ${h}, onde a onda 0 não começou`);
    }
  }
  return problemas;
}

/** Item marcado da lista: a evidência (caminho, linha do ESTADO.md ou registro), nunca segredo nem nome. */
export interface MarcaPrimeiraLiberacao {
  readonly evidencia: string;
  /** Data em que foi cumprido (AAAA-MM-DD). */
  readonly data: string;
}

export interface AvaliacaoPrimeiraLiberacao {
  readonly liberavel: boolean;
  readonly faltam: readonly ItemPrimeiraLiberacao[];
  /** Marcas que não valem (sem evidência ou data inválida). */
  readonly invalidas: readonly ItemPrimeiraLiberacao[];
}

/** Data de calendário AAAA-MM-DD real (rejeita 2026-02-30). */
export function dataValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Regra 1: a primeira liberação de todas só com todos os itens marcados, cada um com evidência e data. */
export function avaliarPrimeiraLiberacao(
  marcas: Readonly<Partial<Record<ItemPrimeiraLiberacao, MarcaPrimeiraLiberacao>>>,
): AvaliacaoPrimeiraLiberacao {
  const faltam: ItemPrimeiraLiberacao[] = [];
  const invalidas: ItemPrimeiraLiberacao[] = [];
  for (const item of ITENS_PRIMEIRA_LIBERACAO) {
    const m = marcas[item];
    if (!m) faltam.push(item);
    else if (m.evidencia.trim() === '' || !dataValida(m.data)) invalidas.push(item);
  }
  return { liberavel: faltam.length === 0 && invalidas.length === 0, faltam, invalidas };
}

/**
 * Regra 3: o usuário está no escopo da onda 0 pelo grupo do legado ou por um papel que o comitê mapeou a esses
 * grupos (diretoria, coordenação, NIR). A extensão a médicos e enfermagem é por chave, não por esta regra.
 */
export function noEscopoOnda0(grupo: string | null, papeisMapeados: readonly string[] = []): boolean {
  if (grupo !== null && (GRUPOS_ONDA_0 as readonly string[]).includes(grupo.trim().toUpperCase()))
    return true;
  return papeisMapeados.length > 0;
}

export const HOSPITAIS_VIGIA = ['pc', 'hs'] as const;

export type ArgumentosVigia =
  | { readonly ok: true; readonly hospital: (typeof HOSPITAIS_VIGIA)[number]; readonly data: string }
  | { readonly ok: false; readonly erro: string };

/**
 * `pnpm assinatura:vigiar -- --hospital=<pc|hs> --data=<AAAA-MM-DD>`: o dia tem de estar fechado (anterior a
 * `hoje`), e o hospital, entre os da Rede. Sem `--data`, não há padrão: o agendador da produção sempre informa.
 */
export function argumentosVigia(
  opcoes: Readonly<Record<string, string | undefined>>,
  hoje: string,
): ArgumentosVigia {
  const hospital = opcoes['hospital']?.trim() ?? '';
  const data = opcoes['data']?.trim() ?? '';
  if (!(HOSPITAIS_VIGIA as readonly string[]).includes(hospital))
    return { ok: false, erro: `--hospital deve ser ${HOSPITAIS_VIGIA.join(' ou ')}` };
  if (!dataValida(data)) return { ok: false, erro: '--data deve ser uma data AAAA-MM-DD' };
  if (data >= hoje) return { ok: false, erro: '--data deve ser um dia já fechado (anterior a hoje)' };
  return { ok: true, hospital: hospital as (typeof HOSPITAIS_VIGIA)[number], data };
}

/** FNV-1a de 32 bits: ordem estável da amostra, reproduzível pela TI com a mesma semente. */
function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Amostra determinística das gravações do dia: as `tamanho` de menor hash de `semente:id`. A semente é
 * `<hospital>:<data>:<operacao>`; a mesma entrada dá sempre a mesma amostra (reexecução e auditoria).
 */
export function amostrarGravacoes<T extends string | number | bigint>(
  ids: readonly T[],
  tamanho: number,
  semente: string,
): T[] {
  if (!Number.isInteger(tamanho) || tamanho < 0) throw new RangeError('tamanho da amostra inválido');
  const unicos = [...new Set(ids)];
  return unicos
    .map((id) => ({ id, h: fnv1a(`${semente}:${String(id)}`) }))
    .sort((a, b) => a.h - b.h || String(a.id).localeCompare(String(b.id)))
    .slice(0, tamanho)
    .map((x) => x.id);
}

const TABELA_ACAO = /^([A-Z][A-Z0-9_$]*):(?:INSERT|UPDATE|DELETE)/;
const NOME = /^[A-Z][A-Z0-9_$]{0,62}$/;

function tipoDaClasse(c: string): string | null {
  return RE_CLASSE.test(c) ? partesClasse(c).tipo : null;
}

/**
 * Elemento da diferença sem valor: tabela, coluna e o tipo da classe esperada (nunca o argumento: `constante:X`
 * vira `constante`, `dominio:A|B` vira `dominio`). Caminhos do comparador (tools/assinatura/src/comparador.ts):
 * `T`, `T:ACAO`, `T:ACAO.linhas`, `T:ACAO.colunas.C[.formato]`, `ligacoes.DE -> PARA`,
 * `efeitosTrigger.TRG:T:ACAO[.linhas]` e `generators.G` (o generator vai no lugar da tabela).
 */
export function elementoDaDiferenca(d: Diferenca): Omit<ElementoVigia, 'ocorrencias'> {
  const el = d.elemento;
  let tabela = 'DESCONHECIDO';
  let coluna: string | null = null;
  if (el.startsWith('ligacoes.')) tabela = el.slice('ligacoes.'.length).split(' -> ')[0]?.trim() ?? tabela;
  else if (el.startsWith('efeitosTrigger.'))
    tabela = el.slice('efeitosTrigger.'.length).split(':')[1] ?? tabela;
  else if (el.startsWith('generators.')) tabela = el.slice('generators.'.length);
  else {
    const m = TABELA_ACAO.exec(el);
    tabela = m?.[1] ?? el;
    const partes = el.split('.colunas.');
    if (partes.length === 2) coluna = (partes[1] ?? '').replace(/\.formato$/, '');
  }
  if (!NOME.test(tabela)) tabela = 'DESCONHECIDO';
  if (coluna !== null && !NOME.test(coluna)) coluna = null;
  const classe = d.tipo === 'classe' || d.tipo === 'colunas' ? tipoDaClasse(d.esperado) : null;
  return { tipo: d.tipo, tabela, coluna, classe };
}

export interface EntradaVigia {
  readonly hospital: string;
  readonly data: string;
  readonly operacao: string;
  /** Uma entrada por gravação amostrada: as diferenças do comparador contra a referência vigente. */
  readonly gravacoes: readonly (readonly Diferenca[])[];
}

/**
 * Resumo do dia de uma operação (linha de SGH_CFG_COEX_VIGIA): quantas amostradas, quantas divergiram (alguma
 * diferença não aceita) e os elementos que divergiram, com a contagem. Validado pelo contrato (sem valor).
 */
export function resumirVigia(e: EntradaVigia): ResultadoVigia {
  const contagem = new Map<string, { el: Omit<ElementoVigia, 'ocorrencias'>; n: number }>();
  let divergentes = 0;
  for (const difs of e.gravacoes) {
    const reais = difs.filter((d) => !d.aceita);
    if (reais.length === 0) continue;
    divergentes++;
    const vistos = new Set<string>();
    for (const d of reais) {
      const el = elementoDaDiferenca(d);
      const k = `${el.tipo}|${el.tabela}|${el.coluna ?? ''}|${el.classe ?? ''}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const atual = contagem.get(k);
      if (atual) atual.n++;
      else contagem.set(k, { el, n: 1 });
    }
  }
  const elementos = [...contagem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ ...v.el, ocorrencias: v.n }));
  return esquemaResultadoVigia.parse({
    hospital: e.hospital,
    data: e.data,
    operacao: e.operacao,
    amostradas: e.gravacoes.length,
    divergentes,
    elementos,
  });
}

/** Alerta direto do cap-14 §14.6 (divergência de assinatura): as linhas do dia com alguma divergência. */
export function alertasDaVigia(resultados: readonly ResultadoVigia[]): string[] {
  return resultados
    .filter((r) => r.divergentes > 0)
    .map(
      (r) =>
        `${r.hospital} ${r.data} ${r.operacao}: ${r.divergentes} de ${r.amostradas} gravação(ões) divergente(s) em ${r.elementos
          .map((x) => (x.coluna ? `${x.tabela}.${x.coluna}` : x.tabela))
          .join(', ')}`,
    );
}

/**
 * Sondas da implantação azul/verde (cap-14 §14.10.1): a versão nova só recebe tráfego com todas as sondas verdes.
 * Sonda que faltou conta como falha (a lista do contrato é a mínima).
 */
export function implantacaoPronta(
  resultados: readonly { readonly sonda: SondaImplantacao; readonly ok: boolean }[],
): boolean {
  return SONDAS_IMPLANTACAO.every((s) => resultados.some((r) => r.sonda === s && r.ok));
}

/**
 * Regra 6: a conferência de leitura vale com o NIR e a diretoria clínica entre os conferentes, o painel de leitos e o
 * prontuário conferidos, e "aceita" só com todas as leituras conformes. Devolve os problemas (vazio: vale).
 */
export function verificarConferenciaLeituras(r: ConferenciaLeiturasOnda0): string[] {
  const p: string[] = [];
  const areas = new Set(r.conferentes.map((c) => c.area.trim().toLowerCase()));
  for (const a of AREAS_CONFERENCIA_LEITURAS) if (!areas.has(a)) p.push(`falta a conferência da área ${a}`);
  const telas = new Set(r.leituras.map((l) => l.tela));
  for (const t of ['leitos', 'prontuario'] as const)
    if (!telas.has(t)) p.push(`falta a leitura da tela ${t}`);
  if (r.resultado === 'aceita' && r.leituras.some((l) => l.resultado === 'divergente'))
    p.push('aceita com leitura divergente');
  if (!dataValida(r.data)) p.push('data inválida');
  return p;
}
