// Quem faz o quê na tela de classificação (ficha do M44, regra 1; cap-05a §5.3, Decisão e Ato médico; cap-08 §8.4):
// só o enfermeiro com conselho ativo conclui ou refaz a classificação; o técnico de enfermagem registra os sinais
// vitais na mesma tela; a recepção e as demais categorias não classificam. A permissão (recepcao.classificacao.*)
// vem do perfil; esta conferência roda na hora, sobre a categoria e o conselho do vínculo relidos no servidor, e é a
// mesma na tela (o botão "Concluir" só aparece a quem pode).
// Regra 6 (cap-12 §12.4, Nota): uma fonte de cor por estabelecimento; ligar a classificação própria desliga, na mesma
// mudança, a classificação externa do M34.
import { CHAVE_CLASSIFICACAO_EXTERNA, CHAVE_LIBERACAO_CLASSIFICACAO } from '@sgh/contratos';

/** As categorias do vínculo que importam aqui (as demais caem em `outra`). */
export type CategoriaVinculo = 'enfermeiro' | 'tecnico-enfermagem' | 'medico' | 'administrativo' | 'outra';

export interface AtorClassificacao {
  readonly categoria: CategoriaVinculo;
  /** Conselho (COREN) ativo e válido hoje. */
  readonly conselhoAtivo: boolean;
  /** O vínculo assistencial com o estabelecimento e o local do PA (ficha, seção 5: condição relida). */
  readonly vinculoAssistencial: boolean;
}

export type AcaoClassificacao = 'registrarSinais' | 'concluir' | 'reclassificar';

export type MotivoRecusaClassificacao =
  'sem-vinculo-assistencial' | 'privativo-enfermeiro' | 'conselho-inativo' | 'categoria-nao-registra';

export function recusaDaAcao(
  ator: AtorClassificacao,
  acao: AcaoClassificacao,
): MotivoRecusaClassificacao | null {
  if (!ator.vinculoAssistencial) return 'sem-vinculo-assistencial';
  if (acao === 'registrarSinais')
    return ator.categoria === 'enfermeiro' || ator.categoria === 'tecnico-enfermagem'
      ? null
      : 'categoria-nao-registra';
  if (ator.categoria !== 'enfermeiro') return 'privativo-enfermeiro';
  if (!ator.conselhoAtivo) return 'conselho-inativo';
  return null;
}

/** As ações que a tela oferece ao ator. */
export function acoesPermitidas(ator: AtorClassificacao): AcaoClassificacao[] {
  return (['registrarSinais', 'concluir', 'reclassificar'] as const).filter(
    (a) => recusaDaAcao(ator, a) === null,
  );
}

export interface MudancaLiberacao {
  readonly chave: string;
  readonly ligada: boolean;
}

/**
 * As mudanças de liberação que acompanham a pedida (regra 6): ligar `pa.classificacao` num escopo desliga, na mesma
 * mudança, `integracao.classificacaoExterna` no mesmo escopo, se ela estiver ligada. Desligar a própria não religa a
 * externa (o administrador decide; a tela avisa que o PA fica sem fonte de cor estruturada).
 */
export function mudancasDaFonteDeCor(
  pedida: MudancaLiberacao,
  externaLigada: boolean,
): readonly MudancaLiberacao[] {
  if (pedida.chave === CHAVE_LIBERACAO_CLASSIFICACAO && pedida.ligada && externaLigada)
    return [pedida, { chave: CHAVE_CLASSIFICACAO_EXTERNA, ligada: false }];
  return [pedida];
}

/** A externa não pode ser ligada onde a própria está ligada (a outra metade da regra 6). */
export function recusaLigarExterna(pedida: MudancaLiberacao, propriaLigada: boolean): boolean {
  return pedida.chave === CHAVE_CLASSIFICACAO_EXTERNA && pedida.ligada && propriaLigada;
}
