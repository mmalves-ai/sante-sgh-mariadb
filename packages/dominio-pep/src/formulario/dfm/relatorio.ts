// Relatório da conversão dos modelos (critério de aceite do M09: 2.368 de 2.368 componentes mapeados,
// 0 classe desconhecida, 0 U+FFFD, pendências de escolha listadas). Só estrutura e contagens do formulário.
import { CLASSES_DFM } from './classes.js';
import {
  PADROES_EXPRESSAO,
  type PadraoExpressao,
  resumirExpressoes,
  type ExpressaoInventariada,
} from './expressoes.js';
import type { ItemFormulario, RepresentacaoFormulario } from './mapeamento.js';

export interface TotaisConversao {
  readonly modelos: number;
  readonly modelosComComponente: number;
  readonly vinculos: number;
  readonly vinculosAtivos: number;
  readonly vinculosInativos: number;
  readonly componentes: number;
  readonly componentesMapeados: number;
  readonly classesDesconhecidas: number;
  readonly caracteresSubstituicao: number;
  readonly opcoesResolvidas: number;
  readonly escolhasPendentes: number;
  readonly expressoesHabilitar: number;
  readonly expressoesCalcular: number;
  readonly expressoesPorPadrao: Readonly<Record<PadraoExpressao, number>>;
  readonly porClasse: Readonly<Record<string, number>>;
  readonly pendenciasPorTipo: Readonly<Record<string, number>>;
}

function percorrer(itens: readonly ItemFormulario[], fn: (i: ItemFormulario) => void): void {
  for (const i of itens) {
    fn(i);
    percorrer(i.itens, fn);
  }
}

export function expressoesDe(r: RepresentacaoFormulario): ExpressaoInventariada[] {
  const lista: ExpressaoInventariada[] = [];
  percorrer(r.itens, (i) => lista.push(...(i.expressoes ?? [])));
  return lista;
}

export function totalizar(reps: readonly RepresentacaoFormulario[]): TotaisConversao {
  const soma = (f: (r: RepresentacaoFormulario) => number) => reps.reduce((s, r) => s + f(r), 0);
  const porClasse: Record<string, number> = {};
  const pendenciasPorTipo: Record<string, number> = {};
  for (const r of reps) {
    for (const [c, n] of Object.entries(r.resumo.porClasse)) porClasse[c] = (porClasse[c] ?? 0) + n;
    for (const p of r.pendencias) pendenciasPorTipo[p.tipo] = (pendenciasPorTipo[p.tipo] ?? 0) + 1;
  }
  const expr = resumirExpressoes(reps.flatMap(expressoesDe));
  return {
    modelos: reps.length,
    modelosComComponente: reps.filter((r) => r.resumo.componentes > 0).length,
    vinculos: soma((r) => r.resumo.vinculos),
    vinculosAtivos: soma((r) => r.resumo.vinculosAtivos),
    vinculosInativos: soma((r) => r.resumo.vinculosInativos),
    componentes: soma((r) => r.resumo.componentes),
    componentesMapeados: soma((r) => r.resumo.componentesMapeados),
    classesDesconhecidas: soma((r) => r.resumo.classesDesconhecidas),
    caracteresSubstituicao: soma((r) => r.resumo.caracteresSubstituicao),
    opcoesResolvidas: soma((r) => r.resumo.opcoesResolvidas),
    escolhasPendentes: soma((r) => r.resumo.escolhasPendentes),
    expressoesHabilitar: expr.habilitar,
    expressoesCalcular: expr.calcular,
    expressoesPorPadrao: expr.porPadrao,
    porClasse,
    pendenciasPorTipo,
  };
}

const n = (x: number) => x.toLocaleString('pt-BR');

