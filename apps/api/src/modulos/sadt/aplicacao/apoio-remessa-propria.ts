// Laboratório de apoio no banco do cliente (F3.5, 05-SADT linha 14): a remessa de envio com os itens, a etiqueta do
// apoio e a manutenção do de-para de analito e de material. Desenho próprio: abrir a remessa já traz, num clique, as
// amostras coletadas dos exames encaminhados ao apoio que ainda não saíram; o item sem código no apoio aparece marcado
// e segura o fechamento; a etiqueta sai só com identificadores (nenhum dado do paciente). Nada se apaga: o item
// retirado fica cancelado, a remessa cancelada guarda o motivo e o de-para se desativa. A regra mora em
// @sgh/dominio-sadt (apoio/remessa.ts); cada gravação é uma operação do Executor com a trilha na mesma transação.
import {
  type CanalApoio,
  conferirAmostraParaRemessa,
  conferirCodigoApoio,
  conferirFatorConversao,
  conferirMeioEnvio,
  etiquetaDoApoio,
  type EtiquetaApoio,
  RecusaApoio,
  situacaoDaRemessaDepois,
  type SituacaoRemessa,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

const TABELAS = [
  'remessa_laboratorio_apoio',
  'remessa_laboratorio_apoio_item',
  'sequencia_negocio',
  'de_para_analito_apoio',
  'de_para_material_apoio',
];
export const TIPO_NUMERO_REMESSA = 'remessa_laboratorio_apoio';

const id = z.number().int().positive();
export const esquemaAbrirRemessa = z.object({
  laboratorio: id,
  /** Só estas amostras; vazio: todas as pendentes do laboratório. */
  amostras: z.array(id).max(500).default([]),
  observacao: z.string().trim().max(2000).nullable().default(null),
});
export const esquemaAcaoRemessa = z.object({
  acao: z.enum(['fechar', 'reabrir', 'enviar', 'cancelar']),
  meio: z.enum(['integracao', 'portal', 'manual']).default('manual'),
  protocolo: z.string().trim().max(60).nullable().default(null),
  transportador: z.string().trim().max(150).nullable().default(null),
  temperaturaC: z.number().min(-80).max(60).nullable().default(null),
  motivo: z.string().trim().max(500).nullable().default(null),
});
export const esquemaRetirarItem = z.object({ item: id });
export const esquemaDeParaAnalito = z.object({
  id: id.nullable().default(null),
  laboratorio: id,
  exame: id,
  analito: id,
  codigoExameApoio: z.string().max(30),
  codigoAnalitoApoio: z.string().max(30),
  nomeApoio: z.string().trim().max(80).nullable().default(null),
  fatorConversao: z.number().default(1),
  ativo: z.boolean().default(true),
});
export const esquemaDeParaMaterial = z.object({
  id: id.nullable().default(null),
  laboratorio: id,
  material: id,
  codigoApoio: z.string().max(30),
  nomeApoio: z.string().trim().max(80).nullable().default(null),
  ativo: z.boolean().default(true),
});

export interface ItemRemessaLido {
  readonly id: number;
  readonly sequencia: number;
  readonly amostra: number;
  readonly codigoBarras: string;
  readonly exameItem: number;
  readonly exameNome: string;
  readonly codigoExameApoio: string | null;
  readonly codigoMaterialApoio: string | null;
  readonly situacao: string;
}
export interface RemessaLida {
  readonly id: number;
  readonly numero: string;
  readonly laboratorio: number;
  readonly laboratorioNome: string;
  readonly situacao: SituacaoRemessa;
  readonly abertaEm: string;
  readonly enviadaEm: string | null;
  readonly meio: string;
  readonly protocolo: string | null;
  readonly quantidadeAmostras: number;
  readonly itens: readonly ItemRemessaLido[];
  readonly semDePara: number;
}

const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown) => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).slice(0, 19) : null;

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaApoio) throw recusa(e.codigo, e.message);
    throw e;
  }
}

