// Escolhas gravam índice, não código (regra 3 da ficha do M09; cap-11 §11.1; ref 04 §1.2): o Delphi grava
// na resposta do registro (campo da escolha) o ItemIndex do combo (ou da lista de marcação) e o texto no campo alfanumérico. O parser
// resolve cada índice pela lista Items do DFM, confirmada pelo ID_RESPOSTA do combo oculto
// (cbxId_Resposta) ou pela ordem da opção do campo; o que não resolver vai ao relatório como pendência, nunca
// adivinhado. Sim/Não (TIPOPERG 4): índice 1 = Não, 2 = Sim, conferido pelo rótulo de cada pergunta.
import { filhoPorNome, listaTextos, type ObjetoDfm } from './leitor.js';

export interface RespostaLegado {
  readonly id: number;
  readonly cod: number | null;
  readonly ordem: number;
  readonly ativo: boolean;
  /** Descrição da opção cadastrada (rótulo cadastrado), quando houver. */
  readonly descricao: string | null;
}

export type OrigemEscolha = 'sim-nao' | 'id-resposta' | 'ordem';

export interface OpcaoResolvida {
  /** ItemIndex gravado pelo Delphi em RESPSNAO. */
  readonly indice: number;
  readonly texto: string;
  readonly idResposta: number | null;
  readonly codigo: number | null;
  /** Sim/Não: o valor lógico da opção. */
  readonly valor?: boolean;
  readonly origem: OrigemEscolha;
}

export interface PendenciaEscolha {
  readonly indice: number | null;
  readonly texto: string | null;
  readonly motivo: string;
  /** Resposta ativa da pergunta com o mesmo rótulo: só sugestão para a conferência, nunca aplicada. */
  readonly sugestaoIdResposta?: number;
}

export interface ResultadoEscolhas {
  readonly opcoes: readonly OpcaoResolvida[];
  readonly pendencias: readonly PendenciaEscolha[];
  /** Índice 0 em branco no combo (sem resposta), como o Delphi mostra. */
  readonly indiceVazio: boolean;
}

function igual(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) =>
    (s ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  return n(a) === n(b);
}

/**
 * Resolve as escolhas de um componente de lista. `subcomponenteRotulos` é o nome do controle com
 * Items.Strings (cbxResp nos combos, clbResp na lista de marcação).
 */
export function resolverEscolhas(
  componente: ObjetoDfm,
  subcomponenteRotulos: string,
  tipoPergunta: string,
  respostas: readonly RespostaLegado[],
): ResultadoEscolhas {
  const controle = filhoPorNome(componente, subcomponenteRotulos);
  const rotulos = listaTextos(controle?.propriedades['Items.Strings']);
  if (!rotulos) {
    return {
      opcoes: [],
      pendencias: [
        { indice: null, texto: null, motivo: `lista ${subcomponenteRotulos}.Items ausente no DFM` },
      ],
      indiceVazio: false,
    };
  }
  const idsTexto = listaTextos(filhoPorNome(componente, 'cbxId_Resposta')?.propriedades['Items.Strings']);
  const ids = idsTexto?.map((s) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null));
  const indiceVazio = rotulos[0] === '';
  const opcoes: OpcaoResolvida[] = [];
  const pendencias: PendenciaEscolha[] = [];
  const porId = new Map(respostas.map((r) => [r.id, r]));
  const ativasPorOrdem = [...respostas]
    .filter((r) => r.ativo)
    .sort((a, b) => a.ordem - b.ordem || a.id - b.id);

  if (tipoPergunta === '4') {
    const nao = rotulos.findIndex((r) => igual(r, 'Não'));
    const sim = rotulos.findIndex((r) => igual(r, 'Sim'));
    if (nao === 1 && sim === 2) {
      // ID_RESPOSTA do combo oculto; sem ele, só a resposta única da pergunta (Sim e Não gravam na mesma
      // linha, com RESPSNAO 1 ou 2). Com mais de uma resposta cadastrada e sem cbxId_Resposta, null e
      // pendência: nunca adivinhado (regra 3).
      const unica = respostas.length === 1 ? (respostas[0]?.id ?? null) : null;
      const id = (i: number) => ids?.[i] ?? unica;
      for (const i of [1, 2]) {
        if (id(i) === null)
          pendencias.push({
            indice: i,
            texto: rotulos[i]!,
            motivo: `Sim/Não sem cbxId_Resposta e com ${respostas.length} respostas cadastradas: ID_RESPOSTA não resolvido`,
          });
      }
      opcoes.push({
        indice: 1,
        texto: rotulos[1]!,
        idResposta: id(1),
        codigo: null,
        valor: false,
        origem: 'sim-nao',
      });
      opcoes.push({
        indice: 2,
        texto: rotulos[2]!,
        idResposta: id(2),
        codigo: null,
        valor: true,
        origem: 'sim-nao',
      });
      for (let i = 3; i < rotulos.length; i++) {
        pendencias.push({ indice: i, texto: rotulos[i]!, motivo: 'Sim/Não com opção além de Não e Sim' });
      }
      return { opcoes, pendencias, indiceVazio };
    }
    pendencias.push({
      indice: null,
      texto: null,
      motivo: 'Sim/Não sem os rótulos Não (índice 1) e Sim (índice 2)',
    });
    return { opcoes, pendencias, indiceVazio };
  }

  const deslocamento = indiceVazio ? 1 : 0;
  for (let i = deslocamento; i < rotulos.length; i++) {
    const texto = rotulos[i]!;
    const id = ids?.[i] ?? null;
    const porIdResposta = id !== null && id > 0 ? porId.get(id) : undefined;
    if (porIdResposta && (porIdResposta.descricao === null || igual(porIdResposta.descricao, texto))) {
      opcoes.push({
        indice: i,
        texto,
        idResposta: porIdResposta.id,
        codigo: porIdResposta.cod,
        origem: 'id-resposta',
      });
      continue;
    }
    const porOrdem = ativasPorOrdem[i - deslocamento];
    if (porOrdem && igual(porOrdem.descricao, texto)) {
      opcoes.push({ indice: i, texto, idResposta: porOrdem.id, codigo: porOrdem.cod, origem: 'ordem' });
      continue;
    }
    let motivo: string;
    if (porIdResposta) motivo = 'rótulo do DFM diferente do cadastro da opção de resposta';
    else if (id !== null && id > 0) motivo = 'ID_RESPOSTA do DFM não pertence à pergunta';
    else if (!ids) motivo = 'sem cbxId_Resposta e sem resposta na mesma ordem com o mesmo rótulo';
    else motivo = 'índice sem ID_RESPOSTA e sem resposta na mesma ordem com o mesmo rótulo';
    const mesmos = respostas.filter((r) => r.ativo && igual(r.descricao, texto));
    pendencias.push(
      mesmos.length === 1
        ? { indice: i, texto, motivo, sugestaoIdResposta: mesmos[0]!.id }
        : { indice: i, texto, motivo },
    );
  }
  return { opcoes, pendencias, indiceVazio };
}
