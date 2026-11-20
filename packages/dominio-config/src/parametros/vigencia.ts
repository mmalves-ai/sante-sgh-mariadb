// Regra 8 do M08 (gravação): definir parâmetro cria uma VERSÃO nova (linha nova, vigente desde agora) e
// fecha a anterior do mesmo nível e alvo (vigente até agora); com justificativa e autor. Recusas: nível não
// permitido pela definição (422), valor fora do tipo, dos limites ou das opções (422), alvo de unidade ou
// empresa que não é código (422), justificativa curta (400 pelo contrato). Perfis com valores diferentes NÃO
// são recusados (cada perfil tem o seu valor; senão todo perfil ficaria obrigado ao mesmo valor): quem tiver
// os dois perfis cai no nível seguinte, com o conflito explicado (resolver.ts); a gravação devolve o aviso.
import type { DefinicaoParametro, NivelParametro, ValorParametro } from '@sgh/contratos';
import { vigenteEm } from './resolver.js';

export type RecusaParametro =
  | { readonly codigo: 'nivel-nao-permitido'; readonly status: 422; readonly mensagem: string }
  | { readonly codigo: 'valor-invalido'; readonly status: 422; readonly mensagem: string }
  | { readonly codigo: 'alvo-invalido'; readonly status: 422; readonly mensagem: string }
  | { readonly codigo: 'parametro-inexistente'; readonly status: 404; readonly mensagem: string };

export function conferirValor(def: DefinicaoParametro, valor: string): string | null {
  switch (def.tipo) {
    case 'inteiro': {
      if (!/^-?\d{1,9}$/.test(valor)) return 'Informe um número inteiro.';
      const n = Number(valor);
      if (def.minimo !== undefined && n < def.minimo) return `O mínimo é ${def.minimo}.`;
      if (def.maximo !== undefined && n > def.maximo) return `O máximo é ${def.maximo}.`;
      return null;
    }
    case 'booleano':
      return valor === 'sim' || valor === 'nao' ? null : 'Informe sim ou não.';
    case 'lista':
      return def.opcoes?.includes(valor) ? null : `Escolha uma das opções: ${(def.opcoes ?? []).join(', ')}.`;
    case 'texto':
      if (valor.trim() === '') return 'Informe o valor.';
      if (def.formato && !new RegExp(def.formato.expressao, 'i').test(valor.trim()))
        return def.formato.mensagem;
      return null;
  }
}

export interface PlanoDefinicao {
  /** Linhas vigentes do mesmo nível e alvo a fechar (vigente até agora). */
  readonly fechar: readonly string[];
  readonly nova: Omit<ValorParametro, 'id'>;
  /** Avisos que não impedem (ex.: outro perfil com valor diferente). */
  readonly avisos: readonly string[];
}

export function planejarDefinicao(
  def: DefinicaoParametro | undefined,
  pedido: {
    readonly nivel: NivelParametro;
    readonly alvo: string;
    readonly valor: string;
    readonly justificativa: string;
  },
  existentes: readonly ValorParametro[],
  autor: string,
  agora: Date,
): PlanoDefinicao | RecusaParametro {
  if (!def) return { codigo: 'parametro-inexistente', status: 404, mensagem: 'Parâmetro não registrado.' };
  if (!def.niveis.includes(pedido.nivel))
    return {
      codigo: 'nivel-nao-permitido',
      status: 422,
      mensagem: `Este parâmetro só pode ser definido por: ${def.niveis.join(', ')}.`,
    };
  const invalido = conferirValor(def, pedido.valor);
  if (invalido) return { codigo: 'valor-invalido', status: 422, mensagem: invalido };
  // Unidade (TBUNIDAD.COD) e empresa (TBEMPHOS.COD) são SMALLINT no legado: alvo tem de ser o código.
  if ((pedido.nivel === 'unidade' || pedido.nivel === 'empresa') && !/^\d{1,5}$/.test(pedido.alvo))
    return {
      codigo: 'alvo-invalido',
      status: 422,
      mensagem: `Informe o código ${pedido.nivel === 'unidade' ? 'da unidade' : 'da empresa'} (número).`,
    };
  const vigentes = existentes.filter((v) => v.chave === def.chave && vigenteEm(v, agora));
  const avisos =
    pedido.nivel === 'perfil'
      ? vigentes
          .filter((v) => v.nivel === 'perfil' && v.alvo !== pedido.alvo && v.valor !== pedido.valor)
          .map(
            (v) =>
              `O perfil ${v.alvo} define outro valor (${v.valor}): quem tiver os dois perfis segue o nível seguinte (veja "explicar valor").`,
          )
      : [];
  const instante = agora.toISOString();
  return {
    // As abertas (VIGENTE_ATE nulo): a transação confere exatamente estas, com trava.
    fechar: vigentes
      .filter((v) => v.nivel === pedido.nivel && v.alvo === pedido.alvo && v.vigenteAte === null)
      .map((v) => v.id),
    nova: {
      chave: def.chave,
      nivel: pedido.nivel,
      alvo: pedido.alvo,
      valor: pedido.valor,
      vigenteDesde: instante,
      vigenteAte: null,
      justificativa: pedido.justificativa,
      autor,
    },
    avisos,
  };
}

/** W0-09: retirar a sobreposição (fechar a vigente do nível e do alvo; o nível volta a herdar). */
export interface PlanoRetirada {
  readonly fechar: readonly string[];
  /** O valor que deixa de valer (vai à resposta; a versão fechada guarda o anterior). */
  readonly valorAnterior: string;
}

export type RecusaRetirada =
  RecusaParametro | { readonly codigo: 'sem-sobreposicao'; readonly status: 409; readonly mensagem: string };

export function planejarRetirada(
  def: DefinicaoParametro | undefined,
  pedido: { readonly nivel: NivelParametro; readonly alvo: string },
  existentes: readonly ValorParametro[],
): PlanoRetirada | RecusaRetirada {
  if (!def) return { codigo: 'parametro-inexistente', status: 404, mensagem: 'Parâmetro não registrado.' };
  if (!def.niveis.includes(pedido.nivel))
    return {
      codigo: 'nivel-nao-permitido',
      status: 422,
      mensagem: `Este parâmetro só pode ser definido por: ${def.niveis.join(', ')}.`,
    };
  const abertas = existentes.filter(
    (v) =>
      v.chave === def.chave && v.nivel === pedido.nivel && v.alvo === pedido.alvo && v.vigenteAte === null,
  );
  const [primeira] = abertas;
  if (!primeira)
    return {
      codigo: 'sem-sobreposicao',
      status: 409,
      mensagem: 'Não há valor vigente neste nível e alvo: ele já herda do nível seguinte.',
    };
  return { fechar: abertas.map((v) => v.id), valorAnterior: primeira.valor };
}

export function ehRecusa(x: PlanoDefinicao | RecusaParametro): x is RecusaParametro {
  return 'codigo' in x;
}
