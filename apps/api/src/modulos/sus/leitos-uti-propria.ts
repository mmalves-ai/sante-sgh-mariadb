// Leitos de UTI habilitados pelo SUS por tipo, unidade e vigência (F7, 06-SUS linha 59), no banco do cliente. As regras
// são as puras de @sgh/dominio-faturamento (leito-uti-habilitado.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - incluir: uma linha em `leito_uti_habilitado` do estabelecimento (tipo de UTI do domínio SUS, unidade opcional,
//     quantidade, vigência por competência, dispensa da crítica de lotação); a nova quantidade a partir de uma
//     competência encerra a habilitação aberta anterior do mesmo tipo e unidade na véspera (na mesma transação);
//   - alterar a vigência (e a dispensa da crítica): grava início e fim com a versão lida, conferidos contra as outras;
//   - inativar: `ativo` falso com a versão lida (nada apagado; a diária já guardada continua apontando a habilitação).
// A trilha de cada gravação vai pelo executor (mesma transação).
import {
  classeDaUtiSus,
  conferirHabilitacaoUti,
  type HabilitacaoUtiVigencia,
} from '@sgh/dominio-faturamento';
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

export const PORTA_LEITOS_UTI = Symbol('PORTA_LEITOS_UTI');

const TABELAS = ['leito_uti_habilitado'];
const LISTA_TIPO_UTI = 'tipo_leito_uti';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

const esquemaInclusao = z
  .object({
    tipo: z.number().int().positive(),
    unidade: z.number().int().positive().nullable().default(null),
    quantidadeLeitos: z.number().int(),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable().default(null),
  })
  .strict();
const esquemaVigencia = z
  .object({
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable(),
    versao: z.number().int().positive(),
  })
  .strict();
const esquemaVersao = z.object({ versao: z.number().int().positive() }).strict();

export interface LeitoUtiHabilitadoLido {
  readonly id: number;
  readonly tipo: number;
  readonly tipoCodigo: string;
  readonly tipoDescricao: string;
  /** Classe e nível da UTI pela descrição do tipo (null quando a descrição não diz). */
  readonly classe: string | null;
  readonly nivel: number | null;
  readonly unidade: number | null;
  readonly unidadeDescricao: string | null;
  readonly quantidadeLeitos: number;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  /** Vigente hoje (ativa e com hoje dentro da vigência). */
  readonly vigente: boolean;
  readonly versao: number;
}

export interface OpcoesLeitosUti {
  readonly tipos: readonly { id: number; codigo: string; descricao: string }[];
  readonly unidades: readonly { id: number; codigo: string; descricao: string }[];
}

const vigenciaDe = (r: Record<string, unknown>): HabilitacaoUtiVigencia => ({
  id: num(r['id']),
  tipo: num(r['tipo_uti_dominio_sus_id']),
  unidade: numOuNull(r['unidade_internacao_id']),
  vigenciaInicio: dataIso(r['vigencia_inicio'])!,
  vigenciaFim: dataIso(r['vigencia_fim']),
  ativo: bool(r['ativo']),
});

