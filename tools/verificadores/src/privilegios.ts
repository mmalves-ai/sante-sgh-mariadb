// M59-F1 (ficha do M59, regra 4; seção 6 "Os privilégios por módulo não são tabela: são scripts de GRANT e REVOKE em
// infra/firebird/fase7/privilegios/"): monta o alcance de cada módulo a partir do repositório (código de cada grupo
// do adaptador, receitas, consultas declaradas e scripts SGH_) e das dependências dos gatilhos do banco do
// estabelecimento (retrato versionado em tools/verificadores/dados/dependencias-gatilhos.<h>.json), e gera os
// artefatos versionados: o alcance (packages/legado/src/acesso/privilegios/alcance.<h>.json) e o par de scripts
// aplicar e recolher dos papéis por módulo, executados pela TI com autorização do dono por passo (ficha, seção 12).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import {
  CONSULTAS_LEGADO,
  lerScriptsSgh,
  OPERACOES,
  RECEITAS_DO_NUCLEO,
  concessoesDaAplicacao,
  geradoresCriados,
  tabelasCriadas,
  tabelasSoInclusao,
  usosNoTexto,
  type DependenciasGatilhos,
  type ObjetosConhecidos,
} from '@sgh/legado';
import { TABELAS_BENEFICIARIO_FICTICIO } from '@sgh/contratos';
import {
  calcularAlcances,
  exigirPlanoImutavel,
  gerarScriptsPapeis,
  planejarPrivilegios,
  versaoDoAlcance,
  type EntradaAlcance,
  type UsoObjetos,
} from '@sgh/dominio-acesso';

export const RAIZ = resolve(import.meta.dirname, '../../..');
const SRC = 'packages/legado/src';
/** Grupos do adaptador que não são módulo: o núcleo (vira o comum), os tipos gerados e a cópia de dev. */
export const GRUPOS_FORA = ['nucleo', 'tipos', 'copia'] as const;

/** Tabelas que nenhum papel por módulo recebe (o guardas:legado barra citá-las em SQL). */
export const NUNCA_NO_PLANO: readonly string[] = [...TABELAS_BENEFICIARIO_FICTICIO];

export const caminhoAlcance = (h: string) => `${SRC}/acesso/privilegios/alcance.${h}.json`;
export const caminhoDependencias = (h: string) => `tools/verificadores/dados/dependencias-gatilhos.${h}.json`;
export const caminhoScripts = (h: string) => `infra/firebird/fase7/privilegios/${h}`;
export const NOME_PASSO_PAPEIS = '0001_papeis_por_modulo';

const ARQUIVO_DE_CODIGO = /\.ts$/;
const FORA_DA_VARREDURA = /(\.spec\.ts|\.spec-util\.ts|\.d\.ts)$/;

function arquivosTs(pasta: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(pasta).sort()) {
    const p = join(pasta, nome);
    if (statSync(p).isDirectory()) {
      if (nome === 'assinaturas' || nome === 'node_modules') continue;
      saida.push(...arquivosTs(p));
    } else if (ARQUIVO_DE_CODIGO.test(nome) && !FORA_DA_VARREDURA.test(nome)) saida.push(p);
  }
  return saida;
}

const textoDe = (pasta: string) =>
  arquivosTs(pasta)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

const IMPORT_RELATIVO = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+'(\.[^']+)\.js';/gm;

/**
 * Os arquivos de outros grupos que o executor alcança por import de valor (seguindo os imports, só de dentro do
 * adaptador): rodam na transação de toda operação, com a conta do módulo dono da receita, e por isso o uso deles vai
 * ao comum de todo módulo (hoje o evento na trilha do legado, `auditoria/gravacao/registrarEventoLegado.ts`). Os
 * demais arquivos do núcleo que importam outros grupos (login, vigias) rodam sem módulo, na conta única.
 */
