// Central de regras de aviso clínico (F3.3, 03-PEP L133), no banco do cliente. Regras puras em @sgh/dominio-pep
// (aviso-clinico-regra.ts); aqui ficam a leitura e a gravação, pelo executor (trilha na mesma transação).
//
// - Tipos de aviso (o evento clínico): tipo_aviso_clinico, catálogo do cliente (código, descrição, categoria,
//   prioridade, e-mail e ciência exigida). Nunca apagado: desativa.
// - Regras: guardadas no motor de regras de alerta da administração (01-ADM L76), no cenário 'aviso_clinico' (criado
//   na primeira regra): regra_alerta com o evento, o setor e a especialidade do evento em `condicao`, o canal em
//   notifica_tela / notifica_email, uma linha de versão a cada gravação (regra_alerta_versao) e os destinatários em
//   regra_alerta_destinatario (setor, especialidade, categoria profissional, perfil, usuário), no escopo do
//   estabelecimento: o que sai da lista fica inativo, nunca apagado; o que volta é reativado.
// - Emissão: o evento clínico (tipo, paciente, atendimento, setor, especialidade, origem) passa pelas regras ativas do
//   estabelecimento; cada regra que cobre o evento gera um aviso_clinico (regra_alerta_id, prioridade do tipo) com os
//   destinatários em aviso_clinico_destinatario: canal 'sistema' cai na central de avisos de quem recebe; canal 'email'
//   fica pendente para o despacho de e-mail (fora de produção a saída é a captura local, regra 6). O autor do evento
//   não é avisado. Sem regra que cubra o evento, nada é gravado.
import {
  ALVOS_AVISO_CLINICO,
  type AlvoAvisoClinico,
  CANAIS_AVISO_CLINICO,
  type CandidatoAvisoClinico,
  type CanalAvisoClinico,
  CATEGORIAS_TIPO_AVISO_CLINICO,
  destinatariosDoAviso,
  MENSAGEM_REGRA_AVISO_CLINICO,
  PRIORIDADES_TIPO_AVISO_CLINICO,
  prioridadeDoAviso,
  type RecusaRegraAvisoClinico,
  type RegraAvisoClinicoAplicavel,
  validarRegraAvisoClinico,
  validarTipoAvisoClinico,
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
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_REGRAS_AVISO_CLINICO = Symbol('PORTA_REGRAS_AVISO_CLINICO');

const TABELAS = [
  'tipo_aviso_clinico',
  'cenario_alerta',
  'regra_alerta',
  'regra_alerta_versao',
  'regra_alerta_destinatario',
  'aviso_clinico',
  'aviso_clinico_destinatario',
];
const CENARIO = 'aviso_clinico';
const TETO = 5000;

const COLUNA_ALVO: Readonly<Record<AlvoAvisoClinico, string>> = {
  setor: 'setor_funcional_id',
  especialidade: 'especialidade_medica_id',
  categoria_profissional: 'categoria_profissional_id',
  perfil: 'perfil_acesso_id',
  usuario: 'usuario_id',
};

const id = z.number().int().positive();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const esquemaTipoAvisoClinico = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    codigo: z.string().trim().max(30),
    descricao: z.string().trim().max(150),
    categoria: z.enum(CATEGORIAS_TIPO_AVISO_CLINICO),
    prioridade: z.enum(PRIORIDADES_TIPO_AVISO_CLINICO).default('media'),
    enviaEmail: z.boolean().default(false),
    exigeCiencia: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaRegraAvisoClinico = z
  .object({
    id: id.optional(),
    versao: id.optional(),
    codigo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,60}$/),
    nome: z.string().trim().max(150),
    tipoAviso: z.string().trim().max(30).nullable(),
    setorEvento: id.nullable().default(null),
    especialidadeEvento: id.nullable().default(null),
    mensagem: z.string().trim().max(1000),
    canais: z.array(z.enum(CANAIS_AVISO_CLINICO)).max(2),
    alvos: z.array(z.object({ tipo: z.enum(ALVOS_AVISO_CLINICO), id }).strict()).max(200),
    vigenciaInicio: dataIso,
    vigenciaFim: dataIso.nullable().default(null),
    ativo: z.boolean().default(true),
    motivo: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type EntradaRegraAvisoClinico = z.infer<typeof esquemaRegraAvisoClinico>;

export const esquemaEventoAvisoClinico = z
  .object({
    tipoAviso: z.string().trim().min(1).max(30),
    paciente: id.nullable().default(null),
    atendimento: id.nullable().default(null),
    setor: id.nullable().default(null),
    especialidade: id.nullable().default(null),
    titulo: z.string().trim().max(200).nullable().default(null),
    mensagem: z.string().trim().max(4000).nullable().default(null),
    moduloOrigem: z.string().trim().max(60).nullable().default(null),
    entidadeOrigem: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,63}$/)
      .nullable()
      .default(null),
    chaveOrigem: id.nullable().default(null),
  })
  .strict();

