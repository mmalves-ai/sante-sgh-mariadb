// A resposta padronizada do analito qualitativo na digitação do resultado (F3.5, 05-SADT linha 3). O texto digitado (ou
// escolhido na lista da tela) é ligado à resposta ativa do grupo do analito pela descrição, pelo atalho (mnemônico) ou
// pelo código, sem diferença de maiúsculas, acentos nem espaços nas pontas; o atalho vira a descrição por extenso. A
// marca da resposta (anormal, crítica) entra na avaliação do valor, como a faixa faz com o número. Texto livre que não
// é resposta do grupo continua aceito (observação do analista) e não leva resposta.

export interface RespostaDoAnalito {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly mnemonico: string | null;
  readonly anormal: boolean;
  readonly critico: boolean;
}

export interface AvaliacaoDaResposta {
  readonly interpretacao: 'normal' | 'anormal' | 'critico' | null;
  readonly anormal: boolean;
  readonly critico: boolean;
}

const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A resposta do grupo que o texto digitado nomeia: descrição primeiro, depois atalho, depois código; ou nenhuma. */
export function respostaDoTexto(
  texto: string | null,
  respostas: readonly RespostaDoAnalito[],
): RespostaDoAnalito | null {
  if (texto === null) return null;
  const k = chave(texto);
  if (!k) return null;
  return (
    respostas.find((r) => chave(r.descricao) === k) ??
    respostas.find((r) => r.mnemonico !== null && chave(r.mnemonico) === k) ??
    respostas.find((r) => chave(r.codigo) === k) ??
    null
  );
}

/** A marca da resposta escolhida: crítica (avisa como valor crítico), anormal ou normal; sem resposta, nada. */
export function avaliarResposta(r: RespostaDoAnalito | null): AvaliacaoDaResposta {
  if (!r) return { interpretacao: null, anormal: false, critico: false };
  if (r.critico) return { interpretacao: 'critico', anormal: true, critico: true };
  if (r.anormal) return { interpretacao: 'anormal', anormal: true, critico: false };
  return { interpretacao: 'normal', anormal: false, critico: false };
}
