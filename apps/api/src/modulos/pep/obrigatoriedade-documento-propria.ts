// Obrigatoriedade de documentos clínicos (F7, 03-PEP L132), no banco do cliente (`regra_obrigatoriedade_documento`,
// `regra_obrigatoriedade_cid`). Contrato de efeito:
//   - regras: leitura das regras do estabelecimento da sessão (e das que valem para todos os estabelecimentos, com
//     estabelecimento nulo), com o título do documento exigido, o setor e os diagnósticos vigentes da regra, e as
//     opções da tela (modelos publicados, setores ativos do estabelecimento, sexos);
//   - incluir: validada pela regra do domínio (a mesma da tela: faixa etária, intervalo do periódico, prazo, vigência,
//     CID-10 pela categoria ou pelo código, sem repetir), grava a regra no estabelecimento da sessão e uma linha por
//     diagnóstico, na mesma transação, com a trilha;
//   - alterar: pela versão lida (conflito: 409), regrava os campos; o diagnóstico retirado recebe a marca de exclusão
//     (nunca apagado) e o recolocado volta pela mesma linha;
//   - ativar e desativar pela versão (nada apagado);
//   - a regra de todos os estabelecimentos guarda o estabelecimento de origem, só ele a altera ou desativa (403 nos
//     outros, sem escrita), e não aceita setor (regra do domínio);
//   - pendências: para os atendimentos abertos do estabelecimento e os encerrados nos últimos 30 dias (ou um atendimento, na visão por paciente), lê o
//     tipo pela categoria, o setor, o sexo, a data de nascimento, os diagnósticos ativos (CID-10), a entrada, a alta,
//     a saída, a primeira prescrição e os registros clínicos não suspensos por modelo, e aplica a regra do domínio: a
//     lista do profissional com o documento que falta, o prazo, se venceu e se bloqueia o passo seguinte.
// Regra de negócio no domínio (@sgh/dominio-pep), nenhuma em gatilho. SQL parametrizado, no estabelecimento da sessão.
import {
  type AtendimentoAvaliado,
  bloqueiosDoPasso,
  motivoDoBloqueio,
  type PassoBloqueavel,
  type DocumentoDoAtendimento,
  EXIGENCIAS_OBRIGATORIEDADE,
  MOMENTOS_OBRIGATORIEDADE,
  normalizarCid,
  pendenciasObrigatorias,
  type PendenciaObrigatoria,
  type RegraObrigatoriedade,
  type RegraObrigatoriedadeEntrada,
  TETO_CIDS_REGRA,
  TIPOS_ATENDIMENTO_OBRIGATORIEDADE,
  tipoAtendimentoDaCategoria,
  validarRegraObrigatoriedade,
} from '@sgh/dominio-pep';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
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

export const PORTA_OBRIGATORIEDADE_DOCUMENTO = Symbol('PORTA_OBRIGATORIEDADE_DOCUMENTO');

const REGRA = 'regra_obrigatoriedade_documento';
const CID = 'regra_obrigatoriedade_cid';
/** Teto de atendimentos abertos avaliados de uma vez na lista do profissional. */
export const TETO_ATENDIMENTOS_PENDENCIAS = 300;
/**
 * Dias em que o atendimento encerrado continua na lista do profissional: o documento da alta e o do fechamento só são
 * exigidos a partir da alta médica e da saída, e a falta não some quando o atendimento fecha.
 */
export const DIAS_ENCERRADO_NA_LISTA = 30;

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaRegra = z
  .object({
    modelo: id,
    setor: id.nullable().default(null),
    sexo: id.nullable().default(null),
    tipoAtendimento: z.enum(TIPOS_ATENDIMENTO_OBRIGATORIEDADE).default('todos'),
    idadeMinimaDias: z.number().int().nullable().default(null),
    idadeMaximaDias: z.number().int().nullable().default(null),
    cids: z.array(z.string().trim().min(1).max(8)).max(TETO_CIDS_REGRA).default([]),
    momento: z.enum(MOMENTOS_OBRIGATORIEDADE),
    exigencia: z.enum(EXIGENCIAS_OBRIGATORIEDADE).default('alertar'),
    prazoMinutos: z.number().int().nullable().default(null),
    intervaloDias: z.number().int().nullable().default(null),
    vigenciaInicio: data,
    vigenciaFim: data.nullable().default(null),
    todosEstabelecimentos: z.boolean().default(false),
  })
  .strict();
