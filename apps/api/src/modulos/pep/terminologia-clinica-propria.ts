// Terminologia clínica no prontuário (F8, 09-AREA linha 84), no banco próprio do cliente. Regras no domínio
// (@sgh/dominio-pep, terminologia-clinica.ts); aqui ficam as leituras e a gravação pelo executor (trilha na mesma
// transação):
// - busca de conceitos clínicos (termo_terminologia da terminologia 'snomed', carregada do pacote RF2 pelo
//   catalogos/carregadores/snomed.py), com as equivalências da CID-10 escolhida primeiro (termo_equivalencia);
// - regiões anatômicas codificadas (regiao_anatomica_codificada), por texto, pela superior ou pelas do exame;
// - diagnósticos do paciente (visão por paciente, com a CID-10 e o conceito equivalente);
// - registro do diagnóstico do atendimento (CID-10 obrigatória, conceito clínico opcional) e troca do conceito
//   equivalente (a versão sobe; nada é apagado);
// - região anatômica do exame (exame_regiao_anatomica): ligar e retirar (retirar só desativa; religar reativa).
import {
  CERTEZAS_DIAGNOSTICO,
  ESCOPOS_DIAGNOSTICO,
  type FalhaTerminologia,
  OBSERVACAO_DIAGNOSTICO_MAXIMA,
  ordenarSugestoesConceito,
  type TermoCatalogo,
  TERMINOLOGIA_CONCEITO_CLINICO,
  TERMINOLOGIA_DIAGNOSTICO,
  TIPOS_DIAGNOSTICO,
  validarRegiaoDoExame,
  validarRegistroDiagnostico,
  validarTrocaConceito,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dataDe = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const id = z.number().int().positive();
const TETO_BUSCA = 30;

export const esquemaDiagnostico = z.discriminatedUnion('acao', [
  z
    .object({
      acao: z.literal('registrar'),
      paciente: id,
      atendimento: id,
      cid: id,
      conceito: id.nullable().optional(),
      tipo: z.enum(TIPOS_DIAGNOSTICO).default('secundario'),
      certeza: z.enum(CERTEZAS_DIAGNOSTICO).default('confirmado'),
      escopo: z.enum(ESCOPOS_DIAGNOSTICO).default('atendimento'),
      observacao: z
        .string()
        .max(OBSERVACAO_DIAGNOSTICO_MAXIMA + 100)
        .nullable()
        .optional(),
    })
    .strict(),
  z
    .object({
      acao: z.literal('conceito'),
      diagnostico: id,
      versao: z.number().int().positive(),
      /** null tira o conceito equivalente. */
      conceito: id.nullable(),
    })
    .strict(),
]);
export type EntradaDiagnostico = z.infer<typeof esquemaDiagnostico>;

export const esquemaRegiaoExame = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('ligar'), exame: id, regiao: id, padrao: z.boolean().default(false) }).strict(),
  z.object({ acao: z.literal('retirar'), exame: id, regiao: id }).strict(),
]);
export type EntradaRegiaoExame = z.infer<typeof esquemaRegiaoExame>;