/** As amostras coletadas dos exames encaminhados ao laboratório, ainda fora de remessa ativa. */
const SQL_PENDENTES = `
  SELECT ab.id AS amostra, ab.codigo_barras, ab.situacao AS situacao_amostra, ei.id AS exame_item, ei.situacao AS situacao_exame,
         ex.nome AS exame_nome, ela.codigo_exame_apoio, ei.laboratorio_apoio_id,
         COALESCE(ela.codigo_material_apoio, dpm.codigo_apoio) AS codigo_material_apoio,
         (SELECT COUNT(*) FROM remessa_laboratorio_apoio_item ri
            JOIN remessa_laboratorio_apoio r ON r.id = ri.remessa_laboratorio_apoio_id
           WHERE ri.exame_item_id = ei.id AND ri.excluido_em IS NULL AND ri.situacao <> 'cancelado'
             AND r.excluido_em IS NULL AND r.situacao <> 'cancelada') AS em_remessa
    FROM amostra_biologica_exame abe
    JOIN amostra_biologica ab ON ab.id = abe.amostra_biologica_id AND ab.excluido_em IS NULL
    JOIN exame_item ei ON ei.id = abe.exame_item_id AND ei.excluido_em IS NULL
    JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
    JOIN exame ex ON ex.id = ei.exame_id
    LEFT JOIN exame_laboratorio_apoio ela ON ela.exame_id = ei.exame_id AND ela.laboratorio_apoio_id = ? AND ela.ativo
    LEFT JOIN de_para_material_apoio dpm ON dpm.laboratorio_apoio_id = ? AND dpm.material_biologico_id = ab.material_biologico_id
         AND dpm.ativo AND dpm.excluido_em IS NULL
   WHERE abe.excluido_em IS NULL AND q.estabelecimento_id = ?`;

