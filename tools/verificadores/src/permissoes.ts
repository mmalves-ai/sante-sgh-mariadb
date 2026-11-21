// pnpm permissoes:verificar [-- --hospital=<cod|todos>] [--atualizar] (ficha do M06, regra 11 e critérios)
// 1. catálogo: o catálogo-base do produto cobre o que a árvore do menu de origem gera (retrato), e o mapa do conector
//    (conector/mapa/permissoes.tsv, ADR 0007 item 8) liga cada opção à permissão; códigos no formato, sem repetição,
//    toda permissão tem linha no mapa ou concessão por perfil, e toda linha do mapa aponta permissão que existe;
// 2. rotas: todo handler da API tem @Permissao (ou @Publica, comentada) e toda rota da tela tem
//    meta.permissao (ou publica); toda permissão citada existe no catálogo; o menu só aponta permissão real;
// 3. prova dos 42 grupos: para cada grupo com permissões, opções do legado × permissões do novo, 0 diferença
//    não justificada (relatório só com nome do grupo e contagens), nos estabelecimentos configurados;
// 4. mapa dos grupos: todo grupo do legado tem destino (perfil, legado, painel ou caso a caso).
// Fonte: a cópia ao vivo quando há cópia em loopback (AMBIENTE=dev); senão (CI, clone), o retrato versionado
// em tools/verificadores/dados. `--atualizar` refaz o retrato da cópia; `--retrato` usa só
// o retrato (o `pnpm verificar` roda assim).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CATALOGO_DECLARADO,
  ARVORE_MENU,
  DOMINIOS_DECLARADOS,
  type DeclaracaoPermissao,
  FORMATO_CODIGO_PERMISSAO,
} from '@sgh/contratos';
import { CATALOGO_BASE } from '@sgh/contratos/catalogo-base';
import {
  chaveGrupo,
  conceder,
  construirCatalogo,
  type CorrespondenciaOrigem,
  indexarCatalogo,
  escoposDaPermissao,
  lerMapaOrigem,
  MAPA_GRUPOS,
  provarGrupos,
  type CatalogoGerado,
} from '@sgh/dominio-acesso';
import { lerArgumentos } from './argumentos.ts';
import { codigosDaCopia, retratarDaCopia } from './permissoes-copia.ts';
import { gravarRetrato, lerRetrato, type RetratoAcessoLegado } from './permissoes-dados.ts';

const raiz = resolve(import.meta.dirname, '../../..');

/** Mapa do conector: opção do menu e marca de usuário de origem → permissão do produto (ADR 0007, item 8). */
export const ARQUIVO_MAPA_ORIGEM = resolve(raiz, 'conector/mapa/permissoes.tsv');

export function lerMapaDoConector(arquivo: string = ARQUIVO_MAPA_ORIGEM): CorrespondenciaOrigem[] {
  return existsSync(arquivo) ? lerMapaOrigem(readFileSync(arquivo, 'utf8')) : [];
}

/**
 * Renomeações de código (F2.4, padrão de permissão em docs/obra/fatias/f24/saida/padroes.md): o código gerado do menu
 * de origem que trazia nome de tabela ou do sistema de origem ganha nome de negócio. O dado fica no mapa do conector
 * (conector/mapa/permissoes-renomeadas.tsv), que também alimenta a migração dos perfis gravados
 * (tools/db/migrar_codigos_permissao.py).
 */
export const ARQUIVO_RENOMEACOES = resolve(raiz, 'conector/mapa/permissoes-renomeadas.tsv');

export function lerRenomeacoes(
  arquivo: string = ARQUIVO_RENOMEACOES,
): ReadonlyMap<string, { readonly codigo: string; readonly descricao: string }> {
  const m = new Map<string, { codigo: string; descricao: string }>();
  if (!existsSync(arquivo)) return m;
  for (const l of readFileSync(arquivo, 'utf8').split('\n').slice(1)) {
    const [antigo, novo, descricao] = l.split('\t');
    if (antigo && novo && descricao) m.set(antigo, { codigo: novo, descricao });
  }
  return m;
}

