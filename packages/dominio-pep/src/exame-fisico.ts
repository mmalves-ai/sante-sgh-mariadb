// Exame físico estruturado por sistema e região do corpo (03-PEP L97). Regras puras: o que cada achado precisa ter,
// como o achado padronizado (seleção rápida) preenche o sistema, a região e o "normal", o lado do corpo quando a
// região o exige, o público a que o achado se aplica (idade do paciente no momento clínico), achados repetidos ou
// contraditórios no mesmo registro e o resumo por sistema. O achado é parte do registro clínico: nunca é apagado;
// corrigir é suspender o registro pelo fluxo próprio e registrar de novo. Só o autor do registro acrescenta achados,
// enquanto o registro está finalizado ou aguardando a coassinatura.
import type { FalhaRegra } from './farmacovigilancia.js';

export const LATERALIDADES_EXAME = ['direito', 'esquerdo', 'bilateral', 'nao_se_aplica'] as const;
export type LateralidadeExame = (typeof LATERALIDADES_EXAME)[number];
export const PUBLICOS_ACHADO = ['todos', 'adulto', 'pediatrico', 'neonatal', 'gestante'] as const;
export type PublicoAchado = (typeof PUBLICOS_ACHADO)[number];
/** Faixa do paciente no momento clínico (nulo quando a data de nascimento não é conhecida). */
export type FaixaPaciente = 'adulto' | 'pediatrico' | 'neonatal';
export const DESCRICAO_ACHADO_MAXIMA = 2000;
export const ITENS_EXAME_MAXIMO = 200;
/** Situações do registro clínico que aceitam achados novos do autor. */
export const SITUACOES_REGISTRO_COM_EXAME = ['finalizado', 'aguardando_coassinatura'] as const;

const falha = (codigo: string, mensagem: string): FalhaRegra => ({ codigo, mensagem });
const DIA = 86_400_000;

export interface SistemaExame {
  readonly id: number;
  readonly ativo: boolean;
}
export interface RegiaoExame {
  readonly id: number;
  readonly ativo: boolean;
  readonly admiteLateralidade: boolean;
  readonly superiorId: number | null;
}
export interface AchadoPadraoExame {
  readonly id: number;
  readonly ativo: boolean;
  readonly sistemaId: number | null;
  readonly regiaoId: number | null;
  readonly normal: boolean;
  readonly publicoAlvo: string;
}
export interface CatalogoExame {
  readonly sistemas: ReadonlyMap<number, SistemaExame>;
  readonly regioes: ReadonlyMap<number, RegiaoExame>;
  readonly padroes: ReadonlyMap<number, AchadoPadraoExame>;
}

/** Item como chega da tela: sistema e/ou região, achado padronizado opcional, lado, normal e descrição livre. */
export interface ItemExame {
  readonly sistemaId: number | null;
  readonly regiaoId: number | null;
  readonly padraoId: number | null;
  readonly lateralidade: LateralidadeExame;
  readonly normal: boolean | null;
  readonly descricao: string | null;
}
/** Item pronto para gravar: sistema e região completados pelo achado padronizado, descrição aparada. */
export type ItemExameResolvido = ItemExame;

/** Faixa do paciente pela idade no momento clínico: até 28 dias, neonatal; abaixo de 18 anos, pediátrico. */
export function faixaEtariaExame(nascimento: Date | null, em: Date): FaixaPaciente | null {
  if (!nascimento || Number.isNaN(nascimento.getTime())) return null;
  if (em.getTime() - nascimento.getTime() < 28 * DIA) return 'neonatal';
  const n = nascimento;
  let anos = em.getUTCFullYear() - n.getUTCFullYear();
  const antesDoAniversario =
    em.getUTCMonth() < n.getUTCMonth() ||
    (em.getUTCMonth() === n.getUTCMonth() && em.getUTCDate() < n.getUTCDate());
  if (antesDoAniversario) anos -= 1;
  return anos < 18 ? 'pediatrico' : 'adulto';
}

/**
 * O achado padronizado serve ao paciente? 'todos' sempre; faixa desconhecida aceita (sem a data de nascimento não há
 * como recusar); o pediátrico inclui o recém-nascido; o de gestante não serve ao recém-nascido nem à criança pequena
 * (a gestação em si é informação clínica do registro, não do cadastro).
 */
export function padraoServeAoPaciente(publico: string, faixa: FaixaPaciente | null): boolean {
  if (publico === 'todos' || faixa === null) return true;
  if (publico === 'adulto') return faixa === 'adulto';
  if (publico === 'pediatrico') return faixa === 'pediatrico' || faixa === 'neonatal';
  if (publico === 'neonatal') return faixa === 'neonatal';
  if (publico === 'gestante') return faixa !== 'neonatal';
  return false;
}

