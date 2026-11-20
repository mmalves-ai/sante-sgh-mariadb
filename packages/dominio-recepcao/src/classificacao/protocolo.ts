// Protocolo de classificação é dado (ficha do M44, regra 2; DP-18): a versão publicada é imutável, com autor,
// aprovador e licença; o tipo `manchester` só publica com a licença do GBCR registrada e válida; a classificação guarda
// a versão usada. Aqui ficam as conferências puras da publicação e a forma canônica do conteúdo (a API calcula o
// SHA-256 dela e grava como impressão digital da versão: a mesma impressão prova que a versão não mudou).
import {
  CORES_RISCO,
  TIPOS_PROTOCOLO_CLASSIFICACAO,
  type ConteudoProtocolo,
  type CorProtocolo,
  type CorRisco,
  type Discriminador,
} from '@sgh/contratos';
import { problemasDaRegra } from './regra.js';

export interface ProblemaProtocolo {
  readonly codigo:
    | 'cores-incompletas'
    | 'tempo-fora-de-ordem'
    | 'licenca-ausente'
    | 'licenca-vencida'
    | 'fluxograma-repetido'
    | 'discriminador-repetido'
    | 'fluxograma-inexistente'
    | 'fluxograma-sem-discriminador'
    | 'regra-invalida'
    | 'opcao-e08-repetida'
    | 'autoaprovacao';
  readonly mensagem: string;
  readonly onde?: string;
}

export interface ContextoPublicacao {
  /** Hoje (AAAA-MM-DD) no fuso do estabelecimento. */
  readonly hoje: string;
  readonly autor: string;
  readonly aprovador: string;
}

const PRIORIDADE: ReadonlyMap<CorRisco, number> = new Map(CORES_RISCO.map((c) => [c.codigo, c.prioridade]));

export function prioridadeDaCor(cor: CorRisco): number {
  return PRIORIDADE.get(cor) ?? Number.MAX_SAFE_INTEGER;
}

/** As cores da versão, na ordem de prioridade (a mais grave primeiro). */
export function coresEmOrdem(conteudo: Pick<ConteudoProtocolo, 'cores'>): CorProtocolo[] {
  return [...conteudo.cores].sort((a, b) => prioridadeDaCor(a.cor) - prioridadeDaCor(b.cor));
}