/**
 * O catálogo gerado da árvore do menu de origem (retrato) está coberto: cada código gerado (com a renomeação do mapa)
 * existe no catálogo-base e cada opção dele tem a linha correspondente no mapa do conector.
 */
export function conferirOrigem(
  c: CatalogoGerado,
  base: readonly DeclaracaoPermissao[],
  mapa: readonly CorrespondenciaOrigem[],
  renomeacoes: ReturnType<typeof lerRenomeacoes> = lerRenomeacoes(),
): Achado[] {
  const achados: Achado[] = [];
  const codigos = new Set(base.map((p) => p.codigo));
  const linhas = new Set(
    mapa.filter((m) => m.tipo === 'opcao_menu').map((m) => `${m.chave}\t${m.permissao}`),
  );
  for (const p of c.permissoes) {
    const codigo = renomeacoes.get(p.codigo)?.codigo ?? p.codigo;
    if (!codigos.has(codigo))
      achados.push({
        regra: 'catalogo-desatualizado',
        detalhe: `${codigo}: gerado do menu de origem e fora do catálogo-base`,
      });
    const faltam = p.opcoesLegado.filter((o) => !linhas.has(`${o}\t${codigo}`));
    if (faltam.length > 0)
      achados.push({
        regra: 'mapa-desatualizado',
        detalhe: `${codigo}: ${faltam.length} opção(ões) do menu sem linha no mapa`,
      });
  }
  return achados;
}

/** Mapa da prova: as opções do catálogo gerado (códigos antes da renomeação) mais as do mapa para as declaradas. */
export function mapaDaProva(
  c: CatalogoGerado,
  mapa: readonly CorrespondenciaOrigem[] = lerMapaDoConector(),
): CorrespondenciaOrigem[] {
  const declaradas = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
  return [
    ...c.permissoes.flatMap((p) =>
      p.opcoesLegado.map((o) => ({ tipo: 'opcao_menu' as const, chave: String(o), permissao: p.codigo })),
    ),
    ...mapa.filter((m) => declaradas.has(m.permissao)),
  ];
}

export interface Achado {
  readonly regra: string;
  readonly detalhe: string;
}

/**
 * Regra 11 (catálogo): formato, repetição e fonte de concessão de cada permissão. A fonte é a linha do mapa do
 * conector (opção do menu ou marca de usuário de origem) ou a concessão por perfil; linha do mapa que aponta
 * permissão fora do catálogo também reprova.
 */
export function conferirCatalogo(
  catalogo: readonly DeclaracaoPermissao[],
  mapa: readonly CorrespondenciaOrigem[] = lerMapaDoConector(),
): Achado[] {
  const achados: Achado[] = [];
  const vistos = new Set<string>();
  const comOrigem = new Set(mapa.map((m) => m.permissao));
  for (const p of catalogo) {
    if (!FORMATO_CODIGO_PERMISSAO.test(p.codigo))
      achados.push({ regra: 'formato', detalhe: `${p.codigo}: fora de modulo.recurso.acao` });
    if (vistos.has(p.codigo)) achados.push({ regra: 'repetida', detalhe: p.codigo });
    vistos.add(p.codigo);
    if (!comOrigem.has(p.codigo) && p.concessaoPorPerfil === null)
      achados.push({
        regra: 'sem-mapeamento',
        detalhe: `${p.codigo}: sem linha no mapa do conector nem concessão por perfil`,
      });
    if (p.concessaoPorPerfil === 'por-perfil' && (p.perfis ?? []).length === 0)
      achados.push({ regra: 'sem-mapeamento', detalhe: `${p.codigo}: por perfil sem perfil` });
    const esperados = [...escoposDaPermissao(p.codigo)].sort().join(',');
    if (p.escopos && [...p.escopos].sort().join(',') !== esperados)
      achados.push({ regra: 'escopos', detalhe: `${p.codigo}: escopos diferentes dos do módulo` });
  }
  const orfas = [...comOrigem].filter((c) => !vistos.has(c)).sort();
  for (const c of orfas)
    achados.push({
      regra: 'mapa-orfao',
      detalhe: `${c}: linha do mapa do conector sem permissão no catálogo`,
    });
  return achados;
}

