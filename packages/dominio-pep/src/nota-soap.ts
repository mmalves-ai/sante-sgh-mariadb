// Nota clínica em quatro partes (subjetivo, objetivo, avaliação e plano) codificada (03-PEP L98). Regras puras:
// configuração aplicável por estabelecimento e especialidade (a mais específica vence), validação do rascunho e da
// assinatura (partes obrigatórias da configuração, CID-10 na avaliação no hospital, classificação da atenção primária
// CIAP-2 só quando a configuração a liga), gestação pela data da última menstruação (data provável do parto pela regra
// de Naegele, idade gestacional em dias), ciclo da nota (rascunho editável só pelo autor; assinada não muda; sem efeito
// com justificativa, nunca apagada) e as sugestões de CID pela correspondência oficial CIAP-2 → CID-10.
import type { FalhaRegra } from './farmacovigilancia.js';

export const PARTES_SOAP = ['subjetivo', 'objetivo', 'avaliacao', 'plano'] as const;
export type ParteSoap = (typeof PARTES_SOAP)[number];
export const TIPOS_NOTA_SOAP = [
  'consulta',
  'retorno',
  'pre_natal',
  'puericultura',
  'teleconsulta',
  'outro',
] as const;
export type TipoNotaSoap = (typeof TIPOS_NOTA_SOAP)[number];
export const CRITICIDADES_NOTA_SOAP = ['baixa', 'media', 'alta'] as const;
export const EDEMAS_NOTA_SOAP = ['0', '+', '++', '+++', '++++'] as const;
export const SITUACOES_NOTA_SOAP = ['rascunho', 'assinada', 'sem_efeito'] as const;
export type SituacaoNotaSoap = (typeof SITUACOES_NOTA_SOAP)[number];
export const TEXTO_PARTE_SOAP_MAXIMO = 20_000;
export const CODIGOS_NOTA_SOAP_MAXIMO = 50;
export const NOTA_CODIGO_MAXIMA = 2000;
/** Idade gestacional máxima aceita (44 semanas e 2 dias), a mesma do CHECK do banco. */
export const IDADE_GESTACIONAL_MAXIMA_DIAS = 310;
/** Regra de Naegele: 280 dias da data da última menstruação à data provável do parto. */
export const DIAS_ATE_PARTO = 280;
export const JUSTIFICATIVA_SEM_EFEITO_MINIMA = 10;

const DIA = 86_400_000;
const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });
const ROTULO_PARTE: Record<ParteSoap, string> = {
  subjetivo: 'subjetivo',
  objetivo: 'objetivo',
  avaliacao: 'avaliação',
  plano: 'plano',
};

export interface ConfiguracaoNotaSoap {
  readonly id: number | null;
  readonly estabelecimentoId: number | null;
  readonly especialidadeId: number | null;
  readonly exigeSubjetivo: boolean;
  readonly exigeObjetivo: boolean;
  readonly exigeAvaliacao: boolean;
  readonly exigePlano: boolean;
  /** A classificação da atenção primária (CIAP-2) aparece e é aceita nos códigos. */
  readonly usaCiap: boolean;
  /** A assinatura exige ao menos um CID-10 na avaliação (padrão do hospital). */
  readonly exigeCidAvaliacao: boolean;
  readonly ativo: boolean;
}

/** Sem configuração gravada: avaliação e plano obrigatórios, CID-10 na avaliação, CIAP-2 desligada. */
export const CONFIGURACAO_NOTA_SOAP_PADRAO: ConfiguracaoNotaSoap = {
  id: null,
  estabelecimentoId: null,
  especialidadeId: null,
  exigeSubjetivo: false,
  exigeObjetivo: false,
  exigeAvaliacao: true,
  exigePlano: true,
  usaCiap: false,
  exigeCidAvaliacao: true,
  ativo: true,
};

/**
 * A configuração que vale para o estabelecimento e a especialidade: a da especialidade no estabelecimento, depois a
 * da especialidade para todos, depois a do estabelecimento, depois a geral; nenhuma ativa, o padrão.
 */
