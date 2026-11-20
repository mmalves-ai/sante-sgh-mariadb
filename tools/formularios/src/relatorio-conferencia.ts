// Relatório versionado da conferência cruzada (docs/marcos/M15/conferencia-<hospital>.json e .md): só contagens
// e taxas, e toda contagem de 1 a 4 sai como "<5" (portão sem-pessoal do M03; ESTADO.md, 2026-10-20): um estrato
// pequeno por modelo não fica identificável. A taxa é calculada antes, sobre os números inteiros.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contagemAgregada, type ContagemAgregada } from '@sgh/contratos';

type Contagem = number | ContagemAgregada;

export interface ModeloConferido {
  modelo: number;
  codigo: string;
  registros: Contagem;
  ilegiveis: Contagem;
  comparados: Contagem;
  iguais: Contagem;
  valorDiferente: Contagem;
  semPar: Contagem;
  foraDoEstruturado: Contagem;
  taxa: number;
}

export interface ResumoConferencia {
  formato: number;
  estabelecimento: string;
  data: string;
  amostraPorEstrato: number;
  desde: number;
  registros: Contagem;
  comparados: Contagem;
  iguais: Contagem;
  valorDiferente: Contagem;
  semPar: Contagem;
  foraDoEstruturado: Contagem;
  taxa: number;
  meta: number;
  minutos: number;
  modelos: ModeloConferido[];
}

const CONTAGENS = [
  'registros',
  'ilegiveis',
  'comparados',
  'iguais',
  'valorDiferente',
  'semPar',
  'foraDoEstruturado',
] as const;

const mascarar = (c: Contagem): Contagem => (typeof c === 'number' ? contagemAgregada(c) : c);

/** O resumo publicável: toda contagem de 1 a 4 vira "<5" (idempotente). */
export function resumoPublicavel(r: ResumoConferencia): ResumoConferencia {
  const x = { ...r, modelos: r.modelos.map((m) => ({ ...m })) };
  for (const k of CONTAGENS) {
    if (k !== 'ilegiveis') x[k] = mascarar(x[k]);
    for (const m of x.modelos) m[k] = mascarar(m[k]);
  }
  return x;
}

export function markdownDaConferencia(r: ResumoConferencia): string {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return [
    `# Conferência cruzada do prontuário — ${r.estabelecimento} (${r.data})`,
    '',
    `Amostra: até ${r.amostraPorEstrato} registros por modelo e ano, desde ${r.desde}; ${r.registros} registros lidos em ${r.minutos} min.`,
    `Igualdade de título e valor: **${pct(r.taxa)}** (${r.iguais}/${r.comparados}; meta ${(r.meta * 100).toFixed(1)}%). Valor diferente: ${r.valorDiferente}; campo sem resposta estruturada de mesmo título: ${r.semPar}; fora da conta (alergias, que não ficam nas respostas estruturadas): ${r.foraDoEstruturado}.`,
    '',
    '| modelo | registros | campos comparados | iguais | valor diferente | sem par | igualdade |',
    '|---|---|---|---|---|---|---|',
    ...r.modelos.map(
      (m) =>
        `| ${m.codigo} | ${m.registros} | ${m.comparados} | ${m.iguais} | ${m.valorDiferente} | ${m.semPar} | ${pct(m.taxa)} |`,
    ),
    '',
    'Só contagens: nenhum conteúdo de registro sai do banco (DP-41). Contagens de 1 a 4 aparecem como "<5".',
    '',
  ].join('\n');
}

/** Grava o .json e o .md publicáveis. */
export function publicarConferencia(pasta: string, r: ResumoConferencia): ResumoConferencia {
  const p = resumoPublicavel(r);
  writeFileSync(resolve(pasta, `conferencia-${p.estabelecimento}.json`), `${JSON.stringify(p, null, 2)}\n`);
  writeFileSync(resolve(pasta, `conferencia-${p.estabelecimento}.md`), markdownDaConferencia(p));
  return p;
}

/** `--regerar`: refaz o .json e o .md a partir do .json já gravado (sem ler o banco). */
export function regerarConferencia(pasta: string, estabelecimento: string): ResumoConferencia {
  const bruto = JSON.parse(
    readFileSync(resolve(pasta, `conferencia-${estabelecimento}.json`), 'utf8'),
  ) as ResumoConferencia;
  return publicarConferencia(pasta, bruto);
}
