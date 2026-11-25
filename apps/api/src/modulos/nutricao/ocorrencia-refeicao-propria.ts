// Ocorrências na entrega da refeição (F8, 04-HOT linha 143), no banco do cliente. Tabelas: `ocorrencia_entrega_refeicao`
// (gravada) sobre a linha do mapa fechado (`mapa_dieta_item`, `mapa_dieta`, lidas) e o tipo (`tipo_ocorrencia_refeicao`,
// cadastro genérico, lido). Contrato de efeito:
//   - registrar: a copa informa a unidade, a refeição, o dia e a internação; a linha do mapa fechado é achada pelo
//     atendimento da internação, só em mapa fechado, em produção ou distribuído (mapa aberto, cancelado ou ausente: 422); a regra do domínio valida (justificativa quando o tipo exige,
//     momento, tipo em uso, linha não cancelada) antes do banco; grava a ocorrência com o atendimento, o paciente, a
//     refeição do dia, o registrante e `resolvida` falso; devolve o aviso de reposição quando o tipo a gera;
//   - resolver: a providência com a versão lida; `resolvida`, `resolvida_em` e `resolvida_por_usuario_id`; a já
//     resolvida é recusada (422) e nada é reescrito nem apagado;
//   - listar (só leitura): as ocorrências do mapa da unidade, refeição e dia, com o tipo, o registrante e a resolução.
import {
  type TipoOcorrenciaRefeicao,
  validarOcorrenciaRefeicao,
  validarResolucaoOcorrencia,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
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
import { civil, instanteCivil } from '../exames/relogio.js';

export const PORTA_OCORRENCIA_REFEICAO = Symbol('PORTA_OCORRENCIA_REFEICAO');

const OCORRENCIA = 'ocorrencia_entrega_refeicao';
const TABELAS = [OCORRENCIA];

type Linha = Record<string, unknown>;

export interface OcorrenciaRefeicaoLida {
  readonly id: number;
  readonly internacao: number | null;
  readonly linhaMapa: number | null;
  readonly tipo: number;
  readonly tipoCodigo: string;
  readonly tipoDescricao: string;
  readonly reposicao: boolean;
  /** "AAAA-MM-DDTHH:mm" no fuso do estabelecimento. */
  readonly ocorridoEm: string;
  readonly descricao: string;
  readonly registradaPor: string | null;
  readonly resolvida: boolean;
  readonly resolvidaEm: string | null;
  readonly resolvidaPor: string | null;
  readonly providencia: string | null;
  readonly versao: number;
}

const id = z.number().int().positive();
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MOMENTO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const UNIDADE = /^[A-Za-z0-9._-]{1,30}$/;

const esquemaRegistrar = z
  .object({
    unidade: z.string().regex(UNIDADE),
    refeicao: id,
    data: z.string().regex(DATA),
    internacao: id,
    tipo: id,
    descricao: z.string().trim().max(2000).nullable().optional(),
    /** "AAAA-MM-DDTHH:mm" no fuso do estabelecimento; sem ele, agora. */
    ocorridoEm: z.string().regex(MOMENTO).nullable().optional(),
  })
  .strict();

const esquemaResolver = z.object({ providencia: z.string().trim().min(1).max(2000), versao: id }).strict();

export interface ConsultaOcorrencias {
  readonly unidade: string;
  readonly refeicao: number;
  readonly data: string;
}

function local(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}
const instante = (t: string, fuso: string): Date =>
  instanteCivil(t.slice(0, 10), `${t.slice(11, 13)}${t.slice(14, 16)}`, fuso);

function tipoDaLinha(x: Linha): TipoOcorrenciaRefeicao {
  return {
    id: num(x['id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    geraReposicao: bool(x['gera_reposicao']),
    exigeJustificativa: bool(x['exige_justificativa']),
    ativo: bool(x['ativo']),
  };
}

export class PortaOcorrenciaRefeicaoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'nutricao.ocorrencia-refeicao');
  }

  /** Os tipos em uso, para a escolha na tela (com o que cada um exige). */
  tipos(c: ContextoPortaPropria): Promise<TipoOcorrenciaRefeicao[]> {
    return this.ler(c, 'tipos', async (l) =>
      (
        await l.consultar<Linha>(
          `SELECT id, codigo, descricao, gera_reposicao, exige_justificativa, ativo FROM tipo_ocorrencia_refeicao
            WHERE ativo ORDER BY descricao LIMIT 200`,
        )
      ).map(tipoDaLinha),
    );
  }

  /** As ocorrências do mapa da unidade, da refeição e do dia. */
  listar(c: ContextoPortaPropria, q: ConsultaOcorrencias): Promise<OcorrenciaRefeicaoLida[]> {
    return this.ler(c, 'listar', async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `SELECT o.id, o.mapa_dieta_item_id, o.tipo_ocorrencia_refeicao_id, t.codigo, t.descricao AS tipo_descricao,
                t.gera_reposicao, o.ocorrido_em, o.descricao, o.providencia, o.resolvida, o.resolvida_em, o.versao,
                ur.login AS registrou, us.login AS resolveu,
                (SELECT MAX(i.id) FROM internacao i WHERE i.atendimento_id = o.atendimento_id AND i.excluido_em IS NULL)
                  AS internacao
           FROM ocorrencia_entrega_refeicao o
           JOIN mapa_dieta_item it ON it.id = o.mapa_dieta_item_id
           JOIN mapa_dieta m ON m.id = it.mapa_dieta_id
           JOIN unidade_internacao ui ON ui.id = m.unidade_internacao_id
           JOIN tipo_ocorrencia_refeicao t ON t.id = o.tipo_ocorrencia_refeicao_id
           LEFT JOIN usuario ur ON ur.id = o.registrado_por_usuario_id
           LEFT JOIN usuario us ON us.id = o.resolvida_por_usuario_id
          WHERE o.estabelecimento_id = ? AND ui.codigo = ? AND m.refeicao_do_dia_id = ? AND m.data_referencia = ?
            AND o.excluido_em IS NULL
          ORDER BY o.resolvida, o.ocorrido_em DESC, o.id DESC
          LIMIT 500`,
        [est.id, q.unidade, q.refeicao, q.data],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        internacao: numOuNull(x['internacao']),
        linhaMapa: numOuNull(x['mapa_dieta_item_id']),
        tipo: num(x['tipo_ocorrencia_refeicao_id']),
        tipoCodigo: String(x['codigo']),
        tipoDescricao: String(x['tipo_descricao']),
        reposicao: bool(x['gera_reposicao']),
        ocorridoEm: local(x['ocorrido_em'], est.fuso) ?? '',
        descricao: String(x['descricao']),
        registradaPor: txtOuNull(x['registrou']),
        resolvida: bool(x['resolvida']),
        resolvidaEm: local(x['resolvida_em'], est.fuso),
        resolvidaPor: txtOuNull(x['resolveu']),
        providencia: txtOuNull(x['providencia']),
        versao: num(x['versao']),
      }));
    });
  }

  /** A linha do mapa fechado (fechado, em produção ou distribuído) da internação (pelo atendimento) na unidade, refeição e dia; mapa aberto não recebe ocorrência. */
  private async linhaDoMapa(l: Leitor, est: number, e: z.infer<typeof esquemaRegistrar>) {
    const i = await l.uma(
      `SELECT id, atendimento_id, paciente_id FROM internacao
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.internacao, est],
    );
    if (!i) throw naoEncontrado('Internação');
    const it = await l.uma(
      `SELECT it.id, it.situacao, it.paciente_id FROM mapa_dieta_item it
         JOIN mapa_dieta m ON m.id = it.mapa_dieta_id
         JOIN unidade_internacao ui ON ui.id = m.unidade_internacao_id
        WHERE m.estabelecimento_id = ? AND ui.codigo = ? AND m.refeicao_do_dia_id = ? AND m.data_referencia = ?
          AND m.excluido_em IS NULL AND m.situacao IN ('fechado', 'em_producao', 'distribuido')
          AND it.atendimento_id = ? AND it.excluido_em IS NULL
        ORDER BY m.id DESC LIMIT 1`,
      [est, e.unidade, e.refeicao, e.data, num(i['atendimento_id'])],
    );
    if (!it)
      throw new ErroOperacao(
        422,
        'regra-violada',
        'Sem bandeja no mapa',
        'O paciente não está no mapa fechado desta refeição: a ocorrência é registrada sobre a bandeja do mapa.',
        { campos: ['internacao'] },
      );
    return {
      item: num(it['id']),
      situacao: String(it['situacao']),
      atendimento: num(i['atendimento_id']),
      paciente: num(it['paciente_id']),
    };
  }

  async registrar(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; reposicao: boolean; mensagem: string }> {
    const e = entradaValida(esquemaRegistrar, entrada);
    return this.gravar(c, 'nutricao.ocorrencia-refeicao.registrar', [OCORRENCIA], async (tx, est, u) => {
      const t = await tx.uma(
        'SELECT id, codigo, descricao, gera_reposicao, exige_justificativa, ativo FROM tipo_ocorrencia_refeicao WHERE id = ?',
        [e.tipo],
      );
      if (!t) throw naoEncontrado('Tipo de ocorrência');
      const tipo = tipoDaLinha(t);
      const linha = await this.linhaDoMapa(tx, est.id, e);
      const agora = new Date();
      const ocorridoEm = e.ocorridoEm ? instante(e.ocorridoEm, est.fuso) : agora;
      const r = validarOcorrenciaRefeicao({
        tipo,
        descricao: e.descricao ?? null,
        ocorridoEm,
        agora,
        dataMapa: e.data,
        situacaoLinha: linha.situacao,
      });
      if (!r.ok) throw recusaRegra('Ocorrência na entrega inválida', r.problemas);
      const novo = await tx.incluir(OCORRENCIA, {
        estabelecimento_id: est.id,
        mapa_dieta_item_id: linha.item,
        atendimento_id: linha.atendimento,
        paciente_id: linha.paciente,
        refeicao_do_dia_id: e.refeicao,
        tipo_ocorrencia_refeicao_id: tipo.id,
        ocorrido_em: ocorridoEm,
        descricao: r.valor.descricao,
        registrado_por_usuario_id: u,
        resolvida: false,
      });
      return {
        tabela: OCORRENCIA,
        id: novo,
        reposicao: r.valor.reposicao,
        mensagem: r.valor.reposicao
          ? `Ocorrência registrada (${tipo.descricao}): providencie a reposição da refeição.`
          : `Ocorrência registrada (${tipo.descricao}).`,
      };
    });
  }

  async resolver(c: ContextoPortaPropria, idOcorrencia: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaResolver, entrada);
    return this.gravar(c, 'nutricao.ocorrencia-refeicao.resolver', [OCORRENCIA], async (tx, est, u) => {
      const o = await tx.uma(
        `SELECT id, ocorrido_em, resolvida FROM ocorrencia_entrega_refeicao
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [idOcorrencia, est.id],
      );
      if (!o) throw naoEncontrado('Ocorrência na entrega');
      const agora = new Date();
      const ocorrido =
        o['ocorrido_em'] instanceof Date ? o['ocorrido_em'] : new Date(String(o['ocorrido_em']));
      const problemas = validarResolucaoOcorrencia({
        resolvida: bool(o['resolvida']),
        providencia: e.providencia,
        ocorridoEm: ocorrido,
        agora,
      });
      if (problemas.length) throw recusaRegra('Resolução da ocorrência inválida', problemas);
      await tx.alterar(OCORRENCIA, idOcorrencia, e.versao, {
        providencia: e.providencia,
        resolvida: true,
        resolvida_em: agora,
        resolvida_por_usuario_id: u,
      });
      return { tabela: OCORRENCIA, id: idOcorrencia };
    });
  }
}