/** A região `regiao` é a própria `ancestral` ou fica dentro dela na árvore do corpo. */
export function regiaoDentroDe(
  regiao: number,
  ancestral: number,
  regioes: ReadonlyMap<number, RegiaoExame>,
): boolean {
  const vistos = new Set<number>();
  let atual: number | null = regiao;
  while (atual !== null && !vistos.has(atual)) {
    if (atual === ancestral) return true;
    vistos.add(atual);
    atual = regioes.get(atual)?.superiorId ?? null;
  }
  return false;
}

/** Chave do ponto examinado (sistema, região e lado): base para achado repetido e para normal contra alterado. */
const chavePonto = (i: Pick<ItemExame, 'sistemaId' | 'regiaoId' | 'lateralidade'>) =>
  `${i.sistemaId ?? '-'}|${i.regiaoId ?? '-'}|${i.lateralidade}`;
const chaveItem = (i: ItemExame) =>
  `${chavePonto(i)}|${i.padraoId ?? '-'}|${(i.descricao ?? '').trim().toLowerCase()}`;

export interface ValidacaoExame {
  readonly itens: readonly ItemExameResolvido[];
  readonly falhas: readonly FalhaRegra[];
}

/**
 * Confere e completa os itens novos. `existentes` são os achados já gravados no mesmo registro (entram na conferência
 * de repetido e de contradição). As falhas trazem o número do item (1 em diante) para a tela apontar.
 */
export function validarExameFisico(
  itens: readonly ItemExame[],
  catalogo: CatalogoExame,
  faixa: FaixaPaciente | null,
  existentes: readonly ItemExame[] = [],
): ValidacaoExame {
  const falhas: FalhaRegra[] = [];
  if (itens.length === 0) return { itens: [], falhas: [falha('exame-vazio', 'Informe ao menos um achado.')] };
  if (itens.length > ITENS_EXAME_MAXIMO)
    return {
      itens: [],
      falhas: [falha('exame-grande', `No máximo ${ITENS_EXAME_MAXIMO} achados por vez.`)],
    };
  const resolvidos: ItemExameResolvido[] = [];
  itens.forEach((bruto, k) => {
    const n = `Achado ${k + 1}:`;
    let { sistemaId, regiaoId, normal } = bruto;
    const descricao = bruto.descricao?.trim() ? bruto.descricao.trim() : null;
    const padrao = bruto.padraoId !== null ? catalogo.padroes.get(bruto.padraoId) : undefined;
    if (bruto.padraoId !== null) {
      if (!padrao) {
        falhas.push(falha('achado-padrao-inexistente', `${n} o achado padronizado não existe.`));
        return;
      }
      if (!padrao.ativo)
        falhas.push(falha('achado-padrao-inativo', `${n} o achado padronizado está inativo.`));
      if (!padraoServeAoPaciente(padrao.publicoAlvo, faixa))
        falhas.push(
          falha(
            'achado-padrao-outro-publico',
            `${n} o achado padronizado não se aplica à idade do paciente.`,
          ),
        );
      if (padrao.sistemaId !== null) {
        if (sistemaId !== null && sistemaId !== padrao.sistemaId)
          falhas.push(falha('achado-padrao-outro-sistema', `${n} o achado padronizado é de outro sistema.`));
        sistemaId ??= padrao.sistemaId;
      }
      if (padrao.regiaoId !== null) {
        if (regiaoId !== null && !regiaoDentroDe(regiaoId, padrao.regiaoId, catalogo.regioes))
          falhas.push(falha('achado-padrao-outra-regiao', `${n} o achado padronizado é de outra região.`));
        regiaoId ??= padrao.regiaoId;
      }
      if (normal !== null && normal !== padrao.normal)
        falhas.push(
          falha(
            'achado-contraditorio',
            `${n} o achado padronizado ${padrao.normal ? 'descreve o normal' : 'descreve uma alteração'}.`,
          ),
        );
      normal ??= padrao.normal;
    }
    if (sistemaId === null && regiaoId === null)
      falhas.push(falha('sem-sistema-ou-regiao', `${n} indique o sistema ou a região do corpo.`));
    if (sistemaId !== null) {
      const s = catalogo.sistemas.get(sistemaId);
      if (!s) falhas.push(falha('sistema-inexistente', `${n} o sistema não existe.`));
      else if (!s.ativo) falhas.push(falha('sistema-inativo', `${n} o sistema está inativo.`));
    }
    const regiao = regiaoId !== null ? catalogo.regioes.get(regiaoId) : undefined;
    if (regiaoId !== null) {
      if (!regiao) falhas.push(falha('regiao-inexistente', `${n} a região do corpo não existe.`));
      else if (!regiao.ativo) falhas.push(falha('regiao-inativa', `${n} a região do corpo está inativa.`));
    }
    if (regiao?.admiteLateralidade && bruto.lateralidade === 'nao_se_aplica')
      falhas.push(falha('lado-obrigatorio', `${n} indique o lado (direito, esquerdo ou ambos).`));
    if (
      (!regiao || !regiao.admiteLateralidade) &&
      regiaoId !== null &&
      bruto.lateralidade !== 'nao_se_aplica'
    )
      falhas.push(falha('lado-indevido', `${n} esta região não tem lado.`));
    if (regiaoId === null && bruto.lateralidade !== 'nao_se_aplica')
      falhas.push(falha('lado-sem-regiao', `${n} o lado só vale com a região do corpo.`));
    if (descricao && descricao.length > DESCRICAO_ACHADO_MAXIMA)
      falhas.push(
        falha('descricao-longa', `${n} a descrição passa de ${DESCRICAO_ACHADO_MAXIMA} caracteres.`),
      );
    if (normal === false && !padrao && !descricao)
      falhas.push(falha('alteracao-sem-descricao', `${n} descreva a alteração encontrada.`));
    if (normal === null && !padrao && !descricao)
      falhas.push(falha('achado-vazio', `${n} marque normal ou alterado, ou descreva o achado.`));
    resolvidos.push({
      sistemaId,
      regiaoId,
      padraoId: bruto.padraoId,
      lateralidade: bruto.lateralidade,
      normal,
      descricao,
    });
  });
  if (falhas.length) return { itens: [], falhas };

  const todos = [...existentes, ...resolvidos];
  const vistos = new Set(existentes.map(chaveItem));
  resolvidos.forEach((i, k) => {
    const c = chaveItem(i);
    if (vistos.has(c))
      falhas.push(falha('achado-repetido', `Achado ${k + 1}: o mesmo achado já está no exame.`));
    vistos.add(c);
  });
  const estado = new Map<string, Set<boolean>>();
  for (const i of todos) {
    if (i.normal === null) continue;
    const c = chavePonto(i);
    const s = estado.get(c) ?? new Set<boolean>();
    s.add(i.normal);
    estado.set(c, s);
  }
  resolvidos.forEach((i, k) => {
    if (i.normal !== null && estado.get(chavePonto(i))?.size === 2)
      falhas.push(
        falha(
          'normal-e-alterado',
          `Achado ${k + 1}: o mesmo ponto do exame está marcado como normal e como alterado.`,
        ),
      );
  });
  return falhas.length ? { itens: [], falhas } : { itens: resolvidos, falhas: [] };
}

