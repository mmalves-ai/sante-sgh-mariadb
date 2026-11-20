// Desfazer um vínculo da Rede (M57, regra 1; cap-07 §7.7.3): é apagar SÓ a ligação do índice. Nenhum cadastro de
// paciente muda (nem é apagado): a linha do vínculo fica `desfeito` (com quem, quando e por quê), nos dois bancos, e o
// candidato volta à fila (`reabrir`, marcado como reaberto por uma pessoa: ORIGEM 'humano') ou fica "outra pessoa".
// Nos dois casos o automático não religa o par: só uma pessoa o tira da fila. A pessoa da Rede continua
// existindo (identificador estável; o outro lado pode estar ligado a ela por outro par).
import { ladosDaChave } from './chave.js';
import { espelho, type PlanoIndice, type VinculoIndice } from './indice.js';

export interface PedidoDesfazer {
  readonly chave: string;
  /** As linhas do vínculo lidas de cada banco (0, 1 ou 2; a que falta é reconstruída do espelho). */
  readonly linhas: readonly VinculoIndice[];
  readonly por: string;
  readonly em: string;
  readonly justificativa: string;
  readonly reabrir: boolean;
}

export type ResultadoDesfazer =
  | { readonly resultado: 'plano'; readonly plano: PlanoIndice }
  | { readonly resultado: 'ja_desfeito' | 'inexistente'; readonly chave: string };

export function planejarDesfazer(p: PedidoDesfazer): ResultadoDesfazer {
  const lados = ladosDaChave(p.chave);
  const daChave = p.linhas.filter((l) => l.chave === p.chave);
  if (daChave.length === 0) return { resultado: 'inexistente', chave: p.chave };
  if (daChave.every((l) => l.situacao === 'desfeito')) return { resultado: 'ja_desfeito', chave: p.chave };
  const base = daChave.find((l) => l.situacao === 'ativo') as VinculoIndice;
  const porBanco = new Map<string, VinculoIndice>();
  for (const l of [base, espelho(base)]) porBanco.set(l.estabelecimento, l);
  return {
    resultado: 'plano',
    plano: {
      operacao: 'desfazer',
      chave: p.chave,
      pessoa: base.pessoa,
      bancos: lados.map(({ estabelecimento }) => {
        const linha = porBanco.get(estabelecimento) as VinculoIndice;
        return {
          estabelecimento,
          escritas: [
            {
              tabela: 'SGH_REDE_VINCULO',
              acao: 'gravar',
              linha: {
                ...linha,
                situacao: 'desfeito',
                desfeitoPor: p.por,
                desfeitoEm: p.em,
                justificativa: p.justificativa,
              },
            },
            {
              tabela: 'SGH_REDE_CANDIDATO',
              acao: 'mudar_situacao',
              chave: p.chave,
              situacao: p.reabrir ? 'aberto' : 'outra_pessoa',
              origem: 'humano',
              por: p.por,
              em: p.em,
              justificativa: p.justificativa,
            },
          ],
        };
      }),
    },
  };
}
