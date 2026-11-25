// Valores habituais da abertura do atendimento: o que a pessoa da recepção costuma usar (unidade, centro de custo,
// convênio, especialidade) entra na ficha quando o paciente não tem atendimento anterior, ou no campo que a herança
// não trouxe. Melhoria sobre o fluxo antigo: o valor habitual tem escopo (o do usuário vence o do estabelecimento,
// campo a campo), nunca passa por cima do que veio do próprio paciente e nunca preenche com item que deixou de valer
// (convênio suspenso, unidade inativa): nesse caso a recepção recebe o aviso e escolhe.
import { CAMPOS_PADRAO_ABERTURA, type CampoPadraoAbertura } from '@sgh/contratos';

/** O item escolhido como habitual: o id, o nome e se ainda pode ser usado na abertura. */
export interface ItemPadrao {
  readonly id: number;
  readonly rotulo: string;
  readonly vale: boolean;
}
/** Os valores habituais de um escopo (campo ausente ou nulo: sem valor habitual). */
export type PadraoAbertura = Readonly<Partial<Record<CampoPadraoAbertura, ItemPadrao | null>>>;
export type OrigemPadrao = 'usuario' | 'estabelecimento';

export interface PadraoEmVigor {
  readonly campos: Partial<Record<CampoPadraoAbertura, { id: number; rotulo: string; origem: OrigemPadrao }>>;
  readonly avisos: string[];
}

const ROTULO = Object.fromEntries(CAMPOS_PADRAO_ABERTURA.map((c) => [c.campo, c.rotulo])) as Record<
  CampoPadraoAbertura,
  string
>;
const DE: Record<OrigemPadrao, string> = {
  usuario: 'dos seus valores habituais',
  estabelecimento: 'do estabelecimento',
};

/**
 * O valor habitual em vigor de cada campo: o do usuário vence o do estabelecimento. O item que deixou de valer não
 * entra (vale o do escopo seguinte, se houver) e vira aviso para quem o escolheu trocar.
 */
export function resolverPadraoAbertura(
  estabelecimento: PadraoAbertura | null,
  pessoal: PadraoAbertura | null,
): PadraoEmVigor {
  const campos: PadraoEmVigor['campos'] = {};
  const avisos: string[] = [];
  for (const { campo } of CAMPOS_PADRAO_ABERTURA) {
    const escopos: [OrigemPadrao, ItemPadrao | null | undefined][] = [
      ['usuario', pessoal?.[campo]],
      ['estabelecimento', estabelecimento?.[campo]],
    ];
    for (const [origem, item] of escopos) {
      if (!item) continue;
      if (!item.vale) {
        avisos.push(
          `${ROTULO[campo]} habitual ${DE[origem]} (${item.rotulo}) não está mais em uso: escolha outro valor.`,
        );
        continue;
      }
      if (!campos[campo]) campos[campo] = { id: item.id, rotulo: item.rotulo, origem };
    }
  }
  return { campos, avisos };
}

export interface PadraoNaFicha {
  readonly valores: Partial<Record<CampoPadraoAbertura, number>>;
  readonly origens: Partial<Record<CampoPadraoAbertura, OrigemPadrao>>;
  readonly avisos: string[];
}

const preenchido = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== 0;

/**
 * O que os valores habituais preenchem na ficha nova. `herdados` é o que a herança do atendimento anterior já trouxe
 * (vazio para o paciente sem atendimento anterior):
 *   - o campo herdado do paciente fica: o hábito de quem atende nunca troca o dado do paciente;
 *   - a especialidade habitual não entra quando o profissional veio do atendimento anterior (a especialidade é a
 *     dele, e a recepção escolhe entre as que ele atende);
 *   - o convênio habitual traz só o convênio: plano, carteirinha e validade são do paciente e nunca vêm do hábito;
 *   - o aviso do item que deixou de valer só aparece para o campo que ficaria vazio.
 */
export function aplicarPadraoAbertura(
  emVigor: PadraoEmVigor,
  herdados: Readonly<Record<string, string | number | null | undefined>>,
): PadraoNaFicha {
  const valores: PadraoNaFicha['valores'] = {};
  const origens: PadraoNaFicha['origens'] = {};
  const livre = (campo: CampoPadraoAbertura): boolean =>
    !preenchido(herdados[campo]) && !(campo === 'especialidade' && preenchido(herdados['profissional']));
  for (const { campo } of CAMPOS_PADRAO_ABERTURA) {
    const v = emVigor.campos[campo];
    if (!v || !livre(campo)) continue;
    valores[campo] = v.id;
    origens[campo] = v.origem;
  }
  const avisos = emVigor.avisos.filter((a) =>
    CAMPOS_PADRAO_ABERTURA.some(
      (c) => a.startsWith(`${c.rotulo} habitual`) && livre(c.campo) && !valores[c.campo],
    ),
  );
  return { valores, origens, avisos };
}

/** O que mudou na gravação de um escopo: só os campos informados e diferentes do gravado. */
export function mudancasDoPadrao(
  atual: Readonly<Partial<Record<CampoPadraoAbertura, number | null>>>,
  pedido: Readonly<Partial<Record<CampoPadraoAbertura, number | null | undefined>>>,
): { campo: CampoPadraoAbertura; antes: number | null; depois: number | null }[] {
  return CAMPOS_PADRAO_ABERTURA.flatMap(({ campo }) => {
    const depois = pedido[campo];
    const antes = atual[campo] ?? null;
    return depois === undefined || depois === antes ? [] : [{ campo, antes, depois }];
  });
}