export interface TipoAvisoClinicoLido {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly categoria: string;
  readonly prioridade: string;
  readonly enviaEmail: boolean;
  readonly exigeCiencia: boolean;
  readonly ativo: boolean;
}
export interface RegraAvisoClinicoLida {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly nome: string;
  readonly tipoAviso: string | null;
  readonly setorEvento: number | null;
  readonly especialidadeEvento: number | null;
  readonly mensagem: string;
  readonly canais: CanalAvisoClinico[];
  readonly alvos: { tipo: AlvoAvisoClinico; id: number }[];
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly ativo: boolean;
  readonly numeroVersao: number;
}
export interface AvisoEmitidoLido {
  readonly id: number;
  readonly regra: number | null;
  readonly titulo: string;
  readonly prioridade: string;
  readonly geradoEm: string;
  readonly paciente: number | null;
  readonly sistema: number;
  readonly email: number;
  readonly cientes: number;
}
export interface Opcao {
  readonly id: number;
  readonly nome: string;
}
export interface PainelRegrasAvisoClinico {
  readonly tipos: TipoAvisoClinicoLido[];
  readonly regras: RegraAvisoClinicoLida[];
  readonly recentes: AvisoEmitidoLido[];
  readonly opcoes: Readonly<Record<AlvoAvisoClinico, Opcao[]>>;
}

const recusar = (r: RecusaRegraAvisoClinico) =>
  new ErroOperacao(422, r, 'Regra de aviso clínico recusada', MENSAGEM_REGRA_AVISO_CLINICO[r]);
const conflito = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Regra de aviso clínico recusada', detalhe);
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hoje = (): string => dia(new Date())!;
const json = (v: unknown): Record<string, unknown> => {
  const x = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
};
const canaisDe = (r: Record<string, unknown>): CanalAvisoClinico[] => [
  ...(bool(r['notifica_tela']) ? (['sistema'] as const) : []),
  ...(bool(r['notifica_email']) ? (['email'] as const) : []),
];
const ids = (v: unknown): number[] =>
  v === null || v === undefined || v === ''
    ? []
    : String(v)
        .split(',')
        .map(Number)
        .filter((n) => n > 0);

export class PortaRegrasAvisoClinicoPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'pep.avisosClinicosRegras');
  }

  /** Tipos de aviso, regras do estabelecimento (e as globais), os avisos emitidos recentes e as opções de alvo. */
  painel(c: ContextoPortaPropria): Promise<PainelRegrasAvisoClinico> {
    return this.ler(c, 'painel', async (l, est) => {
      const tipos = (
        await l.consultar(
          `SELECT id, versao, codigo, descricao, categoria, prioridade, envia_email, exige_ciencia, ativo
             FROM tipo_aviso_clinico ORDER BY ativo DESC, descricao`,
          [],
          { teto: TETO },
        )
      ).map((r) => ({
        id: num(r['id']),
        versao: num(r['versao']),
        codigo: String(r['codigo']),
        descricao: String(r['descricao']),
        categoria: String(r['categoria']),
        prioridade: String(r['prioridade']),
        enviaEmail: bool(r['envia_email']),
        exigeCiencia: bool(r['exige_ciencia']),
        ativo: bool(r['ativo']),
      }));
      const regras = await this.regras(l, est.id);
      const recentes = (
        await l.consultar(
          `SELECT a.id, a.regra_alerta_id, a.titulo, a.prioridade, a.gerado_em, a.paciente_id,
                  SUM(d.canal = 'sistema') AS sistema, SUM(d.canal = 'email') AS email,
                  SUM(d.situacao = 'ciente') AS cientes
             FROM aviso_clinico a
             JOIN regra_alerta r ON r.id = a.regra_alerta_id
             JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id AND ca.codigo = ?
             LEFT JOIN aviso_clinico_destinatario d ON d.aviso_clinico_id = a.id AND d.excluido_em IS NULL
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            GROUP BY a.id ORDER BY a.gerado_em DESC, a.id DESC LIMIT 30`,
          [CENARIO, est.id],
          { teto: 30 },
        )
      ).map((r) => ({
        id: num(r['id']),
        regra: numOuNull(r['regra_alerta_id']),
        titulo: String(r['titulo']),
        prioridade: String(r['prioridade']),
        geradoEm: (r['gerado_em'] instanceof Date
          ? r['gerado_em'].toISOString()
          : String(r['gerado_em'])
        ).slice(0, 19),
        paciente: numOuNull(r['paciente_id']),
        sistema: num(r['sistema']),
        email: num(r['email']),
        cientes: num(r['cientes']),
      }));
      const opcao = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p, { teto: TETO })).map((r) => ({
          id: num(r['id']),
          nome: String(r['nome']),
        }));
      const opcoes = {
        setor: await opcao(
          `SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome`,
          [est.id],
        ),
        especialidade: await opcao(
          'SELECT id, descricao AS nome FROM especialidade_medica WHERE ativo ORDER BY descricao',
        ),
        categoria_profissional: await opcao(
          'SELECT id, descricao AS nome FROM categoria_profissional WHERE ativo ORDER BY descricao',
        ),
        perfil: await opcao(
          `SELECT id, nome FROM perfil_acesso WHERE excluido_em IS NULL
              AND (estabelecimento_id IS NULL OR estabelecimento_id = ?) ORDER BY nome`,
          [est.id],
        ),
        usuario: await opcao(
          `SELECT u.id, u.nome FROM usuario u
             JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id AND ue.estabelecimento_id = ?
                  AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURDATE()
                  AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE())
            WHERE u.excluido_em IS NULL AND u.situacao = 'ativo' ORDER BY u.nome`,
          [est.id],
        ),
      };
      return { tipos, regras, recentes, opcoes };
    });
  }

  private async regras(l: Pick<Leitor, 'consultar'>, est: number): Promise<RegraAvisoClinicoLida[]> {
    const linhas = await l.consultar(
      `SELECT r.id, r.versao, r.codigo, r.nome, r.condicao, r.mensagem, r.notifica_tela, r.notifica_email,
              r.vigencia_inicio, r.vigencia_fim, r.numero_versao_vigente, r.estabelecimento_id,
              (r.ativo AND COALESCE(re.ativo, TRUE)) AS ativo
         FROM regra_alerta r
         JOIN cenario_alerta ca ON ca.id = r.cenario_alerta_id AND ca.codigo = ?
         LEFT JOIN regra_alerta_estabelecimento re ON re.regra_alerta_id = r.id AND re.estabelecimento_id = ?
        WHERE r.estabelecimento_id IS NULL OR r.estabelecimento_id = ?
        ORDER BY r.nome, r.id`,
      [CENARIO, est, est],
      { teto: TETO },
    );
    const alvos =
      linhas.length === 0
        ? []
        : await l.consultar(
            `SELECT regra_alerta_id, tipo_destinatario, destino_id FROM regra_alerta_destinatario
              WHERE regra_alerta_id IN (${linhas.map(() => '?').join(',')}) AND ativo AND excluido_em IS NULL
                AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
              ORDER BY id`,
            [...linhas.map((r) => r['id']), est],
            { teto: TETO },
          );
    return linhas.map((r) => {
      const cond = json(r['condicao']);
      return {
        id: num(r['id']),
        versao: num(r['versao']),
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        tipoAviso: txtOuNull(cond['tipoAviso']),
        setorEvento: numOuNull(cond['setorEvento']),
        especialidadeEvento: numOuNull(cond['especialidadeEvento']),
        mensagem: String(r['mensagem']),
        canais: canaisDe(r),
        alvos: alvos
          .filter((a) => num(a['regra_alerta_id']) === num(r['id']))
          .map((a) => ({
            tipo: String(a['tipo_destinatario']) as AlvoAvisoClinico,
            id: num(a['destino_id']),
          })),
        vigenciaInicio: dia(r['vigencia_inicio'])!,
        vigenciaFim: dia(r['vigencia_fim']),
        ativo: bool(r['ativo']),
        numeroVersao: num(r['numero_versao_vigente']),
      };
    });
  }

  /** Cria ou altera o tipo de aviso (o evento clínico); nunca apaga (desativa). */
  async gravarTipo(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaTipoAvisoClinico, entrada);
    const v = validarTipoAvisoClinico(e);
    if (v) throw recusar(v);
    return this.gravar(c, 'pep.aviso_clinico.tipo', TABELAS, async (tx) => {
      const valores = {
        codigo: e.codigo,
        descricao: e.descricao,
        categoria: e.categoria,
        prioridade: e.prioridade,
        envia_email: e.enviaEmail,
        exige_ciencia: e.exigeCiencia,
        ativo: e.ativo,
      };
      const tabela = 'tipo_aviso_clinico';
      const dup = await tx.uma(`SELECT id FROM ${tabela} WHERE codigo = ? AND id <> ?`, [
        e.codigo,
        e.id ?? 0,
      ]);
      if (dup) throw conflito('codigo-duplicado', 'Já existe tipo de aviso com este código.');
      if (e.id) {
        if (!e.versao) throw conflito('versao-obrigatoria', 'Informe a versão lida do tipo de aviso.');
        const atual = await tx.uma(`SELECT id FROM ${tabela} WHERE id = ?`, [e.id]);
        if (!atual) throw naoEncontrado('Tipo de aviso');
        await tx.alterar(tabela, e.id, e.versao, valores);
        return { tabela, id: e.id };
      }
      return { tabela, id: await tx.incluir(tabela, valores) };
    }).then((r) => ({ id: r.id as number }));
  }

  /** Cria ou altera a regra do estabelecimento (com versão e destinatários; o que sai fica inativo). */
  async gravarRegra(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ id: number; numeroVersao: number }> {
    const e = entradaValida(esquemaRegraAvisoClinico, entrada);
    const v = validarRegraAvisoClinico({
      nome: e.nome,
      mensagem: e.mensagem,
      tipoAviso: e.tipoAviso,
      canais: e.canais,
      alvos: e.alvos,
      vigenciaInicio: e.vigenciaInicio,
      vigenciaFim: e.vigenciaFim,
    });
    if (v) throw recusar(v);
    return this.gravar(c, 'pep.aviso_clinico.regra', TABELAS, async (tx, est, usuario) => {
      const tipo = await tx.uma('SELECT id FROM tipo_aviso_clinico WHERE codigo = ? AND ativo', [
        e.tipoAviso,
      ]);
      if (!tipo) throw conflito('tipo-inexistente', 'Tipo de aviso inexistente ou inativo.');
      await this.conferirAlvos(tx, est.id, e.alvos);
      const cenario = await this.cenario(tx);
      const conteudo = {
        codigo: e.codigo,
        nome: e.nome,
        cenario_alerta_id: cenario,
        condicao: JSON.stringify({
          tipoAviso: e.tipoAviso,
          setorEvento: e.setorEvento,
          especialidadeEvento: e.especialidadeEvento,
        }),
        mensagem: e.mensagem,
        notifica_tela: e.canais.includes('sistema'),
        notifica_email: e.canais.includes('email'),
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        ativo: e.ativo,
      };
      let regra: number;
      let numeroVersao: number;
      if (e.id) {
        if (!e.versao) throw conflito('versao-obrigatoria', 'Informe a versão lida da regra.');
        const [atual] = await tx.consultarParaAtualizar(
          'SELECT id, estabelecimento_id, numero_versao_vigente, cenario_alerta_id FROM regra_alerta WHERE id = ?',
          [e.id],
          { teto: 1 },
        );
        if (!atual || num(atual['cenario_alerta_id']) !== cenario)
          throw naoEncontrado('Regra de aviso clínico');
        if (numOuNull(atual['estabelecimento_id']) !== est.id)
          throw conflito('regra-global', 'A regra é da plataforma: altere-a na administração de alertas.');
        regra = e.id;
        numeroVersao = num(atual['numero_versao_vigente']) + 1;
        await tx.alterar('regra_alerta', regra, e.versao, {
          ...conteudo,
          numero_versao_vigente: numeroVersao,
        });
      } else {
        const dup = await tx.uma('SELECT id FROM regra_alerta WHERE codigo = ?', [e.codigo]);
        if (dup) throw conflito('codigo-duplicado', 'Já existe regra de alerta com este código.');
        numeroVersao = 1;
        regra = await tx.incluir('regra_alerta', {
          ...conteudo,
          estabelecimento_id: est.id,
          gravidade: 'atencao',
          editavel: true,
          numero_versao_vigente: 1,
        });
      }
      const agora = new Date();
      await tx.incluir('regra_alerta_versao', {
        regra_alerta_id: regra,
        operacao: numeroVersao === 1 ? 'inclusao' : 'alteracao',
        dados: JSON.stringify({ ...conteudo, destinatarios: e.alvos }),
        ocorrido_em: agora,
        usuario_id: usuario,
        numero_versao: numeroVersao,
        vigente_desde: agora,
        motivo_alteracao: e.motivo ?? null,
      });
      await this.reconciliarAlvos(tx, regra, est.id, e.alvos);
      return { tabela: 'regra_alerta', id: regra, numeroVersao };
    }).then((r) => ({ id: r.id as number, numeroVersao: r.numeroVersao }));
  }

  /** O cenário do motor de alertas que guarda as regras de aviso clínico (criado na primeira regra). */
  private async cenario(tx: TxOperacao): Promise<number> {
    const tabela = 'cenario_alerta';
    const x = await tx.uma(`SELECT id FROM ${tabela} WHERE codigo = ?`, [CENARIO]);
    if (x) return num(x['id']);
    return tx.incluir(tabela, {
      codigo: CENARIO,
      descricao: 'Aviso clínico ao profissional',
      verificador: 'pep.aviso_clinico',
      explicacao:
        'Evento clínico (tipo de aviso) que avisa setor, especialidade, categoria, perfil ou usuário',
    });
  }

  private async conferirAlvos(
    tx: TxOperacao,
    est: number,
    alvos: readonly { tipo: AlvoAvisoClinico; id: number }[],
  ): Promise<void> {
    for (const a of alvos) {
      const r =
        a.tipo === 'setor'
          ? await tx.uma(
              'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [a.id, est],
            )
          : a.tipo === 'especialidade'
            ? await tx.uma('SELECT id FROM especialidade_medica WHERE id = ? AND ativo', [a.id])
            : a.tipo === 'categoria_profissional'
              ? await tx.uma('SELECT id FROM categoria_profissional WHERE id = ? AND ativo', [a.id])
              : a.tipo === 'perfil'
                ? await tx.uma(
                    `SELECT id FROM perfil_acesso WHERE id = ? AND excluido_em IS NULL
                        AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
                    [a.id, est],
                  )
                : await tx.uma('SELECT id FROM usuario WHERE id = ? AND excluido_em IS NULL', [a.id]);
      if (!r) throw conflito('destinatario-inexistente', `Destinatário inexistente: ${a.tipo}.`);
    }
  }

  private async reconciliarAlvos(
    tx: TxOperacao,
    regra: number,
    est: number,
    desejados: readonly { tipo: AlvoAvisoClinico; id: number }[],
  ): Promise<void> {
    const tabela = 'regra_alerta_destinatario';
    const existentes = await tx.consultarParaAtualizar(
      `SELECT id, versao, tipo_destinatario, destino_id, ativo FROM ${tabela}
        WHERE regra_alerta_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [regra, est],
      { teto: TETO },
    );
    for (const x of existentes) {
      const quer = desejados.some((d) => d.tipo === x['tipo_destinatario'] && d.id === num(x['destino_id']));
      if (quer !== bool(x['ativo']))
        await tx.alterar(tabela, num(x['id']), num(x['versao']), { ativo: quer });
    }
    for (const d of desejados) {
      if (existentes.some((x) => x['tipo_destinatario'] === d.tipo && num(x['destino_id']) === d.id))
        continue;
      await tx.incluir(tabela, {
        regra_alerta_id: regra,
        estabelecimento_id: est,
        tipo_destinatario: d.tipo,
        [COLUNA_ALVO[d.tipo]]: d.id,
        ativo: true,
      });
    }
  }

  /** O evento clínico passa pelas regras: um aviso por regra que o cobre, com os destinatários por canal. */
  async emitir(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{ avisos: number[]; destinatarios: number }> {
    const e = entradaValida(esquemaEventoAvisoClinico, entrada);
    return this.gravar(c, 'pep.aviso_clinico.emitir', TABELAS, async (tx, est, usuario) => {
      const tipo = await tx.uma(
        'SELECT descricao, prioridade FROM tipo_aviso_clinico WHERE codigo = ? AND ativo',
        [e.tipoAviso],
      );
      if (!tipo) throw conflito('tipo-inexistente', 'Tipo de aviso inexistente ou inativo.');
      const lidas = await this.regras(tx, est.id);
      const regras: RegraAvisoClinicoAplicavel[] = lidas.map((r) => ({
        id: r.id,
        tipoAviso: r.tipoAviso ?? '',
        setorEvento: r.setorEvento,
        especialidadeEvento: r.especialidadeEvento,
        ativa: r.ativo,
        vigenciaInicio: r.vigenciaInicio,
        vigenciaFim: r.vigenciaFim,
        canais: r.canais,
        alvos: r.alvos,
      }));
      const mensagens = new Map(lidas.map((r) => [r.id, r.mensagem]));
      const candidatos = await this.candidatos(tx, est.id);
      const avisos = destinatariosDoAviso(
        regras,
        { tipoAviso: e.tipoAviso, setor: e.setor, especialidade: e.especialidade, dia: hoje() },
        candidatos,
        usuario,
      );
      const prioridade = prioridadeDoAviso(String(tipo['prioridade']));
      const agora = new Date();
      const gravados: number[] = [];
      let total = 0;
      for (const a of avisos) {
        const aviso = await tx.incluir('aviso_clinico', {
          estabelecimento_id: est.id,
          regra_alerta_id: a.regra,
          paciente_id: e.paciente,
          atendimento_id: e.atendimento,
          especialidade_medica_id: e.especialidade,
          titulo: e.titulo ?? String(tipo['descricao']),
          mensagem: e.mensagem ?? mensagens.get(a.regra) ?? String(tipo['descricao']),
          prioridade,
          canal: a.destinos.some((d) => d.canal === 'email') ? 'email' : 'sistema',
          exibe_janela: prioridade === 'critica',
          situacao: 'pendente',
          gerado_em: agora,
          modulo_origem: e.moduloOrigem ?? 'pep.aviso_clinico',
          entidade_origem: e.entidadeOrigem,
          entidade_origem_chave: e.chaveOrigem,
        });
        let seq = 0;
        for (const d of a.destinos) {
          await tx.incluir('aviso_clinico_destinatario', {
            aviso_clinico_id: aviso,
            sequencia: ++seq,
            usuario_id: d.usuario,
            profissional_id: d.profissional,
            canal: d.canal,
            situacao: 'pendente',
          });
        }
        total += seq;
        gravados.push(aviso);
      }
      return { tabela: 'aviso_clinico', id: gravados[0] ?? null, avisos: gravados, destinatarios: total };
    }).then((r) => ({ avisos: r.avisos, destinatarios: r.destinatarios }));
  }

  /**
   * Quem pode receber no estabelecimento: usuários ativos com acesso vigente, o profissional vigente da conta, os
   * setores da lotação ativa, as especialidades ativas, as categorias pelo conselho da inscrição ativa e os perfis
   * vigentes no estabelecimento. Só o fato de ter e-mail é lido, nunca o endereço.
   */
  private async candidatos(tx: TxOperacao, est: number): Promise<CandidatoAvisoClinico[]> {
    const linhas = await tx.consultar(
      `SELECT u.id AS usuario, up.profissional_id AS profissional,
              (u.email IS NOT NULL AND u.email <> '') AS tem_email,
              (SELECT GROUP_CONCAT(DISTINCT lp.setor_funcional_id) FROM lotacao_profissional lp
                WHERE lp.profissional_id = up.profissional_id AND lp.estabelecimento_id = ? AND lp.ativo
                  AND lp.excluido_em IS NULL AND lp.setor_funcional_id IS NOT NULL) AS setores,
              (SELECT GROUP_CONCAT(DISTINCT pe.especialidade_medica_id) FROM profissional_especialidade pe
                WHERE pe.profissional_id = up.profissional_id AND pe.ativo AND pe.excluido_em IS NULL) AS especialidades,
              (SELECT GROUP_CONCAT(DISTINCT cp.id) FROM inscricao_conselho ic
                 JOIN categoria_profissional cp ON cp.conselho_classe_id = ic.conselho_classe_id AND cp.ativo
                WHERE ic.profissional_id = up.profissional_id AND ic.situacao = 'ativa'
                  AND ic.excluido_em IS NULL) AS categorias,
              (SELECT GROUP_CONCAT(DISTINCT p.perfil_acesso_id) FROM usuario_perfil p
                WHERE p.usuario_id = u.id AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
                  AND p.vigencia_inicio <= CURDATE()
                  AND (p.vigencia_fim IS NULL OR p.vigencia_fim >= CURDATE())) AS perfis
         FROM usuario u
         JOIN usuario_estabelecimento ue ON ue.usuario_id = u.id AND ue.estabelecimento_id = ?
              AND ue.excluido_em IS NULL AND ue.vigencia_inicio <= CURDATE()
              AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= CURDATE())
         LEFT JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
              AND up.vigencia_inicio <= CURDATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= CURDATE())
        WHERE u.excluido_em IS NULL AND u.situacao = 'ativo'
        ORDER BY u.id`,
      [est, est, est],
      { teto: TETO },
    );
    return linhas.map((r) => ({
      usuario: num(r['usuario']),
      profissional: numOuNull(r['profissional']),
      setores: ids(r['setores']),
      especialidades: ids(r['especialidades']),
      categorias: ids(r['categorias']),
      perfis: ids(r['perfis']),
      temEmail: bool(r['tem_email']),
    }));
  }
}