/** Relatório em Markdown (determinístico: mesma entrada, mesmo texto, salvo a linha de origem). */
export function relatorioMarkdown(
  reps: readonly RepresentacaoFormulario[],
  origem: {
    readonly estabelecimento: string;
    readonly data: string;
    readonly arquivoDe: (r: RepresentacaoFormulario) => string;
  },
): string {
  const t = totalizar(reps);
  const linhas: string[] = [
    '# Relatório da conversão DFM → representação (M09)',
    '',
    `Gerado por \`./pnpm formularios:converter -- --hospital=${origem.estabelecimento}\` em ${origem.data}, sobre a cópia de dev`,
    'do estabelecimento (leitura somente leitura, uma transação curta por modelo). Só estrutura do formulário e',
    'contagens: nenhuma resposta de paciente (`PREVOLPAC`, `PRCONTEVOL`) é lida. O legado continua dono da',
    'definição (o layout muda no Delphi); a impressão digital de cada modelo detecta a mudança.',
    '',
    '## Totais',
    '',
    '| Medida | Valor |',
    '|---|---|',
    `| Modelos convertidos | ${n(t.modelos)} (com componente DFM: ${n(t.modelosComComponente)}) |`,
    `| Vínculos (PRPADEVOL) | ${n(t.vinculos)} (ativos ${n(t.vinculosAtivos)}, inativos preservados ${n(t.vinculosInativos)}) |`,
    `| Componentes mapeados | ${n(t.componentesMapeados)} de ${n(t.componentes)} |`,
    `| Classes desconhecidas | ${n(t.classesDesconhecidas)} |`,
    `| Caracteres U+FFFD ou de byte CP1252 indefinido (0x81, 0x8D, 0x8F, 0x90, 0x9D) no DFM decodificado | ${n(t.caracteresSubstituicao)} |`,
    `| Opções de escolha resolvidas por índice | ${n(t.opcoesResolvidas)} |`,
    `| Pendências de escolha | ${n(t.escolhasPendentes)} |`,
    `| Expressões (habilitar + calcular) | ${n(t.expressoesHabilitar + t.expressoesCalcular)} (${n(t.expressoesHabilitar)} + ${n(t.expressoesCalcular)}) |`,
    '',
    '## Componentes por classe',
    '',
    '| Classe | Componentes |',
    '|---|---|',
    ...CLASSES_DFM.map((c) => `| \`${c.classe}\` | ${n(t.porClasse[c.classe] ?? 0)} |`),
    ...Object.keys(t.porClasse)
      .filter((c) => !CLASSES_DFM.some((k) => k.classe === c))
      .map((c) => `| \`${c}\` (desconhecida) | ${n(t.porClasse[c]!)} |`),
    '',
    '## Expressões por padrão (ref 04 §3.3; tradução no M22)',
    '',
    '| Padrão | Expressões |',
    '|---|---|',
    ...PADROES_EXPRESSAO.map((p) => `| ${p} | ${n(t.expressoesPorPadrao[p])} |`),
    '',
    '## Pendências por tipo',
    '',
    '| Tipo | Quantidade |',
    '|---|---|',
    ...(Object.keys(t.pendenciasPorTipo).length
      ? Object.entries(t.pendenciasPorTipo)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `| ${k} | ${n(v)} |`)
      : ['| (nenhuma) | 0 |']),
    '',
    '## Modelos',
    '',
    '| ID | Código | Arquivo | Vínculos (inativos) | Componentes | Escolhas pendentes | Expressões | Versões do layout | Impressão do layout |',
    '|---|---|---|---|---|---|---|---|---|',
    ...reps.map(
      (r) =>
        `| ${r.modelo.id} | ${r.modelo.codigo ?? '—'} | \`${origem.arquivoDe(r)}\` | ${r.resumo.vinculos} (${r.resumo.vinculosInativos}) | ${r.resumo.componentesMapeados}/${r.resumo.componentes} | ${r.resumo.escolhasPendentes} | ${r.resumo.expressoesHabilitar + r.resumo.expressoesCalcular} | ${r.versoesLayout.length} | \`${r.impressaoLayout.slice(0, 16)}\` |`,
    ),
    '',
    '## Pendências de escolha (para o M22 e a conferência das áreas donas)',
    '',
    'Cada linha é um índice que o parser não resolveu com segurança pela lista `Items` do DFM, pelo',
    '`ID_RESPOSTA` do combo oculto ou por `PRRESPOSTA.ORDEM`. Nada foi adivinhado: a opção fica fora da',
    'representação até a conferência.',
    '',
  ];
  const pend = reps.flatMap((r) =>
    r.pendencias
      .filter((p) => p.tipo === 'escolha')
      .map(
        (p) =>
          `| ${r.modelo.id} | ${r.modelo.codigo ?? '—'} | ${p.linkId ?? '—'} | ${p.indice ?? '—'} | ${(p.opcao ?? '—').replace(/\|/g, '/')} | ${p.detalhe} | ${p.sugestaoIdResposta ?? '—'} |`,
      ),
  );
  if (pend.length) {
    linhas.push(
      '| Modelo | Código | linkId | Índice | Rótulo | Motivo | Resposta com o mesmo rótulo (sugestão) |',
      '|---|---|---|---|---|---|---|',
      ...pend,
    );
  } else linhas.push('Nenhuma.');
  const outras = reps.flatMap((r) =>
    r.pendencias
      .filter((p) => p.tipo !== 'escolha')
      .map((p) => `| ${r.modelo.id} | ${p.tipo} | ${p.linkId ?? '—'} | ${p.detalhe.replace(/\|/g, '/')} |`),
  );
  linhas.push('', '## Outras pendências', '');
  if (outras.length) linhas.push('| Modelo | Tipo | linkId | Detalhe |', '|---|---|---|---|', ...outras);
  else linhas.push('Nenhuma.');
  linhas.push('');
  return linhas.join('\n');
}
