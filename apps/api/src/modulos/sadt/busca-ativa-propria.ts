// Busca ativa de resultados (F8, 05-SADT linha 24), no banco do cliente. As regras são as puras de @sgh/dominio-sadt
// (critico/busca-ativa); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - abrir a fila: cada requisição com resultado liberado DEPOIS da alta do atendimento (crítico, alterado ou cultura
//     positiva) e ainda fora de caso vira um `busca_ativa_resultado` (número da sequência `busca_ativa` do
//     estabelecimento, motivo mais grave, prazo pela gravidade, regra e equipe da regra ativa que abre busca ativa) com
//     os exames em `busca_ativa_resultado_exame` (pendentes). Repetir não duplica (o exame já em caso fica de fora);
//   - contato: cada tentativa vira `busca_ativa_contato` (canal, resultado, orientação, nova coleta combinada, quem e
//     quando) e o caso passa a `em_contato`, com a versão lida (histórico nunca apagado nem alterado);
//   - concluir: grava o desfecho, `concluido_em` e quem concluiu; os exames pendentes ficam `resolvido`;
//   - cancelar: o caso aberto indevidamente fica `cancelado` com o motivo na observação (nada apagado).
import {
  casoAtrasado,
  conferirCancelamentoBuscaAtiva,
  conferirConclusaoBuscaAtiva,
  conferirContatoBuscaAtiva,
  DESFECHOS_BUSCA_ATIVA,
  type MotivoBuscaAtiva,
  motivoDaBuscaAtiva,
  motivoDoCaso,
  prazoDaBuscaAtiva,
  RESULTADOS_CONTATO,
  type SituacaoBuscaAtiva,
  situacaoAposContato,
} from '@sgh/dominio-sadt';
import { ErroOperacao, garantirSequencia, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const BUSCA_ATIVA_RESULTADO = Symbol('BUSCA_ATIVA_RESULTADO');

const T_CASO = 'busca_ativa_resultado';
const T_EXAME = 'busca_ativa_resultado_exame';
const T_CONTATO = 'busca_ativa_contato';
const T_SEQUENCIA = 'sequencia_negocio';
const TABELAS = [T_CASO, T_EXAME, T_CONTATO, T_SEQUENCIA];
const TIPO_SEQUENCIA = 'busca_ativa';
/** Janela da varredura: resultados liberados nos últimos 90 dias. */
const JANELA_DIAS = 90;

type Linha = Record<string, unknown>;
const id = z.number().int().positive();
const data = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

export const esquemaContato = z
  .object({
    versao: z.number().int().positive(),
    contatadoEm: data,
    canal: id.nullable(),
    resultado: z.enum(RESULTADOS_CONTATO),
    orientacao: z.string().trim().max(4000).nullable(),
    novaColetaEm: data.nullable(),
  })
  .strict();

export const esquemaConclusao = z
  .object({
    versao: z.number().int().positive(),
    desfecho: z.enum(DESFECHOS_BUSCA_ATIVA),
    observacao: z.string().trim().max(1000).nullable(),
  })
  .strict();

export const esquemaCancelamento = z
  .object({ versao: z.number().int().positive(), observacao: z.string().trim().max(1000) })
  .strict();

export interface CasoBuscaAtiva {
  readonly id: number;
  readonly numero: string;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: string;
  readonly motivo: string;
  readonly situacao: SituacaoBuscaAtiva;
  readonly desfecho: string | null;
  readonly abertoEm: string;
  readonly prazoEm: string | null;
  readonly atrasado: boolean;
  readonly setor: string | null;
  readonly exames: string;
  readonly tentativas: number;
  readonly ultimoContatoEm: string | null;
  readonly versao: number;
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString();

export class PortaBuscaAtivaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'sadt.busca-ativa');
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Canais de contato ativos e a equipe das regras ativas que abrem busca ativa no estabelecimento. */
  apoio(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio', async (l, est) => ({
      canais: (
        await l.consultar<Linha>(
          'SELECT id, descricao FROM canal_notificacao WHERE ativo ORDER BY descricao LIMIT 100',
          [],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['descricao']) })),
      equipe: await this.equipe(l, est.id, null),
      resultadosContato: RESULTADOS_CONTATO,
      desfechos: DESFECHOS_BUSCA_ATIVA,
    }));
  }

  private async equipe(l: Leitor, est: number, regra: number | null) {
    return (
      await l.consultar<Linha>(
        `SELECT DISTINCT u.id, u.nome FROM equipe_busca_ativa eq
           JOIN regra_busca_ativa rb ON rb.id = eq.regra_busca_ativa_id
           JOIN usuario u ON u.id = eq.usuario_id
          WHERE eq.ativo AND eq.excluido_em IS NULL AND rb.ativo AND rb.acao = 'abrir_busca_ativa'
            AND (rb.estabelecimento_id IS NULL OR rb.estabelecimento_id = ?) AND (? IS NULL OR rb.id = ?)
          ORDER BY u.nome LIMIT 50`,
        [est, regra, regra],
      )
    ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
  }

  /** Resultados liberados depois da alta que ainda não estão em caso (a prévia do que a varredura abre). */
  candidatos(c: ContextoPortaPropria) {
    return this.ler(c, 'candidatos', async (l, est) => this.lerCandidatos(l, est.id, new Date()));
  }

  private async lerCandidatos(l: Leitor, est: number, agora: Date) {
    const desde = new Date(agora.getTime() - JANELA_DIAS * 86_400_000);
    const linhas = await l.consultar<Linha>(
      `SELECT ei.id AS item, ei.exame_id, ei.requisicao_exame_id AS requisicao, r.paciente_id, r.setor_diagnostico_id,
              re.critico, re.anormal, re.liberado_em, COALESCE(a.alta_medica_em, a.saida_em) AS alta_em,
              EXISTS (SELECT 1 FROM resultado_cultura rc
                        LEFT JOIN classificacao_resultado_cultura cc ON cc.id = rc.classificacao_resultado_cultura_id
                       WHERE rc.resultado_exame_id = re.id AND rc.excluido_em IS NULL
                         AND (cc.grupo = 'positiva' OR rc.crescimento = 'com_crescimento')) AS cultura_positiva
         FROM resultado_exame re
         JOIN exame_item ei ON ei.id = re.exame_item_id
         JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
         JOIN atendimento a ON a.id = r.atendimento_id
        WHERE r.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.excluido_em IS NULL
          AND re.liberado_em >= ? AND COALESCE(a.alta_medica_em, a.saida_em) IS NOT NULL
          AND re.liberado_em > COALESCE(a.alta_medica_em, a.saida_em)
          AND NOT EXISTS (SELECT 1 FROM busca_ativa_resultado_exame x
                            JOIN busca_ativa_resultado b ON b.id = x.busca_ativa_resultado_id
                           WHERE x.exame_item_id = ei.id AND x.excluido_em IS NULL AND b.excluido_em IS NULL)
        ORDER BY r.id, ei.sequencia LIMIT 2000`,
      [est, desde],
    );
    const porRequisicao = new Map<
      number,
      {
        paciente: number;
        setor: number | null;
        itens: { item: number; exame: number; motivo: MotivoBuscaAtiva; liberadoEm: Date }[];
      }
    >();
    for (const x of linhas) {
      const liberadoEm = new Date(String(x['liberado_em']));
      const motivo = motivoDaBuscaAtiva({
        critico: bool(x['critico']),
        anormal: bool(x['anormal']),
        culturaPositiva: bool(x['cultura_positiva']),
        liberadoEm,
        altaEm: x['alta_em'] ? new Date(String(x['alta_em'])) : null,
      });
      if (!motivo) continue;
      const r = num(x['requisicao']);
      const g = porRequisicao.get(r) ?? {
        paciente: num(x['paciente_id']),
        setor: numOuNull(x['setor_diagnostico_id']),
        itens: [],
      };
      g.itens.push({ item: num(x['item']), exame: num(x['exame_id']), motivo, liberadoEm });
      porRequisicao.set(r, g);
    }
    return [...porRequisicao.entries()].map(([requisicao, g]) => {
      const motivo = motivoDoCaso(g.itens.map((i) => i.motivo))!;
      const primeira = new Date(Math.min(...g.itens.map((i) => i.liberadoEm.getTime())));
      return {
        requisicao,
        paciente: g.paciente,
        setor: g.setor,
        motivo,
        prazoEm: prazoDaBuscaAtiva(motivo, primeira),
        itens: g.itens,
      };
    });
  }

  /** A fila do estabelecimento (abertos por padrão; `todos` traz os encerrados dos últimos 90 dias). */
  fila(c: ContextoPortaPropria, filtro: { situacao: string | null; paciente: number | null }) {
    return this.ler(c, 'fila', async (l, est) => {
      const agora = new Date();
      const abertos = filtro.situacao === null || filtro.situacao === 'abertos';
      const linhas = await l.consultar<Linha>(
        `SELECT b.*, pf.nome AS paciente_nome, p.numero_prontuario, sd.nome AS setor_nome,
                (SELECT GROUP_CONCAT(e.nome ORDER BY x.sequencia SEPARATOR ', ') FROM busca_ativa_resultado_exame x
                   JOIN exame_item ei ON ei.id = x.exame_item_id JOIN exame e ON e.id = ei.exame_id
                  WHERE x.busca_ativa_resultado_id = b.id AND x.excluido_em IS NULL) AS exames,
                (SELECT COUNT(*) FROM busca_ativa_contato t WHERE t.busca_ativa_resultado_id = b.id) AS tentativas,
                (SELECT MAX(t.contatado_em) FROM busca_ativa_contato t WHERE t.busca_ativa_resultado_id = b.id) AS ultimo
           FROM busca_ativa_resultado b
           JOIN paciente p ON p.id = b.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN setor_diagnostico sd ON sd.id = b.setor_diagnostico_id
          WHERE b.estabelecimento_id = ? AND b.excluido_em IS NULL AND (? IS NULL OR b.paciente_id = ?)
            AND (${abertos ? "b.situacao IN ('aberto','em_contato','suspenso')" : 'b.aberto_em >= ?'})
          ORDER BY b.situacao IN ('concluido','cancelado'), b.prazo_em IS NULL, b.prazo_em, b.id LIMIT 500`,
        abertos
          ? [est.id, filtro.paciente, filtro.paciente]
          : [est.id, filtro.paciente, filtro.paciente, new Date(agora.getTime() - JANELA_DIAS * 86_400_000)],
      );
      return linhas.map((x): CasoBuscaAtiva => {
        const situacao = String(x['situacao']) as SituacaoBuscaAtiva;
        const prazo = x['prazo_em'] ? new Date(String(x['prazo_em'])) : null;
        return {
          id: num(x['id']),
          numero: String(x['numero']),
          paciente: num(x['paciente_id']),
          pacienteNome: String(x['paciente_nome']),
          prontuario: String(x['numero_prontuario']),
          motivo: String(x['motivo']),
          situacao,
          desfecho: txtOuNull(x['desfecho']),
          abertoEm: iso(x['aberto_em'])!,
          prazoEm: iso(x['prazo_em']),
          atrasado: casoAtrasado(situacao, prazo, agora),
          setor: txtOuNull(x['setor_nome']),
          exames: String(x['exames'] ?? ''),
          tentativas: num(x['tentativas']),
          ultimoContatoEm: iso(x['ultimo']),
          versao: num(x['versao']),
        };
      });
    });
  }

  /** O caso com os exames, as tentativas de contato (histórico) e a equipe da regra. */
  detalhe(c: ContextoPortaPropria, caso: number) {
    return this.ler(c, 'detalhe', async (l, est) => {
      const b = await l.uma(
        `SELECT b.*, u.nome AS concluido_por FROM busca_ativa_resultado b
           LEFT JOIN usuario u ON u.id = b.concluido_por_usuario_id
          WHERE b.id = ? AND b.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [caso, est.id],
      );
      if (!b) throw naoEncontrado('Caso de busca ativa');
      const exames = await l.consultar<Linha>(
        `SELECT x.id, x.situacao, e.nome, re.liberado_em, re.critico, re.anormal FROM busca_ativa_resultado_exame x
           JOIN exame_item ei ON ei.id = x.exame_item_id JOIN exame e ON e.id = ei.exame_id
           LEFT JOIN resultado_exame re ON re.exame_item_id = ei.id AND re.situacao = 'liberado' AND re.excluido_em IS NULL
          WHERE x.busca_ativa_resultado_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
        [caso],
      );
      const contatos = await l.consultar<Linha>(
        `SELECT t.id, t.contatado_em, t.resultado, t.orientacao, t.nova_coleta_marcada_para, cn.descricao AS canal,
                u.nome AS por
           FROM busca_ativa_contato t LEFT JOIN canal_notificacao cn ON cn.id = t.canal_notificacao_id
           LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.busca_ativa_resultado_id = ? ORDER BY t.contatado_em DESC, t.id DESC`,
        [caso],
      );
      return {
        id: num(b['id']),
        numero: String(b['numero']),
        situacao: String(b['situacao']),
        desfecho: txtOuNull(b['desfecho']),
        observacao: txtOuNull(b['observacao']),
        concluidoEm: iso(b['concluido_em']),
        concluidoPor: txtOuNull(b['concluido_por']),
        versao: num(b['versao']),
        exames: exames.map((x) => ({
          id: num(x['id']),
          nome: String(x['nome']),
          situacao: String(x['situacao']),
          liberadoEm: iso(x['liberado_em']),
          critico: bool(x['critico']),
          alterado: bool(x['anormal']),
        })),
        contatos: contatos.map((x) => ({
          id: num(x['id']),
          contatadoEm: iso(x['contatado_em'])!,
          resultado: String(x['resultado']),
          orientacao: txtOuNull(x['orientacao']),
          novaColetaEm: iso(x['nova_coleta_marcada_para']),
          canal: txtOuNull(x['canal']),
          por: txtOuNull(x['por']),
        })),
        equipe: await this.equipe(l, est.id, numOuNull(b['regra_busca_ativa_id'])),
      };
    });
  }

  // ── Gravações ────────────────────────────────────────────────────────────────────────────────────────────

  /** Varre os resultados liberados depois da alta e abre um caso por requisição ainda fora da fila. */
  async abrirPendentes(c: ContextoPortaPropria): Promise<{ abertos: number; exames: number }> {
    const r = await this.gravar(c, 'sadt.busca-ativa.abrir', TABELAS, async (tx, est, usuario) => {
      const agora = new Date();
      const candidatos = await this.lerCandidatos(tx, est.id, agora);
      if (!candidatos.length) return { abertos: 0, exames: 0, tabela: T_CASO, id: null };
      await garantirSequencia(
        tx,
        { tipo: TIPO_SEQUENCIA, estabelecimento: est.id, prefixo: 'BA' },
        { agora, usuario },
      );
      let ultimo: number | null = null;
      let exames = 0;
      for (const k of candidatos) {
        const regra = await this.regraDoCaso(
          tx,
          est.id,
          k.motivo,
          k.itens.map((i) => i.exame),
        );
        const numero = await tx.proximoNumero(TIPO_SEQUENCIA);
        ultimo = await tx.incluir(T_CASO, {
          estabelecimento_id: est.id,
          numero: numero.formatado,
          paciente_id: k.paciente,
          requisicao_exame_id: k.requisicao,
          regra_busca_ativa_id: regra,
          setor_diagnostico_id: k.setor,
          motivo: k.motivo,
          aberto_em: agora,
          prazo_em: k.prazoEm,
          situacao: 'aberto',
        });
        for (const [s, i] of k.itens.entries()) {
          await tx.incluir(T_EXAME, {
            busca_ativa_resultado_id: ultimo,
            sequencia: s + 1,
            exame_item_id: i.item,
            situacao: 'pendente',
          });
          exames++;
        }
      }
      return { abertos: candidatos.length, exames, tabela: T_CASO, id: ultimo };
    });
    return { abertos: r.abertos, exames: r.exames };
  }

  /** A regra ativa que abre busca ativa para o motivo (a do exame antes da geral; a do estabelecimento antes da rede). */
  private async regraDoCaso(tx: TxOperacao, est: number, motivo: MotivoBuscaAtiva, exames: number[]) {
    const gatilhos =
      motivo === 'resultado_critico'
        ? ['valor_critico', 'resultado_apos_alta']
        : ['resultado_alterado', 'cultura_positiva', 'resultado_apos_alta'];
    const r = await tx.uma(
      `SELECT id FROM regra_busca_ativa
        WHERE ativo AND acao = 'abrir_busca_ativa' AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
          AND gatilho IN (${gatilhos.map(() => '?').join(', ')})
          AND (exame_id IS NULL OR exame_id IN (${exames.map(() => '?').join(', ')}))
        ORDER BY exame_id IS NULL, estabelecimento_id IS NULL, id LIMIT 1`,
      [est, ...gatilhos, ...exames],
    );
    return r ? num(r['id']) : null;
  }

  private async casoTravado(tx: TxOperacao, est: number, caso: number) {
    const [b] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, situacao, versao FROM busca_ativa_resultado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [caso, est],
    );
    if (!b) throw naoEncontrado('Caso de busca ativa');
    return { situacao: String(b['situacao']) as SituacaoBuscaAtiva, versao: num(b['versao']) };
  }

  private static conferirVersao(lida: number, atual: number) {
    if (lida !== atual)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Caso alterado por outra pessoa',
        'O caso mudou desde a leitura: abra de novo e repita.',
      );
  }

  /** Registra a tentativa de contato; o caso passa a "em contato". */
  async registrarContato(c: ContextoPortaPropria, caso: number, entrada: unknown) {
    const e = entradaValida(esquemaContato, entrada);
    return this.gravar(c, 'sadt.busca-ativa.contato', [T_CASO, T_CONTATO], async (tx, est, usuario) => {
      const b = await this.casoTravado(tx, est.id, caso);
      const agora = new Date();
      const recusas = conferirContatoBuscaAtiva(
        b.situacao,
        {
          resultado: e.resultado,
          orientacao: e.orientacao,
          contatadoEm: e.contatadoEm,
          novaColetaEm: e.novaColetaEm,
        },
        agora,
      );
      if (recusas.length) throw recusaRegra('Contato recusado', recusas);
      PortaBuscaAtivaPropria.conferirVersao(e.versao, b.versao);
      if (
        e.canal !== null &&
        !(await tx.uma('SELECT id FROM canal_notificacao WHERE id = ? AND ativo', [e.canal]))
      )
        throw naoEncontrado('Canal de contato');
      const contato = await tx.incluir(T_CONTATO, {
        busca_ativa_resultado_id: caso,
        operacao: 'inclusao',
        ocorrido_em: agora,
        usuario_id: usuario,
        contatado_em: e.contatadoEm,
        canal_notificacao_id: e.canal,
        resultado: e.resultado,
        orientacao: e.orientacao || null,
        nova_coleta_marcada_para: e.novaColetaEm,
      });
      const versao = await tx.alterar(T_CASO, caso, b.versao, { situacao: situacaoAposContato(b.situacao) });
      return { contato, versao, tabela: T_CONTATO, id: contato };
    });
  }

  /** Encerra o caso com o desfecho; os exames pendentes ficam resolvidos. */
  async concluir(c: ContextoPortaPropria, caso: number, entrada: unknown) {
    const e = entradaValida(esquemaConclusao, entrada);
    return this.gravar(c, 'sadt.busca-ativa.concluir', [T_CASO, T_EXAME], async (tx, est, usuario) => {
      const b = await this.casoTravado(tx, est.id, caso);
      const contatos = (
        await tx.consultar<Linha>(
          'SELECT resultado FROM busca_ativa_contato WHERE busca_ativa_resultado_id = ?',
          [caso],
        )
      ).map((x) => ({ resultado: String(x['resultado']) as (typeof RESULTADOS_CONTATO)[number] }));
      const recusas = conferirConclusaoBuscaAtiva(b.situacao, e.desfecho, contatos);
      if (recusas.length) throw recusaRegra('Conclusão recusada', recusas);
      PortaBuscaAtivaPropria.conferirVersao(e.versao, b.versao);
      const versao = await tx.alterar(T_CASO, caso, b.versao, {
        situacao: 'concluido',
        desfecho: e.desfecho,
        concluido_em: new Date(),
        concluido_por_usuario_id: usuario,
        observacao: e.observacao || null,
      });
      await this.fecharExames(tx, caso, 'resolvido');
      return { versao, tabela: T_CASO, id: caso };
    });
  }

  /** Cancela o caso aberto indevidamente, com o motivo (nada apagado). */
  async cancelar(c: ContextoPortaPropria, caso: number, entrada: unknown) {
    const e = entradaValida(esquemaCancelamento, entrada);
    return this.gravar(c, 'sadt.busca-ativa.cancelar', [T_CASO, T_EXAME], async (tx, est) => {
      const b = await this.casoTravado(tx, est.id, caso);
      const recusas = conferirCancelamentoBuscaAtiva(b.situacao, e.observacao);
      if (recusas.length) throw recusaRegra('Cancelamento recusado', recusas);
      PortaBuscaAtivaPropria.conferirVersao(e.versao, b.versao);
      const versao = await tx.alterar(T_CASO, caso, b.versao, {
        situacao: 'cancelado',
        observacao: e.observacao,
      });
      await this.fecharExames(tx, caso, 'cancelado');
      return { versao, tabela: T_CASO, id: caso };
    });
  }

  private async fecharExames(tx: TxOperacao, caso: number, situacao: 'resolvido' | 'cancelado') {
    const exames = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao FROM busca_ativa_resultado_exame
        WHERE busca_ativa_resultado_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
      [caso],
    );
    for (const x of exames) await tx.alterar(T_EXAME, num(x['id']), num(x['versao']), { situacao });
  }
}
