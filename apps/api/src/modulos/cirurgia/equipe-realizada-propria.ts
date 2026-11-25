// Equipe realizada do ato cirúrgico (F3.4, 04-CC linha 95), no banco do cliente. Contrato de efeito:
//   - equipe: só leitura. Para o ato do estabelecimento da sessão, cada membro vivo de `participante_cirurgia` (o
//     retirado, com excluido_em, não aparece) com a função, o profissional, o procedimento, a entrada e a saída
//     (nulas = o tempo do paciente na sala), os minutos de participação e o percentual; outro estabelecimento é 404;
//   - levar à conta: para cada par (procedimento do ato, item da conta do mesmo atendimento), a equipe do
//     procedimento entra em `conta_hospitalar_item_participante` pela gravação da equipe do item do faturamento (o
//     mesmo cálculo do valor do ato, a memória do item e o total da conta). Os participantes que o faturista já
//     tinha ficam como estão; cada membro que gera honorário entra uma vez por profissional e função de cobrança; na
//     vaga única do item (cirurgião, anestesista, cada auxiliar) entra quem ficou mais tempo e os demais da troca
//     voltam na resposta (foraDaVaga); a vaga já ocupada no item não muda; a função sem honorário (circulante,
//     pediatra) não entra. Item de outra internação, procedimento de outro ato, função de cobrança não cadastrada e
//     item que não recebe equipe (material, medicamento, diária, taxa; estornado ou transferido; conta fechada:
//     'item-sem-equipe', regra motivoItemSemEquipe do domínio) são recusados sem escrita. Nada é apagado.
//   - a leitura só oferece os itens que recebem equipe (procedimento ou honorário, vivos, de conta editável), com a
//     situação do item; passando de LIMITE_ITENS, avisa (itensContaCortados) em vez de cortar calado.
import {
  equipeDoItemComOAto,
  type MembroParaConta,
  minutosDeParticipacao,
  motivoItemSemEquipe,
  type ParticipanteDoItem,
  SITUACOES_ITEM_SEM_EQUIPE,
  TIPOS_ITEM_COM_EQUIPE,
  tipoCobrancaDaFuncao,
  vagaDaCobranca,
} from '@sgh/dominio-cirurgia';
import { contaEditavel, SITUACOES_CONTA_EDITAVEL } from '@sgh/dominio-faturamento';
import { type ContextoOperacao, ErroOperacao, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { esquemaEquipe, opGravarEquipe } from '../faturamento/conta-movimentos-propria.js';

export const PORTA_EQUIPE_REALIZADA = Symbol('PORTA_EQUIPE_REALIZADA');

const ATO = 'ato_cirurgico';
const PARTICIPANTE = 'participante_cirurgia';
const ITEM_PARTICIPANTE = 'conta_hospitalar_item_participante';
const TABELAS_CONTA = [
  ITEM_PARTICIPANTE,
  'conta_hospitalar_item_memoria',
  'conta_hospitalar_item',
  'conta_hospitalar',
] as const;
const LIMITE_ITENS = 200;

type Linha = Record<string, unknown>;

export interface MembroRealizado {
  readonly participante: number;
  readonly funcao: string;
  readonly funcaoDescricao: string;
  readonly profissional: number;
  readonly profissionalNome: string | null;
  readonly procedimentoAto: number | null;
  readonly procedimentoDescricao: string | null;
  readonly principal: boolean;
  readonly entrada: string | null;
  readonly saida: string | null;
  readonly minutos: number;
  readonly percentual: number | null;
}

export interface EquipeRealizada {
  readonly ato: number;
  readonly numero: string;
  readonly atendimento: number;
  readonly entradaSala: string | null;
  readonly saidaSala: string | null;
  readonly procedimentos: { readonly id: number; readonly sequencia: number; readonly descricao: string }[];
  readonly membros: MembroRealizado[];
  /** Itens das contas da mesma internação, para escolher onde a equipe de cada procedimento entra. */
  /** Só os que recebem equipe: procedimento ou honorário, vivos, de conta editável. */
  readonly itensConta: {
    readonly id: number;
    readonly conta: string;
    readonly descricao: string;
    readonly situacao: string;
  }[];
  /** Há mais itens que recebem equipe do que os listados (LIMITE_ITENS). */
  readonly itensContaCortados: boolean;
}

const esquemaLevar = z
  .object({
    itens: z
      .array(
        z.object({ procedimento: z.number().int().positive(), item: z.number().int().positive() }).strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

const data = (v: unknown): Date | null =>
  v instanceof Date ? v : v ? new Date(String(v).replace(' ', 'T') + 'Z') : null;
const iso = (v: unknown) => data(v)?.toISOString() ?? null;

const recusa = (codigo: string, mensagem: string, campos: string[] = []) =>
  new ErroOperacao(422, codigo, 'Equipe não levada à conta', mensagem, { campos });

const MENSAGEM_SEM_EQUIPE = {
  tipo: 'O item não é procedimento nem honorário: a equipe do ato não entra nele.',
  inativo: 'O item foi estornado ou transferido: a equipe não muda.',
  'conta-fechada': 'A conta não está aberta: reabra-a para levar a equipe.',
} as const;

async function atoDoEstabelecimento(l: Leitor, est: number, ato: number) {
  const [a] = await l.consultar<Linha>(
    `SELECT id, numero, atendimento_id, entrada_sala_em, saida_sala_em FROM ato_cirurgico
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
    [ato, est],
  );
  if (!a) throw naoEncontrado('Ato cirúrgico');
  return a;
}

async function membrosDoAto(l: Leitor, ato: number) {
  return l.consultar<Linha>(
    `SELECT p.id, p.profissional_id, p.ato_cirurgico_procedimento_id, p.principal, p.entrada_em, p.saida_em,
            p.percentual_participacao, f.codigo AS funcao, f.descricao AS funcao_descricao, pf.nome AS profissional_nome,
            pc.descricao AS procedimento_descricao
       FROM participante_cirurgia p
       JOIN funcao_equipe_cirurgica f ON f.id = p.funcao_equipe_cirurgica_id
       LEFT JOIN profissional pr ON pr.id = p.profissional_id
       LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
       LEFT JOIN ato_cirurgico_procedimento ap ON ap.id = p.ato_cirurgico_procedimento_id
       LEFT JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
      WHERE p.ato_cirurgico_id = ? AND p.excluido_em IS NULL
      ORDER BY p.sequencia`,
    [ato],
  );
}

export class PortaEquipeRealizadaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [ATO, PARTICIPANTE, ...TABELAS_CONTA], 'cirurgia.equipe-realizada');
  }

  /** A equipe realizada do ato, membro a membro, com os tempos e os minutos de participação. */
  equipe(c: ContextoPortaPropria, ato: number): Promise<EquipeRealizada> {
    return this.ler(c, 'equipe', async (l, est) => {
      const a = await atoDoEstabelecimento(l, est.id, ato);
      const entradaSala = data(a['entrada_sala_em']);
      const saidaSala = data(a['saida_sala_em']);
      const procs = await l.consultar<Linha>(
        `SELECT ap.id, ap.sequencia, pc.descricao FROM ato_cirurgico_procedimento ap
           JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
          WHERE ap.ato_cirurgico_id = ? AND ap.excluido_em IS NULL ORDER BY ap.sequencia`,
        [ato],
      );
      const membros = await membrosDoAto(l, ato);
      const lista = (v: readonly string[]) => v.map(() => '?').join(', ');
      const tipos = lista(TIPOS_ITEM_COM_EQUIPE);
      const inativos = lista(SITUACOES_ITEM_SEM_EQUIPE);
      const editaveis = lista(SITUACOES_CONTA_EDITAVEL);
      const limite = LIMITE_ITENS + 1;
      const itens = await l.consultar<Linha>(
        `SELECT i.id, ch.numero AS conta, f.descricao, i.situacao
           FROM conta_hospitalar_item i
           JOIN conta_hospitalar ch ON ch.id = i.conta_hospitalar_id
           JOIN item_faturavel f ON f.id = i.item_faturavel_id
          WHERE ch.atendimento_id = ? AND ch.estabelecimento_id = ? AND i.excluido_em IS NULL
            AND f.tipo_item IN (${tipos})
            AND i.situacao NOT IN (${inativos})
            AND ch.situacao IN (${editaveis})
          ORDER BY ch.id, i.sequencia
          LIMIT ${limite}`,
        [
          num(a['atendimento_id']),
          est.id,
          ...TIPOS_ITEM_COM_EQUIPE,
          ...SITUACOES_ITEM_SEM_EQUIPE,
          ...SITUACOES_CONTA_EDITAVEL,
        ],
      );
      return {
        ato,
        numero: String(a['numero']),
        atendimento: num(a['atendimento_id']),
        entradaSala: iso(entradaSala),
        saidaSala: iso(saidaSala),
        procedimentos: procs.map((p) => ({
          id: num(p['id']),
          sequencia: num(p['sequencia']),
          descricao: String(p['descricao']),
        })),
        membros: membros.map((m) => ({
          participante: num(m['id']),
          funcao: String(m['funcao']),
          funcaoDescricao: String(m['funcao_descricao']),
          profissional: num(m['profissional_id']),
          profissionalNome: txtOuNull(m['profissional_nome']),
          procedimentoAto: numOuNull(m['ato_cirurgico_procedimento_id']),
          procedimentoDescricao: txtOuNull(m['procedimento_descricao']),
          principal: m['principal'] === true || num(m['principal']) === 1,
          entrada: iso(m['entrada_em']),
          saida: iso(m['saida_em']),
          minutos:
            entradaSala && saidaSala
              ? minutosDeParticipacao(data(m['entrada_em']), data(m['saida_em']), {
                  entrada: entradaSala,
                  saida: saidaSala,
                })
              : 0,
          percentual: numOuNull(m['percentual_participacao']),
        })),
        itensConta: itens.slice(0, LIMITE_ITENS).map((i) => ({
          id: num(i['id']),
          conta: String(i['conta']),
          descricao: String(i['descricao']),
          situacao: String(i['situacao']),
        })),
        itensContaCortados: itens.length > LIMITE_ITENS,
      };
    });
  }

  /** Leva a equipe de cada procedimento do ato ao item da conta escolhido, sem tirar quem o faturista já pôs. */
  async levarParaConta(c: ContextoPortaPropria, ato: number, entrada: unknown) {
    const e = entradaValida(esquemaLevar, entrada ?? {});
    return this.gravar(
      c,
      'cirurgia.equipe-realizada.levar-conta',
      [...TABELAS_CONTA],
      async (tx, est, usuario) => {
        const a = await atoDoEstabelecimento(tx, est.id, ato);
        const membros = await membrosDoAto(tx, ato);
        const cobranca = await tx.consultar<Linha>(
          `SELECT id, tipo_funcao, ordem_auxiliar FROM funcao_equipe_cobranca
          WHERE ativo = TRUE ORDER BY COALESCE(ordem_apresentacao, 1000), id`,
          [],
        );
        const funcaoCobranca = (funcao: string): { id: number; vaga: string | null } | null => {
          const t = tipoCobrancaDaFuncao(funcao);
          if (!t) return null;
          const f = cobranca.find(
            (x) => x['tipo_funcao'] === t.tipo && (t.ordem === null || num(x['ordem_auxiliar']) === t.ordem),
          );
          if (!f)
            throw recusa(
              'funcao-cobranca-inexistente',
              `A função de cobrança de ${funcao} não está cadastrada.`,
              ['itens'],
            );
          return { id: num(f['id']), vaga: vagaDaCobranca(t.tipo, t.ordem) };
        };
        const entradaSala = data(a['entrada_sala_em']);
        const saidaSala = data(a['saida_sala_em']);
        const minutos = (m: Linha) =>
          entradaSala && saidaSala
            ? minutosDeParticipacao(data(m['entrada_em']), data(m['saida_em']), {
                entrada: entradaSala,
                saida: saidaSala,
              })
            : 0;
        const ctx: ContextoOperacao = {
          cliente: this.banco(c),
          estabelecimento: est.id,
          usuario,
          correlacao: 'cirurgia.equipe-realizada.levar-conta',
          chaveIdempotencia: `cirurgia.equipe-realizada.levar-conta:${ato}`,
        };
        const resultado: {
          procedimento: number;
          item: number;
          incluidos: number;
          foraDaVaga: readonly { profissional: number; funcaoCobranca: number }[];
        }[] = [];
        for (const [i, par] of e.itens.entries()) {
          const [proc] = await tx.consultar<Linha>(
            'SELECT id FROM ato_cirurgico_procedimento WHERE id = ? AND ato_cirurgico_id = ? AND excluido_em IS NULL',
            [par.procedimento, ato],
          );
          if (!proc)
            throw recusa('procedimento-de-outro-ato', 'O procedimento não é deste ato.', [
              `itens.${i}.procedimento`,
            ]);
          const [item] = await tx.consultar<Linha>(
            `SELECT i.id, i.situacao, f.tipo_item, ch.situacao AS situacao_conta
               FROM conta_hospitalar_item i
               JOIN conta_hospitalar ch ON ch.id = i.conta_hospitalar_id
               JOIN item_faturavel f ON f.id = i.item_faturavel_id
              WHERE i.id = ? AND ch.atendimento_id = ? AND ch.estabelecimento_id = ? AND i.excluido_em IS NULL`,
            [par.item, num(a['atendimento_id']), est.id],
          );
          if (!item)
            throw recusa('item-de-outra-internacao', 'O item não é de uma conta desta internação.', [
              `itens.${i}.item`,
            ]);
          const motivo = motivoItemSemEquipe({
            tipoItem: String(item['tipo_item']),
            situacao: String(item['situacao']),
            contaEditavel: contaEditavel(String(item['situacao_conta'])),
          });
          if (motivo) throw recusa('item-sem-equipe', MENSAGEM_SEM_EQUIPE[motivo], [`itens.${i}.item`]);
          const doProcedimento: MembroParaConta[] = membros
            .filter((m) => {
              const p = numOuNull(m['ato_cirurgico_procedimento_id']);
              return p === null || p === par.procedimento;
            })
            .map((m) => {
              const f = funcaoCobranca(String(m['funcao']));
              return {
                profissional: num(m['profissional_id']),
                funcaoCobranca: f?.id ?? null,
                vaga: f?.vaga ?? null,
                minutos: minutos(m),
                percentual: numOuNull(m['percentual_participacao']),
              };
            });
          const existentes: (ParticipanteDoItem & { vaga: string | null })[] = (
            await tx.consultar<Linha>(
              `SELECT p.profissional_id, p.funcao_equipe_cobranca_id, p.grau_participacao_termo_terminologia_id,
                    p.percentual_cobranca, p.forma_pagamento, f.tipo_funcao, f.ordem_auxiliar
               FROM conta_hospitalar_item_participante p
               JOIN funcao_equipe_cobranca f ON f.id = p.funcao_equipe_cobranca_id
              WHERE p.conta_hospitalar_item_id = ? AND p.excluido_em IS NULL AND p.transferencia_conta_id IS NULL
              ORDER BY p.sequencia`,
              [par.item],
            )
          ).map((p) => ({
            profissionalId: num(p['profissional_id']),
            funcaoId: num(p['funcao_equipe_cobranca_id']),
            grauId: numOuNull(p['grau_participacao_termo_terminologia_id']),
            percentual: numOuNull(p['percentual_cobranca']),
            formaPagamento: String(p['forma_pagamento']) as ParticipanteDoItem['formaPagamento'],
            vaga: vagaDaCobranca(String(p['tipo_funcao']), numOuNull(p['ordem_auxiliar'])),
          }));
          const equipe = equipeDoItemComOAto(existentes, doProcedimento);
          if (equipe.incluidos > 0)
            await opGravarEquipe.gravar(
              tx,
              esquemaEquipe.parse({ itemId: par.item, participantes: equipe.participantes }),
              ctx,
            );
          resultado.push({
            procedimento: par.procedimento,
            item: par.item,
            incluidos: equipe.incluidos,
            foraDaVaga: equipe.foraDaVaga,
          });
        }
        return { tabela: ATO, id: ato, itens: resultado };
      },
    );
  }
}