const esquemaAlterar = esquemaRegra.extend({ versao: id }).strict();
const esquemaAtivo = z.object({ versao: id, ativo: z.boolean() }).strict();
const esquemaFiltro = z
  .object({
    setor: z.coerce.number().int().positive().optional(),
    vencidas: z
      .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
      .optional()
      .transform((v) => v === '1' || v === 'true'),
  })
  .strict();

export interface RegraObrigatoriedadeLida extends RegraObrigatoriedade {
  readonly versao: number;
  readonly todosEstabelecimentos: boolean;
  /** A sessão pode alterar e desativar: regra do estabelecimento ou regra de todos criada por ele. */
  readonly editavel: boolean;
  readonly setorNome: string | null;
}

export interface AtendimentoComPendencias {
  readonly atendimento: number;
  readonly numero: string;
  readonly paciente: number;
  readonly pacienteNome: string;
  readonly prontuario: string | null;
  readonly setor: number | null;
  readonly setorNome: string | null;
  readonly pendencias: readonly PendenciaObrigatoria[];
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};

const SQL_REGRAS = `
  SELECT r.id, r.versao, r.ativo, r.estabelecimento_id, r.estabelecimento_origem_id, r.modelo_documento_clinico_id, m.titulo,
         r.setor_funcional_id, sf.nome AS setor_nome, r.sexo_id, r.tipo_atendimento, r.idade_minima_dias,
         r.idade_maxima_dias, r.momento, r.exigencia, r.prazo_minutos, r.intervalo_dias, r.vigencia_inicio,
         r.vigencia_fim
    FROM regra_obrigatoriedade_documento r
    JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
    LEFT JOIN setor_funcional sf ON sf.id = r.setor_funcional_id AND sf.estabelecimento_id = ?
   WHERE (r.estabelecimento_id = ? OR r.estabelecimento_id IS NULL)`;

