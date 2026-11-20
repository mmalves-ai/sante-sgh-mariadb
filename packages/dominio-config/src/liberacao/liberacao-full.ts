// Liberação full na instalação (M61; decisão do dono de 30/10/2026; ADR 0034): o planejamento puro do comando
// `pnpm liberacao:ligar-tudo`. Por chave, a linha do estabelecimento (`hospital`/'*') passa a ligada; as linhas de setor,
// grupo ou pessoa DESLIGADAS passam a herdar (null, com o antes guardado: o lote é reversível); as ligadas e as que já
// herdam ficam. Quem usa cada função continua decidido pelas permissões por login (M06), que este plano não toca.
// As chaves são as de RECURSOS_DESLIGADOS (tipo recurso) e as do catálogo de operações (tipo operacao; gravadas por
// paridade: o executor só as lê em produção, com o catálogo `liberada`, que este plano não promove), menos as listas de
// exceção versionadas em @sgh/contratos (liberacao-full.ts).
import {
  DECISAO_DO_DONO_EM_PRODUCAO,
  ehAmbienteDaObra,
  MARCA_LIBERACAO_FULL,
  NUNCA_LIGAR_EM_MASSA,
  type PrerequisitoDeclarado,
  SEM_ENVIO_NO_DEV,
  TETO_LINHAS_LIBERACAO_FULL,
  type TipoPrerequisito,
} from '@sgh/contratos';
import type { ChaveAtual, MudancaLote } from './lote.js';
import { faltasDoRecurso, type PrerequisitoRegistrado } from './prerequisito-chave.js';

export type TipoChaveFull = 'recurso' | 'operacao';

export interface ChaveFull {
  readonly tipo: TipoChaveFull;
  readonly chave: string;
}

export type ListaExclusaoFull = 'nunca-em-massa' | 'sem-envio-no-dev' | 'decisao-do-dono';

export interface ChaveExcluidaFull extends ChaveFull {
  readonly lista: ListaExclusaoFull;
  readonly motivo: string;
}

export interface ClassificacaoFull {
  readonly ligar: readonly ChaveFull[];
  readonly excluidas: readonly ChaveExcluidaFull[];
  /** As da decisão do dono pedidas por `--incluir` (só fora de dev/ci, com a referência). */
  readonly incluidas: readonly string[];
}

export class ErroLiberacaoFull extends Error {
  override readonly name = 'ErroLiberacaoFull';
}

/** O plano por chave: liga a do estabelecimento; as específicas desligadas passam a herdar. */
export function planejarLigarTudo(atuais: readonly ChaveAtual[]): MudancaLote[] {
  const r: MudancaLote[] = [];
  const doEstabelecimento = atuais.find((c) => c.escopo === 'hospital' && c.valor === '*');
  if (doEstabelecimento?.ligada !== true)
    r.push({ escopo: 'hospital', valor: '*', ligada: true, antes: doEstabelecimento?.ligada ?? null });
  for (const c of atuais) {
    if (c.escopo === 'hospital' || c.ligada !== false) continue;
    r.push({ escopo: c.escopo, valor: c.valor, ligada: null, antes: false });
  }
  return r;
}

/**
 * Separa as chaves a ligar das excluídas pelas listas: as que nunca ligam em massa (todo ambiente), as que mandam
 * mensagem ou e-mail a pessoa (dev/ci) e as de efeito externo real (fora de dev/ci, salvo `--incluir`).
 */