export function arquivosAlcancadosPeloExecutor(raiz = RAIZ): string[] {
  const src = resolve(raiz, SRC);
  const nucleo = join(src, 'nucleo') + sep;
  const vistos = new Set<string>();
  const fora = new Set<string>();
  const pilha = [join(src, 'nucleo', 'executor.ts')];
  while (pilha.length > 0) {
    const f = pilha.pop()!;
    if (vistos.has(f) || !existsSync(f)) continue;
    vistos.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(IMPORT_RELATIVO)) {
      const corpo = (m[2] ?? '').trim();
      if (m[1]) continue;
      const nomes = corpo
        .replace(/^\{|\}$/g, '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (corpo.startsWith('{') && nomes.every((x) => x.startsWith('type '))) continue;
      const alvo = normalize(join(dirname(f), `${m[3]}.ts`));
      if (!alvo.startsWith(src + sep)) continue;
      if (!alvo.startsWith(nucleo)) fora.add(alvo);
      pilha.push(alvo);
    }
  }
  return [...fora].sort();
}

/** Os objetos conhecidos: tabelas e visões do sistema anterior e tabelas SGH_ dos scripts versionados. */
export function objetosConhecidos(raiz = RAIZ): ObjetosConhecidos {
  const t = JSON.parse(readFileSync(resolve(raiz, SRC, 'tipos/tabelas-legadas.json'), 'utf8')) as {
    tabelas: string[];
    visoes: string[];
  };
  const sgh = new Set<string>();
  const geradoresSgh = new Set<string>();
  const textos: string[] = [];
  for (const s of lerScriptsSgh(resolve(raiz, SRC))) {
    textos.push(s.comandos.join('\n'));
    for (const x of tabelasCriadas(s.comandos.join('\n'))) sgh.add(x);
    for (const x of geradoresCriados(s.comandos.join('\n'))) geradoresSgh.add(x);
  }
  // D-PRIV-IMUTAVEL-546: o plano do módulo nunca dá UPDATE onde o script não dá ao papel da aplicação.
  const soInclusaoSgh = tabelasSoInclusao(concessoesDaAplicacao(textos.join('\n')));
  // M56 (regra 4): as tabelas dos beneficiários fictícios nunca são lidas nem gravadas pelo novo; nenhum papel as recebe.
  const nunca = new Set<string>(NUNCA_NO_PLANO);
  return {
    legado: new Set([...t.tabelas, ...t.visoes].map((x) => x.toUpperCase()).filter((x) => !nunca.has(x))),
    sgh,
    geradoresSgh,
    soInclusaoSgh,
    procedimentos: new Set(
      Object.keys(
        (
          JSON.parse(readFileSync(resolve(raiz, SRC, 'tipos/procedimentos-legados.json'), 'utf8')) as {
            procedimentos: Record<string, unknown>;
          }
        ).procedimentos,
      ).map((x) => x.toUpperCase()),
    ),
  };
}

const VAZIAS: DependenciasGatilhos = {
  generatorsPorTabela: {},
  proceduresPorTabela: {},
  tabelasPorTabela: {},
};

/** Retrato versionado das dependências dos gatilhos do estabelecimento (ausente: vazio, com aviso no relatório). */
export function lerRetratoDependencias(h: string, raiz = RAIZ): DependenciasGatilhos | null {
  const p = resolve(raiz, caminhoDependencias(h));
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, 'utf8')) as DependenciasGatilhos & { estabelecimento?: string };
  if (j.estabelecimento !== h) throw new Error(`${caminhoDependencias(h)}: de outro estabelecimento.`);
  // As tabelas que nenhum papel recebe ficam fora também quando um gatilho as usa (o guardas:legado as barra).
  const tabelasPorTabela = Object.fromEntries(
    Object.entries(j.tabelasPorTabela ?? {}).map(([t, xs]) => [
      t,
      Object.fromEntries(Object.entries(xs).filter(([x]) => !NUNCA_NO_PLANO.includes(x))),
    ]),
  );
  return {
    generatorsPorTabela: j.generatorsPorTabela,
    proceduresPorTabela: j.proceduresPorTabela,
    tabelasPorTabela,
  };
}

