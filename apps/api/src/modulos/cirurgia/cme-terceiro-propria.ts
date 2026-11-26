// Material de terceiro e consignado processado pela CME (F7, 04-CME linha 119; RDC ANVISA 15/2012, arts. 21 e 22) no
// banco do cliente, pelo @sgh/nucleo, sempre no estabelecimento da sessão. Regras em @sgh/dominio-cirurgia
// (cme/material-terceiro). Contrato de efeito:
//   - material: material_terceiro_reprocessamento com o dono (fornecedor, profissional, outro estabelecimento ou
//     paciente), o paciente e a cirurgia previstos e o roteiro (expurgo, lavagem, desinfecção, preparo, esterilização,
//     guarda no arsenal);
//   - receber: recebimento_material_terceiro (número de negócio, CME, entregador, quem recebeu e quando, fornecedor,
//     cirurgia e paciente) e um recebimento_material_terceiro_item por material, situação "recebido";
//   - conferir: cada item conferido ou com a divergência; o recebimento fica conferido (quem e quando) ou divergente;
//   - reprocessar: só o conferido; um pacote_esteril por item que exige esterilização (etiqueta, material de terceiro,
//     aguardando esterilização), ligado ao item (pacote_esteril_id, migração 08_CC/99w), que segue o ciclo da CME como
//     o pacote próprio; o recebimento fica em reprocessamento (ou disponível, se nada exige esterilização);
//   - disponibilizar: só com todos os pacotes estéreis; o recebimento fica disponível para a cirurgia;
//   - devolver: cada item com utilizado, devolvido e conferência da devolução; o recebimento fica devolvido com quem
//     devolveu, quando e quem retirou.
// Nada é apagado. Recusa da regra: 422, sem escrita. Outro estabelecimento: 404. Versão velha: 409.
import {
  codigoEtiqueta,
  conferirDevolucao,
  conferirDisponibilidade,
  conferirEnvio,
  conferirMaterialTerceiro,
  conferirRecebimento,
  desfechoDaConferencia,
  type ProblemaCme,
  TIPOS_PROPRIETARIO,
  type TipoProprietario,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';
import { type Linha, PortaCmePropria, TABELAS_CME } from './cme-propria.js';

export const PORTA_CME_TERCEIRO = Symbol('PORTA_CME_TERCEIRO');

export const TABELAS_CME_TERCEIRO = [
  ...TABELAS_CME,
  'material_terceiro_reprocessamento',
  'recebimento_material_terceiro',
  'recebimento_material_terceiro_item',
] as const;

const id = z.number().int().positive();
const texto = (n: number) => z.string().trim().max(n).nullable().default(null);
const esquemaMaterial = z
  .object({
    descricao: z.string().trim().min(1).max(150),
    tipoProprietario: z.enum(TIPOS_PROPRIETARIO),
    fornecedor: id.nullable().default(null),
    profissional: id.nullable().default(null),
    paciente: id.nullable().default(null),
    agendamento: id.nullable().default(null),
    codigoBarras: texto(100),
    quantidadePecas: z.number().int().min(0).max(65535).nullable().default(null),
    validadeDias: z.number().int().min(0).max(3650).nullable().default(null),
    expurgo: z.boolean().default(true),
    lavagem: z.boolean().default(true),
    desinfeccao: z.boolean().default(false),
    preparo: z.boolean().default(true),
    esterilizacao: z.boolean().default(true),
    guardaArsenal: z.boolean().default(false),
    arsenal: id.nullable().default(null),
  })
  .strict();
const esquemaRecebimento = z
  .object({
    cme: id,
    fornecedor: id.nullable().default(null),
    agendamento: id.nullable().default(null),
    paciente: id.nullable().default(null),
    entregador: texto(150),
    observacao: texto(2000),
    itens: z
      .array(
        z
          .object({
            material: id,
            quantidade: z.number().positive().max(99999),
            procedimento: id.nullable().default(null),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
const esquemaConferir = z
  .object({
    versao: id,
    itens: z
      .array(z.object({ sequencia: id, conferido: z.boolean(), divergencia: texto(500) }).strict())
      .max(200),
  })
  .strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaDevolver = z
  .object({
    versao: id,
    recebedor: texto(150),
    observacao: texto(2000),
    itens: z
      .array(
        z
          .object({
            sequencia: id,
            utilizada: z.number().min(0).max(99999),
            devolvida: z.number().min(0).max(99999),
            conferido: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const recusa = (titulo: string, p: readonly ProblemaCme[]) => {
  if (p.length) throw recusaRegra(titulo, p);
};
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 16) : v ? String(v).replace(' ', 'T').slice(0, 16) : null;
const tipoDono = (v: unknown): TipoProprietario =>
  (TIPOS_PROPRIETARIO as readonly string[]).includes(String(v))
    ? (String(v) as TipoProprietario)
    : 'outro_estabelecimento';

export interface MaterialTerceiroLido {
  readonly id: number;
  readonly descricao: string;
  readonly tipoProprietario: TipoProprietario;
  readonly dono: string | null;
  readonly fornecedor: number | null;
  readonly codigoBarras: string | null;
  readonly quantidadePecas: number | null;
  readonly validadeDias: number | null;
  readonly esterilizacao: boolean;
  readonly ativo: boolean;
}
export interface ItemRecebimentoLido {
  readonly sequencia: number;
  readonly material: number;
  readonly descricao: string;
  readonly recebida: number;
  readonly utilizada: number;
  readonly devolvida: number;
  readonly conferidoRecebimento: boolean;
  readonly conferidoDevolucao: boolean;
  readonly divergencia: string | null;
}
export interface RecebimentoTerceiroLido {
  readonly id: number;
  readonly numero: number;
  readonly situacao: string;
  readonly versao: number;
  readonly fornecedor: string | null;
  readonly agendamento: string | null;
  readonly temPaciente: boolean;
  readonly cme: string;
  readonly entregador: string | null;
  readonly recebidoEm: string | null;
  readonly conferidoEm: string | null;
  readonly devolvidoEm: string | null;
  readonly recebedorDevolucao: string | null;
  readonly itens: ItemRecebimentoLido[];
  readonly pacotes: { id: number; etiqueta: string; situacao: string; material: number }[];
}
export interface PainelTerceiros {
  readonly materiais: MaterialTerceiroLido[];
  readonly recebimentos: RecebimentoTerceiroLido[];
  readonly setores: { id: number; nome: string }[];
  readonly agendamentos: { id: number; numero: string; paciente: number | null }[];
}

export class PortaCmeTerceiroPropria extends PortaCmePropria {
  constructor(nucleo: ConstructorParameters<typeof PortaCmePropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS_CME_TERCEIRO);
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────

  painelTerceiros(c: ContextoPortaPropria): Promise<PainelTerceiros> {
    return this.ler(c, 'terceiros', async (l, est) => {
      const materiais = await l.consultar(
        `SELECT m.id, m.descricao, m.tipo_proprietario, m.empresa_fornecedora_id, m.codigo_barras, m.quantidade_pecas,
                m.validade_esterilizacao_dias, m.exige_esterilizacao, m.ativo,
                COALESCE(f.nome_fantasia, f.razao_social, pf.nome) AS dono
           FROM material_terceiro_reprocessamento m
           LEFT JOIN empresa_fornecedora f ON f.id = m.empresa_fornecedora_id
           LEFT JOIN profissional pr ON pr.id = m.proprietario_profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE m.estabelecimento_id = ? AND m.excluido_em IS NULL ORDER BY m.descricao LIMIT 500`,
        [est.id],
      );
      const recs = await l.consultar(
        `SELECT r.id, r.numero, r.situacao, r.versao, r.paciente_id, r.entregador_nome, r.recebido_em, r.conferido_em,
                r.devolvido_em, r.devolucao_recebedor_nome, s.nome AS cme, a.numero AS agendamento,
                COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor
           FROM recebimento_material_terceiro r
           JOIN setor_funcional s ON s.id = r.cme_setor_funcional_id
           LEFT JOIN agendamento_cirurgico a ON a.id = r.agendamento_cirurgico_id
           LEFT JOIN empresa_fornecedora f ON f.id = r.empresa_fornecedora_id
          WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL ORDER BY r.recebido_em DESC, r.id DESC LIMIT 100`,
        [est.id],
      );
      const ids = recs.map((r) => num(r['id']));
      const itens = ids.length
        ? await l.consultar(
            `SELECT i.recebimento_material_terceiro_id AS rec, i.sequencia, i.material_terceiro_reprocessamento_id AS mat,
                    m.descricao, i.quantidade_recebida, i.quantidade_utilizada, i.quantidade_devolvida,
                    i.conferido_recebimento, i.conferido_devolucao, i.divergencia
               FROM recebimento_material_terceiro_item i
               JOIN material_terceiro_reprocessamento m ON m.id = i.material_terceiro_reprocessamento_id
              WHERE i.recebimento_material_terceiro_id IN (${ids.map(() => '?').join(',')}) AND i.excluido_em IS NULL
              ORDER BY i.sequencia`,
            ids,
          )
        : [];
      const pacotes = await this.pacotesDosRecebimentos(l, est.id, ids);
      const setores = await l.consultar(
        'SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY nome',
        [est.id],
      );
      const ags = await l.consultar(
        `SELECT id, numero, paciente_id FROM agendamento_cirurgico WHERE estabelecimento_id = ? AND excluido_em IS NULL
          ORDER BY id DESC LIMIT 100`,
        [est.id],
      );
      return {
        materiais: materiais.map((m) => ({
          id: num(m['id']),
          descricao: String(m['descricao']),
          tipoProprietario: tipoDono(m['tipo_proprietario']),
          dono: txtOuNull(m['dono']),
          fornecedor: numOuNull(m['empresa_fornecedora_id']),
          codigoBarras: txtOuNull(m['codigo_barras']),
          quantidadePecas: numOuNull(m['quantidade_pecas']),
          validadeDias: numOuNull(m['validade_esterilizacao_dias']),
          esterilizacao: bool(m['exige_esterilizacao']),
          ativo: bool(m['ativo']),
        })),
        recebimentos: recs.map((r) => ({
          id: num(r['id']),
          numero: num(r['numero']),
          situacao: String(r['situacao']),
          versao: num(r['versao']),
          fornecedor: txtOuNull(r['fornecedor']),
          agendamento: txtOuNull(r['agendamento']),
          temPaciente: r['paciente_id'] !== null,
          cme: String(r['cme']),
          entregador: txtOuNull(r['entregador_nome']),
          recebidoEm: instante(r['recebido_em']),
          conferidoEm: instante(r['conferido_em']),
          devolvidoEm: instante(r['devolvido_em']),
          recebedorDevolucao: txtOuNull(r['devolucao_recebedor_nome']),
          itens: itens
            .filter((i) => num(i['rec']) === num(r['id']))
            .map((i) => ({
              sequencia: num(i['sequencia']),
              material: num(i['mat']),
              descricao: String(i['descricao']),
              recebida: Number(i['quantidade_recebida']),
              utilizada: Number(i['quantidade_utilizada']),
              devolvida: Number(i['quantidade_devolvida']),
              conferidoRecebimento: bool(i['conferido_recebimento']),
              conferidoDevolucao: bool(i['conferido_devolucao']),
              divergencia: txtOuNull(i['divergencia']),
            })),
          pacotes: pacotes
            .filter((p) => p.rec === num(r['id']))
            .map((p) => ({ id: p.id, etiqueta: p.etiqueta, situacao: p.situacao, material: p.material })),
        })),
        setores: setores.map((s) => ({ id: num(s['id']), nome: String(s['nome']) })),
        agendamentos: ags.map((a) => ({
          id: num(a['id']),
          numero: String(a['numero']),
          paciente: numOuNull(a['paciente_id']),
        })),
      };
    });
  }

  /** Fornecedores ou profissionais donos do material, pela busca da tela (até 30). */
  donos(c: ContextoPortaPropria, tipo: string, termo: string) {
    const q = `%${termo.trim().slice(0, 60)}%`;
    return this.ler(c, 'terceiros.donos', async (l) => {
      const linhas =
        tipo === 'profissional'
          ? await l.consultar(
              `SELECT p.id, f.nome AS nome FROM profissional p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id
                WHERE p.excluido_em IS NULL AND f.nome LIKE ? ORDER BY f.nome LIMIT 30`,
              [q],
            )
          : await l.consultar(
              `SELECT id, COALESCE(nome_fantasia, razao_social) AS nome FROM empresa_fornecedora
                WHERE excluido_em IS NULL AND (razao_social LIKE ? OR nome_fantasia LIKE ?) ORDER BY razao_social LIMIT 30`,
              [q, q],
            );
      return linhas.map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
    });
  }

  private async pacotesDosRecebimentos(
    l: Pick<TxOperacao, 'consultar'>,
    est: number,
    ids: readonly number[],
  ) {
    if (!ids.length) return [];
    const ps = await l.consultar(
      `SELECT i.recebimento_material_terceiro_id AS rec, p.id, p.codigo_etiqueta, p.situacao,
              p.material_terceiro_reprocessamento_id AS mat
         FROM recebimento_material_terceiro_item i
         JOIN pacote_esteril p ON p.id = i.pacote_esteril_id AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
        WHERE i.recebimento_material_terceiro_id IN (${ids.map(() => '?').join(',')}) AND i.excluido_em IS NULL
        ORDER BY i.sequencia`,
      [est, ...ids],
    );
    return ps.map((p) => ({
      rec: num(p['rec']),
      id: num(p['id']),
      etiqueta: String(p['codigo_etiqueta']),
      situacao: String(p['situacao']),
      material: num(p['mat']),
    }));
  }

  // ── Gravações ─────────────────────────────────────────────────────────────────────────────────────────────────

  async cadastrarMaterial(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaMaterial, entrada);
    recusa('Material de terceiro recusado', conferirMaterialTerceiro(e));
    return this.gravar(
      c,
      'cirurgia.cme.terceiro.material',
      ['material_terceiro_reprocessamento'],
      async (tx, est) => {
        if (e.fornecedor !== null) await this.existe(tx, 'empresa_fornecedora', e.fornecedor, 'Fornecedor');
        if (e.profissional !== null) await this.existe(tx, 'profissional', e.profissional, 'Profissional');
        if (e.paciente !== null) await this.existe(tx, 'paciente', e.paciente, 'Paciente');
        if (e.arsenal !== null) await this.setor(tx, est.id, e.arsenal, 'Arsenal');
        if (e.agendamento !== null) await this.agendamentoDoEst(tx, est.id, e.agendamento);
        if (e.codigoBarras) {
          const dup = await tx.uma(
            'SELECT id FROM material_terceiro_reprocessamento WHERE estabelecimento_id = ? AND codigo_barras = ?',
            [est.id, e.codigoBarras],
          );
          if (dup)
            throw recusaRegra('Material de terceiro recusado', [
              { campo: 'codigoBarras', mensagem: 'Já há material com este código de barras.' },
            ]);
        }
        const material = await tx.incluir('material_terceiro_reprocessamento', {
          estabelecimento_id: est.id,
          descricao: e.descricao,
          tipo_proprietario: e.tipoProprietario,
          empresa_fornecedora_id: e.fornecedor,
          proprietario_profissional_id: e.profissional,
          paciente_id: e.paciente,
          agendamento_cirurgico_id: e.agendamento,
          codigo_barras: e.codigoBarras || null,
          quantidade_pecas: e.quantidadePecas,
          validade_esterilizacao_dias: e.validadeDias,
          exige_expurgo: e.expurgo,
          exige_lavagem: e.lavagem,
          exige_desinfeccao: e.desinfeccao,
          exige_preparo: e.preparo,
          exige_esterilizacao: e.esterilizacao,
          exige_guarda_arsenal: e.guardaArsenal,
          arsenal_setor_funcional_id: e.arsenal,
        });
        return { tabela: 'material_terceiro_reprocessamento', id: material, material };
      },
    );
  }

  async receber(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRecebimento, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.terceiro.receber',
      ['recebimento_material_terceiro', 'recebimento_material_terceiro_item', 'sequencia_negocio'],
      async (tx, est, usuario) => {
        await this.setor(tx, est.id, e.cme, 'CME');
        if (e.fornecedor !== null) await this.existe(tx, 'empresa_fornecedora', e.fornecedor, 'Fornecedor');
        let paciente = e.paciente;
        if (e.agendamento !== null) {
          const ag = await this.agendamentoDoEst(tx, est.id, e.agendamento);
          paciente = paciente ?? numOuNull(ag['paciente_id']);
        }
        if (paciente !== null) await this.existe(tx, 'paciente', paciente, 'Paciente');
        const ids = e.itens.map((i) => i.material);
        const mats = ids.length
          ? await tx.consultar(
              `SELECT id, ativo, tipo_proprietario, empresa_fornecedora_id FROM material_terceiro_reprocessamento
                WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
              [est.id, ...ids],
            )
          : [];
        const porId = new Map(mats.map((m) => [num(m['id']), m]));
        for (const i of e.itens) if (!porId.has(i.material)) throw naoEncontrado('Material de terceiro');
        recusa(
          'Recebimento recusado',
          conferirRecebimento({
            fornecedor: e.fornecedor,
            entregador: e.entregador,
            itens: e.itens.map((i) => {
              const m = porId.get(i.material)!;
              return {
                material: i.material,
                quantidade: i.quantidade,
                ativo: bool(m['ativo']),
                tipoProprietario: tipoDono(m['tipo_proprietario']),
                fornecedor: numOuNull(m['empresa_fornecedora_id']),
              };
            }),
          }),
        );
        const n = await this.numeroDe(tx, est.id, 'recebimento_material_terceiro');
        const recebimento = await tx.incluir('recebimento_material_terceiro', {
          estabelecimento_id: est.id,
          numero: n,
          empresa_fornecedora_id: e.fornecedor,
          agendamento_cirurgico_id: e.agendamento,
          paciente_id: paciente,
          cme_setor_funcional_id: e.cme,
          recebido_em: new Date(),
          recebido_por_usuario_id: usuario,
          entregador_nome: e.entregador,
          situacao: 'recebido',
          observacao: e.observacao,
        });
        let seq = 0;
        for (const i of e.itens)
          await tx.incluir('recebimento_material_terceiro_item', {
            recebimento_material_terceiro_id: recebimento,
            sequencia: ++seq,
            material_terceiro_reprocessamento_id: i.material,
            agendamento_cirurgico_procedimento_id: i.procedimento,
            quantidade_recebida: i.quantidade,
          });
        return { tabela: 'recebimento_material_terceiro', id: recebimento, recebimento, numero: n };
      },
    );
  }

  async conferir(c: ContextoPortaPropria, recebimento: number, entrada: unknown) {
    const e = entradaValida(esquemaConferir, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.terceiro.conferir',
      ['recebimento_material_terceiro', 'recebimento_material_terceiro_item'],
      async (tx, est, usuario) => {
        const r = await this.recebimentoTravado(tx, est.id, recebimento, e.versao);
        const itens = await this.itens(tx, recebimento);
        const d = desfechoDaConferencia(
          String(r['situacao']),
          itens.map((i) => num(i['sequencia'])),
          e.itens,
        );
        recusa('Conferência recusada', d.problemas);
        for (const i of e.itens) {
          const it = itens.find((x) => num(x['sequencia']) === i.sequencia)!;
          await tx.alterar('recebimento_material_terceiro_item', num(it['id']), num(it['versao']), {
            conferido_recebimento: i.conferido,
            divergencia: i.divergencia?.trim() || null,
          });
        }
        await tx.alterar('recebimento_material_terceiro', recebimento, e.versao, {
          situacao: d.situacao,
          conferido_em: new Date(),
          conferido_por_usuario_id: usuario,
        });
        return { tabela: 'recebimento_material_terceiro', id: recebimento, situacao: d.situacao };
      },
    );
  }

  async reprocessar(c: ContextoPortaPropria, recebimento: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.terceiro.reprocessar',
      [
        'recebimento_material_terceiro',
        'recebimento_material_terceiro_item',
        'pacote_esteril',
        'sequencia_negocio',
      ],
      async (tx, est, usuario) => {
        const r = await this.recebimentoTravado(tx, est.id, recebimento, e.versao);
        const itens = await tx.consultar(
          `SELECT i.id, i.versao, i.sequencia, i.material_terceiro_reprocessamento_id AS mat, m.exige_esterilizacao, m.ativo
             FROM recebimento_material_terceiro_item i
             JOIN material_terceiro_reprocessamento m ON m.id = i.material_terceiro_reprocessamento_id
            WHERE i.recebimento_material_terceiro_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
          [recebimento],
        );
        const d = conferirEnvio(
          String(r['situacao']),
          itens.map((i) => ({
            sequencia: num(i['sequencia']),
            esterilizacao: bool(i['exige_esterilizacao']),
            ativo: bool(i['ativo']),
          })),
        );
        recusa('Envio ao reprocessamento recusado', d.problemas);
        const etiquetas: string[] = [];
        for (const s of d.pacotes) {
          const it = itens.find((i) => num(i['sequencia']) === s)!;
          const n = await this.numeroDe(tx, est.id, 'pacote_esteril');
          const etiqueta = codigoEtiqueta(est.id, n);
          const pacote = await tx.incluir('pacote_esteril', {
            estabelecimento_id: est.id,
            codigo_etiqueta: etiqueta,
            material_terceiro_reprocessamento_id: num(it['mat']),
            preparado_em: new Date(),
            preparado_por_usuario_id: usuario,
            numero_reprocessamento: 1,
            situacao: 'aguardando_esterilizacao',
          });
          await tx.alterar('recebimento_material_terceiro_item', num(it['id']), num(it['versao']), {
            pacote_esteril_id: pacote,
          });
          etiquetas.push(etiqueta);
        }
        // Sem item que exija esterilização (só limpeza ou desinfecção), o material sai da CME disponível.
        const situacao = d.pacotes.length ? 'em_reprocessamento' : 'disponivel';
        await tx.alterar('recebimento_material_terceiro', recebimento, e.versao, { situacao });
        return { tabela: 'recebimento_material_terceiro', id: recebimento, situacao, etiquetas };
      },
    );
  }

  async disponibilizar(c: ContextoPortaPropria, recebimento: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.terceiro.disponibilizar',
      ['recebimento_material_terceiro'],
      async (tx, est) => {
        const r = await this.recebimentoTravado(tx, est.id, recebimento, e.versao);
        const pacotes = await this.pacotesDosRecebimentos(tx, est.id, [recebimento]);
        recusa(
          'Disponibilidade recusada',
          conferirDisponibilidade(
            String(r['situacao']),
            pacotes.map((p) => p.situacao),
          ),
        );
        await tx.alterar('recebimento_material_terceiro', recebimento, e.versao, { situacao: 'disponivel' });
        return { tabela: 'recebimento_material_terceiro', id: recebimento, situacao: 'disponivel' };
      },
    );
  }

  async devolver(c: ContextoPortaPropria, recebimento: number, entrada: unknown) {
    const e = entradaValida(esquemaDevolver, entrada);
    return this.gravar(
      c,
      'cirurgia.cme.terceiro.devolver',
      ['recebimento_material_terceiro', 'recebimento_material_terceiro_item'],
      async (tx, est, usuario) => {
        const r = await this.recebimentoTravado(tx, est.id, recebimento, e.versao);
        const itens = await this.itens(tx, recebimento);
        const recebida = new Map(itens.map((i) => [num(i['sequencia']), Number(i['quantidade_recebida'])]));
        recusa(
          'Devolução recusada',
          conferirDevolucao({
            situacao: String(r['situacao']),
            recebedor: e.recebedor,
            temPaciente: r['paciente_id'] !== null,
            sequencias: [...recebida.keys()],
            itens: e.itens.map((i) => ({ ...i, recebida: recebida.get(i.sequencia) ?? 0 })),
          }),
        );
        for (const i of e.itens) {
          const it = itens.find((x) => num(x['sequencia']) === i.sequencia)!;
          await tx.alterar('recebimento_material_terceiro_item', num(it['id']), num(it['versao']), {
            quantidade_utilizada: i.utilizada,
            quantidade_devolvida: i.devolvida,
            conferido_devolucao: i.conferido,
          });
        }
        const obs = [txtOuNull(r['observacao']), e.observacao].filter(Boolean).join('\n') || null;
        await tx.alterar('recebimento_material_terceiro', recebimento, e.versao, {
          situacao: 'devolvido',
          devolvido_em: new Date(),
          devolvido_por_usuario_id: usuario,
          devolucao_recebedor_nome: e.recebedor,
          observacao: obs,
        });
        return { tabela: 'recebimento_material_terceiro', id: recebimento, situacao: 'devolvido' };
      },
    );
  }

  // ── Apoio ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private async recebimentoTravado(tx: TxOperacao, est: number, id: number, versao: number): Promise<Linha> {
    const r =
      (
        await tx.consultarParaAtualizar<Linha>(
          `SELECT id, situacao, versao, paciente_id, observacao FROM recebimento_material_terceiro
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [id, est],
        )
      )[0] ?? null;
    if (!r) throw naoEncontrado('Recebimento de material de terceiro');
    if (num(r['versao']) !== versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Recebimento alterado',
        'Outro usuário alterou o recebimento: recarregue.',
      );
    return r;
  }

  private itens(tx: TxOperacao, recebimento: number) {
    return tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, sequencia, quantidade_recebida FROM recebimento_material_terceiro_item
        WHERE recebimento_material_terceiro_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
      [recebimento],
    );
  }

  private async existe(tx: TxOperacao, tabela: string, id: number, nome: string) {
    if (!(await tx.uma(`SELECT id FROM ${tabela} WHERE id = ? AND excluido_em IS NULL`, [id])))
      throw naoEncontrado(nome);
  }

  private async setor(tx: TxOperacao, est: number, id: number, nome: string) {
    const s = await tx.uma(
      'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL',
      [id, est],
    );
    if (!s) throw naoEncontrado(nome);
  }

  private async agendamentoDoEst(tx: TxOperacao, est: number, ag: number): Promise<Linha> {
    const a = await tx.uma(
      'SELECT id, paciente_id FROM agendamento_cirurgico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [ag, est],
    );
    if (!a) throw naoEncontrado('Agendamento cirúrgico');
    return a;
  }

  private async numeroDe(tx: TxOperacao, est: number, tipo: string): Promise<number> {
    const seq = await tx.uma('SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id = ?', [
      tipo,
      est,
    ]);
    if (!seq)
      await tx.incluir('sequencia_negocio', {
        estabelecimento_id: est,
        tipo,
        prefixo: '',
        proximo_valor: 1,
        incremento: 1,
        ativo: true,
      });
    return Number((await tx.proximoNumero(tipo)).valor);
  }
}