export function classificarChavesFull(p: {
  readonly ambiente: string;
  readonly recursos: readonly string[];
  readonly operacoes: readonly string[];
  readonly incluir?: readonly string[];
}): ClassificacaoFull {
  const obra = ehAmbienteDaObra(p.ambiente);
  const incluir = [...new Set((p.incluir ?? []).map((x) => x.trim()).filter(Boolean))];
  const daDecisao = new Map(DECISAO_DO_DONO_EM_PRODUCAO.map((e) => [e.chave, e.motivo]));
  if (incluir.length && obra)
    throw new ErroLiberacaoFull('--incluir só vale fora de dev/ci: no dev as listas valem sem exceção.');
  for (const c of incluir)
    if (!daDecisao.has(c))
      throw new ErroLiberacaoFull(
        `--incluir=${c.slice(0, 60)}: só as chaves da lista de decisão do dono em produção podem ser incluídas.`,
      );
  const nunca = new Map(NUNCA_LIGAR_EM_MASSA.map((e) => [e.chave, e.motivo]));
  const semEnvio = new Map(SEM_ENVIO_NO_DEV.map((e) => [e.chave, e.motivo]));
  const ligar: ChaveFull[] = [];
  const excluidas: ChaveExcluidaFull[] = [];
  const todas: ChaveFull[] = [
    ...[...new Set(p.recursos)].map((chave) => ({ tipo: 'recurso' as const, chave })),
    ...[...new Set(p.operacoes)].map((chave) => ({ tipo: 'operacao' as const, chave })),
  ];
  for (const c of todas) {
    const m1 = nunca.get(c.chave);
    const m2 = obra ? semEnvio.get(c.chave) : undefined;
    const m3 = !obra && !incluir.includes(c.chave) ? daDecisao.get(c.chave) : undefined;
    if (m1) excluidas.push({ ...c, lista: 'nunca-em-massa', motivo: m1 });
    else if (m2) excluidas.push({ ...c, lista: 'sem-envio-no-dev', motivo: m2 });
    else if (m3) excluidas.push({ ...c, lista: 'decisao-do-dono', motivo: m3 });
    else ligar.push(c);
  }
  return { ligar, excluidas, incluidas: incluir };
}

export interface PrerequisitoFull {
  readonly recurso: string;
  readonly tipo: TipoPrerequisito;
}

export interface PlanoPrerequisitosFull {
  /** Registrar como `dispensado` (com a referência e a marca na evidência). */
  readonly dispensar: readonly PrerequisitoFull[];
  /** Ficam pendentes (contrato, certificado ou credenciamento fora de dev/ci): o relatório lista. */
  readonly pendentes: readonly (PrerequisitoFull & { readonly motivo: string })[];
  /** Já cumpridos (na validade) ou dispensados. */
  readonly emDia: number;
}

/**
 * Pré-requisitos dos recursos a ligar: a aprovação de setor (do plano gradual abolido) vira `dispensado` em todo
 * ambiente; contrato, certificado e credenciamento, só em dev/ci (com a autorização de 30/10/2026). Fora de dev/ci,
 * esses três nunca se dispensam pelo comando: ficam pendentes no relatório (quem providencia registra na tela).
 */
export function planejarPrerequisitosFull(p: {
  readonly ambiente: string;
  readonly recursos: readonly {
    readonly chave: string;
    readonly prerequisitos: readonly PrerequisitoDeclarado[];
  }[];
  readonly registrados: readonly (PrerequisitoRegistrado & { readonly recurso: string })[];
  readonly agora: Date;
}): PlanoPrerequisitosFull {
  const obra = ehAmbienteDaObra(p.ambiente);
  const dispensar: PrerequisitoFull[] = [];
  const pendentes: (PrerequisitoFull & { motivo: string })[] = [];
  let emDia = 0;
  for (const r of p.recursos) {
    const tipos = [...new Set(r.prerequisitos.map((d) => d.tipo))];
    const faltas = faltasDoRecurso(
      r.prerequisitos,
      p.registrados.filter((x) => x.recurso === r.chave),
      p.agora,
    );
    const faltam = new Set(faltas.map((f) => f.tipo));
    for (const tipo of tipos) {
      if (!faltam.has(tipo)) emDia++;
      else if (tipo === 'aprovacao' || obra) dispensar.push({ recurso: r.chave, tipo });
      else
        pendentes.push({
          recurso: r.chave,
          tipo,
          motivo: `${tipo} não se dispensa pelo comando fora de dev/ci: registre o cumprimento (com validade) na tela de chaves`,
        });
    }
  }
  return { dispensar, pendentes, emDia };
}

/** O registro do pré-requisito antes da dispensa (null: sem registro). */
export interface PrerequisitoAntesFull {
  readonly situacao: 'pendente' | 'cumprido' | 'dispensado';
  readonly validade: string | null;
  readonly evidencia: string | null;
}

const TETO_EVIDENCIA = 200;
const RE_DISPENSA_FULL = new RegExp(
  `^${MARCA_LIBERACAO_FULL} \\d{4}-\\d{2}-\\d{2}; antes: (nenhum|pendente|cumprido|dispensado)(?: até (\\d{4}-\\d{2}-\\d{2}))?(?:; evidência anterior \\[(\\d{1,3})\\]: )?`,
);