export function configuracaoNotaAplicavel(
  configuracoes: readonly ConfiguracaoNotaSoap[],
  estabelecimentoId: number,
  especialidadeId: number | null,
): ConfiguracaoNotaSoap {
  let melhor: ConfiguracaoNotaSoap | null = null;
  let nota = -1;
  for (const c of configuracoes) {
    if (!c.ativo) continue;
    if (c.estabelecimentoId !== null && c.estabelecimentoId !== estabelecimentoId) continue;
    if (c.especialidadeId !== null && c.especialidadeId !== especialidadeId) continue;
    const n = (c.especialidadeId !== null ? 2 : 0) + (c.estabelecimentoId !== null ? 1 : 0);
    if (n > nota) {
      melhor = c;
      nota = n;
    }
  }
  return melhor ?? CONFIGURACAO_NOTA_SOAP_PADRAO;
}

/** Configuração nova ou alterada: ao menos a avaliação ou o plano obrigatório (a nota não pode nascer vazia). */
export function validarConfiguracaoNota(c: ConfiguracaoNotaSoap & { descricao: string }): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (!c.descricao.trim()) f.push(falha('descricao-obrigatoria', 'Dê um nome à configuração.'));
  if (!c.exigeSubjetivo && !c.exigeObjetivo && !c.exigeAvaliacao && !c.exigePlano)
    f.push(falha('configuracao-sem-parte', 'Ao menos uma parte da nota tem de ser obrigatória.'));
  if (c.exigeCidAvaliacao && !c.exigeAvaliacao)
    f.push(
      falha(
        'cid-sem-avaliacao',
        'O CID-10 obrigatório fica na avaliação: torne a avaliação obrigatória ou desligue o CID obrigatório.',
      ),
    );
  return f;
}

export type SistemaCodigo = 'ciap2' | 'cid10';
export interface TermoCodigoNota {
  readonly id: number;
  readonly sistema: SistemaCodigo;
  readonly codigo: string;
  readonly ativo: boolean;
}
export interface CodigoNotaSoap {
  readonly parte: ParteSoap;
  readonly ciapId: number | null;
  readonly cidId: number | null;
  readonly nota?: string | null;
  readonly incluirListaProblemas: boolean;
}
export interface NotaSoapEntrada {
  readonly tipo: TipoNotaSoap;
  readonly subjetivo: string | null;
  readonly objetivo: string | null;
  readonly avaliacao: string | null;
  readonly plano: string | null;
  readonly criticidade: string | null;
  /** AAAA-MM-DD. */
  readonly dataUltimaMenstruacao: string | null;
  readonly edema: string | null;
  readonly codigos: readonly CodigoNotaSoap[];
}
export interface GestacaoNota {
  /** AAAA-MM-DD. */
  readonly dataProvavelParto: string;
  readonly idadeGestacionalDias: number;
}
export interface ValidacaoNotaSoap {
  readonly falhas: FalhaRegra[];
  readonly avisos: string[];
  readonly gestacao: GestacaoNota | null;
}
export interface CorrespondenciaCiapCid {
  readonly ciapId: number;
  readonly cidId: number;
  readonly preferencial: boolean;
}