export class ServicoApoioRemessa {
  private readonly executor: Executor;
  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt-apoio').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private async gravar<T extends { readonly id: number }>(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(tx, est) };
        return { valor: JSON.stringify(saida.valor) };
      },
      alvo: () => ({ tabela, id: saida ? saida.valor.id : null }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt-apoio:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (saida) return (saida as { valor: T }).valor;
    const v = r.resultado['valor'];
    return (typeof v === 'string' ? JSON.parse(v) : null) as T;
  }

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => fn(l, est));
  }

  private async laboratorio(l: Leitor, est: number, lab: number) {
    const r = await l.uma(
      `SELECT id, nome, codigo_cliente_no_apoio, canal_envio FROM laboratorio_apoio
        WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL`,
      [lab, est],
    );
    if (!r)
      throw recusa('laboratorio-inexistente', 'O laboratório de apoio não existe neste estabelecimento.');
    return {
      id: n(r['id']),
      nome: String(r['nome']),
      codigoCliente: t(r['codigo_cliente_no_apoio']),
      canal: String(r['canal_envio']) as CanalApoio,
    };
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  /** As amostras do laboratório que ainda não saíram (o que a remessa nova traz). */
  pendentes(c: ContextoSadt, lab: number) {
    return this.ler(c, async (l, est) => {
      await this.laboratorio(l, est, lab);
      const rs = await l.consultar(
        `${SQL_PENDENTES} AND ei.laboratorio_apoio_id = ? AND ab.situacao NOT IN ('aguardando_coleta','rejeitada','descartada','cancelada')
            AND ei.situacao NOT IN ('cancelado','recusado','liberado','entregue') ORDER BY ab.id, ei.id`,
        [lab, lab, est, lab],
        { teto: 500 },
      );
      return rs
        .filter((r) => n(r['em_remessa']) === 0)
        .map((r) => ({
          amostra: n(r['amostra']),
          codigoBarras: String(r['codigo_barras']),
          exameItem: n(r['exame_item']),
          exameNome: String(r['exame_nome']),
          codigoExameApoio: t(r['codigo_exame_apoio']),
          codigoMaterialApoio: t(r['codigo_material_apoio']),
        }));
    });
  }

  private async lerRemessa(l: Leitor, est: number, remessa: number): Promise<RemessaLida> {
    const r = await l.uma(
      `SELECT r.id, r.numero, r.laboratorio_apoio_id, la.nome AS lab_nome, r.situacao, r.aberta_em, r.enviada_em, r.meio_envio,
              r.protocolo_apoio, r.quantidade_amostras
         FROM remessa_laboratorio_apoio r JOIN laboratorio_apoio la ON la.id = r.laboratorio_apoio_id
        WHERE r.id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL`,
      [remessa, est],
    );
    if (!r) throw recusa('remessa-inexistente', 'A remessa não existe neste estabelecimento.');
    const lab = n(r['laboratorio_apoio_id']);
    const itens = await l.consultar(
      `SELECT ri.id, ri.sequencia, ri.amostra_biologica_id, ab.codigo_barras, ri.exame_item_id, ex.nome AS exame_nome,
              ri.codigo_exame_apoio, ri.situacao, COALESCE(ela.codigo_material_apoio, dpm.codigo_apoio) AS codigo_material_apoio
         FROM remessa_laboratorio_apoio_item ri
         JOIN amostra_biologica ab ON ab.id = ri.amostra_biologica_id
         JOIN exame_item ei ON ei.id = ri.exame_item_id
         JOIN exame ex ON ex.id = ei.exame_id
         LEFT JOIN exame_laboratorio_apoio ela ON ela.exame_id = ei.exame_id AND ela.laboratorio_apoio_id = ? AND ela.ativo
         LEFT JOIN de_para_material_apoio dpm ON dpm.laboratorio_apoio_id = ? AND dpm.material_biologico_id = ab.material_biologico_id
              AND dpm.ativo AND dpm.excluido_em IS NULL
        WHERE ri.remessa_laboratorio_apoio_id = ? AND ri.excluido_em IS NULL ORDER BY ri.sequencia`,
      [lab, lab, remessa],
      { teto: 1000 },
    );
    const lidos: ItemRemessaLido[] = itens.map((i) => ({
      id: n(i['id']),
      sequencia: n(i['sequencia']),
      amostra: n(i['amostra_biologica_id']),
      codigoBarras: String(i['codigo_barras']),
      exameItem: n(i['exame_item_id']),
      exameNome: String(i['exame_nome']),
      codigoExameApoio: t(i['codigo_exame_apoio']),
      codigoMaterialApoio: t(i['codigo_material_apoio']),
      situacao: String(i['situacao']),
    }));
    const ativos = lidos.filter((i) => i.situacao !== 'cancelado');
    return {
      id: n(r['id']),
      numero: String(r['numero']),
      laboratorio: lab,
      laboratorioNome: String(r['lab_nome']),
      situacao: String(r['situacao']) as SituacaoRemessa,
      abertaEm: iso(r['aberta_em']) ?? '',
      enviadaEm: iso(r['enviada_em']),
      meio: String(r['meio_envio']),
      protocolo: t(r['protocolo_apoio']),
      quantidadeAmostras: n(r['quantidade_amostras']),
      itens: lidos,
      semDePara: ativos.filter((i) => !i.codigoExameApoio).length,
    };
  }

  remessa(c: ContextoSadt, remessa: number): Promise<RemessaLida> {
    return this.ler(c, (l, est) => this.lerRemessa(l, est, remessa));
  }

  /** As remessas do estabelecimento, as abertas e fechadas primeiro (sem os itens). */
  remessas(c: ContextoSadt, lab: number | null) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT r.id, r.numero, r.laboratorio_apoio_id, la.nome AS lab_nome, r.situacao, r.aberta_em, r.enviada_em,
                  r.protocolo_apoio, r.quantidade_amostras
             FROM remessa_laboratorio_apoio r JOIN laboratorio_apoio la ON la.id = r.laboratorio_apoio_id
            WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND (? IS NULL OR r.laboratorio_apoio_id = ?)
            ORDER BY FIELD(r.situacao, 'aberta', 'fechada') DESC, r.aberta_em DESC`,
          [est, lab, lab],
          { teto: 200 },
        )
      ).map((r) => ({
        id: n(r['id']),
        numero: String(r['numero']),
        laboratorio: n(r['laboratorio_apoio_id']),
        laboratorioNome: String(r['lab_nome']),
        situacao: String(r['situacao']),
        abertaEm: iso(r['aberta_em']),
        enviadaEm: iso(r['enviada_em']),
        protocolo: t(r['protocolo_apoio']),
        quantidadeAmostras: n(r['quantidade_amostras']),
      })),
    );
  }

  /** As etiquetas do apoio de cada item ativo da remessa (só identificadores). */
  etiquetas(c: ContextoSadt, remessa: number): Promise<(EtiquetaApoio & { item: number })[]> {
    return this.ler(c, async (l, est) => {
      const r = await this.lerRemessa(l, est, remessa);
      const lab = await l.uma('SELECT nome, codigo_cliente_no_apoio FROM laboratorio_apoio WHERE id = ?', [
        r.laboratorio,
      ]);
      return r.itens
        .filter((i) => i.situacao !== 'cancelado')
        .map((i) => ({
          item: i.id,
          ...daRegra(() =>
            etiquetaDoApoio({
              laboratorio: String(lab?.['nome'] ?? r.laboratorioNome),
              codigoCliente: t(lab?.['codigo_cliente_no_apoio']),
              remessa: r.numero,
              sequencia: i.sequencia,
              codigoBarras: i.codigoBarras,
              codigoExameApoio: i.codigoExameApoio,
              codigoMaterialApoio: i.codigoMaterialApoio,
            }),
          ),
        }));
    });
  }

  /** O de-para de analito e de material do laboratório (ativos e inativos: nada se apaga). */
  dePara(c: ContextoSadt, lab: number) {
    return this.ler(c, async (l, est) => {
      await this.laboratorio(l, est, lab);
      const analitos = await l.consultar(
        `SELECT d.id, d.exame_id, ex.nome AS exame_nome, d.analito_id, an.nome AS analito_nome, d.codigo_exame_apoio,
                d.codigo_analito_apoio, d.nome_apoio, d.fator_conversao, d.ativo
           FROM de_para_analito_apoio d JOIN exame ex ON ex.id = d.exame_id JOIN analito an ON an.id = d.analito_id
          WHERE d.laboratorio_apoio_id = ? AND d.excluido_em IS NULL ORDER BY ex.nome, an.nome`,
        [lab],
        { teto: 2000 },
      );
      const materiais = await l.consultar(
        `SELECT d.id, d.material_biologico_id, mb.descricao AS material_nome, d.codigo_apoio, d.nome_apoio, d.ativo
           FROM de_para_material_apoio d JOIN material_biologico mb ON mb.id = d.material_biologico_id
          WHERE d.laboratorio_apoio_id = ? AND d.excluido_em IS NULL ORDER BY mb.descricao`,
        [lab],
        { teto: 500 },
      );
      return {
        analitos: analitos.map((d) => ({
          id: n(d['id']),
          exame: n(d['exame_id']),
          exameNome: String(d['exame_nome']),
          analito: n(d['analito_id']),
          analitoNome: String(d['analito_nome']),
          codigoExameApoio: String(d['codigo_exame_apoio']),
          codigoAnalitoApoio: String(d['codigo_analito_apoio']),
          nomeApoio: t(d['nome_apoio']),
          fatorConversao: Number(d['fator_conversao']),
          ativo: Boolean(n(d['ativo'])),
        })),
        materiais: materiais.map((d) => ({
          id: n(d['id']),
          material: n(d['material_biologico_id']),
          materialNome: String(d['material_nome']),
          codigoApoio: String(d['codigo_apoio']),
          nomeApoio: t(d['nome_apoio']),
          ativo: Boolean(n(d['ativo'])),
        })),
      };
    });
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Abre a remessa com as amostras pendentes do laboratório (ou só as escolhidas), numerada pela sequência. */
  abrir(
    c: ContextoSadt,
    entrada: unknown,
  ): Promise<{ id: number; numero: string; itens: number; semDePara: number }> {
    const p = esquemaAbrirRemessa.parse(entrada);
    return this.gravar(c, 'sadt.apoio.remessa.abrir', 'remessa_laboratorio_apoio', async (tx, est) => {
      await this.laboratorio(tx, est, p.laboratorio);
      const rs = await tx.consultar(
        `${SQL_PENDENTES} AND ${p.amostras.length ? `ab.id IN (${p.amostras.map(() => '?').join(',')})` : 'ei.laboratorio_apoio_id = ?'}
          ORDER BY ab.id, ei.id`,
        [p.laboratorio, p.laboratorio, est, ...(p.amostras.length ? p.amostras : [p.laboratorio])],
        { teto: 1000 },
      );
      const vistas = new Set(rs.map((r) => n(r['amostra'])));
      const faltando = p.amostras.filter((a) => !vistas.has(a));
      if (faltando.length)
        throw recusa(
          'amostra-inexistente',
          `${faltando.length} amostra(s) não existem neste estabelecimento.`,
        );
      const aceitos = rs.filter((r) => {
        const cand = {
          doLaboratorio: nn(r['laboratorio_apoio_id']) === p.laboratorio,
          amostraColetada: !['aguardando_coleta', 'rejeitada', 'descartada', 'cancelada'].includes(
            String(r['situacao_amostra']),
          ),
          emOutraRemessa: n(r['em_remessa']) > 0,
          situacaoExame: String(r['situacao_exame']),
        };
        if (p.amostras.length) {
          daRegra(() => conferirAmostraParaRemessa(cand));
          return true;
        }
        try {
          conferirAmostraParaRemessa(cand);
          return !['liberado', 'entregue', 'recusado'].includes(cand.situacaoExame);
        } catch {
          return false;
        }
      });
      if (aceitos.length === 0)
        throw recusa('remessa-vazia', 'Não há amostras pendentes para este laboratório.');
      const numero = (await tx.proximoNumero(TIPO_NUMERO_REMESSA)).formatado;
      const agora = new Date();
      const remessa = await tx.incluir('remessa_laboratorio_apoio', {
        estabelecimento_id: est,
        numero,
        laboratorio_apoio_id: p.laboratorio,
        situacao: 'aberta',
        aberta_em: agora,
        meio_envio: 'manual',
        quantidade_amostras: new Set(aceitos.map((r) => n(r['amostra']))).size,
        observacao: p.observacao,
      });
      let seq = 0;
      for (const r of aceitos)
        await tx.incluir('remessa_laboratorio_apoio_item', {
          remessa_laboratorio_apoio_id: remessa,
          sequencia: ++seq,
          amostra_biologica_id: n(r['amostra']),
          exame_item_id: n(r['exame_item']),
          codigo_exame_apoio: t(r['codigo_exame_apoio']),
        });
      return {
        id: remessa,
        numero,
        itens: aceitos.length,
        semDePara: aceitos.filter((r) => !r['codigo_exame_apoio']).length,
      };
    });
  }

  /** Retira um item da remessa aberta: o item fica cancelado (nunca apagado) e a contagem de amostras acompanha. */
  retirarItem(c: ContextoSadt, remessa: number, entrada: unknown): Promise<{ id: number; itens: number }> {
    const p = esquemaRetirarItem.parse(entrada);
    return this.gravar(c, 'sadt.apoio.remessa.retirar', 'remessa_laboratorio_apoio_item', async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, situacao, versao FROM remessa_laboratorio_apoio WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [remessa, est],
      );
      if (!r) throw recusa('remessa-inexistente', 'A remessa não existe neste estabelecimento.');
      daRegra(() => situacaoDaRemessaDepois(String(r['situacao']) as SituacaoRemessa, 'incluir'));
      const [i] = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM remessa_laboratorio_apoio_item
          WHERE id = ? AND remessa_laboratorio_apoio_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [p.item, remessa],
      );
      if (!i) throw recusa('item-inexistente', 'O item não está ativo nesta remessa.');
      await tx.alterar('remessa_laboratorio_apoio_item', p.item, n(i['versao']), { situacao: 'cancelado' });
      const q = await tx.uma(
        `SELECT COUNT(*) AS itens, COUNT(DISTINCT amostra_biologica_id) AS amostras FROM remessa_laboratorio_apoio_item
          WHERE remessa_laboratorio_apoio_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [remessa],
      );
      await tx.alterar('remessa_laboratorio_apoio', remessa, n(r['versao']), {
        quantidade_amostras: n(q?.['amostras'] ?? 0),
      });
      return { id: p.item, itens: n(q?.['itens'] ?? 0) };
    });
  }

  /** Fechar, reabrir, enviar (meio coerente com o canal, protocolo do apoio) ou cancelar (com motivo). */
  agir(
    c: ContextoSadt,
    remessa: number,
    entrada: unknown,
  ): Promise<{ id: number; situacao: SituacaoRemessa }> {
    const p = esquemaAcaoRemessa.parse(entrada);
    return this.gravar(c, `sadt.apoio.remessa.${p.acao}`, 'remessa_laboratorio_apoio', async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT id, situacao, versao, laboratorio_apoio_id, aberta_em, observacao FROM remessa_laboratorio_apoio
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [remessa, est],
      );
      if (!r) throw recusa('remessa-inexistente', 'A remessa não existe neste estabelecimento.');
      const q = await tx.uma(
        `SELECT COUNT(*) AS itens, SUM(codigo_exame_apoio IS NULL) AS sem FROM remessa_laboratorio_apoio_item
          WHERE remessa_laboratorio_apoio_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [remessa],
      );
      const nova = daRegra(() =>
        situacaoDaRemessaDepois(String(r['situacao']) as SituacaoRemessa, p.acao, {
          itens: n(q?.['itens'] ?? 0),
          semDePara: n(q?.['sem'] ?? 0),
          motivo: p.motivo,
        }),
      );
      const agora = new Date();
      const dados: Record<string, unknown> = { situacao: nova };
      if (p.acao === 'fechar') dados['fechada_em'] = agora;
      if (p.acao === 'reabrir') dados['fechada_em'] = null;
      if (p.acao === 'enviar') {
        const lab = await this.laboratorio(tx, est, n(r['laboratorio_apoio_id']));
        daRegra(() => conferirMeioEnvio(lab.canal, p.meio));
        Object.assign(dados, {
          enviada_em: agora,
          enviada_por_usuario_id: tx.contexto.usuario,
          meio_envio: p.meio,
          protocolo_apoio: p.protocolo,
          transportador: p.transportador,
          temperatura_envio_c: p.temperaturaC,
        });
      }
      if (p.acao === 'cancelar') {
        const antes = t(r['observacao']);
        dados['observacao'] = `${antes ? `${antes}\n` : ''}Cancelada: ${p.motivo}`.slice(0, 60000);
        const itens = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM remessa_laboratorio_apoio_item
            WHERE remessa_laboratorio_apoio_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
          [remessa],
          { teto: 1000 },
        );
        for (const i of itens)
          await tx.alterar('remessa_laboratorio_apoio_item', n(i['id']), n(i['versao']), {
            situacao: 'cancelado',
          });
      }
      await tx.alterar('remessa_laboratorio_apoio', remessa, n(r['versao']), dados);
      return { id: remessa, situacao: nova };
    });
  }

  /** Inclui ou altera o de-para de analito (desativar é ativo=false; nunca se apaga). */
  salvarDeParaAnalito(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const p = esquemaDeParaAnalito.parse(entrada);
    return this.gravar(c, 'sadt.apoio.depara.analito', 'de_para_analito_apoio', async (tx, est) => {
      await this.laboratorio(tx, est, p.laboratorio);
      const dados = {
        exame_id: p.exame,
        analito_id: p.analito,
        codigo_exame_apoio: daRegra(() => conferirCodigoApoio(p.codigoExameApoio, 'código do exame')),
        codigo_analito_apoio: daRegra(() => conferirCodigoApoio(p.codigoAnalitoApoio, 'código do analito')),
        nome_apoio: p.nomeApoio,
        fator_conversao: daRegra(() => conferirFatorConversao(p.fatorConversao)),
        ativo: p.ativo,
      };
      const repetido = await tx.uma(
        `SELECT id FROM de_para_analito_apoio WHERE laboratorio_apoio_id = ? AND id <> ? AND excluido_em IS NULL
            AND ((exame_id = ? AND analito_id = ?) OR (codigo_exame_apoio = ? AND codigo_analito_apoio = ?))`,
        [p.laboratorio, p.id ?? 0, p.exame, p.analito, dados.codigo_exame_apoio, dados.codigo_analito_apoio],
      );
      if (repetido)
        throw recusa('de-para-repetido', 'Este analito ou este código já está no de-para deste laboratório.');
      if (p.id === null)
        return {
          id: await tx.incluir('de_para_analito_apoio', { laboratorio_apoio_id: p.laboratorio, ...dados }),
        };
      const [d] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM de_para_analito_apoio WHERE id = ? AND laboratorio_apoio_id = ? AND excluido_em IS NULL',
        [p.id, p.laboratorio],
      );
      if (!d) throw recusa('de-para-inexistente', 'O de-para não existe neste laboratório.');
      await tx.alterar('de_para_analito_apoio', p.id, n(d['versao']), dados);
      return { id: p.id };
    });
  }

  /** Inclui ou altera o de-para de material (desativar é ativo=false; nunca se apaga). */
  salvarDeParaMaterial(c: ContextoSadt, entrada: unknown): Promise<{ id: number }> {
    const p = esquemaDeParaMaterial.parse(entrada);
    return this.gravar(c, 'sadt.apoio.depara.material', 'de_para_material_apoio', async (tx, est) => {
      await this.laboratorio(tx, est, p.laboratorio);
      const dados = {
        material_biologico_id: p.material,
        codigo_apoio: daRegra(() => conferirCodigoApoio(p.codigoApoio, 'código do material')),
        nome_apoio: p.nomeApoio,
        ativo: p.ativo,
      };
      const repetido = await tx.uma(
        `SELECT id FROM de_para_material_apoio WHERE laboratorio_apoio_id = ? AND id <> ? AND excluido_em IS NULL
            AND (material_biologico_id = ? OR codigo_apoio = ?)`,
        [p.laboratorio, p.id ?? 0, p.material, dados.codigo_apoio],
      );
      if (repetido)
        throw recusa(
          'de-para-repetido',
          'Este material ou este código já está no de-para deste laboratório.',
        );
      if (p.id === null)
        return {
          id: await tx.incluir('de_para_material_apoio', { laboratorio_apoio_id: p.laboratorio, ...dados }),
        };
      const [d] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM de_para_material_apoio WHERE id = ? AND laboratorio_apoio_id = ? AND excluido_em IS NULL',
        [p.id, p.laboratorio],
      );
      if (!d) throw recusa('de-para-inexistente', 'O de-para não existe neste laboratório.');
      await tx.alterar('de_para_material_apoio', p.id, n(d['versao']), dados);
      return { id: p.id };
    });
  }
}
