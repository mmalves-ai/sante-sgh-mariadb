// Complemento da conta da AIH (F7, 06-SUS linha 58), no banco do cliente: a equipe de cada procedimento
// (conta_aih_profissional), os diagnósticos secundários (conta_aih_diagnostico, no lugar do campo único da autorização)
// e os incrementos da habilitação (conta_aih_incremento). As regras são as puras de @sgh/dominio-faturamento
// (sus/conta-aih-complemento.ts); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - salvar: só na última conta da AIH, fechada (antes da apresentação), na versão vista; cada lista é conferida
//     inteira e gravada pela diferença: a linha que continua é alterada no lugar, a que sai fica marcada como excluída
//     (excluido_em/excluido_por; nunca apagada) e volta ao ser incluída de novo; a nova entra na sequência seguinte;
//     o profissional pelo CNS, a ocupação pelo CBO, a atividade e o credor pelo domínio do SUS, a habilitação pela
//     tabela unificada vigente na internação e só se o hospital a tem; o valor do incremento é o percentual sobre os
//     serviços hospitalar e profissional da SIGTAP vigente na saída; a versão da conta e a da autorização sobem;
//   - fechar e reapresentar levam o complemento da conta anterior à nova (copiarComplementoDaConta); o primeiro
//     fechamento grava o CID secundário do laudo como o primeiro diagnóstico secundário.
// A trilha de cada gravação vai pelo executor (mesma transação).
import type { ComplementoContaAih } from '@sgh/contratos';
import {
  CLASSIFICACOES_DIAGNOSTICO_AIH,
  type ComplementoSisaih,
  conferirComplementoAih,
  MAXIMO_DIAGNOSTICOS_SECUNDARIOS_AIH,
  MAXIMO_EQUIPE_AIH,
  MAXIMO_INCREMENTOS_AIH,
  TIPOS_DIAGNOSTICO_AIH,
  tipoDocumentoCredor,
  valorDoIncrementoAih,
} from '@sgh/dominio-faturamento';
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

export const PORTA_CONTA_AIH_COMPLEMENTO = Symbol('PORTA_CONTA_AIH_COMPLEMENTO');

/** As tabelas do complemento (a gravação da AIH as soma às dela, para fechar e reapresentar). */
export const TABELAS_COMPLEMENTO_AIH = [
  'conta_aih_profissional',
  'conta_aih_diagnostico',
  'conta_aih_incremento',
] as const;
const TABELAS = [...TABELAS_COMPLEMENTO_AIH, 'conta_aih', 'autorizacao_internacao_sus'];