/** O registro aceita achados novos desta pessoa? Só o autor, e só com o registro em vigor. */
export function registroAceitaExame(
  registro: { readonly situacao: string; readonly autorUsuarioId: number },
  usuario: number,
): FalhaRegra[] {
  const f: FalhaRegra[] = [];
  if (!(SITUACOES_REGISTRO_COM_EXAME as readonly string[]).includes(registro.situacao))
    f.push(
      falha(
        'registro-fora-de-vigor',
        'O registro está suspenso ou corrigido: registre o exame num registro novo.',
      ),
    );
  if (registro.autorUsuarioId !== usuario)
    f.push(falha('nao-e-autor', 'Só o autor do registro acrescenta achados do exame físico.'));
  return f;
}

export interface ResumoSistema {
  readonly sistemaId: number | null;
  readonly examinados: number;
  readonly normais: number;
  readonly alterados: number;
}

/** Contagem por sistema (sem sistema, a região diz o lugar): o que foi examinado, normal e alterado. */
export function resumirExamePorSistema(
  itens: readonly Pick<ItemExame, 'sistemaId' | 'normal'>[],
): ResumoSistema[] {
  const m = new Map<number | null, { examinados: number; normais: number; alterados: number }>();
  for (const i of itens) {
    const r = m.get(i.sistemaId) ?? { examinados: 0, normais: 0, alterados: 0 };
    r.examinados += 1;
    if (i.normal === true) r.normais += 1;
    if (i.normal === false) r.alterados += 1;
    m.set(i.sistemaId, r);
  }
  return [...m.entries()].map(([sistemaId, r]) => ({ sistemaId, ...r }));
}

const LADO_TEXTO: Record<string, string> = {
  direito: 'direito',
  esquerdo: 'esquerdo',
  bilateral: 'bilateral',
};

/** Linha de texto do achado para o texto do registro e para a leitura: "Sistema · Região (lado): achado; descrição". */
export function textoAchadoExame(a: {
  readonly sistema: string | null;
  readonly regiao: string | null;
  readonly lateralidade: string;
  readonly achado: string | null;
  readonly normal: boolean | null;
  readonly descricao: string | null;
}): string {
  const lado = LADO_TEXTO[a.lateralidade];
  const onde = [a.sistema, a.regiao ? (lado ? `${a.regiao} (${lado})` : a.regiao) : null]
    .filter(Boolean)
    .join(' · ');
  const oque = [
    a.achado ?? (a.normal === true ? 'sem alterações' : a.normal === false ? 'alterado' : null),
    a.descricao,
  ]
    .filter(Boolean)
    .join('; ');
  return `${onde}: ${oque}`;
}
