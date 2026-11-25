// Kit padrão no agendamento cirúrgico (F3.6, 05-SUP linha 13), no banco do cliente (`agendamento_cirurgico_material`).
// Contrato de efeito:
//   - sugestão: para cada procedimento vigente do agendamento, o kit padrão do procedimento (vínculo marcado como
//     padrão, kit ativo do estabelecimento) com a composição vigente e se já está na lista; e a lista vigente de
//     materiais previstos do agendamento. Só leitura;
//   - aplicar: os kits escolhidos (todos os sugeridos, quando a escolha não vem) entram na lista como linha de natureza
//     "kit", ligada ao procedimento do agendamento, com a quantidade de kits do vínculo e a sequência seguinte; o kit
//     que já está na lista não entra de novo; a linha do agendamento fica travada na transação (duas aplicações
//     simultâneas passam uma de cada vez); lista fechada pela situação, escolha vazia, repetida ou fora do padrão
//     são recusadas (422) sem escrita;
//   - retirar: só a linha de kit (sem OPME nem implante; as demais naturezas são recusadas com 422, sem escrita) sai
//     da lista com a marca de exclusão (excluido_em/excluido_por) e a versão lida; nunca apagada.
import {
  conferirKitsAgendamento,
  conferirRetiradaMaterial,
  kitJaNaLista,
  type KitPadraoDoAgendamento,
  linhasKitAgendamento,
  listaMaterialAberta,
  type MaterialVigenteAgendamento,
  materialRetiravelPeloKit,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_KIT_AGENDAMENTO = Symbol('PORTA_KIT_AGENDAMENTO');

const AGENDAMENTO = 'agendamento_cirurgico';
const MATERIAL = 'agendamento_cirurgico_material';
const ERRNO_LINHA_MUDOU = 1020;

type Linha = Record<string, unknown>;

export interface ItemKitSugerido {
  readonly insumo: number;
  readonly nome: string;
  readonly unidade: string;
  readonly quantidade: number;
}

export interface KitSugeridoAgendamento extends KitPadraoDoAgendamento {
  readonly procedimento: number;
  readonly procedimentoCodigo: string;
  readonly procedimentoNome: string;
  readonly principal: boolean;
  readonly codigo: string;
  readonly nome: string;
  readonly jaNaLista: boolean;
  readonly itens: ItemKitSugerido[];
}

export interface MaterialAgendamentoLido extends MaterialVigenteAgendamento {
  readonly id: number;
  readonly versao: number;
  readonly sequencia: number;
  readonly natureza: string;
  readonly insumo: number | null;
  readonly nome: string | null;
  readonly quantidade: number;
  /** Se a linha sai por esta retirada (só a linha de kit; OPME e os demais materiais seguem o fluxo próprio). */
  readonly retiravel: boolean;
}

export interface SugestaoKitAgendamento {
  readonly agendamento: number;
  readonly numero: string;
  readonly situacao: string;
  readonly aberta: boolean;
  readonly sugeridos: KitSugeridoAgendamento[];
  readonly materiais: MaterialAgendamentoLido[];
}

const id = z.number().int().positive();
const esquemaAplicar = z
  .object({
    kits: z
      .array(z.object({ kit: id, procedimentoAgendamento: id }).strict())
      .max(50)
      .optional(),
  })
  .strict();
const esquemaRetirar = z.object({ versao: id }).strict();

const SQL_MATERIAIS = `
  SELECT m.id, m.versao, m.sequencia, m.natureza, m.insumo_id, m.kit_material_id,
         m.solicitacao_opme_id, m.implante_permanente,
         m.agendamento_cirurgico_procedimento_id, m.quantidade_solicitada,
         COALESCE(k.nome, i.nome, m.descricao_nao_padronizada) AS nome
    FROM agendamento_cirurgico_material m
    LEFT JOIN kit_material k ON k.id = m.kit_material_id
    LEFT JOIN insumo i ON i.id = m.insumo_id
   WHERE m.agendamento_cirurgico_id = ? AND m.excluido_em IS NULL
   ORDER BY m.sequencia`;

/** A linha como a regra da retirada a lê. */
const linhaRetirada = (r: Linha) => ({
  natureza: String(r['natureza']),
  solicitacaoOpme: numOuNull(r['solicitacao_opme_id']),
  implantePermanente: Boolean(num(r['implante_permanente'])),
});

function materialLido(r: Linha): MaterialAgendamentoLido {
  return {
    retiravel: materialRetiravelPeloKit(linhaRetirada(r)),
    id: num(r['id']),
    versao: num(r['versao']),
    sequencia: num(r['sequencia']),
    natureza: String(r['natureza']),
    insumo: numOuNull(r['insumo_id']),
    kit: numOuNull(r['kit_material_id']),
    procedimentoAgendamento: numOuNull(r['agendamento_cirurgico_procedimento_id']),
    nome: txtOuNull(r['nome']),
    quantidade: num(r['quantidade_solicitada']),
  };
}

/** Os kits padrão dos procedimentos vigentes do agendamento (um por procedimento: o vínculo marcado como padrão). */
async function padroesDoAgendamento(
  l: Leitor,
  est: number,
  agendamento: number,
): Promise<(KitPadraoDoAgendamento & Omit<KitSugeridoAgendamento, 'jaNaLista' | 'itens'>)[]> {
  const rs = await l.consultar<Linha>(
    `SELECT ap.id AS proc_agendamento, ap.procedimento_cirurgico_id, ap.principal, pc.codigo AS proc_codigo,
            pc.descricao AS proc_nome, k.id AS kit, k.codigo, k.nome, kp.quantidade_kits
       FROM agendamento_cirurgico_procedimento ap
       JOIN procedimento_cirurgico pc ON pc.id = ap.procedimento_cirurgico_id
       JOIN kit_material_procedimento kp
         ON kp.procedimento_cirurgico_id = ap.procedimento_cirurgico_id AND kp.padrao AND kp.excluido_em IS NULL
       JOIN kit_material k ON k.id = kp.kit_material_id AND k.ativo AND k.excluido_em IS NULL AND k.estabelecimento_id = ?
      WHERE ap.agendamento_cirurgico_id = ? AND ap.excluido_em IS NULL
      ORDER BY ap.sequencia, kp.id`,
    [est, agendamento],
  );
  return rs.map((r) => ({
    procedimentoAgendamento: num(r['proc_agendamento']),
    procedimento: num(r['procedimento_cirurgico_id']),
    procedimentoCodigo: String(r['proc_codigo'] ?? ''),
    procedimentoNome: String(r['proc_nome'] ?? ''),
    principal: Boolean(num(r['principal'])),
    kit: num(r['kit']),
    codigo: String(r['codigo']),
    nome: String(r['nome']),
    quantidadeKits: num(r['quantidade_kits']),
  }));
}

export class PortaKitAgendamentoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [AGENDAMENTO, MATERIAL], 'cirurgia.agendamento-kit');
  }

  private async agendamentoDoEstabelecimento(l: Leitor, est: number, agendamento: number, travar: boolean) {
    const sql = `SELECT id, numero, situacao FROM agendamento_cirurgico
                  WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`;
    const [a] = travar
      ? await (l as TxOperacao).consultarParaAtualizar<Linha>(sql, [agendamento, est])
      : await l.consultar<Linha>(sql, [agendamento, est]);
    if (!a) throw naoEncontrado('Agendamento cirúrgico');
    return { numero: String(a['numero']), situacao: String(a['situacao']) };
  }

  /** O kit padrão de cada procedimento do agendamento, com a composição, e a lista vigente de materiais previstos. */
  sugestao(c: ContextoPortaPropria, agendamento: number): Promise<SugestaoKitAgendamento> {
    return this.ler(c, 'sugestao', async (l, est) => {
      const a = await this.agendamentoDoEstabelecimento(l, est.id, agendamento, false);
      const padroes = await padroesDoAgendamento(l, est.id, agendamento);
      const materiais = (await l.consultar<Linha>(SQL_MATERIAIS, [agendamento])).map(materialLido);
      const kits = [...new Set(padroes.map((p) => p.kit))];
      const itens = kits.length
        ? await l.consultar<Linha>(
            `SELECT ki.kit_material_id, ki.insumo_id, i.nome, u.sigla, ki.quantidade
               FROM kit_material_item ki
               JOIN insumo i ON i.id = ki.insumo_id
               JOIN unidade_medida u ON u.id = ki.unidade_medida_id
              WHERE ki.excluido_em IS NULL AND ki.kit_material_id IN (${kits.map(() => '?').join(', ')})
              ORDER BY ki.kit_material_id, ki.sequencia`,
            kits,
          )
        : [];
      return {
        agendamento,
        numero: a.numero,
        situacao: a.situacao,
        aberta: listaMaterialAberta(a.situacao),
        sugeridos: padroes.map((p) => ({
          ...p,
          jaNaLista: kitJaNaLista(p, materiais),
          itens: itens
            .filter((i) => num(i['kit_material_id']) === p.kit)
            .map((i) => ({
              insumo: num(i['insumo_id']),
              nome: String(i['nome']),
              unidade: String(i['sigla']),
              quantidade: num(i['quantidade']),
            })),
        })),
        materiais,
      };
    });
  }

  /** Os kits escolhidos (ou todos os sugeridos) entram na lista do agendamento; o que já está nela não entra de novo. */
  async aplicar(c: ContextoPortaPropria, agendamento: number, entrada: unknown) {
    const e = entradaValida(esquemaAplicar, entrada ?? {});
    return this.gravarSemCorrida(c, 'cirurgia.agendamento-kit.aplicar', async (tx, est) => {
      const a = await this.agendamentoDoEstabelecimento(tx, est.id, agendamento, true);
      const padroes = await padroesDoAgendamento(tx, est.id, agendamento);
      const escolhidos =
        e.kits ?? padroes.map((p) => ({ kit: p.kit, procedimentoAgendamento: p.procedimentoAgendamento }));
      const problemas = conferirKitsAgendamento(a.situacao, padroes, escolhidos);
      if (problemas.length) throw recusaRegra('Kit padrão recusado', problemas);
      const todas = await tx.consultar<Linha>(
        `SELECT sequencia, kit_material_id, agendamento_cirurgico_procedimento_id, excluido_em
           FROM agendamento_cirurgico_material WHERE agendamento_cirurgico_id = ?`,
        [agendamento],
      );
      const vigentes = todas
        .filter((r) => r['excluido_em'] === null)
        .map((r) => ({
          kit: numOuNull(r['kit_material_id']),
          procedimentoAgendamento: numOuNull(r['agendamento_cirurgico_procedimento_id']),
        }));
      let sequencia = todas.reduce((m, r) => Math.max(m, num(r['sequencia'])), 0);
      const linhas = linhasKitAgendamento(padroes, vigentes, escolhidos);
      let ultima: number | null = null;
      for (const x of linhas)
        ultima = await tx.incluir(MATERIAL, {
          agendamento_cirurgico_id: agendamento,
          sequencia: ++sequencia,
          agendamento_cirurgico_procedimento_id: x.procedimentoAgendamento,
          natureza: 'kit',
          kit_material_id: x.kit,
          quantidade_solicitada: x.quantidade,
        });
      return {
        tabela: MATERIAL,
        id: ultima,
        agendamento,
        incluidos: linhas.length,
        jaNaLista: escolhidos.length - linhas.length,
      };
    });
  }

  /** A linha sai da lista com a marca de exclusão (nunca é apagada). */
  async retirar(c: ContextoPortaPropria, agendamento: number, material: number, entrada: unknown) {
    const e = entradaValida(esquemaRetirar, entrada);
    return this.gravarSemCorrida(c, 'cirurgia.agendamento-kit.retirar', async (tx, est, usuario) => {
      const a = await this.agendamentoDoEstabelecimento(tx, est.id, agendamento, true);
      const [linha] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, natureza, solicitacao_opme_id, implante_permanente FROM agendamento_cirurgico_material
          WHERE id = ? AND agendamento_cirurgico_id = ? AND excluido_em IS NULL`,
        [material, agendamento],
      );
      if (!linha) throw naoEncontrado('Material do agendamento');
      const problemas = conferirRetiradaMaterial(a.situacao, linhaRetirada(linha));
      if (problemas.length) throw recusaRegra('Retirada recusada', problemas);
      await tx.alterar(MATERIAL, material, e.versao, { excluido_em: new Date(), excluido_por: usuario });
      return { tabela: MATERIAL, id: material, agendamento };
    });
  }

  /**
   * A leitura com trava de uma linha que outra transação confirmou depois do instantâneo desta é recusada pelo banco
   * (erro 1020): vira 409, nada gravado, para a tela reler e tentar de novo.
   */
  private async gravarSemCorrida<T extends Record<string, unknown>>(
    c: ContextoPortaPropria,
    nome: string,
    fn: (
      tx: TxOperacao,
      est: { id: number; fuso: string },
      usuario: number,
    ) => Promise<T & { tabela: string; id: number | null }>,
  ): Promise<T> {
    try {
      return await this.gravar(c, nome, [AGENDAMENTO, MATERIAL], fn);
    } catch (erro) {
      if ((erro as { errno?: unknown } | null)?.errno === ERRNO_LINHA_MUDOU)
        throw new ErroOperacao(
          409,
          'gravacao-concorrente',
          'Gravação simultânea',
          'Outra gravação mudou a lista desta cirurgia ao mesmo tempo. Nada foi gravado: confira e grave de novo.',
        );
      throw erro;
    }
  }
}