const esquemaSalvar = z
  .object({
    versao: z.number().int().positive(),
    diagnosticos: z
      .array(
        z
          .object({
            cid: z
              .string()
              .trim()
              .transform((v) => v.replace('.', '').toUpperCase())
              .pipe(z.string().regex(/^[A-Z]\d{2}[0-9A-Z]{0,3}$/)),
            tipo: z.enum(TIPOS_DIAGNOSTICO_AIH),
            classificacao: z.enum(CLASSIFICACOES_DIAGNOSTICO_AIH).nullable().default(null),
          })
          .strict(),
      )
      .max(MAXIMO_DIAGNOSTICOS_SECUNDARIOS_AIH + 2),
    equipe: z
      .array(
        z
          .object({
            procedimento: z.number().int().positive(),
            cns: z
              .string()
              .trim()
              .regex(/^\d{15}$/),
            cbo: z.string().trim().toUpperCase().max(6),
            atividade: z.string().trim().max(10),
            credor: z.string().trim().min(1).max(10).nullable().default(null),
            documentoCredor: z
              .string()
              .trim()
              .transform((v) => v.replace(/\D/g, ''))
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(MAXIMO_EQUIPE_AIH),
    incrementos: z
      .array(
        z
          .object({
            habilitacao: z.string().trim().max(4),
            procedimento: z.number().int().positive().nullable().default(null),
            percentual: z.number(),
          })
          .strict(),
      )
      .max(MAXIMO_INCREMENTOS_AIH),
  })
  .strict();

type Linha = Record<string, unknown>;
type TabelaComplemento = (typeof TABELAS_COMPLEMENTO_AIH)[number];
/** As linhas de cada lista da conta, vivas e excluídas (SQL literal por tabela). */
const SQL_TODAS: Record<TabelaComplemento, string> = {
  conta_aih_profissional: 'SELECT * FROM conta_aih_profissional WHERE conta_aih_id = ? ORDER BY sequencia',
  conta_aih_diagnostico: 'SELECT * FROM conta_aih_diagnostico WHERE conta_aih_id = ? ORDER BY sequencia',
  conta_aih_incremento: 'SELECT * FROM conta_aih_incremento WHERE conta_aih_id = ? ORDER BY sequencia',
};
const vivo = (x: Linha) => x['excluido_em'] === null || x['excluido_em'] === undefined;
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dia = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%d')`;

/** A conta da AIH com as listas do complemento, lida numa conexão (a da leitura ou a da transação). */
export interface ComplementoLido {
  readonly contrato: ComplementoContaAih;
  readonly arquivo: ComplementoSisaih;
  readonly procedimentos: readonly {
    id: number;
    sequencia: number;
    tipo: string;
    sigtap: number;
    codigo: string;
    nome: string;
    sh: number;
    sp: number;
  }[];
}

/** A última conta da AIH do estabelecimento (com trava na transação). */
async function ultimaConta(
  l: Leitor,
  est: number,
  aih: number,
  tx: TxOperacao | null,
): Promise<Linha | null> {
  const sql = `SELECT c.id, c.versao, c.situacao, c.codigo_cid10_principal, ${dia('c.data_internacao')} AS entrada,
                      ${dia('COALESCE(c.data_saida, c.data_internacao)')} AS saida, a.versao AS versao_autorizacao
                 FROM conta_aih c JOIN autorizacao_internacao_sus a ON a.id = c.autorizacao_internacao_sus_id
                WHERE a.id = ? AND a.estabelecimento_id = ? AND c.excluido_em IS NULL
                ORDER BY c.numero_fechamento DESC LIMIT 1`;
  if (tx) return (await tx.consultarParaAtualizar(sql, [aih, est]))[0] ?? null;
  return l.uma(sql, [aih, est]);
}

/** As listas do complemento de uma conta (as linhas vivas, na ordem da sequência). */
export async function lerComplementoDaConta(l: Leitor, conta: Linha): Promise<ComplementoLido> {
  const id = num(conta['id']);
  const saida = txt(conta['saida']);
  const valor = (col: string) =>
    `(SELECT v.${col} FROM procedimento_sigtap_valor v WHERE v.procedimento_sigtap_id = x.procedimento_sigtap_id
        AND v.vigencia_inicio <= ? ORDER BY v.vigencia_inicio DESC LIMIT 1)`;
  const procs = (
    await l.consultar(
      `SELECT x.id, x.sequencia, x.tipo, x.quantidade, x.procedimento_sigtap_id, s.codigo_sigtap, s.descricao,
              ${valor('valor_servico_hospitalar')} AS sh, ${valor('valor_servico_profissional')} AS sp
         FROM conta_aih_procedimento x JOIN procedimento_sigtap s ON s.id = x.procedimento_sigtap_id
        WHERE x.conta_aih_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
      [saida, saida, id],
      { teto: 2_000 },
    )
  ).map((x) => ({
    id: num(x['id']),
    sequencia: num(x['sequencia']),
    tipo: txt(x['tipo']),
    sigtap: num(x['procedimento_sigtap_id']),
    codigo: txt(x['codigo_sigtap']),
    nome: txt(x['descricao']),
    sh: num(x['sh']) * num(x['quantidade']),
    sp: num(x['sp']) * num(x['quantidade']),
  }));
  const seqDoProc = new Map(procs.map((p) => [p.id, p]));
  const equipe = await l.consultar(
    `SELECT x.conta_aih_procedimento_id, pf.cns, pf.nome, o.codigo_cbo,
            COALESCE(da.codigo_oficial, da.codigo) AS atividade, COALESCE(dc.codigo_oficial, dc.codigo) AS credor,
            x.documento_credor
       FROM conta_aih_profissional x
       JOIN profissional pp ON pp.id = x.profissional_id JOIN pessoa_fisica pf ON pf.id = pp.pessoa_fisica_id
       JOIN ocupacao_cbo o ON o.id = x.ocupacao_cbo_id
       LEFT JOIN dominio_sus da ON da.id = x.atividade_dominio_sus_id
       LEFT JOIN dominio_sus dc ON dc.id = x.credor_dominio_sus_id
      WHERE x.conta_aih_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
    [id],
    { teto: 500 },
  );
  const diags = await l.consultar(
    `SELECT codigo_cid10, tipo, classificacao FROM conta_aih_diagnostico
      WHERE conta_aih_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [id],
    { teto: 100 },
  );
  const incs = await l.consultar(
    `SELECT h.codigo_habilitacao, h.descricao, x.conta_aih_procedimento_id, x.percentual,
            x.valor_servico_hospitalar, x.valor_servico_profissional, x.valor_total
       FROM conta_aih_incremento x JOIN habilitacao_sigtap h ON h.id = x.habilitacao_sigtap_id
      WHERE x.conta_aih_id = ? AND x.excluido_em IS NULL ORDER BY x.sequencia`,
    [id],
    { teto: 100 },
  );
  const situacao = txt(conta['situacao']);
  const contrato: ComplementoContaAih = {
    conta: id,
    situacaoConta: situacao,
    editavel: situacao === 'fechada',
    versao: num(conta['versao']),
    equipe: equipe.map((x) => {
      const p = seqDoProc.get(num(x['conta_aih_procedimento_id']));
      return {
        procedimento: p?.sequencia ?? 0,
        codigoProcedimento: p?.codigo ?? '',
        cns: txt(x['cns']),
        nome: txtOuNull(x['nome']),
        cbo: txt(x['codigo_cbo']),
        atividade: txt(x['atividade']),
        credor: txtOuNull(x['credor']),
        documentoCredor: txtOuNull(x['documento_credor']),
      };
    }),
    diagnosticos: diags.map((x) => ({
      cid: txt(x['codigo_cid10']),
      tipo: txt(x['tipo']) as ComplementoContaAih['diagnosticos'][number]['tipo'],
      classificacao: txtOuNull(
        x['classificacao'],
      ) as ComplementoContaAih['diagnosticos'][number]['classificacao'],
    })),
    incrementos: incs.map((x) => {
      const p = numOuNull(x['conta_aih_procedimento_id']);
      return {
        habilitacao: txt(x['codigo_habilitacao']),
        descricao: txtOuNull(x['descricao']),
        procedimento: p === null ? null : (seqDoProc.get(p)?.sequencia ?? null),
        percentual: num(x['percentual']),
        valorServicoHospitalar: num(x['valor_servico_hospitalar']),
        valorServicoProfissional: num(x['valor_servico_profissional']),
        valorTotal: num(x['valor_total']),
      };
    }),
  };
  const codigoDaSeq = new Map(procs.map((p) => [p.sequencia, p.codigo]));
  const arquivo: ComplementoSisaih = {
    equipe: contrato.equipe.map((x) => ({
      procedimento: x.codigoProcedimento,
      cns: x.cns,
      cbo: x.cbo,
      atividade: x.atividade,
      documentoCredor: x.documentoCredor,
    })),
    diagnosticos: contrato.diagnosticos,
    incrementos: contrato.incrementos.map((x) => ({
      habilitacao: x.habilitacao,
      procedimento: x.procedimento === null ? null : (codigoDaSeq.get(x.procedimento) ?? null),
      percentual: x.percentual,
    })),
  };
  return { contrato, arquivo, procedimentos: procs };
}

/** O complemento da última conta da AIH (null sem conta). */
export async function complementoDaAih(l: Leitor, est: number, aih: number): Promise<ComplementoLido | null> {
  const c = await ultimaConta(l, est, aih, null);
  return c ? lerComplementoDaConta(l, c) : null;
}

/**
 * Leva o complemento vivo da conta `de` à conta `para` (o fechamento depois da reabertura e a reapresentação): os
 * diagnósticos inteiros; a equipe e o incremento de procedimento pelo mesmo procedimento da SIGTAP na conta nova (o
 * que não tem mais o procedimento fica só na conta anterior); o incremento da AIH toda sempre.
 */
export async function copiarComplementoDaConta(tx: TxOperacao, de: number, para: number): Promise<void> {
  const procDe = await tx.consultar(
    'SELECT id, procedimento_sigtap_id FROM conta_aih_procedimento WHERE conta_aih_id = ? AND excluido_em IS NULL',
    [de],
    { teto: 2_000 },
  );
  const procPara = await tx.consultar(
    'SELECT id, procedimento_sigtap_id FROM conta_aih_procedimento WHERE conta_aih_id = ? AND excluido_em IS NULL ORDER BY sequencia',
    [para],
    { teto: 2_000 },
  );
  const sigtapDe = new Map(procDe.map((x) => [num(x['id']), num(x['procedimento_sigtap_id'])]));
  const novoPorSigtap = new Map<number, number>();
  for (const x of procPara)
    if (!novoPorSigtap.has(num(x['procedimento_sigtap_id'])))
      novoPorSigtap.set(num(x['procedimento_sigtap_id']), num(x['id']));
  const destino = (antigo: unknown): number | null => {
    const s = sigtapDe.get(num(antigo));
    return s === undefined ? null : (novoPorSigtap.get(s) ?? null);
  };
  const vivos = async (t: TabelaComplemento) =>
    (await tx.consultar(SQL_TODAS[t], [de], { teto: 1_000 })).filter(vivo);
  const limpa = (x: Linha, sem: readonly string[]): Linha =>
    Object.fromEntries(
      Object.entries(x).filter(
        ([k]) =>
          ![
            'id',
            'conta_aih_id',
            'sequencia',
            'criado_em',
            'criado_por',
            'alterado_em',
            'alterado_por',
            'versao',
            'excluido_em',
            'excluido_por',
            ...sem,
          ].includes(k),
      ),
    );
  let seq = 0;
  for (const x of await vivos('conta_aih_diagnostico'))
    await tx.incluir('conta_aih_diagnostico', { ...limpa(x, []), conta_aih_id: para, sequencia: (seq += 1) });
  seq = 0;
  for (const x of await vivos('conta_aih_profissional')) {
    const p = destino(x['conta_aih_procedimento_id']);
    if (p === null) continue;
    await tx.incluir('conta_aih_profissional', {
      ...limpa(x, ['conta_aih_procedimento_id']),
      conta_aih_id: para,
      sequencia: (seq += 1),
      conta_aih_procedimento_id: p,
    });
  }
  seq = 0;
  for (const x of await vivos('conta_aih_incremento')) {
    const antigo = x['conta_aih_procedimento_id'];
    const p = antigo === null || antigo === undefined ? null : destino(antigo);
    if (antigo !== null && antigo !== undefined && p === null) continue;
    await tx.incluir('conta_aih_incremento', {
      ...limpa(x, ['conta_aih_procedimento_id', 'conta_aih_profissional_id']),
      conta_aih_id: para,
      sequencia: (seq += 1),
      conta_aih_procedimento_id: p,
      conta_aih_profissional_id: null,
    });
  }
}

/** O primeiro fechamento: o CID secundário do laudo vira o primeiro diagnóstico secundário da conta. */
export async function diagnosticoDoLaudo(tx: TxOperacao, conta: number, cid: string | null): Promise<void> {
  const c = (cid ?? '').trim().replace('.', '').toUpperCase();
  if (!/^[A-Z]\d{2}[0-9A-Z]{0,3}$/.test(c)) return;
  await tx.incluir('conta_aih_diagnostico', {
    conta_aih_id: conta,
    sequencia: 1,
    codigo_cid10: c,
    tipo: 'secundario',
    origem: 'sistema',
  });
}

function versaoDiferente(): never {
  throw new ErroOperacao(
    409,
    'conflito-versao',
    'Registro alterado',
    'A conta da AIH mudou desde que a tela foi aberta. Recarregue e confira.',
  );
}

type Entrada = z.infer<typeof esquemaSalvar>;

export interface OpcoesComplementoAih {
  readonly procedimentos: readonly { sequencia: number; codigo: string; nome: string; tipo: string }[];
  readonly atividades: readonly { codigo: string; descricao: string }[];
  readonly credores: readonly { codigo: string; descricao: string }[];
  readonly habilitacoes: readonly { codigo: string; descricao: string }[];
}

export class PortaContaAihComplementoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'faturamento.susAihComplemento');
  }

  /** As habilitações do hospital vigentes na internação que a tabela unificada conhece (código → id e descrição). */
  private async habilitacoes(
    l: Leitor,
    est: number,
    data: string,
  ): Promise<Map<string, { id: number; descricao: string }>> {
    const ls = await l.consultar(
      `SELECT h.id, h.codigo_habilitacao, h.descricao
         FROM habilitacao_estabelecimento he JOIN habilitacao_sus hs ON hs.id = he.habilitacao_sus_id
         JOIN habilitacao_sigtap h ON h.tipo = 'habilitacao' AND h.codigo_habilitacao = hs.codigo_cnes
                                  AND h.vigencia_inicio <= ? AND (h.vigencia_fim IS NULL OR h.vigencia_fim >= ?)
        WHERE he.estabelecimento_id = ? AND he.excluido_em IS NULL AND he.vigencia_inicio <= ?
          AND (he.vigencia_fim IS NULL OR he.vigencia_fim >= ?)
        ORDER BY h.codigo_habilitacao, h.vigencia_inicio DESC`,
      [data, data, est, data, data],
      { teto: 500 },
    );
    const m = new Map<string, { id: number; descricao: string }>();
    for (const x of ls)
      if (!m.has(txt(x['codigo_habilitacao'])))
        m.set(txt(x['codigo_habilitacao']), { id: num(x['id']), descricao: txt(x['descricao']) });
    return m;
  }

  private async dominio(l: Leitor, lista: 'atividade_profissional' | 'credor') {
    return (
      await l.consultar(
        `SELECT id, COALESCE(codigo_oficial, codigo) AS codigo, descricao FROM dominio_sus
          WHERE lista = ? AND ativo ORDER BY COALESCE(codigo_oficial, codigo)`,
        [lista],
        { teto: 200 },
      )
    ).map((x) => ({ id: num(x['id']), codigo: txt(x['codigo']), descricao: txt(x['descricao']) }));
  }

  /** O complemento da última conta da AIH e as opções da tela (procedimentos, atividades, credores, habilitações). */
  consultar(
    c: ContextoPortaPropria,
    aih: number,
  ): Promise<ComplementoContaAih & { opcoes: OpcoesComplementoAih }> {
    return this.ler(c, 'consultar', async (l, est) => {
      const conta = await ultimaConta(l, est.id, aih, null);
      if (!conta) throw naoEncontrado('Conta da AIH');
      const lido = await lerComplementoDaConta(l, conta);
      const habs = await this.habilitacoes(l, est.id, txt(conta['entrada']));
      const semId = (xs: { codigo: string; descricao: string }[]) =>
        xs.map((x) => ({ codigo: x.codigo, descricao: x.descricao }));
      return {
        ...lido.contrato,
        opcoes: {
          procedimentos: lido.procedimentos.map((p) => ({
            sequencia: p.sequencia,
            codigo: p.codigo,
            nome: p.nome,
            tipo: p.tipo,
          })),
          atividades: semId(await this.dominio(l, 'atividade_profissional')),
          credores: semId(await this.dominio(l, 'credor')),
          habilitacoes: [...habs].map(([codigo, h]) => ({ codigo, descricao: h.descricao })),
        },
      };
    });
  }

  /** Grava a equipe, os diagnósticos e os incrementos da última conta (a lista inteira, pela diferença). */
  salvar(c: ContextoPortaPropria, aih: number, entrada: unknown): Promise<ComplementoContaAih> {
    const e: Entrada = entradaValida(esquemaSalvar, entrada);
    return this.gravar(c, 'faturamento.sus.aih.complemento', TABELAS, async (tx, est, usuario) => {
      const conta = await ultimaConta(tx, est.id, aih, tx);
      if (!conta) throw naoEncontrado('Conta da AIH');
      if (num(conta['versao']) !== e.versao) versaoDiferente();
      const contaId = num(conta['id']);
      const atual = await lerComplementoDaConta(tx, conta);
      const habs = await this.habilitacoes(tx, est.id, txt(conta['entrada']));
      const problemas = conferirComplementoAih(e, {
        situacaoConta: txt(conta['situacao']),
        cidPrincipal: txt(conta['codigo_cid10_principal']),
        procedimentos: atual.procedimentos.map((p) => ({ sequencia: p.sequencia, tipo: p.tipo })),
        habilitacoes: new Set(habs.keys()),
      });
      if (problemas.length) throw recusaRegra('Complemento da AIH recusado', problemas);
      const procPorSeq = new Map(atual.procedimentos.map((p) => [p.sequencia, p]));
      const excluir = { excluido_em: new Date(), excluido_por: usuario };
      const reviver = { excluido_em: null, excluido_por: null };
      const todas = (t: TabelaComplemento) => tx.consultar(SQL_TODAS[t], [contaId], { teto: 1_000 });
      const proxima = (ls: Linha[]) => ls.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0) + 1;

      // Diagnósticos: a chave é o CID com o papel (única na conta, mesmo excluída: volta a mesma linha).
      const diags = await todas('conta_aih_diagnostico');
      let seq = proxima(diags);
      const queroDiag = new Map(e.diagnosticos.map((d) => [`${d.cid}|${d.tipo}`, d]));
      for (const x of diags) {
        const d = queroDiag.get(`${txt(x['codigo_cid10'])}|${txt(x['tipo'])}`);
        const ativo = vivo(x);
        if (d) {
          queroDiag.delete(`${d.cid}|${d.tipo}`);
          if (!ativo || txtOuNull(x['classificacao']) !== d.classificacao)
            await tx.alterar('conta_aih_diagnostico', num(x['id']), num(x['versao']), {
              classificacao: d.classificacao,
              ...reviver,
            });
        } else if (ativo) await tx.alterar('conta_aih_diagnostico', num(x['id']), num(x['versao']), excluir);
      }
      for (const d of queroDiag.values())
        await tx.incluir('conta_aih_diagnostico', {
          conta_aih_id: contaId,
          sequencia: seq++,
          codigo_cid10: d.cid,
          tipo: d.tipo,
          classificacao: d.classificacao,
          origem: 'sistema',
        });

      // Equipe: a chave é o procedimento, o profissional e a atividade.
      const atividades = new Map(
        (await this.dominio(tx, 'atividade_profissional')).map((x) => [x.codigo, x.id]),
      );
      const credores = new Map((await this.dominio(tx, 'credor')).map((x) => [x.codigo, x.id]));
      const recusar = (campo: string, mensagem: string) => {
        throw recusaRegra('Complemento da AIH recusado', [{ campo, mensagem }]);
      };
      const linhasEquipe: Linha[] = [];
      for (const [i, x] of e.equipe.entries()) {
        const pf = await tx.uma(
          `SELECT pp.id FROM profissional pp JOIN pessoa_fisica pf ON pf.id = pp.pessoa_fisica_id
            WHERE pf.cns = ? AND pp.excluido_em IS NULL ORDER BY pp.id LIMIT 1`,
          [x.cns],
        );
        if (!pf) recusar(`equipe.${i}`, `O CNS da linha ${i + 1} não é de um profissional do cadastro.`);
        const o = await tx.uma('SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ? ORDER BY id LIMIT 1', [
          x.cbo,
        ]);
        if (!o) recusar(`equipe.${i}`, `A ocupação (CBO) da linha ${i + 1} não está no catálogo.`);
        const atividade = atividades.get(x.atividade);
        if (atividade === undefined)
          recusar(`equipe.${i}`, `A atividade da linha ${i + 1} não está no domínio do SUS do cliente.`);
        const credor = x.credor === null ? null : (credores.get(x.credor) ?? null);
        if (x.credor !== null && credor === null)
          recusar(`equipe.${i}`, `O credor da linha ${i + 1} não está no domínio do SUS do cliente.`);
        linhasEquipe.push({
          conta_aih_procedimento_id: procPorSeq.get(x.procedimento)?.id,
          profissional_id: num(pf?.['id']),
          ocupacao_cbo_id: num(o?.['id']),
          atividade_dominio_sus_id: atividade,
          credor_dominio_sus_id: credor,
          tipo_documento_credor: tipoDocumentoCredor(x.documentoCredor),
          documento_credor: x.documentoCredor || null,
        });
      }
      const chaveEquipe = (x: Linha) =>
        `${num(x['conta_aih_procedimento_id'])}|${num(x['profissional_id'])}|${num(x['atividade_dominio_sus_id'])}`;
      const equipe = await todas('conta_aih_profissional');
      seq = proxima(equipe);
      const queroEquipe = new Map(linhasEquipe.map((x) => [chaveEquipe(x), x]));
      for (const x of equipe) {
        const ativo = vivo(x);
        const q = queroEquipe.get(chaveEquipe(x));
        if (q && ativo) {
          queroEquipe.delete(chaveEquipe(x));
          if (
            num(x['ocupacao_cbo_id']) !== num(q['ocupacao_cbo_id']) ||
            numOuNull(x['credor_dominio_sus_id']) !== q['credor_dominio_sus_id'] ||
            txtOuNull(x['documento_credor']) !== q['documento_credor']
          )
            await tx.alterar('conta_aih_profissional', num(x['id']), num(x['versao']), {
              ocupacao_cbo_id: q['ocupacao_cbo_id'],
              credor_dominio_sus_id: q['credor_dominio_sus_id'],
              tipo_documento_credor: q['tipo_documento_credor'],
              documento_credor: q['documento_credor'],
            });
        } else if (ativo) await tx.alterar('conta_aih_profissional', num(x['id']), num(x['versao']), excluir);
      }
      for (const q of queroEquipe.values())
        await tx.incluir('conta_aih_profissional', {
          ...q,
          conta_aih_id: contaId,
          sequencia: seq++,
          origem: 'sistema',
        });

      // Incrementos: a chave é a habilitação com o alvo (procedimento ou a AIH toda); o valor sobre a SIGTAP da saída.
      const totalAih = atual.procedimentos.reduce(
        (t, p) => ({
          servicoHospitalar: t.servicoHospitalar + p.sh,
          servicoProfissional: t.servicoProfissional + p.sp,
        }),
        { servicoHospitalar: 0, servicoProfissional: 0 },
      );
      const linhasInc = e.incrementos.map((x) => {
        const p = x.procedimento === null ? null : (procPorSeq.get(x.procedimento) ?? null);
        const v = valorDoIncrementoAih(
          p ? { servicoHospitalar: p.sh, servicoProfissional: p.sp } : totalAih,
          x.percentual,
        );
        return {
          habilitacao_sigtap_id: habs.get(x.habilitacao)?.id ?? 0,
          conta_aih_procedimento_id: p?.id ?? null,
          percentual: x.percentual,
          valor_servico_hospitalar: v.servicoHospitalar,
          valor_servico_profissional: v.servicoProfissional,
          valor_total: v.total,
        };
      });
      const chaveInc = (x: Linha) =>
        `${num(x['habilitacao_sigtap_id'])}|${numOuNull(x['conta_aih_procedimento_id']) ?? 'aih'}`;
      const incs = await todas('conta_aih_incremento');
      seq = proxima(incs);
      const queroInc = new Map(linhasInc.map((x) => [chaveInc(x), x]));
      for (const x of incs) {
        const ativo = vivo(x);
        const q = queroInc.get(chaveInc(x));
        if (q && ativo) {
          queroInc.delete(chaveInc(x));
          if (num(x['percentual']) !== q.percentual || num(x['valor_total']) !== q.valor_total)
            await tx.alterar('conta_aih_incremento', num(x['id']), num(x['versao']), {
              percentual: q.percentual,
              valor_servico_hospitalar: q.valor_servico_hospitalar,
              valor_servico_profissional: q.valor_servico_profissional,
              valor_total: q.valor_total,
            });
        } else if (ativo) await tx.alterar('conta_aih_incremento', num(x['id']), num(x['versao']), excluir);
      }
      for (const q of queroInc.values())
        await tx.incluir('conta_aih_incremento', {
          ...q,
          conta_aih_id: contaId,
          sequencia: seq++,
          origem: 'sistema',
        });

      await tx.alterar('conta_aih', contaId, num(conta['versao']), {});
      await tx.alterar('autorizacao_internacao_sus', aih, num(conta['versao_autorizacao']), {});
      const depois = await ultimaConta(tx, est.id, aih, null);
      const lido = await lerComplementoDaConta(tx, depois ?? conta);
      return { ...lido.contrato, tabela: 'conta_aih', id: contaId };
    }).then((r) => {
      // O resultado do executor leva a tabela e o id da trilha; a tela recebe só o complemento.
      const resto: Record<string, unknown> = { ...r };
      delete resto['tabela'];
      delete resto['id'];
      return resto as ComplementoContaAih;
    });
  }
}