/** A entrada do cálculo do alcance, lida do repositório. */
export function entradaDoRepositorio(dep: DependenciasGatilhos | null, raiz = RAIZ): EntradaAlcance {
  const k = objetosConhecidos(raiz);
  const src = resolve(raiz, SRC);
  const usosPorGrupo: Record<string, Record<string, string[]>> = {};
  let comum: UsoObjetos = {};
  for (const g of readdirSync(src).sort()) {
    const pasta = join(src, g);
    if (!statSync(pasta).isDirectory()) continue;
    if (g === 'nucleo')
      comum = usosNoTexto(
        [textoDe(pasta), ...arquivosAlcancadosPeloExecutor(raiz).map((f) => readFileSync(f, 'utf8'))].join(
          '\n',
        ),
        k,
      );
    else if (!(GRUPOS_FORA as readonly string[]).includes(g))
      usosPorGrupo[g] = usosNoTexto(textoDe(pasta), k);
  }
  // As consultas declaradas (M14 e seguintes) leem a tabela pelo grupo dono, mesmo quando a declaração é gerada fora
  // da pasta do grupo.
  for (const c of CONSULTAS_LEGADO) {
    const t = c.tabela.trim().toUpperCase();
    if (NUNCA_NO_PLANO.includes(t)) continue;
    const u = (usosPorGrupo[c.grupo] ??= {});
    const acoes = (u[t] ??= []);
    if (!acoes.includes('SELECT')) acoes.unshift('SELECT');
  }
  const receitas = Object.values(OPERACOES).map((o) => ({
    nome: o.receita.nome,
    grupo: o.receita.grupo,
    passos: o.receita.passos.map((p) => ({ tabela: p.tabela, acao: p.acao })),
    efeitos: o.receita.efeitos.map((f) => ({ tabela: f.tabela, acao: f.acao })),
  }));
  return {
    receitas,
    usosPorGrupo: usosPorGrupo as EntradaAlcance['usosPorGrupo'],
    comum,
    ...(dep ?? VAZIAS),
    receitasDoNucleo: [...RECEITAS_DO_NUCLEO],
    gruposFora: [...GRUPOS_FORA],
  };
}

export interface Artefatos {
  readonly alcanceJson: string;
  readonly aplicar: string;
  readonly recolher: string;
  readonly versao: string;
  readonly descartes: readonly string[];
  readonly modulos: number;
  readonly itens: number;
  readonly semDependencias: boolean;
}

/** Os artefatos versionados do estabelecimento (texto exato: o teste compara byte a byte). */
export function gerarArtefatos(h: string, raiz = RAIZ): Artefatos {
  const dep = lerRetratoDependencias(h, raiz);
  const { alcances, descartes } = calcularAlcances(entradaDoRepositorio(dep, raiz));
  const versao = versaoDoAlcance(alcances);
  const plano = planejarPrivilegios(alcances);
  // M59-F3 (regra 6): nenhum papel por módulo apaga registro clínico (fora das exceções com motivo).
  exigirPlanoImutavel(plano);
  const scripts = gerarScriptsPapeis(plano, { hospital: h, versao });
  // Um módulo por linha: diff legível e nenhuma linha "CHAVE": valor (o verificador de segredos lê nomes como
  // SGH_GEN_OPE_SENHA, um generator, como chave de segredo).
  const alcanceJson = [
    `{"formato":1,"estabelecimento":${JSON.stringify(h)},"versao":"${versao}","descartes":${descartes.length},"alcances":[`,
    alcances.map((x) => JSON.stringify(x)).join(',\n'),
    ']}',
    '',
  ].join('\n');
  return {
    alcanceJson,
    aplicar: scripts.aplicar,
    recolher: scripts.recolher,
    versao,
    descartes,
    modulos: alcances.length,
    itens: plano.length,
    semDependencias: dep === null,
  };
}