const vazio = (s: string | null | undefined) => !s || !s.trim();
const dataIso = (d: Date) => d.toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data provável do parto e idade gestacional (dias completos) no momento da nota; null sem a data válida. */
export function gestacaoPelaDum(dum: string | null, momento: Date): GestacaoNota | null {
  if (!dum || !DATA.test(dum)) return null;
  const d = new Date(`${dum}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || dataIso(d) !== dum) return null;
  const hoje = Date.UTC(momento.getUTCFullYear(), momento.getUTCMonth(), momento.getUTCDate());
  return {
    dataProvavelParto: dataIso(new Date(d.getTime() + DIAS_ATE_PARTO * DIA)),
    idadeGestacionalDias: Math.floor((hoje - d.getTime()) / DIA),
  };
}

/** Semanas e dias ("32s 4d") da idade gestacional. */
export function idadeGestacionalTexto(dias: number): string {
  return `${Math.floor(dias / 7)}s ${dias % 7}d`;
}

/**
 * Valida a nota no rascunho (algo escrito ou codificado; códigos coerentes) e na assinatura (além disso, as partes
 * obrigatórias da configuração, o CID-10 na avaliação quando exigido e a data da última menstruação no pré-natal).
 * `termos` traz os termos citados nos códigos (o sistema e se seguem ativos na edição vigente).
 */
export function validarNotaSoap(
  n: NotaSoapEntrada,
  config: ConfiguracaoNotaSoap,
  termos: ReadonlyMap<number, TermoCodigoNota>,
  momento: 'rascunho' | 'assinatura',
  registradaEm: Date,
  correspondencias: readonly CorrespondenciaCiapCid[] = [],
): ValidacaoNotaSoap {
  const f: FalhaRegra[] = [];
  const avisos: string[] = [];
  if (!(TIPOS_NOTA_SOAP as readonly string[]).includes(n.tipo))
    f.push(falha('tipo-invalido', 'Tipo de nota desconhecido.'));
  for (const p of PARTES_SOAP)
    if ((n[p]?.length ?? 0) > TEXTO_PARTE_SOAP_MAXIMO)
      f.push(
        falha('texto-longo', `A parte ${ROTULO_PARTE[p]} passa de ${TEXTO_PARTE_SOAP_MAXIMO} caracteres.`),
      );
  if (PARTES_SOAP.every((p) => vazio(n[p])) && n.codigos.length === 0)
    f.push(falha('nota-vazia', 'Escreva ao menos uma parte da nota ou lance um código.'));
  if (n.criticidade !== null && !(CRITICIDADES_NOTA_SOAP as readonly string[]).includes(n.criticidade))
    f.push(falha('criticidade-invalida', 'Criticidade desconhecida.'));
  if (n.edema !== null && !(EDEMAS_NOTA_SOAP as readonly string[]).includes(n.edema))
    f.push(falha('edema-invalido', 'Graduação do edema em cruzes: 0 a ++++.'));

  if (n.codigos.length > CODIGOS_NOTA_SOAP_MAXIMO)
    f.push(falha('codigos-demais', `No máximo ${CODIGOS_NOTA_SOAP_MAXIMO} códigos por nota.`));
  const vistos = new Set<string>();
  n.codigos.forEach((c, i) => {
    const pos = `Código ${i + 1}`;
    if (!(PARTES_SOAP as readonly string[]).includes(c.parte))
      f.push(falha('parte-invalida', `${pos}: parte da nota desconhecida.`));
    if (c.ciapId === null && c.cidId === null)
      f.push(falha('codigo-vazio', `${pos}: escolha o CID-10 ou o código da atenção primária.`));
    if (c.ciapId !== null) {
      const t = termos.get(c.ciapId);
      if (!config.usaCiap)
        f.push(
          falha(
            'ciap-desligada',
            `${pos}: a classificação da atenção primária não está ligada nesta configuração.`,
          ),
        );
      else if (!t || t.sistema !== 'ciap2' || !t.ativo)
        f.push(falha('codigo-invalido', `${pos}: código da atenção primária inexistente ou inativo.`));
    }
    if (c.cidId !== null) {
      const t = termos.get(c.cidId);
      if (!t || t.sistema !== 'cid10' || !t.ativo)
        f.push(falha('codigo-invalido', `${pos}: CID-10 inexistente ou inativo.`));
    }
    if ((c.nota?.length ?? 0) > NOTA_CODIGO_MAXIMA)
      f.push(falha('texto-longo', `${pos}: a observação passa de ${NOTA_CODIGO_MAXIMA} caracteres.`));
    if (c.incluirListaProblemas && c.parte !== 'avaliacao')
      f.push(
        falha('problema-fora-da-avaliacao', `${pos}: só o código da avaliação vai à lista de problemas.`),
      );
    const chave = `${c.parte}|${c.ciapId ?? ''}|${c.cidId ?? ''}`;
    if (vistos.has(chave)) f.push(falha('codigo-repetido', `${pos}: o mesmo código já está nesta parte.`));
    vistos.add(chave);
    if (c.ciapId !== null && c.cidId !== null) {
      const possiveis = correspondencias.filter((x) => x.ciapId === c.ciapId);
      if (possiveis.length && !possiveis.some((x) => x.cidId === c.cidId))
        avisos.push(
          `${pos}: o CID-10 escolhido não está entre os correspondentes ao código da atenção primária.`,
        );
    }
  });

  let gestacao: GestacaoNota | null = null;
  if (n.dataUltimaMenstruacao !== null) {
    gestacao = gestacaoPelaDum(n.dataUltimaMenstruacao, registradaEm);
    if (!gestacao) f.push(falha('dum-invalida', 'Data da última menstruação inválida.'));
    else if (gestacao.idadeGestacionalDias < 0)
      f.push(falha('dum-futura', 'A data da última menstruação não pode ser depois da nota.'));
    else if (gestacao.idadeGestacionalDias > IDADE_GESTACIONAL_MAXIMA_DIAS)
      f.push(
        falha(
          'idade-gestacional-invalida',
          'A data da última menstruação dá mais de 44 semanas de gestação: confira a data.',
        ),
      );
  }

  if (momento === 'assinatura') {
    const exige: Record<ParteSoap, boolean> = {
      subjetivo: config.exigeSubjetivo,
      objetivo: config.exigeObjetivo,
      avaliacao: config.exigeAvaliacao,
      plano: config.exigePlano,
    };
    for (const p of PARTES_SOAP)
      if (exige[p] && vazio(n[p]) && !n.codigos.some((c) => c.parte === p))
        f.push(falha('parte-obrigatoria', `Preencha a parte ${ROTULO_PARTE[p]} antes de assinar.`));
    if (config.exigeCidAvaliacao && !n.codigos.some((c) => c.parte === 'avaliacao' && c.cidId !== null))
      f.push(falha('avaliacao-sem-cid', 'Lance ao menos um CID-10 na avaliação antes de assinar.'));
    if (n.tipo === 'pre_natal' && n.dataUltimaMenstruacao === null)
      f.push(falha('dum-obrigatoria', 'A nota de pré-natal exige a data da última menstruação.'));
  }
  return { falhas: f, avisos, gestacao };
}

export type AcaoNotaSoap = 'editar' | 'assinar' | 'sem_efeito';
export interface NotaSoapEstado {
  readonly situacao: SituacaoNotaSoap;
  readonly autorUsuarioId: number | null;
}

/**
 * Ciclo: o rascunho só o autor edita ou assina; a assinada não muda (correção é tornar sem efeito, com justificativa,
 * e escrever outra); a sem efeito fica como histórico. Nada é apagado.
 */
export function acaoNotaSoap(
  nota: NotaSoapEstado,
  usuarioId: number,
  acao: AcaoNotaSoap,
  justificativa: string | null = null,
): FalhaRegra[] {
  if (nota.autorUsuarioId !== usuarioId)
    return [falha('nao-autor', 'Só quem escreveu a nota pode alterá-la, assiná-la ou torná-la sem efeito.')];
  if (nota.situacao === 'sem_efeito') return [falha('nota-sem-efeito', 'A nota já está sem efeito.')];
  if (acao !== 'sem_efeito' && nota.situacao !== 'rascunho')
    return [
      falha(
        'nota-assinada',
        'A nota assinada não muda: torne-a sem efeito com a justificativa e escreva outra.',
      ),
    ];
  if (
    acao === 'sem_efeito' &&
    nota.situacao === 'assinada' &&
    (justificativa ?? '').trim().length < JUSTIFICATIVA_SEM_EFEITO_MINIMA
  )
    return [
      falha(
        'justificativa-obrigatoria',
        `Explique em ao menos ${JUSTIFICATIVA_SEM_EFEITO_MINIMA} caracteres por que a nota assinada fica sem efeito.`,
      ),
    ];
  return [];
}

/** CIDs correspondentes ao código da atenção primária: o preferencial primeiro, depois pela ordem do catálogo. */
export function cidsSugeridos(ciapId: number, correspondencias: readonly CorrespondenciaCiapCid[]): number[] {
  return correspondencias
    .filter((c) => c.ciapId === ciapId)
    .sort((a, b) => Number(b.preferencial) - Number(a.preferencial) || a.cidId - b.cidId)
    .map((c) => c.cidId);
}

/** Texto da nota para o prontuário (uma linha por parte preenchida, os códigos ao fim de cada parte). */
export function textoNotaSoap(
  n: Pick<NotaSoapEntrada, 'subjetivo' | 'objetivo' | 'avaliacao' | 'plano'>,
  codigos: readonly { parte: ParteSoap; rotulo: string }[] = [],
): string {
  const sigla: Record<ParteSoap, string> = { subjetivo: 'S', objetivo: 'O', avaliacao: 'A', plano: 'P' };
  return PARTES_SOAP.flatMap((p) => {
    const cods = codigos.filter((c) => c.parte === p).map((c) => c.rotulo);
    const txt = (n[p] ?? '').trim();
    if (!txt && !cods.length) return [];
    return [`${sigla[p]}: ${txt}${cods.length ? `${txt ? ' ' : ''}[${cods.join('; ')}]` : ''}`];
  }).join('\n');
}

/** A nota nasce em atendimento do paciente que não foi cancelado (o encerrado aceita a nota tardia do atendimento). */
export function atendimentoAceitaNota(situacao: string): FalhaRegra[] {
  return situacao === 'cancelado'
    ? [falha('atendimento-cancelado', 'O atendimento foi cancelado: escolha outro atendimento do paciente.')]
    : [];
}