function arquivos(pasta: string, filtro: (f: string) => boolean): string[] {
  if (!existsSync(pasta)) return [];
  const r: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const p = join(pasta, nome);
    if (nome === 'node_modules' || nome === 'dist') continue;
    if (statSync(p).isDirectory()) r.push(...arquivos(p, filtro));
    else if (filtro(p)) r.push(p);
  }
  return r.sort();
}

const METODO_HTTP = /^\s*@(Get|Post|Put|Patch|Delete|All)\(/;
const DECORADOR = /^\s*@[A-Za-z]+\(/;

/**
 * Regra 11 (API): todo método HTTP de controlador tem @Permissao('codigo') ou @Publica('motivo') entre os
 * seus decoradores (ou na classe). Devolve os achados e as permissões citadas.
 */
export function conferirControlador(
  caminho: string,
  texto: string,
): { achados: Achado[]; citadas: string[] } {
  const linhas = texto.split('\n');
  const achados: Achado[] = [];
  const citadas: string[] = [];
  const iClasse = linhas.findIndex((l) => /^\s*@Controller\(/.test(l));
  if (iClasse < 0) return { achados, citadas };
  // Decoradores da classe: as linhas acima de @Controller até o fim do membro anterior (import, comentário).
  let classe = '';
  for (let i = iClasse - 1; i >= 0 && !/[;}]\s*$/.test(linhas[i] ?? ''); i--) classe += `${linhas[i]}\n`;
  for (let i = iClasse; i < linhas.length && !/\bclass\s/.test(linhas[i] ?? ''); i++)
    classe += `${linhas[i]}\n`;
  for (let i = 0; i < linhas.length; i++) {
    if (!METODO_HTTP.test(linhas[i] ?? '')) continue;
    // Bloco do método: para cima até o fim do membro anterior; para baixo até a assinatura do método.
    let bloco = '';
    for (let j = i - 1; j > iClasse && !/[;{}]\s*$/.test(linhas[j] ?? ''); j--)
      bloco = `${linhas[j]}\n${bloco}`;
    for (let k = i; k < linhas.length; k++) {
      bloco += `${linhas[k]}\n`;
      if (
        /^\s*(?:async\s+)?[a-zA-Z_$][\w$]*\s*[(<]/.test(linhas[k] ?? '') &&
        !DECORADOR.test(linhas[k] ?? '')
      )
        break;
    }
    const todos = `${classe}\n${bloco}`;
    for (const m of todos.matchAll(/@Permissao\(\s*['"`]([^'"`]+)['"`]/g)) if (m[1]) citadas.push(m[1]);
    for (const m of todos.matchAll(/@Permissao\(\s*PERMISSOES_[A-Z_]+\.([a-zA-Z]+)/g))
      if (m[1]) citadas.push(`@${m[1]}`);
    if (!/@Permissao\(/.test(todos) && !/@Publica\(/.test(todos)) {
      achados.push({
        regra: 'rota-sem-permissao',
        detalhe: `${relative(raiz, caminho)}:${i + 1} ${(linhas[i] ?? '').trim()}`,
      });
    }
    // Regra 11 ("em toda ação"): handler com @Permissao que muda estado registra o evento nas trilhas, pelo
    // @Auditar ou na própria transação (@AuditadoNoHandler, com o motivo).
    if (
      /^\s*@(Post|Put|Patch|Delete)\(/.test(linhas[i] ?? '') &&
      /@Permissao\(/.test(todos) &&
      !/@Auditar\(/.test(todos) &&
      !/@AuditadoNoHandler\(/.test(todos)
    ) {
      achados.push({
        regra: 'acao-sem-auditoria',
        detalhe: `${relative(raiz, caminho)}:${i + 1} ${(linhas[i] ?? '').trim()}`,
      });
    }
  }
  return { achados, citadas };
}

/** Regra 11 (tela): todo objeto de rota com `path` e `component` tem meta.permissao ou meta.publica. */
export function conferirRotasTela(caminho: string, texto: string): { achados: Achado[]; citadas: string[] } {
  const achados: Achado[] = [];
  const citadas: string[] = [];
  const blocos = texto.split(/\n\s*\{\s*\n|\{\s*path:/).slice(1);
  for (const b of blocos) {
    const corpo = b.split(/\n\s*\},?\s*\n/)[0] ?? '';
    if (!/component:/.test(corpo) || /redirect:/.test(corpo)) continue;
    const m = /permissao:\s*['"`]([^'"`]+)['"`]/.exec(corpo);
    if (m?.[1]) citadas.push(m[1]);
    else if (!/permissao:/.test(corpo) && !/publica:\s*true/.test(corpo)) {
      const rota = /path:\s*['"`]([^'"`]+)/.exec(`path:${corpo}`)?.[1] ?? '?';
      achados.push({ regra: 'rota-sem-permissao', detalhe: `${relative(raiz, caminho)} ${rota}` });
    }
  }
  return { achados, citadas };
}

export interface RelatorioPermissoes {
  readonly linhas: string[];
  readonly achados: Achado[];
}

export function provaEMapa(retrato: RetratoAcessoLegado): RelatorioPermissoes {
  const linhas: string[] = [];
  const achados: Achado[] = [];
  const c = construirCatalogo(retrato.opcoes, retrato.modulos);
  const prova = provarGrupos(c, retrato.opcoes, retrato.permissoesGrupos);
  linhas.push(
    `[${retrato.estabelecimento}] árvore: ${c.contagens.opcoes} opções, ${c.contagens.ativas} ativas, por nível ${c.contagens.porNivel.join('/')}, ${c.contagens.modulos} módulos → ${c.permissoes.length} permissões; fora do catálogo ${c.exclusoes.length} (${resumo(c.exclusoes.map((e) => e.motivo))})`,
  );
  linhas.push(
    `[${retrato.estabelecimento}] prova dos grupos: ${retrato.grupos.length} grupos, ${prova.gruposComPermissao} com permissões`,
  );
  linhas.push(
    '  grupo | opções legado | permissões novo | ganhos justificados | perdas justificadas | não justificadas',
  );
  for (const g of prova.grupos) {
    linhas.push(
      `  ${g.grupo} | ${g.opcoesLegado} | ${g.permissoesNovo} | ${g.ganhosJustificados} | ${g.perdasJustificadas} | ${g.naoJustificadas}`,
    );
    if (g.naoJustificadas > 0)
      achados.push({
        regra: 'prova-grupos',
        detalhe: `[${retrato.estabelecimento}] ${g.grupo}: ${g.naoJustificadas} diferença(s) não justificada(s) (${resumo(Object.keys(g.motivos))})`,
      });
  }
  // A prova passa também pela concessão real (conceder: perfis e segregação), com cada papel SBIS: o que o
  // legado concede ao grupo não pode sumir no caminho (regra 4). Conflitos de segregação mantidos são
  // contados por motivo (vão à revisão do dono e das áreas; não reprovam).
  const indice = indexarCatalogo([...c.permissoes, ...CATALOGO_DECLARADO], [], mapaDaProva(c));
  const doGrupo = new Map<string, number[]>();
  for (const [g, o] of retrato.permissoesGrupos) doGrupo.set(g, [...(doGrupo.get(g) ?? []), o]);
  const conflitos: string[] = [];
  let perdasNaConcessao = 0;
  for (const [g, opts] of [...doGrupo].sort((x, y) => x[0].localeCompare(y[0]))) {
    const esperadas = new Set(
      opts.flatMap((o) => {
        const x = c.permissaoDaOpcao.get(o);
        return x ? [x] : [];
      }),
    );
    for (const papeis of [[], [0], [1], [2], [3]]) {
      const r = conceder({
        legado: { grupo: g, opcoesGrupo: opts, opcoesPapel: [], papeis, flags: [], conselho: true },
        catalogo: [],
        indice,
      });
      if (papeis.length === 0) conflitos.push(...r.conflitos.map((x) => x.motivo));
      const perdidas = [...esperadas].filter((p) => !r.permissoes.has(p));
      if (perdidas.length > 0) {
        perdasNaConcessao += perdidas.length;
        achados.push({
          regra: 'prova-grupos-concessao',
          detalhe: `[${retrato.estabelecimento}] ${g} (papéis ${papeis.join(',') || 'nenhum'}): ${perdidas.length} permissão(ões) do legado retirada(s) (${resumo(r.retiradas.filter((x) => perdidas.includes(x.permissao)).map((x) => x.motivo))})`,
        });
      }
    }
  }
  linhas.push(
    `[${retrato.estabelecimento}] pela concessão (papéis nenhum/0/1/2/3): ${perdasNaConcessao} permissão(ões) do legado retirada(s); conflitos de segregação mantidos para revisão: ${conflitos.length}${conflitos.length ? ` (${resumo(conflitos)})` : ''}`,
  );
  linhas.push(
    `[${retrato.estabelecimento}] diferenças não justificadas: ${prova.naoJustificadas}; justificadas: ganhos por agrupamento de executável ${soma(prova.grupos, 'ganhosJustificados')}, perdas por opção inativa/SGO ${soma(prova.grupos, 'perdasJustificadas')}`,
  );
  const semDestino = retrato.grupos.filter((g) => !MAPA_GRUPOS[chaveGrupo(g.nome)]);
  for (const g of semDestino)
    achados.push({
      regra: 'mapa-grupos',
      detalhe: `[${retrato.estabelecimento}] ${g.nome}: sem destino no mapa`,
    });
  const destinos = retrato.grupos.map((g) => MAPA_GRUPOS[chaveGrupo(g.nome)]?.tipo ?? 'sem-destino');
  linhas.push(`[${retrato.estabelecimento}] mapa dos grupos: ${resumo(destinos)}`);
  return { linhas, achados };
}

function resumo(xs: readonly string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k} ${n}`).join(', ');
}

function soma<T>(xs: readonly T[], campo: keyof T): number {
  return xs.reduce((s, x) => s + Number(x[campo]), 0);
}

export function conferirRotas(catalogo: ReadonlySet<string>): RelatorioPermissoes {
  const achados: Achado[] = [];
  const citadas: string[] = [];
  let handlers = 0;
  for (const f of arquivos(
    resolve(raiz, 'apps/api/src'),
    (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'),
  )) {
    const t = readFileSync(f, 'utf8');
    if (!/@Controller\(/.test(t)) continue;
    handlers += (t.match(/^\s*@(Get|Post|Put|Patch|Delete|All)\(/gm) ?? []).length;
    const r = conferirControlador(f, t);
    achados.push(...r.achados);
    citadas.push(...r.citadas);
  }
  let telas = 0;
  for (const f of arquivos(resolve(raiz, 'apps/web/src'), (p) => /rotas\.ts$|roteador\.ts$/.test(p))) {
    const t = readFileSync(f, 'utf8');
    const r = conferirRotasTela(f, t);
    telas += (t.match(/component:/g) ?? []).length;
    achados.push(...r.achados);
    citadas.push(...r.citadas);
  }
  for (const item of ARVORE_MENU) if (item.permissao) citadas.push(item.permissao);
  for (const c of new Set(citadas)) {
    if (c.startsWith('@')) continue; // constante PERMISSOES_*: o typecheck garante a existência
    if (!catalogo.has(c)) achados.push({ regra: 'permissao-inexistente', detalhe: c });
  }
  return {
    linhas: [
      `rotas: ${handlers} handlers da API e ${telas} telas conferidos; ${achados.filter((a) => a.regra === 'rota-sem-permissao').length} sem permissão`,
    ],
    achados,
  };
}

async function principal(): Promise<number> {
  const { opcoes, bandeiras } = lerArgumentos(process.argv.slice(2));
  // `--retrato`: só o retrato versionado (o `pnpm verificar` usa: determinístico, sem a cópia).
  const copia = bandeiras.has('retrato') ? null : codigosDaCopia();
  const pedido = opcoes['hospital'] ?? 'todos';
  const linhas: string[] = [];
  const achados: Achado[] = [];
  const configurados = copia?.codigos ?? ['pc'];
  const alvos = pedido === 'todos' ? configurados : [pedido];
  if (pedido === 'todos' && configurados.length < 2)
    linhas.push(`Bloqueio: só ${configurados.join(', ')} configurado; os demais aguardam a cópia (HS-1).`);
  const retratos: RetratoAcessoLegado[] = [];
  for (const cod of alvos) {
    let r: RetratoAcessoLegado | null = null;
    if (copia?.codigos.includes(cod)) {
      try {
        r = await retratarDaCopia(copia.env, cod);
        linhas.push(`[${cod}] fonte: cópia ao vivo (READ ONLY)`);
        if (bandeiras.has('atualizar')) linhas.push(`  gravado ${relative(raiz, gravarRetrato(r))}`);
        else {
          const v = lerRetrato(cod);
          const igual = v && JSON.stringify(v) === JSON.stringify(JSON.parse(JSON.stringify(r)));
          if (!igual)
            achados.push({
              regra: 'retrato-desatualizado',
              detalhe: `[${cod}] o retrato versionado difere da cópia: rode --atualizar e revise o diff`,
            });
        }
      } catch (e) {
        linhas.push(
          `[${cod}] cópia indisponível (${e instanceof Error ? e.name : 'erro'}); usando o retrato versionado`,
        );
        r = null;
      }
    }
    r ??= lerRetrato(cod);
    if (!r) {
      linhas.push(`[${cod}] Bloqueio: sem cópia e sem retrato versionado (HS-1 para hs)`);
      continue;
    }
    if (!copia?.codigos.includes(cod)) linhas.push(`[${cod}] fonte: retrato versionado`);
    retratos.push(r);
  }
  // 1. o catálogo-base e o mapa do conector cobrem o que a árvore do menu de origem gera (retrato do pc).
  const mapa = lerMapaDoConector();
  const ref = retratos.find((r) => r.estabelecimento === 'pc') ?? lerRetrato('pc');
  if (ref) achados.push(...conferirOrigem(construirCatalogo(ref.opcoes, ref.modulos), CATALOGO_BASE, mapa));
  const catalogo = [...CATALOGO_BASE, ...CATALOGO_DECLARADO];
  const codigos = new Set(catalogo.map((p) => p.codigo));
  const cat = conferirCatalogo(catalogo, mapa);
  achados.push(...cat);
  linhas.push(
    `catálogo: ${CATALOGO_BASE.length} do catálogo-base + ${CATALOGO_DECLARADO.length} declaradas; mapa do conector com ${mapa.length} linhas; ${cat.filter((a) => a.regra === 'sem-mapeamento').length} sem mapeamento`,
  );
  // M08: as telas geradas do CRUD genérico — toda ação de todo domínio declarado com opções do legado.
  const dominios = DOMINIOS_DECLARADOS.map((d) => ({
    id: `${d.modulo}.${d.recurso}`,
    semOpcao: d.acoes.filter((a) => (d.opcoesLegado[a] ?? []).length === 0),
  }));
  for (const d of dominios.filter((x) => x.semOpcao.length > 0))
    achados.push({
      regra: 'sem-mapeamento',
      detalhe: `domínio ${d.id}: ${d.semOpcao.join(', ')} sem opcoesLegado`,
    });
  linhas.push(
    `CRUD genérico: ${dominios.length} telas de domínio declaradas; ${dominios.filter((d) => d.semOpcao.length === 0).length} com opcoesLegado em todas as ações`,
  );
  const rotas = conferirRotas(codigos);
  linhas.push(...rotas.linhas);
  achados.push(...rotas.achados);
  for (const r of retratos) {
    const p = provaEMapa(r);
    linhas.push(...p.linhas);
    achados.push(...p.achados);
  }
  for (const l of linhas) console.log(l);
  for (const a of achados) console.error(`  VERMELHO [${a.regra}] ${a.detalhe}`);
  console.log(
    achados.length === 0 ? 'Resultado: verde' : `Resultado: VERMELHO (${achados.length} achado(s))`,
  );
  return achados.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(await principal());
}