/**
 * A evidência da dispensa feita pelo comando: a marca, o estado de antes (situação e validade, sempre inteiros), a
 * evidência de antes (com o tamanho, para a reversão a recuperar; cortada com "…" se não couber) e a referência da
 * autorização no espaço que sobrar (a coluna tem 200 caracteres). A reversão devolve o registro a esse estado.
 */
export function evidenciaDispensaFull(
  dia: string,
  referencia: string | null,
  antes: PrerequisitoAntesFull | null,
): string {
  const estado = antes
    ? `${antes.situacao}${antes.situacao === 'cumprido' && antes.validade ? ` até ${antes.validade}` : ''}`
    : 'nenhum';
  const cabeca = `${MARCA_LIBERACAO_FULL} ${dia}; antes: ${estado}`;
  const autorizacao = `; autorização: ${referencia ?? '—'}`;
  const ev = antes?.evidencia ?? '';
  if (!ev) return `${cabeca}${autorizacao}`.slice(0, TETO_EVIDENCIA);
  // Cabe a evidência inteira e ao menos o começo da referência? Senão, a evidência é cortada (com "…").
  const rotulo = (n: number) => `; evidência anterior [${n}]: `;
  const livre = TETO_EVIDENCIA - cabeca.length - rotulo(999).length - '; autorização: '.length - 20;
  const guardada = ev.length <= livre ? ev : `${ev.slice(0, Math.max(0, livre - 1))}…`;
  return `${cabeca}${rotulo(guardada.length)}${guardada}${autorizacao}`.slice(0, TETO_EVIDENCIA);
}

/**
 * O estado de antes guardado na evidência da dispensa (`evidenciaDispensaFull`): `undefined` quando a evidência não é
 * desse formato (dispensa anterior a ele, ou de outra origem); `null` quando não havia registro.
 */
export function anteriorDaDispensaFull(evidencia: string | null): PrerequisitoAntesFull | null | undefined {
  const m = RE_DISPENSA_FULL.exec(evidencia ?? '');
  if (!m) return undefined;
  const situacao = m[1] as 'nenhum' | PrerequisitoAntesFull['situacao'];
  if (situacao === 'nenhum') return null;
  const n = m[3] === undefined ? 0 : Number(m[3]);
  const texto = (evidencia ?? '').slice(m[0].length, m[0].length + n);
  return { situacao, validade: m[2] ?? null, evidencia: n > 0 ? texto : null };
}

/** A justificativa do lote (com a marca que a reversão procura; a coluna tem 200 caracteres). */
export function justificativaLiberacaoFull(dia: string, extra: string | null = null): string {
  return `${MARCA_LIBERACAO_FULL} ${dia}: liberação full na instalação (decisão do dono de 30/10/2026; ADR 0034)${extra ? `; ${extra}` : ''}`.slice(
    0,
    200,
  );
}

export const ehLoteLiberacaoFull = (justificativa: string | null | undefined): boolean =>
  (justificativa ?? '').startsWith(`${MARCA_LIBERACAO_FULL} `);

export interface LinhaDeLote {
  readonly tipo: TipoChaveFull;
  readonly chave: string;
  readonly lote: string | null;
  readonly justificativa: string | null;
}

/** Os lotes do comando a reverter, do mais novo ao mais antigo (a reversão recusa lote mexido por um posterior). */
export function lotesParaReverter(linhas: readonly LinhaDeLote[]): (ChaveFull & { readonly lote: string })[] {
  const vistos = new Map<string, ChaveFull & { lote: string }>();
  for (const l of linhas)
    if (l.lote && ehLoteLiberacaoFull(l.justificativa) && !vistos.has(l.lote))
      vistos.set(l.lote, { tipo: l.tipo, chave: l.chave, lote: l.lote });
  return [...vistos.values()].sort((a, b) => {
    const x = BigInt(a.lote);
    const y = BigInt(b.lote);
    return x > y ? -1 : x < y ? 1 : 0;
  });
}

/** O comando recusa o estabelecimento com linhas demais (a leitura das chaves corta em 5000). */
export function recusaPorLinhas(linhas: number, novas: number): string | null {
  const total = linhas + novas;
  return total > TETO_LINHAS_LIBERACAO_FULL
    ? `o estabelecimento ficaria com ${total} linhas de chave (teto ${TETO_LINHAS_LIBERACAO_FULL}; a leitura corta em 5000): limpe as linhas que só herdam antes`
    : null;
}