function regraLida(r: Linha, cids: readonly string[], est: number): RegraObrigatoriedadeLida {
  return {
    id: num(r['id']),
    versao: num(r['versao']),
    ativo: bool(r['ativo']),
    todosEstabelecimentos: r['estabelecimento_id'] === null || r['estabelecimento_id'] === undefined,
    editavel: numOuNull(r['estabelecimento_id'] ?? r['estabelecimento_origem_id']) === est,
    modelo: num(r['modelo_documento_clinico_id']),
    titulo: String(r['titulo'] ?? ''),
    setor: numOuNull(r['setor_funcional_id']),
    setorNome: txtOuNull(r['setor_nome']),
    sexo: numOuNull(r['sexo_id']),
    tipoAtendimento: String(r['tipo_atendimento']) as RegraObrigatoriedade['tipoAtendimento'],
    idadeMinimaDias: numOuNull(r['idade_minima_dias']),
    idadeMaximaDias: numOuNull(r['idade_maxima_dias']),
    cids,
    momento: String(r['momento']) as RegraObrigatoriedade['momento'],
    exigencia: String(r['exigencia']) as RegraObrigatoriedade['exigencia'],
    prazoMinutos: numOuNull(r['prazo_minutos']),
    intervaloDias: numOuNull(r['intervalo_dias']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
    vigenciaFim: dataIso(r['vigencia_fim']),
  };
}

/** As regras do estabelecimento com os diagnósticos vigentes de cada uma. */
async function lerRegras(l: Leitor, est: number, filtro = ''): Promise<RegraObrigatoriedadeLida[]> {
  const linhas = await l.consultar<Linha>(`${SQL_REGRAS}${filtro} ORDER BY r.ativo DESC, m.titulo, r.id`, [
    est,
    est,
  ]);
  if (!linhas.length) return [];
  const ids = linhas.map((r) => num(r['id']));
  const cids = await l.consultar<Linha>(
    `SELECT regra_obrigatoriedade_documento_id AS regra, codigo_cid10 FROM regra_obrigatoriedade_cid
      WHERE excluido_em IS NULL AND regra_obrigatoriedade_documento_id IN (${ids.map(() => '?').join(',')})
      ORDER BY codigo_cid10`,
    ids,
  );
  const porRegra = new Map<number, string[]>();
  for (const c of cids) {
    const k = num(c['regra']);
    porRegra.set(k, [...(porRegra.get(k) ?? []), String(c['codigo_cid10'])]);
  }
  return linhas.map((r) => regraLida(r, porRegra.get(num(r['id'])) ?? [], est));
}

function paraDominio(e: z.infer<typeof esquemaRegra>): RegraObrigatoriedadeEntrada {
  return {
    todosEstabelecimentos: e.todosEstabelecimentos,
    modelo: e.modelo,
    setor: e.setor,
    sexo: e.sexo,
    tipoAtendimento: e.tipoAtendimento,
    idadeMinimaDias: e.idadeMinimaDias,
    idadeMaximaDias: e.idadeMaximaDias,
    cids: e.cids,
    momento: e.momento,
    exigencia: e.exigencia,
    prazoMinutos: e.prazoMinutos,
    intervaloDias: e.intervaloDias,
    vigenciaInicio: e.vigenciaInicio,
    vigenciaFim: e.vigenciaFim,
  };
}

const SQL_ATENDIMENTOS = `
  SELECT a.id, a.numero, a.paciente_id, pf.nome AS paciente_nome, pc.numero_prontuario, k.tipo_base,
         COALESCE(a.setor_funcional_id,
           (SELECT MIN(sf.id) FROM setor_funcional sf
             WHERE sf.estabelecimento_id = a.estabelecimento_id AND sf.ativo
               AND sf.unidade_assistencial_id = COALESCE(uin.unidade_assistencial_id, a.unidade_assistencial_id))
         ) AS setor_id,
         pf.sexo_id, pf.data_nascimento, a.entrada_em, a.alta_medica_em, a.saida_em,
         (SELECT MIN(p.prescrito_em) FROM prescricao p
           WHERE p.atendimento_id = a.id AND p.situacao NOT IN ('rascunho','cancelada','futura')) AS primeira_prescricao
    FROM atendimento a
    JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
    JOIN paciente pc ON pc.id = a.paciente_id AND pc.excluido_em IS NULL
    JOIN pessoa_fisica pf ON pf.id = pc.pessoa_fisica_id
    LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.excluido_em IS NULL
    LEFT JOIN unidade_internacao uin ON uin.id = i.unidade_internacao_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL`;

/** Leitura das pendências: atendimentos, diagnósticos ativos e registros clínicos não suspensos por modelo. */
async function lerPendencias(
  l: Leitor,
  est: number,
  regras: readonly RegraObrigatoriedade[],
  filtro: { readonly atendimento?: number },
  agora: Date,
  passos?: readonly PassoBloqueavel[],
): Promise<AtendimentoComPendencias[]> {
  // Na lista: os abertos e os encerrados há até DIAS_ENCERRADO_NA_LISTA dias (a alta e o fechamento vencem depois).
  const desde = new Date(agora.getTime() - DIAS_ENCERRADO_NA_LISTA * 86_400_000);
  const params: unknown[] = filtro.atendimento ? [est, filtro.atendimento] : [est, desde];
  const where = filtro.atendimento
    ? ' AND a.id = ?'
    : " AND (a.situacao IN ('aberto','em_atendimento','em_observacao') OR (a.situacao = 'encerrado' AND a.saida_em >= ?))";
  const linhas = await l.consultar<Linha>(
    `${SQL_ATENDIMENTOS}${where} ORDER BY a.entrada_em DESC, a.id DESC LIMIT ${TETO_ATENDIMENTOS_PENDENCIAS}`,
    params,
  );
  if (!linhas.length) return [];
  const ids = linhas.map((r) => num(r['id']));
  const marcas = ids.map(() => '?').join(',');
  const cids = await l.consultar<Linha>(
    `SELECT d.atendimento_id, t.codigo_termo FROM diagnostico_atendimento d
       JOIN termo_terminologia t ON t.id = d.cid_termo_terminologia_id
      WHERE d.situacao = 'ativo' AND d.excluido_em IS NULL AND d.atendimento_id IN (${marcas})`,
    ids,
  );
  const docs = await l.consultar<Linha>(
    `SELECT atendimento_id, modelo_documento_clinico_id AS modelo, data_hora_clinica AS em
       FROM registro_assistencial
      WHERE excluido_em IS NULL AND situacao IN ('finalizado','aguardando_coassinatura')
        AND atendimento_id IN (${marcas})`,
    ids,
  );
  const setores = new Map<number, string>(
    (
      await l.consultar<Linha>('SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ?', [est])
    ).map((s) => [num(s['id']), String(s['nome'])]),
  );
  const agrupar = <T>(lista: Linha[], f: (r: Linha) => T) => {
    const m = new Map<number, T[]>();
    for (const r of lista) {
      const k = num(r['atendimento_id']);
      m.set(k, [...(m.get(k) ?? []), f(r)]);
    }
    return m;
  };
  const cidsPor = agrupar(cids, (r) => normalizarCid(String(r['codigo_termo'])));
  const docsPor = agrupar(docs, (r): DocumentoDoAtendimento => ({
    modelo: num(r['modelo']),
    em: iso(r['em']) ?? '',
  }));
  return linhas.map((r) => {
    const at = num(r['id']);
    const setor = numOuNull(r['setor_id']);
    const avaliado: AtendimentoAvaliado = {
      tipo: tipoAtendimentoDaCategoria(txtOuNull(r['tipo_base'])),
      setor,
      sexo: numOuNull(r['sexo_id']),
      nascimento: dataIso(r['data_nascimento']),
      cids: cidsPor.get(at) ?? [],
      entrada: iso(r['entrada_em']) ?? agora.toISOString(),
      altaMedica: iso(r['alta_medica_em']),
      saida: iso(r['saida_em']),
      primeiraPrescricao: iso(r['primeira_prescricao']),
    };
    return {
      atendimento: at,
      numero: String(r['numero'] ?? at),
      paciente: num(r['paciente_id']),
      pacienteNome: String(r['paciente_nome'] ?? ''),
      prontuario: txtOuNull(r['numero_prontuario']),
      setor,
      setorNome: setor === null ? null : (setores.get(setor) ?? null),
      pendencias: passos
        ? bloqueiosDoPasso(regras, avaliado, docsPor.get(at) ?? [], passos, agora)
        : pendenciasObrigatorias(regras, avaliado, docsPor.get(at) ?? [], agora),
    };
  });
}

/**
 * A regra "bloquear" na operação (C2-028): chamada dentro da transação da alta médica e do fechamento do atendimento,
 * recusa (422 documento-exigido-pendente) com o motivo quando falta documento exigido pelo passo ou já vencido. Sem
 * regra ativa no estabelecimento, nada é lido além das regras.
 */
export async function conferirDocumentosExigidos(
  l: Leitor,
  est: number,
  atendimento: number,
  passos: readonly PassoBloqueavel[],
  agora: Date,
): Promise<void> {
  const regras = (await lerRegras(l, est, ' AND r.ativo')).filter((r) => r.exigencia === 'bloquear');
  if (!regras.length) return;
  const [a] = await lerPendencias(l, est, regras, { atendimento }, agora, passos);
  if (!a?.pendencias.length) return;
  throw new ErroOperacao(
    422,
    'documento-exigido-pendente',
    'Documento exigido pendente',
    motivoDoBloqueio(a.pendencias),
    {
      pendencias: a.pendencias.map((p) => ({
        regra: p.regra,
        modelo: p.modelo,
        titulo: p.titulo,
        momento: p.momento,
      })),
    },
  );
}

export class PortaObrigatoriedadeDocumentoPropria extends PortaEstabelecimentoPropria {
  constructor(
    nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0],
    cliente: string,
    private readonly relogio: () => Date = () => new Date(),
  ) {
    super(nucleo, cliente, [REGRA, CID], 'pep.obrigatoriedade');
  }

  /** As regras do estabelecimento e as opções da tela. */
  regras(c: ContextoPortaPropria) {
    return this.ler(c, 'regras', async (l, est) => ({
      regras: await lerRegras(l, est.id),
      opcoes: {
        modelos: (
          await l.consultar<Linha>(
            `SELECT id, titulo AS rotulo FROM modelo_documento_clinico
              WHERE situacao = 'publicado' AND excluido_em IS NULL ORDER BY titulo LIMIT 2000`,
          )
        ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) })),
        setores: (
          await l.consultar<Linha>(
            'SELECT id, nome AS rotulo FROM setor_funcional WHERE estabelecimento_id = ? AND ativo ORDER BY nome LIMIT 2000',
            [est.id],
          )
        ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) })),
        sexos: (
          await l.consultar<Linha>('SELECT id, descricao AS rotulo FROM sexo ORDER BY id LIMIT 20')
        ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) })),
      },
    }));
  }

  /** Confere modelo e setor no banco e a regra no domínio; recusa sem escrita. */
  private async conferir(tx: TxOperacao, est: number, e: z.infer<typeof esquemaRegra>): Promise<string[]> {
    const modelo = await tx.uma(
      "SELECT id FROM modelo_documento_clinico WHERE id = ? AND situacao = 'publicado' AND excluido_em IS NULL",
      [e.modelo],
    );
    if (!modelo) throw naoEncontrado('Modelo de documento publicado');
    if (e.setor !== null) {
      const s = await tx.uma('SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ?', [
        e.setor,
        est,
      ]);
      if (!s) throw naoEncontrado('Setor');
    }
    if (e.sexo !== null && !(await tx.uma('SELECT id FROM sexo WHERE id = ?', [e.sexo])))
      throw naoEncontrado('Sexo');
    const falhas = validarRegraObrigatoriedade(paraDominio(e));
    if (falhas.length)
      throw recusaRegra(
        'Regra de documento exigido recusada',
        falhas.map((f) => ({ campo: f.codigo, mensagem: f.mensagem })),
      );
    return [...new Set(e.cids.map(normalizarCid))];
  }

  /**
   * A regra que a sessão pode alterar ou desativar: a do estabelecimento, ou a de todos os estabelecimentos criada por
   * ele. A de todos criada em outro estabelecimento é recusada sem escrita (403); a de outro estabelecimento, 404.
   */
  private async regraEditavel(tx: TxOperacao, est: number, regra: number): Promise<void> {
    const atual = await tx.uma(
      'SELECT id, estabelecimento_id, estabelecimento_origem_id FROM regra_obrigatoriedade_documento WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
      [regra, est],
    );
    if (!atual) throw naoEncontrado('Regra de documento exigido');
    if (atual['estabelecimento_id'] === null && numOuNull(atual['estabelecimento_origem_id']) !== est)
      throw new ErroOperacao(
        403,
        'regra-de-outro-estabelecimento',
        'Regra de todos os estabelecimentos',
        'A regra que vale para todos os estabelecimentos só é alterada ou desativada pelo estabelecimento que a criou.',
      );
  }

  private colunas(e: z.infer<typeof esquemaRegra>) {
    return {
      modelo_documento_clinico_id: e.modelo,
      setor_funcional_id: e.setor,
      sexo_id: e.sexo,
      tipo_atendimento: e.tipoAtendimento,
      idade_minima_dias: e.idadeMinimaDias,
      idade_maxima_dias: e.idadeMaximaDias,
      momento: e.momento,
      exigencia: e.exigencia,
      prazo_minutos: e.prazoMinutos,
      intervalo_dias: e.intervaloDias,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
    };
  }

  /** Inclui a regra com os diagnósticos, na mesma transação. */
  async incluir(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaRegra, entrada);
    return this.gravar(c, 'pep.obrigatoriedade.regra-incluir', [REGRA, CID], async (tx, est) => {
      const cids = await this.conferir(tx, est.id, e);
      const regra = await tx.incluir(REGRA, {
        estabelecimento_id: e.todosEstabelecimentos ? null : est.id,
        estabelecimento_origem_id: est.id,
        ...this.colunas(e),
        ativo: true,
      });
      for (const cid of cids)
        await tx.incluir(CID, { regra_obrigatoriedade_documento_id: regra, codigo_cid10: cid });
      return { tabela: REGRA, id: regra, cids: cids.length };
    });
  }

  /** Altera pela versão lida; diagnóstico retirado recebe a marca de exclusão, recolocado volta pela mesma linha. */
  async alterar(c: ContextoPortaPropria, regra: number, entrada: unknown) {
    const e = entradaValida(esquemaAlterar, entrada);
    return this.gravar(c, 'pep.obrigatoriedade.regra-alterar', [REGRA, CID], async (tx, est, usuario) => {
      await this.regraEditavel(tx, est.id, regra);
      const cids = await this.conferir(tx, est.id, e);
      await tx.alterar(REGRA, regra, e.versao, {
        ...this.colunas(e),
        estabelecimento_id: e.todosEstabelecimentos ? null : est.id,
      });
      const existentes = await tx.consultar<Linha>(
        'SELECT id, versao, codigo_cid10, excluido_em FROM regra_obrigatoriedade_cid WHERE regra_obrigatoriedade_documento_id = ?',
        [regra],
      );
      const porCodigo = new Map(existentes.map((x) => [String(x['codigo_cid10']), x]));
      const quero = new Set(cids);
      let retirados = 0;
      for (const x of existentes) {
        const vivo = x['excluido_em'] === null || x['excluido_em'] === undefined;
        const codigo = String(x['codigo_cid10']);
        if (vivo && !quero.has(codigo)) {
          await tx.alterar(CID, num(x['id']), num(x['versao']), {
            excluido_em: this.relogio(),
            excluido_por: usuario,
          });
          retirados++;
        } else if (!vivo && quero.has(codigo))
          await tx.alterar(CID, num(x['id']), num(x['versao']), { excluido_em: null, excluido_por: null });
      }
      for (const cid of cids)
        if (!porCodigo.has(cid))
          await tx.incluir(CID, { regra_obrigatoriedade_documento_id: regra, codigo_cid10: cid });
      return { tabela: REGRA, id: regra, cids: cids.length, retirados };
    });
  }

  /** Ativa ou desativa pela versão lida (nada apagado). */
  async ativar(c: ContextoPortaPropria, regra: number, entrada: unknown) {
    const e = entradaValida(esquemaAtivo, entrada);
    return this.gravar(c, 'pep.obrigatoriedade.regra-ativo', [REGRA], async (tx, est) => {
      await this.regraEditavel(tx, est.id, regra);
      await tx.alterar(REGRA, regra, e.versao, { ativo: e.ativo });
      return { tabela: REGRA, id: regra, ativo: e.ativo };
    });
  }

  /** A lista do profissional: atendimentos abertos com documento exigido que falta (vencidas primeiro). */
  pendencias(c: ContextoPortaPropria, consulta: unknown) {
    const f = entradaValida(esquemaFiltro, consulta ?? {});
    return this.ler(c, 'pendencias', async (l, est) => {
      const agora = this.relogio();
      const regras = await lerRegras(l, est.id, ' AND r.ativo');
      const todos = regras.length ? await lerPendencias(l, est.id, regras, {}, agora) : [];
      const itens = todos
        .filter((a) => f.setor === undefined || a.setor === f.setor)
        .map((a) => ({ ...a, pendencias: f.vencidas ? a.pendencias.filter((p) => p.vencida) : a.pendencias }))
        .filter((a) => a.pendencias.length > 0);
      const pend = itens.flatMap((a) => a.pendencias);
      return {
        agora: agora.toISOString(),
        regrasAtivas: regras.length,
        totais: {
          atendimentos: itens.length,
          pendencias: pend.length,
          vencidas: pend.filter((p) => p.vencida).length,
          bloqueantes: pend.filter((p) => p.exigencia === 'bloquear').length,
        },
        itens,
      };
    });
  }

  /** Visão por paciente: as pendências de um atendimento do estabelecimento. */
  pendenciasDoAtendimento(c: ContextoPortaPropria, atendimento: number) {
    return this.ler(c, 'pendencias-atendimento', async (l, est) => {
      const agora = this.relogio();
      const regras = await lerRegras(l, est.id, ' AND r.ativo');
      const [a] = await lerPendencias(l, est.id, regras, { atendimento }, agora);
      if (!a) throw naoEncontrado('Atendimento');
      return { agora: agora.toISOString(), ...a };
    });
  }
}