/** Tudo o que impede publicar a versão (vazio: pode publicar). */
export function problemasDaPublicacao(
  conteudo: ConteudoProtocolo,
  ctx: ContextoPublicacao,
): ProblemaProtocolo[] {
  const p: ProblemaProtocolo[] = [];
  const cores = new Set(conteudo.cores.map((c) => c.cor));
  if (cores.size !== CORES_RISCO.length)
    p.push({ codigo: 'cores-incompletas', mensagem: 'A versão precisa das cinco cores, uma vez cada.' });
  const ordem = coresEmOrdem(conteudo);
  for (let i = 1; i < ordem.length; i++)
    if (ordem[i]!.tempoAlvoMin < ordem[i - 1]!.tempoAlvoMin)
      p.push({
        codigo: 'tempo-fora-de-ordem',
        mensagem: `O tempo-alvo de ${ordem[i]!.cor} é menor que o de ${ordem[i - 1]!.cor}: a cor mais grave espera menos.`,
        onde: ordem[i]!.cor,
      });
  const opcoes = conteudo.cores.map((c) => c.opcaoE08).filter((o): o is number => o !== null);
  if (new Set(opcoes).size !== opcoes.length)
    p.push({
      codigo: 'opcao-e08-repetida',
      mensagem: 'Duas cores apontam para a mesma prioridade clínica do formulário do prontuário.',
    });
  const tipo = TIPOS_PROTOCOLO_CLASSIFICACAO.find((t) => t.codigo === conteudo.tipo);
  if (tipo?.exigeLicenca) {
    if (!conteudo.licenca)
      p.push({
        codigo: 'licenca-ausente',
        mensagem: 'O protocolo Manchester só publica com a licença registrada.',
      });
    else if (conteudo.licenca.validaAte < ctx.hoje)
      p.push({ codigo: 'licenca-vencida', mensagem: `A licença venceu em ${conteudo.licenca.validaAte}.` });
  }
  const fluxos = new Set<string>();
  for (const f of conteudo.fluxogramas) {
    if (fluxos.has(f.codigo))
      p.push({ codigo: 'fluxograma-repetido', mensagem: 'Fluxograma repetido.', onde: f.codigo });
    fluxos.add(f.codigo);
  }
  const discs = new Set<string>();
  const comDiscriminador = new Set<string>();
  for (const d of conteudo.discriminadores) {
    const chave = `${d.fluxograma}/${d.codigo}`;
    if (discs.has(chave))
      p.push({
        codigo: 'discriminador-repetido',
        mensagem: 'Discriminador repetido no fluxograma.',
        onde: chave,
      });
    discs.add(chave);
    if (!fluxos.has(d.fluxograma))
      p.push({
        codigo: 'fluxograma-inexistente',
        mensagem: 'O discriminador aponta para um fluxograma que a versão não tem.',
        onde: chave,
      });
    comDiscriminador.add(d.fluxograma);
    if (d.regra !== null) {
      const r = problemasDaRegra(d.regra);
      if (r.length > 0) p.push({ codigo: 'regra-invalida', mensagem: r.join('; '), onde: chave });
    }
  }
  for (const f of fluxos)
    if (!comDiscriminador.has(f))
      p.push({ codigo: 'fluxograma-sem-discriminador', mensagem: 'Fluxograma sem discriminador.', onde: f });
  if (ctx.autor.trim().toUpperCase() === ctx.aprovador.trim().toUpperCase())
    p.push({ codigo: 'autoaprovacao', mensagem: 'Quem aprova a versão não pode ser quem a escreveu.' });
  return p;
}

/** Os discriminadores de um fluxograma da versão. */
export function discriminadoresDoFluxograma(
  conteudo: Pick<ConteudoProtocolo, 'discriminadores'>,
  fluxograma: string,
): Discriminador[] {
  return conteudo.discriminadores.filter((d) => d.fluxograma === fluxograma);
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, ordenar((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/**
 * JSON canônico do conteúdo (chaves em ordem, sem espaço): a entrada do SHA-256 da impressão digital da versão.
 * A ordem das listas é a do autor (a ordem dos discriminadores é a da tela) e entra na impressão.
 */
export function conteudoCanonico(conteudo: ConteudoProtocolo): string {
  return JSON.stringify(ordenar(conteudo));
}

/** A versão publicada não muda: qualquer alteração vira rascunho de uma versão nova. */
export function podeEditarVersao(situacao: 'rascunho' | 'publicado' | 'substituido'): boolean {
  return situacao === 'rascunho';
}

/** As linhas que a versão desdobra (cores com a prioridade e discriminadores na ordem do autor), para a gravação. */
export function linhasDaVersao(conteudo: ConteudoProtocolo): {
  cores: {
    cor: CorRisco;
    nome: string;
    prioridade: number;
    tempoAlvoMin: number;
    opcaoE08: number | null;
    corLegado: number | null;
  }[];
  discriminadores: {
    fluxograma: string;
    codigo: string;
    titulo: string;
    cor: CorRisco;
    regra: unknown;
    sugereProtocolo: string | null;
  }[];
} {
  return {
    cores: coresEmOrdem(conteudo).map((c) => ({
      cor: c.cor,
      nome: c.nome,
      prioridade: prioridadeDaCor(c.cor),
      tempoAlvoMin: c.tempoAlvoMin,
      opcaoE08: c.opcaoE08,
      corLegado: c.corLegado ?? null,
    })),
    discriminadores: conteudo.discriminadores.map((d) => ({
      fluxograma: d.fluxograma,
      codigo: d.codigo,
      titulo: d.titulo,
      cor: d.cor,
      regra: d.regra ?? null,
      sugereProtocolo: d.sugereProtocolo ?? null,
    })),
  };
}
