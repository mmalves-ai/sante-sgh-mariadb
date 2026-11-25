// O contexto da restrição clínica do pedido de exames (F3.5, 05-SADT linha 5): o tipo de atendimento em que o exame é
// pedido, a exceção vigente que libera a regra (do paciente, do setor que pede, do perfil de quem pede ou do
// estabelecimento) e o material do exame escolhido na tela. Regra pura, sem banco: a aplicação lê o cadastro e chama.
import { RecusaPedido, type TipoAtendimento } from './pedido.js';

/**
 * O tipo de atendimento do pedido. O pedido de fora (paciente que só veio fazer o exame) é "externo"; nos demais vale o
 * regime do atendimento pelo código oficial do padrão de troca com as operadoras (01 ambulatorial, 02 domiciliar,
 * 03 internação, 04 pronto-socorro, 05 telessaúde, que é atendimento ambulatorial à distância). Sem regime, a
 * internação aberta para o atendimento decide; sem nada, o tipo fica desconhecido (a regra que o exige vira alerta).
 */
export function tipoAtendimentoDoPedido(a: {
  readonly pedidoExterno: boolean;
  readonly regimeCodigo: string | null;
  readonly temInternacao: boolean;
}): TipoAtendimento | null {
  if (a.pedidoExterno) return 'externo';
  const codigo = (a.regimeCodigo ?? '').trim().replace(/^0+/, '');
  if (codigo === '3') return 'internacao';
  if (codigo === '4') return 'urgencia';
  if (codigo === '2') return 'domiciliar';
  if (codigo === '1' || codigo === '5') return 'ambulatorial';
  return a.temInternacao ? 'internacao' : null;
}

export type AbrangenciaExcecao = 'paciente' | 'setor' | 'perfil' | 'estabelecimento';

/** Uma exceção permanente do cadastro (a exceção pontual do item pedido não entra: ela vale só para aquele item). */
export interface ExcecaoCadastrada {
  readonly id: number;
  readonly regra: number;
  readonly abrangencia: AbrangenciaExcecao;
  readonly estabelecimento: number | null;
  readonly setorFuncional: number | null;
  readonly perfil: number | null;
  readonly paciente: number | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
}

/** Quem pede e para quem: o que a exceção precisa casar. */
export interface AlvoDaExcecao {
  readonly estabelecimento: number;
  readonly paciente: number;
  /** O setor que pede o exame (o setor do atendimento); nulo quando o atendimento não tem setor. */
  readonly setorFuncional: number | null;
  /** Os perfis de acesso vigentes de quem grava o pedido, neste estabelecimento. */
  readonly perfis: readonly number[];
  /** Data do pedido (AAAA-MM-DD) na hora do estabelecimento. */
  readonly data: string;
}

const ORDEM: readonly AbrangenciaExcecao[] = ['paciente', 'setor', 'perfil', 'estabelecimento'];

function casa(e: ExcecaoCadastrada, a: AlvoDaExcecao): boolean {
  if (!e.ativo || e.vigenciaInicio > a.data || (e.vigenciaFim !== null && e.vigenciaFim < a.data))
    return false;
  switch (e.abrangencia) {
    case 'paciente':
      return e.paciente === a.paciente;
    case 'setor':
      return a.setorFuncional !== null && e.setorFuncional === a.setorFuncional;
    case 'perfil':
      return e.perfil !== null && a.perfis.includes(e.perfil);
    case 'estabelecimento':
      return e.estabelecimento === a.estabelecimento;
  }
}

/**
 * A exceção vigente que libera a regra para este pedido, ou nulo. Com mais de uma, vence a mais específica (paciente,
 * depois setor que pede, depois perfil de quem pede, depois o estabelecimento inteiro) e, no empate, a mais antiga: a
 * trilha do item mostra sempre a mesma exceção para o mesmo pedido.
 */
export function excecaoQueLibera(
  excecoes: readonly ExcecaoCadastrada[],
  regra: number,
  alvo: AlvoDaExcecao,
): number | null {
  const validas = excecoes.filter((e) => e.regra === regra && casa(e, alvo));
  if (validas.length === 0) return null;
  validas.sort((x, y) => ORDEM.indexOf(x.abrangencia) - ORDEM.indexOf(y.abrangencia) || x.id - y.id);
  return validas[0]!.id;
}

/** Um material aceito pelo exame, como está no cadastro (só os ativos chegam aqui). */
export interface MaterialDoExame {
  readonly material: number;
  readonly padrao: boolean;
}

/**
 * O material do item pedido: o escolhido na tela, se o exame o aceita, ou o padrão do cadastro (o marcado como padrão;
 * sem marca, o primeiro). Material que o exame não aceita é recusado: o pedido nunca grava um material fora do
 * cadastro do exame, porque a restrição por material, a etiqueta e a coleta partem dele.
 */
export function materialDoItem(escolhido: number | null, aceitos: readonly MaterialDoExame[]): number | null {
  if (escolhido !== null) {
    if (!aceitos.some((m) => m.material === escolhido))
      throw new RecusaPedido(
        'material-invalido',
        aceitos.length === 0
          ? 'Este exame não tem material no cadastro: tire o material do pedido.'
          : 'O material escolhido não é aceito por este exame: escolha um dos materiais do cadastro do exame.',
      );
    return escolhido;
  }
  if (aceitos.length === 0) return null;
  const padrao = aceitos.find((m) => m.padrao);
  return (padrao ?? [...aceitos].sort((x, y) => x.material - y.material)[0]!).material;
}