export interface NucleoTerminologia {
  lerSomente<T>(
    contexto: {
      readonly cliente: string;
      readonly correlacao: string;
      readonly estabelecimento?: number | null;
    },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}
export interface ContextoTerminologia {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoTerminologia = ContextoTerminologia & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface ConceitoLido {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly descricaoCompleta: string | null;
  /** Equivalência à CID pedida (equivalente, mais_amplo...), quando veio dela. */
  readonly equivalencia: string | null;
}
export interface RegiaoLida {
  readonly id: number;
  readonly sistema: string;
  readonly nivel: string;
  readonly codigo: string;
  readonly descricao: string;
  readonly superiorId: number | null;
  readonly padrao?: boolean;
}
export interface DiagnosticoLido {
  readonly id: number;
  readonly versao: number;
  readonly atendimentoId: number;
  readonly cid: { readonly id: number; readonly codigo: string; readonly descricao: string };
  readonly conceito: { readonly id: number; readonly codigo: string; readonly descricao: string } | null;
  readonly tipo: string;
  readonly certeza: string;
  readonly escopo: string;
  readonly situacao: string;
  readonly diagnosticadoEm: string | null;
  readonly profissional: string | null;
  readonly observacao: string | null;
}

const recusar = (f: readonly FalhaTerminologia[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};
const inexistente = (o: string): ErroOperacao =>
  new ErroOperacao(404, 'registro-inexistente', `${o} não encontrado`, `${o} não existe neste cliente.`);

async function termo(tx: Pick<TxOperacao, 'uma'>, termoId: number): Promise<TermoCatalogo | null> {
  const t = await tx.uma(
    `SELECT g.codigo AS terminologia, t.ativo, t.nivel, t.vigencia_fim
       FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id WHERE t.id = ?`,
    [termoId],
  );
  return t
    ? {
        terminologia: String(t['terminologia']),
        ativo: bool(t['ativo']),
        nivel: numOuNull(t['nivel']),
        vigenciaFim: dataDe(t['vigencia_fim']),
      }
    : null;
}

export class TerminologiaClinicaPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opDiagnostico = definirOperacao<
    EntradaDiagnostico,
    { diagnostico: number; versao: number }
  >({
    nome: 'pep.diagnostico_atendimento',
    tabelas: ['diagnostico_atendimento'],
    entrada: esquemaDiagnostico as unknown as z.ZodType<EntradaDiagnostico>,
    gravar: (tx, e) => this.gravarDiagnostico(tx, e),
    alvo: (_e, r) => ({ tabela: 'diagnostico_atendimento', id: r.diagnostico }),
  });

  private readonly opRegiaoExame = definirOperacao<EntradaRegiaoExame, { ligacao: number; ativo: boolean }>({
    nome: 'sadt.exame_regiao_anatomica',
    tabelas: ['exame_regiao_anatomica'],
    entrada: esquemaRegiaoExame as unknown as z.ZodType<EntradaRegiaoExame>,
    gravar: (tx, e) => this.gravarRegiaoExame(tx, e),
    alvo: (_e, r) => ({ tabela: 'exame_regiao_anatomica', id: r.ligacao }),
  });

  constructor(
    private readonly nucleo: NucleoTerminologia,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private ler<T>(fn: (l: Leitor) => Promise<T>, estabelecimento?: number): Promise<T> {
    return this.nucleo.lerSomente(
      {
        cliente: this.cliente,
        correlacao: 'pep.terminologia',
        ...(estabelecimento ? { estabelecimento } : {}),
      },
      fn,
    );
  }

  private quem(c: ContextoTerminologia) {
    return this.ler(async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  private async contexto(c: ContextoGravacaoTerminologia): Promise<ContextoOperacao> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    return {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
  }

  pacienteExiste(paciente: number): Promise<boolean> {
    return this.ler(async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** O paciente dono do diagnóstico (o vínculo assistencial é conferido antes de gravar); null quando não existe. */
  pacienteDoDiagnostico(diagnostico: number): Promise<number | null> {
    return this.ler(async (l) => {
      const x = await l.uma(
        'SELECT paciente_id FROM diagnostico_atendimento WHERE id = ? AND excluido_em IS NULL',
        [diagnostico],
      );
      return x ? num(x['paciente_id']) : null;
    });
  }

  /**
   * Conceitos clínicos ativos por texto ou código; com a CID, as equivalências dela vêm primeiro (a principal, depois
   * as exatas). Até 30.
   */
  conceitos(filtro: { readonly texto?: string; readonly cid?: number }): Promise<readonly ConceitoLido[]> {
    const texto = (filtro.texto ?? '').trim();
    return this.ler(async (l) => {
      const sugeridos = filtro.cid
        ? ordenarSugestoesConceito(
            (
              await l.consultar(
                `SELECT t.id, t.codigo_termo, t.descricao, t.descricao_completa, q.tipo_equivalencia, q.principal
                   FROM termo_equivalencia q
                   JOIN termo_terminologia t ON t.id = q.termo_terminologia_id
                   JOIN terminologia g ON g.id = t.terminologia_id
                  WHERE q.equivalente_termo_terminologia_id = ? AND g.codigo = ? AND q.ativo = TRUE
                    AND q.excluido_em IS NULL AND t.ativo = TRUE
                    AND (q.vigencia_fim IS NULL OR q.vigencia_fim >= CURRENT_DATE)`,
                [filtro.cid, TERMINOLOGIA_CONCEITO_CLINICO],
              )
            ).map((x) => ({
              id: num(x['id']),
              codigo: String(x['codigo_termo']),
              descricao: String(x['descricao']),
              descricaoCompleta: txt(x['descricao_completa']),
              equivalencia: String(x['tipo_equivalencia']),
              principal: bool(x['principal']),
              tipoEquivalencia: String(x['tipo_equivalencia']),
            })),
          ).map((c) => ({
            id: c.id,
            codigo: c.codigo,
            descricao: c.descricao,
            descricaoCompleta: c.descricaoCompleta,
            equivalencia: c.equivalencia,
          }))
        : [];
      if (texto.length < 2) return sugeridos;
      const linhas = await l.consultar(
        `SELECT t.id, t.codigo_termo, t.descricao, t.descricao_completa
           FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
          WHERE g.codigo = ? AND t.ativo = TRUE AND (t.codigo_termo = ? OR t.descricao LIKE ?)
          ORDER BY (t.codigo_termo = ?) DESC, CHAR_LENGTH(t.descricao), t.descricao LIMIT ${TETO_BUSCA}`,
        [TERMINOLOGIA_CONCEITO_CLINICO, texto, `%${texto.replace(/[%_\\]/g, '\\$&')}%`, texto],
      );
      const ja = new Set(sugeridos.map((s) => s.id));
      return [
        ...sugeridos,
        ...linhas
          .filter((x) => !ja.has(num(x['id'])))
          .map((x) => ({
            id: num(x['id']),
            codigo: String(x['codigo_termo']),
            descricao: String(x['descricao']),
            descricaoCompleta: txt(x['descricao_completa']),
            equivalencia: null,
          })),
      ].slice(0, TETO_BUSCA);
    });
  }

  /** CID-10 ativas por código (exato primeiro) ou texto, para o registro do diagnóstico. Até 30. */
  cids(texto: string): Promise<readonly { id: number; codigo: string; descricao: string }[]> {
    const q = texto.trim();
    if (q.length < 2) return Promise.resolve([]);
    return this.ler(async (l) => {
      const codigo = q.toUpperCase().replace('.', '');
      const linhas = await l.consultar(
        `SELECT t.id, t.codigo_termo, t.descricao
           FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
          WHERE g.codigo = ? AND t.ativo = TRUE AND (t.codigo_termo LIKE ? OR t.descricao LIKE ?)
          ORDER BY (t.codigo_termo = ?) DESC, t.codigo_termo LIMIT ${TETO_BUSCA}`,
        [
          TERMINOLOGIA_DIAGNOSTICO,
          `${codigo.replace(/[%_\\]/g, '\\$&')}%`,
          `%${q.replace(/[%_\\]/g, '\\$&')}%`,
          codigo,
        ],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo_termo']),
        descricao: String(x['descricao']),
      }));
    });
  }

  /** Regiões anatômicas ativas: as do exame (com a padrão), as filhas de uma superior, ou por texto. Até 30. */
  regioes(filtro: {
    readonly texto?: string;
    readonly superior?: number;
    readonly exame?: number;
  }): Promise<readonly RegiaoLida[]> {
    const texto = (filtro.texto ?? '').trim();
    return this.ler(async (l) => {
      const conds = ['r.ativo = TRUE', '(r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE)'];
      const p: unknown[] = [];
      let junta = '';
      let padrao = 'NULL';
      if (filtro.exame) {
        junta = 'JOIN exame_regiao_anatomica x ON x.regiao_anatomica_codificada_id = r.id';
        conds.push('x.exame_id = ?', 'x.ativo = TRUE');
        p.push(filtro.exame);
        padrao = 'x.padrao';
      }
      if (filtro.superior) {
        conds.push('r.regiao_superior_id = ?');
        p.push(filtro.superior);
      } else if (!filtro.exame && texto.length < 2) conds.push('r.regiao_superior_id IS NULL');
      if (texto.length >= 2) {
        conds.push('(r.codigo_anatomico = ? OR r.descricao LIKE ?)');
        p.push(texto, `%${texto.replace(/[%_\\]/g, '\\$&')}%`);
      }
      const linhas = await l.consultar(
        `SELECT r.id, r.sistema_codificacao, r.nivel, r.codigo_anatomico, r.descricao, r.regiao_superior_id,
                ${padrao} AS padrao
           FROM regiao_anatomica_codificada r ${junta}
          WHERE ${conds.join(' AND ')}
          ORDER BY ${filtro.exame ? 'x.padrao DESC, ' : ''}r.descricao LIMIT ${TETO_BUSCA}`,
        p,
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        sistema: String(x['sistema_codificacao']),
        nivel: String(x['nivel']),
        codigo: String(x['codigo_anatomico']),
        descricao: String(x['descricao']),
        superiorId: numOuNull(x['regiao_superior_id']),
        ...(filtro.exame ? { padrao: bool(x['padrao']) } : {}),
      }));
    });
  }

  /** Diagnósticos do paciente (todos os atendimentos), o mais recente primeiro, com a CID e o conceito. */
  diagnosticosDoPaciente(paciente: number): Promise<readonly DiagnosticoLido[]> {
    return this.ler(async (l) => {
      const linhas = await l.consultar(
        `SELECT d.id, d.versao, d.atendimento_id, d.tipo, d.certeza, d.escopo, d.situacao, d.diagnosticado_em,
                d.observacao, c.id AS cid_id, c.codigo_termo AS cid_codigo, c.descricao AS cid_descricao,
                s.id AS conceito_id, s.codigo_termo AS conceito_codigo, s.descricao AS conceito_descricao,
                pf.nome AS profissional
           FROM diagnostico_atendimento d
           JOIN termo_terminologia c ON c.id = d.cid_termo_terminologia_id
           LEFT JOIN termo_terminologia s ON s.id = d.snomed_termo_terminologia_id
           LEFT JOIN profissional p ON p.id = d.profissional_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE d.paciente_id = ? AND d.excluido_em IS NULL
          ORDER BY d.diagnosticado_em DESC, d.id DESC`,
        [paciente],
      );
      return linhas.map((x) => ({
        id: num(x['id']),
        versao: num(x['versao']),
        atendimentoId: num(x['atendimento_id']),
        cid: { id: num(x['cid_id']), codigo: String(x['cid_codigo']), descricao: String(x['cid_descricao']) },
        conceito:
          x['conceito_id'] === null || x['conceito_id'] === undefined
            ? null
            : {
                id: num(x['conceito_id']),
                codigo: String(x['conceito_codigo']),
                descricao: String(x['conceito_descricao']),
              },
        tipo: String(x['tipo']),
        certeza: String(x['certeza']),
        escopo: String(x['escopo']),
        situacao: String(x['situacao']),
        diagnosticadoEm: iso(x['diagnosticado_em']),
        profissional: txt(x['profissional']),
        observacao: txt(x['observacao']),
      }));
    });
  }

  async gravarDiagnosticoAtendimento(c: ContextoGravacaoTerminologia, entrada: unknown) {
    const r = await this.executor.executar(this.opDiagnostico, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  async gravarRegiaoDoExame(c: ContextoGravacaoTerminologia, entrada: unknown) {
    const r = await this.executor.executar(this.opRegiaoExame, this.cliente, entrada, await this.contexto(c));
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravarDiagnostico(tx: TxOperacao, e: EntradaDiagnostico) {
    const hoje = this.agora();
    if (e.acao === 'conceito') {
      const [d] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM diagnostico_atendimento WHERE id = ? AND excluido_em IS NULL',
        [e.diagnostico],
        { teto: 1 },
      );
      if (!d) throw inexistente('O diagnóstico');
      const conceito = e.conceito === null ? undefined : await termo(tx, e.conceito);
      const f = validarTrocaConceito({ situacao: String(d['situacao']) }, conceito, hoje);
      if (f.length) recusar(f);
      const versao = await tx.alterar('diagnostico_atendimento', e.diagnostico, e.versao, {
        snomed_termo_terminologia_id: e.conceito,
      } as never);
      return { diagnostico: e.diagnostico, versao };
    }
    // O profissional da conta: o vínculo no estabelecimento da sessão (em vigor) e, sem ele, o vínculo geral.
    const prof = await tx.uma(
      `SELECT profissional_id FROM (
         SELECT 0 AS ordem, v.id, v.profissional_id FROM usuario_vinculo_profissional v
          WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.profissional_id IS NOT NULL
            AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE)
         UNION ALL
         SELECT 1, u.id, u.profissional_id FROM usuario_profissional u
          WHERE u.usuario_id = ? AND u.excluido_em IS NULL) x
        ORDER BY ordem, id LIMIT 1`,
      [tx.contexto.usuario, tx.contexto.estabelecimento, tx.contexto.usuario],
    );
    if (!prof)
      throw recusa('usuario-sem-profissional', 'O diagnóstico é registrado por um profissional de saúde.');
    const a = await tx.uma('SELECT paciente_id FROM atendimento WHERE id = ? AND excluido_em IS NULL', [
      e.atendimento,
    ]);
    if (!a) throw inexistente('O atendimento');
    const principal = await tx.uma(
      `SELECT id FROM diagnostico_atendimento WHERE atendimento_id = ? AND tipo = 'principal'
          AND situacao = 'ativo' AND excluido_em IS NULL LIMIT 1`,
      [e.atendimento],
    );
    const f = validarRegistroDiagnostico(
      {
        cid: await termo(tx, e.cid),
        ...(e.conceito ? { conceito: await termo(tx, e.conceito) } : {}),
        tipo: e.tipo,
        observacao: e.observacao ?? null,
        atendimentoDoPaciente: num(a['paciente_id']) === e.paciente,
        principalAtivoExiste: Boolean(principal),
      },
      hoje,
    );
    if (f.length) recusar(f);
    const diagnostico = await tx.incluir('diagnostico_atendimento', {
      estabelecimento_id: Number(tx.contexto.estabelecimento),
      atendimento_id: e.atendimento,
      paciente_id: e.paciente,
      cid_termo_terminologia_id: e.cid,
      snomed_termo_terminologia_id: e.conceito ?? null,
      tipo: e.tipo,
      certeza: e.certeza,
      escopo: e.escopo,
      diagnosticado_em: hoje,
      profissional_id: num(prof['profissional_id']),
      observacao: e.observacao?.trim() || null,
      situacao: 'ativo',
      origem: 'sistema',
    } as never);
    return { diagnostico, versao: 1 };
  }

  private async gravarRegiaoExame(tx: TxOperacao, e: EntradaRegiaoExame) {
    const ex = await tx.uma('SELECT id FROM exame WHERE id = ?', [e.exame]);
    if (!ex) throw inexistente('O exame');
    const [atual] = await tx.consultarParaAtualizar(
      `SELECT id, versao, ativo FROM exame_regiao_anatomica
        WHERE exame_id = ? AND regiao_anatomica_codificada_id = ?`,
      [e.exame, e.regiao],
      { teto: 1 },
    );
    if (e.acao === 'retirar') {
      if (!atual || !bool(atual['ativo']))
        throw recusa('regiao-nao-ligada', 'A região não está ligada a este exame.');
      await tx.alterar('exame_regiao_anatomica', num(atual['id']), num(atual['versao']), {
        ativo: false,
        padrao: false,
        desativado_em: this.agora(),
        desativado_por: tx.contexto.usuario,
      } as never);
      return { ligacao: num(atual['id']), ativo: false };
    }
    const r = await tx.uma('SELECT ativo, vigencia_fim FROM regiao_anatomica_codificada WHERE id = ?', [
      e.regiao,
    ]);
    const f = validarRegiaoDoExame(
      r ? { ativo: bool(r['ativo']), vigenciaFim: dataDe(r['vigencia_fim']) } : null,
      Boolean(atual && bool(atual['ativo'])),
      this.agora(),
    );
    if (f.length) recusar(f);
    if (e.padrao)
      await tx.executar(
        `UPDATE exame_regiao_anatomica SET padrao = FALSE, alterado_em = ?, alterado_por = ?, versao = versao + 1
          WHERE exame_id = ? AND padrao = TRUE`,
        [this.agora(), tx.contexto.usuario, e.exame],
      );
    // A ligação retirada (inativa, nunca padrão) volta na mesma linha: a versão dela não mudou com o UPDATE acima.
    if (atual) {
      await tx.alterar('exame_regiao_anatomica', num(atual['id']), num(atual['versao']), {
        ativo: true,
        padrao: e.padrao,
        desativado_em: null,
        desativado_por: null,
      } as never);
      return { ligacao: num(atual['id']), ativo: true };
    }
    const ligacao = await tx.incluir('exame_regiao_anatomica', {
      exame_id: e.exame,
      regiao_anatomica_codificada_id: e.regiao,
      padrao: e.padrao,
      ativo: true,
    } as never);
    return { ligacao, ativo: true };
  }
}
