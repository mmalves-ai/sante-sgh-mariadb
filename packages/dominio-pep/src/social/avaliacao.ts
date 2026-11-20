// Serviço social (M45, etapa 5; ficha, regra 13; cap-05b §5.9): o risco social calculado pela rede de apoio e pelas
// vulnerabilidades marcadas (a assistente social pode subir o risco, nunca baixar abaixo do calculado), a sugestão de
// avaliação na fila (pessoa idosa ou menor, permanência longa, risco alto sem evolução recente) e o sigilo do parecer:
// dado socioeconômico é sensível (LGPD); o parecer só para a categoria (assistente social, CBO 2516); as demais
// categorias com vínculo assistencial veem o resto (risco, vulnerabilidades, encaminhamentos e orientações à equipe).
// Puro: a API aplica.
import {
  type CategoriaAssistencial,
  type RedeApoio,
  type RegistroSocialLido,
  type RiscoSocial,
  VULNERABILIDADES_SOCIAIS,
  type VulnerabilidadeSocial,
} from '@sgh/contratos';

export type CodigoRecusaSocial = 'risco-abaixo-do-calculado' | 'categoria-nao-autorizada';

export class ErroSocial extends Error {
  override readonly name = 'ErroSocial';
  readonly codigo: CodigoRecusaSocial;
  constructor(codigo: CodigoRecusaSocial, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const PESO_REDE: Readonly<Record<RedeApoio, number>> = { presente: 0, fragil: 1, ausente: 3 };
const ORDEM_RISCO: Readonly<Record<RiscoSocial, number>> = { baixo: 0, medio: 1, alto: 2 };

/** Os pontos do risco social com as parcelas (a rede de apoio e cada vulnerabilidade com o peso). */
export function pontosRiscoSocial(
  rede: RedeApoio,
  vulnerabilidades: readonly VulnerabilidadeSocial[],
): { pontos: number; parcelas: { codigo: string; peso: number }[] } {
  const parcelas: { codigo: string; peso: number }[] = [{ codigo: `rede:${rede}`, peso: PESO_REDE[rede] }];
  for (const v of new Set(vulnerabilidades)) {
    const d = VULNERABILIDADES_SOCIAIS.find((x) => x.codigo === v);
    if (d) parcelas.push({ codigo: v, peso: d.peso });
  }
  return { pontos: parcelas.reduce((s, p) => s + p.peso, 0), parcelas };
}

/** Risco social calculado: 5 pontos ou mais é alto; de 2 a 4, médio; abaixo, baixo. */
export function riscoSocialCalculado(
  rede: RedeApoio,
  vulnerabilidades: readonly VulnerabilidadeSocial[],
): RiscoSocial {
  const { pontos } = pontosRiscoSocial(rede, vulnerabilidades);
  return pontos >= 5 ? 'alto' : pontos >= 2 ? 'medio' : 'baixo';
}

/** O risco escolhido nunca fica abaixo do calculado (a assistente social pode subir). */
export function conferirRiscoSocial(
  escolhido: RiscoSocial,
  rede: RedeApoio,
  vulnerabilidades: readonly VulnerabilidadeSocial[],
): RiscoSocial {
  const calculado = riscoSocialCalculado(rede, vulnerabilidades);
  if (ORDEM_RISCO[escolhido] < ORDEM_RISCO[calculado])
    throw new ErroSocial(
      'risco-abaixo-do-calculado',
      `Pela rede de apoio e pelas vulnerabilidades marcadas, o risco social é ${calculado === 'alto' ? 'alto' : 'médio'}: escolha esse risco ou um maior.`,
    );
  return escolhido;
}

/** Só a assistente social registra e lê o parecer. */
export const CATEGORIA_SERVICO_SOCIAL: CategoriaAssistencial = 'servico-social';

export function daCategoriaSocial(categoria: CategoriaAssistencial | null): boolean {
  return categoria === CATEGORIA_SERVICO_SOCIAL;
}

export function exigirCategoriaSocial(categoria: CategoriaAssistencial | null): void {
  if (!daCategoriaSocial(categoria))
    throw new ErroSocial(
      'categoria-nao-autorizada',
      'A avaliação social é registrada pela assistente social: a sessão precisa do vínculo de assistente social com o conselho ativo.',
    );
}

/** Aplica o sigilo ao registro: o parecer só para a categoria. */
export function comSigiloSocial(
  r: RegistroSocialLido,
  leitor: CategoriaAssistencial | null,
): RegistroSocialLido {
  if (daCategoriaSocial(leitor)) return { ...r, sigilo: false };
  // W0-05: o motivo do adendo e o do estorno também ficam sob sigilo (podem citar o caso).
  return {
    ...r,
    parecer: null,
    sigilo: true,
    motivoAdendo: r.motivoAdendo === null ? null : '',
    correcao: r.correcao === null ? null : { ...r.correcao, motivo: '' },
  };
}

/**
 * Sugestão de avaliação social na fila: sem avaliação, a pessoa idosa (60 ou mais) ou menor de 18, ou 7 dias ou mais de
 * internação; com avaliação de risco alto, a última com mais de 3 dias.
 */
export function avaliacaoSugerida(x: {
  readonly idade: number | null;
  readonly diasInternado: number;
  readonly ultima: { readonly risco: RiscoSocial; readonly em: string } | null;
  readonly hoje: string;
}): boolean {
  if (!x.ultima) return (x.idade !== null && (x.idade >= 60 || x.idade < 18)) || x.diasInternado >= 7;
  if (x.ultima.risco !== 'alto') return false;
  const dias =
    (Date.parse(`${x.hoje.slice(0, 10)}T00:00:00Z`) - Date.parse(`${x.ultima.em.slice(0, 10)}T00:00:00Z`)) /
    86_400_000;
  return dias > 3;
}
