// Vincular dois cadastros da rede (M57, regras 2 e 4): pela decisão humana na fila ou pelo pareamento automático. A
// pessoa da Rede é a que um dos lados já tem; sem nenhuma, nasce uma nova (identificador estável, sem dado pessoal);
// os dois lados com pessoas DIFERENTES é conflito (alguém desfaz antes; juntar pessoas não é desta etapa). O plano
// grava em cada banco, separado: a pessoa (se ausente), a linha do vínculo do cadastro local e a situação do candidato.
import type { OrigemVinculoRede } from '@sgh/contratos';
import { chavePar, ladosDaChave } from './chave.js';
import type { PlanoBanco, PlanoIndice, VinculoIndice } from './indice.js';
import { espelho } from './indice.js';

export interface LadoCadastro {
  readonly estabelecimento: string;
  readonly id: number;
  readonly prontuario: number;
  /** A pessoa da Rede a que o cadastro já aponta (vínculo ativo no banco dele), ou null. */
  readonly pessoaAtual: string | null;
}

export interface PedidoVincular {
  readonly a: LadoCadastro;
  readonly b: LadoCadastro;
  readonly origem: OrigemVinculoRede;
  /** Login de quem decidiu (no automático, o usuário técnico do pareamento). */
  readonly por: string;
  /** ISO 8601 (UTC). */
  readonly em: string;
  readonly justificativa: string | null;
  /** Gera o identificador de uma pessoa nova (UUID na API; determinístico nos testes). */
  readonly novaPessoa: () => string;
}

export type ResultadoVincular =
  | { readonly resultado: 'plano'; readonly plano: PlanoIndice }
  | { readonly resultado: 'ja_vinculado'; readonly chave: string; readonly pessoa: string }
  | { readonly resultado: 'conflito'; readonly chave: string; readonly motivo: 'pessoas_diferentes' };

const PESSOA = /^[0-9a-z][0-9a-z-]{7,63}$/;

export function planejarVinculo(p: PedidoVincular): ResultadoVincular {
  const chave = chavePar(p.a, p.b);
  const { pessoaAtual: pa } = p.a;
  const { pessoaAtual: pb } = p.b;
  if (pa && pb && pa !== pb) return { resultado: 'conflito', chave, motivo: 'pessoas_diferentes' };
  if (pa && pb && pa === pb) return { resultado: 'ja_vinculado', chave, pessoa: pa };
  const pessoa = pa ?? pb ?? p.novaPessoa();
  if (!PESSOA.test(pessoa)) throw new Error('Identificador de pessoa da Rede fora do formato.');
  const linhaA: VinculoIndice = {
    estabelecimento: p.a.estabelecimento,
    chave,
    pessoa,
    idLocal: p.a.id,
    prontuarioLocal: p.a.prontuario,
    estabelecimentoRemoto: p.b.estabelecimento,
    idRemoto: p.b.id,
    prontuarioRemoto: p.b.prontuario,
    origem: p.origem,
    situacao: 'ativo',
    criadoPor: p.por,
    criadoEm: p.em,
    desfeitoPor: null,
    desfeitoEm: null,
    justificativa: p.justificativa,
  };
  const bancos: PlanoBanco[] = [linhaA, espelho(linhaA)]
    .sort((x, y) => x.estabelecimento.localeCompare(y.estabelecimento))
    .map((linha) => ({
      estabelecimento: linha.estabelecimento,
      escritas: [
        { tabela: 'SGH_REDE_PESSOA', acao: 'inserir_se_ausente', pessoa, em: p.em },
        { tabela: 'SGH_REDE_VINCULO', acao: 'gravar', linha },
        {
          tabela: 'SGH_REDE_CANDIDATO',
          acao: 'mudar_situacao',
          chave,
          situacao: 'vinculado',
          origem: p.origem,
          por: p.por,
          em: p.em,
          justificativa: p.justificativa,
        },
      ],
    }));
  return { resultado: 'plano', plano: { operacao: 'vincular', chave, pessoa, bancos } };
}

/** "É outra pessoa": o par sai da fila nos dois bancos; nenhum vínculo é gravado. */
export function planejarOutraPessoa(
  chave: string,
  por: string,
  em: string,
  justificativa: string,
): PlanoIndice {
  return {
    operacao: 'outra_pessoa',
    chave,
    pessoa: null,
    bancos: ladosDaChave(chave).map(({ estabelecimento }) => ({
      estabelecimento,
      escritas: [
        {
          tabela: 'SGH_REDE_CANDIDATO',
          acao: 'mudar_situacao',
          chave,
          situacao: 'outra_pessoa',
          por,
          em,
          justificativa,
        },
      ],
    })),
  };
}
