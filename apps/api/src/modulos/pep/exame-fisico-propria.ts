// Exame físico estruturado por sistema e região do corpo (03-PEP L97), no banco próprio do cliente. Regras no domínio
// (@sgh/dominio-pep, exame-fisico.ts); aqui ficam a leitura (catálogo do mapa do corpo e o exame por paciente) e a
// gravação pelo executor (trilha na mesma transação). exame_fisico_achado guarda cada achado ligado ao registro
// clínico, numerado no registro, com sistema, região, lado, achado padronizado, normal e descrição. Nada é apagado
// nem reescrito: só o autor acrescenta achados enquanto o registro está em vigor; a correção é suspender o registro
// pelo fluxo próprio e registrar de novo. Sistemas, regiões (com o desenho do mapa) e achados padronizados são
// mantidos no cadastro genérico da configuração.
import {
  type CatalogoExame,
  faixaEtariaExame,
  type FalhaRegra,
  ITENS_EXAME_MAXIMO,
  type ItemExame,
  LATERALIDADES_EXAME,
  registroAceitaExame,
  resumirExamePorSistema,
  textoAchadoExame,
  validarExameFisico,
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
const boolOuNull = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : Boolean(Number(v));
const bool = (v: unknown): boolean => Boolean(Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const dataDe = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(String(v)) : null);
const id = z.number().int().positive();

const esquemaItem = z
  .object({
    sistema: id.nullable().optional(),
    regiao: id.nullable().optional(),
    padrao: id.nullable().optional(),
    lateralidade: z.enum(LATERALIDADES_EXAME).default('nao_se_aplica'),
    normal: z.boolean().nullable().optional(),
    descricao: z.string().max(2100).nullable().optional(),
  })
  .strict();
export const esquemaExameFisico = z
  .object({
    registro: id,
    itens: z.array(esquemaItem).min(1).max(ITENS_EXAME_MAXIMO),
  })
  .strict();
export type EntradaExameFisico = z.infer<typeof esquemaExameFisico>;

export interface NucleoExame {
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
export interface ContextoExame {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoExame = ContextoExame & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface CatalogoExameLido {
  readonly sistemas: readonly { id: number; codigo: string; descricao: string; sigla: string | null }[];
  readonly regioes: readonly {
    id: number;
    codigo: string;
    descricao: string;
    nivel: string;
    superior: number | null;
    admiteLateralidade: boolean;
    desenho: string | null;
  }[];
  readonly padroes: readonly {
    id: number;
    codigo: string;
    descricao: string;
    sistema: number | null;
    regiao: number | null;
    normal: boolean;
    publicoAlvo: string;
  }[];
}
export interface AchadoLido {
  readonly id: number;
  readonly sequencia: number;
  readonly sistema: { id: number; descricao: string } | null;
  readonly regiao: { id: number; descricao: string } | null;
  readonly padrao: { id: number; descricao: string } | null;
  readonly lateralidade: string;
  readonly normal: boolean | null;
  readonly descricao: string | null;
  readonly texto: string;
}
export interface ExameDoRegistro {
  readonly registro: number;
  readonly dataHoraClinica: string | null;
  readonly titulo: string;
  readonly situacao: string;
  readonly autor: string | null;
  /** Esta pessoa é a autora e o registro está em vigor: pode acrescentar achados. */
  readonly podeAcrescentar: boolean;
  readonly achados: readonly AchadoLido[];
  readonly resumo: readonly {
    sistema: string | null;
    examinados: number;
    normais: number;
    alterados: number;
  }[];
}
export interface ExameDoPaciente {
  /** Faixa pela idade de hoje (o achado padronizado de outro público é recusado na gravação). */
  readonly faixa: string | null;
  readonly registros: readonly ExameDoRegistro[];
}

const recusar = (f: readonly FalhaRegra[]): never => {
  throw recusa(f[0]!.codigo, f.map((x) => x.mensagem).join(' '));
};

/** Achados gravados de uma vez: o primeiro e o último id e a faixa da numeração no registro. */
export interface ResultadoExame {
  readonly registro: number;
  readonly primeiro: number;
  readonly ultimo: number;
  readonly de: number;
  readonly ate: number;
  readonly quantidade: number;
  readonly [campo: string]: number;
}

/** Registros recentes do paciente lidos na visão por paciente (os mais novos primeiro). */
const REGISTROS_NA_VISAO = 30;

export class ExameFisicoPropria {
  private executorCache: Executor | null = null;
  private get executor(): Executor {
    return (this.executorCache ??= this.nucleo.criarExecutor());
  }

  private readonly opExame = definirOperacao<EntradaExameFisico, ResultadoExame>({
    nome: 'pep.exame_fisico',
    tabelas: ['exame_fisico_achado'],
    entrada: esquemaExameFisico as unknown as z.ZodType<EntradaExameFisico>,
    gravar: (tx, e) => this.gravar(tx, e),
    alvo: (_e, r) => ({ tabela: 'exame_fisico_achado', id: r.primeiro }),
  });

  constructor(
    private readonly nucleo: NucleoExame,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private quem(c: ContextoExame) {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.exameFisico' }, async (l) => {
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

  /** O paciente existe no cliente (a leitura de paciente inexistente é 404). */
  pacienteExiste(paciente: number): Promise<boolean> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.exameFisico' }, async (l) =>
      Boolean(await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente])),
    );
  }

  /** O paciente do registro clínico (o vínculo assistencial é conferido antes de gravar); null quando não existe. */
  pacienteDoRegistro(registro: number): Promise<number | null> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.exameFisico' }, async (l) => {
      const x = await l.uma(
        'SELECT paciente_id FROM registro_assistencial WHERE id = ? AND excluido_em IS NULL',
        [registro],
      );
      return x ? num(x['paciente_id']) : null;
    });
  }

  /** Sistemas, regiões (com o desenho do mapa do corpo) e achados padronizados ativos. */
  catalogo(): Promise<CatalogoExameLido> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pep.exameFisico' }, async (l) => {
      const s = await l.consultar(
        'SELECT id, codigo, descricao, sigla FROM sistema_corporal WHERE ativo = TRUE ORDER BY ordem IS NULL, ordem, descricao, id',
      );
      const r = await l.consultar(
        `SELECT id, codigo, descricao, nivel, superior_regiao_corporal_id, admite_lateralidade, desenho_svg
           FROM regiao_corporal WHERE ativo = TRUE ORDER BY ordem IS NULL, ordem, descricao, id`,
      );
      const p = await l.consultar(
        `SELECT id, codigo, descricao, sistema_corporal_id, regiao_corporal_id, normal, publico_alvo
           FROM achado_exame_fisico_padrao WHERE ativo = TRUE ORDER BY ordem IS NULL, ordem, descricao, id LIMIT 2000`,
      );
      return {
        sistemas: s.map((x) => ({
          id: num(x['id']),
          codigo: String(x['codigo']),
          descricao: String(x['descricao']),
          sigla: txt(x['sigla']),
        })),
        regioes: r.map((x) => ({
          id: num(x['id']),
          codigo: String(x['codigo']),
          descricao: String(x['descricao']),
          nivel: String(x['nivel']),
          superior: numOuNull(x['superior_regiao_corporal_id']),
          admiteLateralidade: bool(x['admite_lateralidade']),
          desenho: txt(x['desenho_svg']),
        })),
        padroes: p.map((x) => ({
          id: num(x['id']),
          codigo: String(x['codigo']),
          descricao: String(x['descricao']),
          sistema: numOuNull(x['sistema_corporal_id']),
          regiao: numOuNull(x['regiao_corporal_id']),
          normal: bool(x['normal']),
          publicoAlvo: String(x['publico_alvo']),
        })),
      };
    });
  }

  /** Os registros clínicos recentes do paciente com os achados do exame físico e o resumo por sistema. */
  async doPaciente(c: ContextoExame, paciente: number): Promise<ExameDoPaciente> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pep.exameFisico', estabelecimento: q.estabelecimento },
      async (l) => {
        const pac = await l.uma(
          `SELECT pf.data_nascimento FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.id = ?`,
          [paciente],
        );
        const regs = await l.consultar(
          `SELECT r.id, r.data_hora_clinica, r.situacao, r.autor_usuario_id, m.titulo, pf.nome AS autor
             FROM registro_assistencial r
             JOIN modelo_documento_clinico m ON m.id = r.modelo_documento_clinico_id
             LEFT JOIN profissional pr ON pr.id = r.autor_profissional_id
             LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE r.paciente_id = ? AND r.excluido_em IS NULL AND r.confidencial = FALSE
            ORDER BY r.data_hora_clinica DESC, r.id DESC LIMIT ${REGISTROS_NA_VISAO}`,
          [paciente],
        );
        const ids = regs.map((x) => num(x['id']));
        const achados = ids.length
          ? await l.consultar(
              `SELECT a.id, a.registro_assistencial_id, a.sequencia, a.sistema_corporal_id, s.descricao AS sistema,
                      a.regiao_corporal_id, rc.descricao AS regiao, a.achado_exame_fisico_padrao_id,
                      ap.descricao AS padrao, a.lateralidade, a.normal, a.descricao
                 FROM exame_fisico_achado a
                 LEFT JOIN sistema_corporal s ON s.id = a.sistema_corporal_id
                 LEFT JOIN regiao_corporal rc ON rc.id = a.regiao_corporal_id
                 LEFT JOIN achado_exame_fisico_padrao ap ON ap.id = a.achado_exame_fisico_padrao_id
                WHERE a.registro_assistencial_id IN (${ids.map(() => '?').join(',')}) AND a.excluido_em IS NULL
                ORDER BY a.registro_assistencial_id, a.sequencia`,
              ids,
            )
          : [];
        const porRegistro = new Map<number, AchadoLido[]>();
        for (const a of achados) {
          const lido: AchadoLido = {
            id: num(a['id']),
            sequencia: num(a['sequencia']),
            sistema:
              a['sistema_corporal_id'] !== null
                ? { id: num(a['sistema_corporal_id']), descricao: String(a['sistema']) }
                : null,
            regiao:
              a['regiao_corporal_id'] !== null
                ? { id: num(a['regiao_corporal_id']), descricao: String(a['regiao']) }
                : null,
            padrao:
              a['achado_exame_fisico_padrao_id'] !== null
                ? { id: num(a['achado_exame_fisico_padrao_id']), descricao: String(a['padrao']) }
                : null,
            lateralidade: String(a['lateralidade']),
            normal: boolOuNull(a['normal']),
            descricao: txt(a['descricao']),
            texto: textoAchadoExame({
              sistema: txt(a['sistema']),
              regiao: txt(a['regiao']),
              lateralidade: String(a['lateralidade']),
              achado: txt(a['padrao']),
              normal: boolOuNull(a['normal']),
              descricao: txt(a['descricao']),
            }),
          };
          const k = num(a['registro_assistencial_id']);
          porRegistro.set(k, [...(porRegistro.get(k) ?? []), lido]);
        }
        const registros: ExameDoRegistro[] = regs.map((x) => {
          const lista = porRegistro.get(num(x['id'])) ?? [];
          const nomes = new Map(lista.map((a) => [a.sistema?.id ?? null, a.sistema?.descricao ?? null]));
          return {
            registro: num(x['id']),
            dataHoraClinica: iso(x['data_hora_clinica']),
            titulo: String(x['titulo']),
            situacao: String(x['situacao']),
            autor: txt(x['autor']),
            podeAcrescentar:
              q.usuario !== null &&
              registroAceitaExame(
                { situacao: String(x['situacao']), autorUsuarioId: num(x['autor_usuario_id']) },
                q.usuario,
              ).length === 0,
            achados: lista,
            resumo: resumirExamePorSistema(
              lista.map((a) => ({ sistemaId: a.sistema?.id ?? null, normal: a.normal })),
            ).map((r) => ({
              sistema: nomes.get(r.sistemaId) ?? null,
              examinados: r.examinados,
              normais: r.normais,
              alterados: r.alterados,
            })),
          };
        });
        return {
          faixa: faixaEtariaExame(dataDe(pac?.['data_nascimento']), this.agora()),
          registros,
        };
      },
    );
  }

  async gravarExame(c: ContextoGravacaoExame, entrada: unknown) {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'A gravação exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.opExame, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async catalogoParaRegra(
    tx: Pick<TxOperacao, 'consultar'>,
    itens: readonly ItemExame[],
  ): Promise<CatalogoExame> {
    const sis = [...new Set(itens.map((i) => i.sistemaId).filter((x): x is number => x !== null))];
    const pad = [...new Set(itens.map((i) => i.padraoId).filter((x): x is number => x !== null))];
    const padroes = pad.length
      ? await tx.consultar(
          `SELECT id, ativo, sistema_corporal_id, regiao_corporal_id, normal, publico_alvo
             FROM achado_exame_fisico_padrao WHERE id IN (${pad.map(() => '?').join(',')})`,
          pad,
        )
      : [];
    for (const p of padroes) {
      const s = numOuNull(p['sistema_corporal_id']);
      if (s !== null && !sis.includes(s)) sis.push(s);
    }
    const sistemas = sis.length
      ? await tx.consultar(
          `SELECT id, ativo FROM sistema_corporal WHERE id IN (${sis.map(() => '?').join(',')})`,
          sis,
        )
      : [];
    // A árvore inteira das regiões é pequena (partes, membros, órgãos e itens): lida de uma vez para a ascendência.
    const regioes = await tx.consultar(
      'SELECT id, ativo, admite_lateralidade, superior_regiao_corporal_id FROM regiao_corporal',
    );
    return {
      sistemas: new Map(sistemas.map((x) => [num(x['id']), { id: num(x['id']), ativo: bool(x['ativo']) }])),
      regioes: new Map(
        regioes.map((x) => [
          num(x['id']),
          {
            id: num(x['id']),
            ativo: bool(x['ativo']),
            admiteLateralidade: bool(x['admite_lateralidade']),
            superiorId: numOuNull(x['superior_regiao_corporal_id']),
          },
        ]),
      ),
      padroes: new Map(
        padroes.map((x) => [
          num(x['id']),
          {
            id: num(x['id']),
            ativo: bool(x['ativo']),
            sistemaId: numOuNull(x['sistema_corporal_id']),
            regiaoId: numOuNull(x['regiao_corporal_id']),
            normal: bool(x['normal']),
            publicoAlvo: String(x['publico_alvo']),
          },
        ]),
      ),
    };
  }

  private async gravar(tx: TxOperacao, e: EntradaExameFisico) {
    const reg = await tx.uma(
      `SELECT r.id, r.situacao, r.autor_usuario_id, r.data_hora_clinica, pf.data_nascimento
         FROM registro_assistencial r
         JOIN paciente p ON p.id = r.paciente_id
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
        WHERE r.id = ? AND r.excluido_em IS NULL`,
      [e.registro],
    );
    if (!reg)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Registro clínico não encontrado',
        'O registro clínico não existe neste cliente.',
      );
    const aceita = registroAceitaExame(
      { situacao: String(reg['situacao']), autorUsuarioId: num(reg['autor_usuario_id']) },
      Number(tx.contexto.usuario ?? 0),
    );
    if (aceita.length) recusar(aceita);
    const itens: ItemExame[] = e.itens.map((i) => ({
      sistemaId: i.sistema ?? null,
      regiaoId: i.regiao ?? null,
      padraoId: i.padrao ?? null,
      lateralidade: i.lateralidade,
      normal: i.normal ?? null,
      descricao: i.descricao ?? null,
    }));
    const gravados = await tx.consultar(
      `SELECT sequencia, sistema_corporal_id, regiao_corporal_id, achado_exame_fisico_padrao_id, lateralidade, normal,
              descricao
         FROM exame_fisico_achado WHERE registro_assistencial_id = ? AND excluido_em IS NULL`,
      [e.registro],
    );
    const existentes: ItemExame[] = gravados.map((x) => ({
      sistemaId: numOuNull(x['sistema_corporal_id']),
      regiaoId: numOuNull(x['regiao_corporal_id']),
      padraoId: numOuNull(x['achado_exame_fisico_padrao_id']),
      lateralidade: String(x['lateralidade']) as ItemExame['lateralidade'],
      normal: boolOuNull(x['normal']),
      descricao: txt(x['descricao']),
    }));
    const catalogo = await this.catalogoParaRegra(tx, itens);
    const faixa = faixaEtariaExame(
      dataDe(reg['data_nascimento']),
      dataDe(reg['data_hora_clinica']) ?? this.agora(),
    );
    const v = validarExameFisico(itens, catalogo, faixa, existentes);
    if (v.falhas.length) recusar(v.falhas);
    // A numeração segue a maior já usada no registro (inclusive a de achado excluído pela origem): nunca se repete.
    const ultima = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS n FROM exame_fisico_achado WHERE registro_assistencial_id = ?',
      [e.registro],
    );
    let seq = num(ultima?.['n'] ?? 0);
    const achados: number[] = [];
    const sequencias: number[] = [];
    for (const i of v.itens) {
      seq += 1;
      achados.push(
        await tx.incluir('exame_fisico_achado', {
          registro_assistencial_id: e.registro,
          sequencia: seq,
          sistema_corporal_id: i.sistemaId,
          regiao_corporal_id: i.regiaoId,
          achado_exame_fisico_padrao_id: i.padraoId,
          lateralidade: i.lateralidade,
          normal: i.normal,
          descricao: i.descricao,
          origem: 'sistema',
        }),
      );
      sequencias.push(seq);
    }
    return {
      registro: e.registro,
      primeiro: achados[0]!,
      ultimo: achados[achados.length - 1]!,
      de: sequencias[0]!,
      ate: sequencias[sequencias.length - 1]!,
      quantidade: achados.length,
    };
  }
}