export class PortaLeitosUtiPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.leitosUti');
  }

  /** As habilitações do estabelecimento (ativas primeiro, depois as mais recentes), com tipo e unidade. */
  listar(c: ContextoPortaPropria): Promise<LeitoUtiHabilitadoLido[]> {
    return this.ler(c, 'listar', async (l, est) =>
      (
        await l.consultar(
          `SELECT h.*, d.codigo_oficial, d.codigo AS tipo_codigo, d.descricao AS tipo_descricao,
                  u.descricao AS unidade_descricao,
                  (h.ativo AND h.vigencia_inicio <= CURRENT_DATE
                    AND (h.vigencia_fim IS NULL OR h.vigencia_fim >= CURRENT_DATE)) AS vigente
             FROM leito_uti_habilitado h
             JOIN dominio_sus d ON d.id = h.tipo_uti_dominio_sus_id
             LEFT JOIN unidade_internacao u ON u.id = h.unidade_internacao_id
            WHERE h.estabelecimento_id = ?
            ORDER BY h.ativo DESC, h.vigencia_inicio DESC, d.descricao, h.id DESC LIMIT 1000`,
          [est.id],
        )
      ).map((r) => {
        const descricao = String(r['tipo_descricao']);
        const classe = classeDaUtiSus(descricao);
        return {
          id: num(r['id']),
          tipo: num(r['tipo_uti_dominio_sus_id']),
          tipoCodigo: String(txtOuNull(r['codigo_oficial']) ?? r['tipo_codigo']),
          tipoDescricao: descricao,
          classe: classe?.classe ?? null,
          nivel: classe?.nivel ?? null,
          unidade: numOuNull(r['unidade_internacao_id']),
          unidadeDescricao: txtOuNull(r['unidade_descricao']),
          quantidadeLeitos: num(r['quantidade_leitos']),
          vigenciaInicio: dataIso(r['vigencia_inicio'])!,
          vigenciaFim: dataIso(r['vigencia_fim']),
          ativo: bool(r['ativo']),
          vigente: bool(r['vigente']),
          versao: num(r['versao']),
        };
      }),
    );
  }

  /** Os tipos de UTI do domínio SUS e as unidades de internação ativas do estabelecimento (para o formulário). */
  opcoes(c: ContextoPortaPropria): Promise<OpcoesLeitosUti> {
    return this.ler(c, 'opcoes', async (l, est) => ({
      tipos: (
        await l.consultar(
          `SELECT id, codigo, codigo_oficial, descricao FROM dominio_sus
            WHERE lista = ? AND ativo ORDER BY ordem, codigo_oficial, descricao LIMIT 200`,
          [LISTA_TIPO_UTI],
        )
      ).map((r) => ({
        id: num(r['id']),
        codigo: String(txtOuNull(r['codigo_oficial']) ?? r['codigo']),
        descricao: String(r['descricao']),
      })),
      unidades: (
        await l.consultar(
          `SELECT id, codigo, descricao FROM unidade_internacao
            WHERE estabelecimento_id = ? AND ativo AND excluido_em IS NULL ORDER BY descricao LIMIT 500`,
          [est.id],
        )
      ).map((r) => ({ id: num(r['id']), codigo: String(r['codigo']), descricao: String(r['descricao']) })),
    }));
  }

  async incluir(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; encerrada: number | null }> {
    const e = entradaValida(esquemaInclusao, entrada);
    return this.gravar(c, 'faturamento.sus.leitouti.incluir', TABELAS, async (tx, est) => {
      const tipo = await tx.uma('SELECT id FROM dominio_sus WHERE id = ? AND lista = ? AND ativo', [
        e.tipo,
        LISTA_TIPO_UTI,
      ]);
      if (!tipo) throw naoEncontrado('Tipo de UTI');
      if (e.unidade !== null) {
        const u = await tx.uma(
          'SELECT id FROM unidade_internacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.unidade, est.id],
        );
        if (!u) throw naoEncontrado('Unidade de internação');
      }
      const existentes = (
        await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, tipo_uti_dominio_sus_id, unidade_internacao_id, vigencia_inicio, vigencia_fim, ativo, versao
             FROM leito_uti_habilitado WHERE estabelecimento_id = ? AND tipo_uti_dominio_sus_id = ?`,
          [est.id, e.tipo],
        )
      ).map((r) => ({ ...vigenciaDe(r), versao: num(r['versao']) }));
      const r = conferirHabilitacaoUti(e, existentes);
      if (r.problemas.length) throw recusaRegra('Habilitação de UTI recusada', r.problemas);
      if (r.encerrar) {
        const anterior = existentes.find((x) => x.id === r.encerrar!.id)!;
        await tx.alterar('leito_uti_habilitado', anterior.id, anterior.versao, {
          vigencia_fim: r.encerrar.vigenciaFim,
        });
      }
      const id = await tx.incluir('leito_uti_habilitado', {
        estabelecimento_id: est.id,
        tipo_uti_dominio_sus_id: e.tipo,
        unidade_internacao_id: e.unidade,
        quantidade_leitos: e.quantidadeLeitos,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: true,
      });
      return { tabela: 'leito_uti_habilitado', id, encerrada: r.encerrar?.id ?? null };
    });
  }

  /** Altera a vigência com a versão lida; a quantidade muda por nova habilitação. */
  async alterarVigencia(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaVigencia, entrada);
    return this.gravar(c, 'faturamento.sus.leitouti.vigencia', TABELAS, async (tx, est) => {
      const atual = await tx.uma(
        `SELECT id, tipo_uti_dominio_sus_id, unidade_internacao_id, quantidade_leitos, vigencia_inicio, vigencia_fim,
                ativo
           FROM leito_uti_habilitado WHERE id = ? AND estabelecimento_id = ?`,
        [id, est.id],
      );
      if (!atual) throw naoEncontrado('Habilitação de UTI');
      if (!bool(atual['ativo']))
        throw recusaRegra('Habilitação de UTI recusada', [
          { campo: 'ativo', mensagem: 'A habilitação está inativa: inclua uma nova.' },
        ]);
      const outras = (
        await tx.consultarParaAtualizar<Record<string, unknown>>(
          `SELECT id, tipo_uti_dominio_sus_id, unidade_internacao_id, vigencia_inicio, vigencia_fim, ativo
             FROM leito_uti_habilitado WHERE estabelecimento_id = ? AND tipo_uti_dominio_sus_id = ?`,
          [est.id, num(atual['tipo_uti_dominio_sus_id'])],
        )
      ).map(vigenciaDe);
      const r = conferirHabilitacaoUti(
        {
          tipo: num(atual['tipo_uti_dominio_sus_id']),
          unidade: numOuNull(atual['unidade_internacao_id']),
          quantidadeLeitos: num(atual['quantidade_leitos']),
          vigenciaInicio: e.vigenciaInicio,
          vigenciaFim: e.vigenciaFim,
        },
        outras,
        id,
      );
      if (r.problemas.length) throw recusaRegra('Habilitação de UTI recusada', r.problemas);
      await tx.alterar('leito_uti_habilitado', id, e.versao, {
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
      });
      return { tabela: 'leito_uti_habilitado', id };
    });
  }

  /** Inativa a habilitação (nada apagado). */
  async inativar(c: ContextoPortaPropria, id: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'faturamento.sus.leitouti.inativar', TABELAS, async (tx, est) => {
      const atual = await tx.uma(
        'SELECT ativo FROM leito_uti_habilitado WHERE id = ? AND estabelecimento_id = ?',
        [id, est.id],
      );
      if (!atual) throw naoEncontrado('Habilitação de UTI');
      if (!bool(atual['ativo']))
        throw recusaRegra('Habilitação de UTI recusada', [
          { campo: 'ativo', mensagem: 'A habilitação já está inativa.' },
        ]);
      await tx.alterar('leito_uti_habilitado', id, e.versao, { ativo: false });
      return { tabela: 'leito_uti_habilitado', id };
    });
  }
}
