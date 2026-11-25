// Prontuário de acesso restrito (F8, 03-PEP L93), no banco do cliente. As regras são do domínio (@sgh/dominio-pep,
// prontuario-restrito); a porta lê e grava pelo executor (trilha e autoria na mesma transação):
// - restricao_prontuario: a marca do prontuário restrito (modo, categoria, motivo, vigência); encerrar não apaga;
// - configuracao_prontuario_restrito: quem autoriza, validade, senha do paciente, limite de aberturas (por unidade);
// - pedido_acesso_prontuario_restrito: o pedido de quem não está autorizado, decidido (aprovado/negado), cancelado
//   pelo solicitante, expirado pela validade ou revogado junto com a autorização;
// - autorizacao_acesso_prontuario_restrito: a autorização nascida da aprovação (pela equipe ou pelo paciente com a
//   senha), com vigência; revogada com motivo;
// - senha_prontuario_paciente (06_PEP/99_prontuario_restrito): só o resumo scrypt com sal (LGPD art. 46); a errada
//   conta e bloqueia, e a contagem fica gravada mesmo com a recusa;
// - acesso_prontuario_restrito + leitura_prontuario: cada abertura numerada contra o limite; acima dele, 403.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  aposConferencia,
  avaliarAbertura,
  type Autorizador,
  CONFIGURACAO_RESTRITO_PADRAO,
  type ConfiguracaoProntuarioRestrito,
  fimDoAcesso,
  pedidoExpirado,
  podeDecidirPedido,
  podeRevogarAutorizacao,
  senhaBloqueada,
  validarConfiguracaoRestrito,
  validarDecisaoPedido,
  validarPedidoAcesso,
  validarSenhaPaciente,
} from '@sgh/dominio-pep';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

export const PORTA_PRONTUARIO_RESTRITO = Symbol('PORTA_PRONTUARIO_RESTRITO');

const T_RESTRICAO = 'restricao_prontuario';
const T_CONFIG = 'configuracao_prontuario_restrito';
const T_PEDIDO = 'pedido_acesso_prontuario_restrito';
const T_AUTORIZACAO = 'autorizacao_acesso_prontuario_restrito';
const T_SENHA = 'senha_prontuario_paciente';
const T_ACESSO = 'acesso_prontuario_restrito';
const T_LEITURA = 'leitura_prontuario';
/** O perfil da diretoria clínica (o mesmo das concessões por perfil em @sgh/contratos). */
const PERFIL_DIRETORIA_CLINICA = 'diretoria-clinica';

const num = (v: unknown): number => Number(v);
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const p2 = (n: number) => String(n).padStart(2, '0');
const instante = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}T${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`
      : String(v).replace(' ', 'T').slice(0, 19);
const paraBanco = (iso: string): string => iso.replace('T', ' ').slice(0, 19);

async function agoraDoBanco(l: Leitor): Promise<string> {
  const r = await l.uma<Linha>('SELECT NOW(3) AS agora');
  return instante(r?.['agora']) ?? new Date().toISOString().slice(0, 19);
}

// ---- senha do paciente: resumo scrypt com sal (nunca a senha) ----
const N = 16384;
export function resumirSenha(senha: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(senha, sal, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$8$1$${sal.toString('base64')}$${h.toString('base64')}`;
}
export function conferirSenha(senha: string, resumo: string): boolean {
  const [alg, n, r, p, sal, h] = resumo.split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const obtido = scryptSync(senha, Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(esperado, obtido);
}

// ---- entradas ----
export const esquemaConfiguracao = z.object({
  autorizador: z.enum(['paciente', 'medico_responsavel', 'diretoria_clinica', 'papel']),
  papelId: z.number().int().positive().nullable().default(null),
  validadeHoras: z.number().int(),
  exigeSenhaPaciente: z.boolean(),
  limiteAcessos: z.number().int().nullable(),
  exigeMotivo: z.boolean(),
  avisaResponsavel: z.boolean(),
});
export type EntradaConfiguracao = z.infer<typeof esquemaConfiguracao>;

export const esquemaRestringir = z.object({
  paciente: z.number().int().positive(),
  atendimento: z.number().int().positive().nullable().default(null),
  modo: z.enum(['restrito', 'consentido']),
  categoria: z.enum([
    'personalidade',
    'funcionario',
    'caso_sensivel',
    'judicial',
    'pedido_paciente',
    'outro',
  ]),
  motivo: z.string().trim().min(5).max(500),
  permiteEmergencial: z.boolean().default(true),
});
export type EntradaRestringir = z.infer<typeof esquemaRestringir>;

export const esquemaEncerrarRestricao = z.object({
  restricao: z.number().int().positive(),
  versao: z.number().int().positive(),
});
export type EntradaEncerrarRestricao = z.infer<typeof esquemaEncerrarRestricao>;

export const esquemaSenha = z.object({
  paciente: z.number().int().positive(),
  senha: z.string().max(40),
});
export type EntradaSenha = z.infer<typeof esquemaSenha>;

export const esquemaPedido = z.object({
  paciente: z.number().int().positive(),
  atendimento: z.number().int().positive().nullable().default(null),
  motivo: z.number().int().positive(),
  tipo: z.enum(['regular', 'emergencial']).default('regular'),
  justificativa: z.string().max(2000).default(''),
});
export type EntradaPedido = z.infer<typeof esquemaPedido>;

export const esquemaDecisao = z.object({
  pedido: z.number().int().positive(),
  versao: z.number().int().positive(),
  aprovar: z.boolean(),
  motivoDecisao: z.string().max(500).default(''),
  tipoAutorizacao: z.enum(['consulta', 'consulta_e_registro']).default('consulta'),
  /** Com a senha do paciente: conferida antes de aprovar (exigida quando a configuração pede ou o paciente autoriza). */
  senhaPaciente: z.string().max(40).optional(),
  pelopaciente: z.boolean().default(false),
});
export type EntradaDecisao = z.infer<typeof esquemaDecisao>;

export const esquemaRevogar = z.object({
  autorizacao: z.number().int().positive(),
  versao: z.number().int().positive(),
  motivo: z.string().trim().min(5).max(300),
});
export type EntradaRevogar = z.infer<typeof esquemaRevogar>;

export const esquemaCancelarPedido = z.object({
  pedido: z.number().int().positive(),
  versao: z.number().int().positive(),
});
export type EntradaCancelarPedido = z.infer<typeof esquemaCancelarPedido>;

export const esquemaAbrir = z.object({ paciente: z.number().int().positive() });
export type EntradaAbrir = z.infer<typeof esquemaAbrir>;

// Alias de tipo (não interface): o resultado da operação do executor é um registro de valores simples.
type Gravado = {
  readonly id: number;
  readonly versao: number;
};

// ---- leituras comuns ----
async function configuracaoDe(
  l: Leitor,
  est: number,
): Promise<ConfiguracaoProntuarioRestrito & { id: number | null; versao: number; daUnidade: boolean }> {
  const ls = await l.consultar<Linha>(
    `SELECT id, estabelecimento_id, autorizador, autorizador_papel_seguranca_id, validade_autorizacao_horas,
            exige_senha_paciente, limite_acessos, exige_motivo, avisa_responsavel, versao
       FROM configuracao_prontuario_restrito
      WHERE estabelecimento_id = ? OR estabelecimento_id IS NULL
      ORDER BY estabelecimento_id IS NULL LIMIT 1`,
    [est],
  );
  const c = ls[0];
  if (!c) return { ...CONFIGURACAO_RESTRITO_PADRAO, id: null, versao: 0, daUnidade: false };
  return {
    id: num(c['id']),
    versao: num(c['versao']),
    daUnidade: c['estabelecimento_id'] !== null,
    autorizador: String(c['autorizador']) as Autorizador,
    papelId: numN(c['autorizador_papel_seguranca_id']),
    validadeHoras: num(c['validade_autorizacao_horas']),
    exigeSenhaPaciente: Boolean(num(c['exige_senha_paciente'])),
    limiteAcessos: numN(c['limite_acessos']),
    exigeMotivo: Boolean(num(c['exige_motivo'])),
    avisaResponsavel: Boolean(num(c['avisa_responsavel'])),
  };
}

async function restricaoVigente(l: Leitor, est: number, paciente: number): Promise<Linha | null> {
  const ls = await l.consultar<Linha>(
    `SELECT id, modo, categoria_motivo, motivo, permite_acesso_emergencial, vigencia_inicio, vigencia_fim, atendimento_id,
            responsavel_usuario_id, versao
       FROM restricao_prontuario
      WHERE paciente_id = ? AND ativo AND excluido_em IS NULL AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
        AND vigencia_inicio <= NOW(3) AND (vigencia_fim IS NULL OR vigencia_fim > NOW(3))
      ORDER BY id DESC LIMIT 1`,
    [paciente, est],
  );
  return ls[0] ?? null;
}

async function profissionalDe(l: Leitor, usuario: number): Promise<number | null> {
  const p = await l.uma<Linha>(
    'SELECT profissional_id FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
    [usuario],
  );
  return p ? num(p['profissional_id']) : null;
}

/** O profissional responde por atendimento em curso (ou dos últimos 30 dias) do paciente nesta unidade. */
async function ehMedicoResponsavel(l: Leitor, est: number, paciente: number, profissional: number | null) {
  if (profissional === null) return false;
  const r = await l.uma<Linha>(
    `SELECT id FROM atendimento WHERE paciente_id = ? AND estabelecimento_id = ? AND profissional_id = ?
        AND excluido_em IS NULL AND (saida_em IS NULL OR saida_em > NOW(3) - INTERVAL 30 DAY) LIMIT 1`,
    [paciente, est, profissional],
  );
  return Boolean(r);
}

async function temPapel(l: Leitor, usuario: number, papel: number | null): Promise<boolean> {
  if (papel === null) return false;
  const r = await l.uma<Linha>(
    `SELECT usuario_id FROM usuario_papel_seguranca WHERE usuario_id = ? AND papel_seguranca_id = ? AND excluido_em IS NULL
        AND vigencia_inicio <= CURDATE() AND (vigencia_fim IS NULL OR vigencia_fim >= CURDATE()) LIMIT 1`,
    [usuario, papel],
  );
  return Boolean(r);
}

/** Os perfis vigentes de quem decide na unidade: a diretoria clínica e o administrador (pode tudo, ADR 0002). */
async function perfisDe(l: Leitor, est: number, usuario: number) {
  const ls = await l.consultar<Linha>(
    `SELECT DISTINCT p.codigo, p.administrador FROM usuario_perfil up
       JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.ativo AND p.excluido_em IS NULL
        AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = ?)
      WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
        AND up.vigencia_inicio <= UTC_DATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())`,
    [est, usuario, est],
  );
  return {
    ehDiretoriaClinica: ls.some((x) => x['codigo'] === PERFIL_DIRETORIA_CLINICA),
    administrador: ls.some((x) => Boolean(num(x['administrador']))),
  };
}

/** A autorização vigente do usuário para o paciente, com as aberturas já feitas e a última. */
async function autorizacaoDoUsuario(l: Leitor, est: number, paciente: number, usuario: number) {
  const ls = await l.consultar<Linha>(
    `SELECT a.id, a.vigencia_inicio, a.vigencia_fim, a.revogada_em, a.versao, a.limite_acessos,
            (SELECT COUNT(*) FROM acesso_prontuario_restrito x WHERE x.autorizacao_acesso_prontuario_restrito_id = a.id) AS acessos,
            (SELECT MAX(x.acessado_em) FROM acesso_prontuario_restrito x WHERE x.autorizacao_acesso_prontuario_restrito_id = a.id) AS ultima
       FROM autorizacao_acesso_prontuario_restrito a
      WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.autorizado_usuario_id = ? AND a.excluido_em IS NULL
        AND a.revogada_em IS NULL AND a.vigencia_inicio <= NOW(3) AND (a.vigencia_fim IS NULL OR a.vigencia_fim > NOW(3))
      ORDER BY a.vigencia_fim IS NULL DESC, a.vigencia_fim DESC, a.id DESC LIMIT 1`,
    [paciente, est, usuario],
  );
  return ls[0] ?? null;
}

async function senhaVigente(l: Leitor, paciente: number) {
  return l.uma<Linha>(
    `SELECT id, senha_resumo, tentativas_falhas, bloqueada_ate, versao FROM senha_prontuario_paciente
      WHERE paciente_id = ? AND situacao = 'vigente'`,
    [paciente],
  );
}

const erroCampos = (erros: Record<string, string>) =>
  recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });

// ---- gravações ----
async function configurar(tx: TxOperacao, e: EntradaConfiguracao, ctx: ContextoOperacao): Promise<Gravado> {
  const est = ctx.estabelecimento as number;
  const erros = validarConfiguracaoRestrito({ ...e, papelId: e.papelId ?? null });
  if (Object.keys(erros).length) throw erroCampos(erros);
  const valores = {
    autorizador: e.autorizador,
    autorizador_papel_seguranca_id: e.autorizador === 'papel' ? e.papelId : null,
    validade_autorizacao_horas: e.validadeHoras,
    exige_senha_paciente: e.exigeSenhaPaciente,
    limite_acessos: e.limiteAcessos,
    exige_motivo: e.exigeMotivo,
    avisa_responsavel: e.avisaResponsavel,
  };
  const atual = await tx.consultarParaAtualizar<Linha>(
    'SELECT id, versao FROM configuracao_prontuario_restrito WHERE estabelecimento_id = ?',
    [est],
  );
  const a = atual[0];
  if (a) {
    const versao = await tx.alterar(T_CONFIG, num(a['id']), num(a['versao']), valores);
    return { id: num(a['id']), versao };
  }
  const id = await tx.incluir(T_CONFIG, { estabelecimento_id: est, ...valores });
  return { id, versao: 1 };
}

async function restringir(tx: TxOperacao, e: EntradaRestringir, ctx: ContextoOperacao): Promise<Gravado> {
  const est = ctx.estabelecimento as number;
  if (!(await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente])))
    throw new ErroOperacao(404, 'nao-encontrado', 'Paciente', 'O paciente não existe.');
  if (await restricaoVigente(tx, est, e.paciente))
    throw recusa('ja-restrito', 'O prontuário deste paciente já está restrito.');
  const agora = await agoraDoBanco(tx);
  const id = await tx.incluir(T_RESTRICAO, {
    estabelecimento_id: est,
    paciente_id: e.paciente,
    atendimento_id: e.atendimento,
    modo: e.modo,
    categoria_motivo: e.categoria,
    motivo: e.motivo,
    permite_acesso_emergencial: e.permiteEmergencial,
    exige_justificativa_acesso: true,
    responsavel_usuario_id: ctx.usuario,
    vigencia_inicio: paraBanco(agora),
    ativo: true,
  });
  return { id, versao: 1 };
}

async function encerrarRestricao(
  tx: TxOperacao,
  e: EntradaEncerrarRestricao,
  ctx: ContextoOperacao,
): Promise<Gravado> {
  const r = await tx.uma<Linha>(
    'SELECT id, ativo FROM restricao_prontuario WHERE id = ? AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)',
    [e.restricao, ctx.estabelecimento],
  );
  if (!r) throw new ErroOperacao(404, 'nao-encontrado', 'Restrição', 'A restrição não existe nesta unidade.');
  if (!num(r['ativo'])) throw recusa('ja-encerrada', 'A restrição já foi encerrada.');
  const agora = await agoraDoBanco(tx);
  const versao = await tx.alterar(T_RESTRICAO, e.restricao, e.versao, {
    ativo: false,
    vigencia_fim: paraBanco(agora),
  });
  return { id: e.restricao, versao };
}

async function definirSenha(tx: TxOperacao, e: EntradaSenha, ctx: ContextoOperacao): Promise<Gravado> {
  const erros = validarSenhaPaciente(e.senha);
  if (Object.keys(erros).length) throw erroCampos(erros);
  if (!(await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente])))
    throw new ErroOperacao(404, 'nao-encontrado', 'Paciente', 'O paciente não existe.');
  const agora = paraBanco(await agoraDoBanco(tx));
  const atual = await tx.consultarParaAtualizar<Linha>(
    "SELECT id, versao FROM senha_prontuario_paciente WHERE paciente_id = ? AND situacao = 'vigente'",
    [e.paciente],
  );
  for (const a of atual)
    await tx.alterar(T_SENHA, num(a['id']), num(a['versao']), {
      situacao: 'substituida',
      encerrada_em: agora,
    });
  const id = await tx.incluir(T_SENHA, {
    paciente_id: e.paciente,
    senha_resumo: resumirSenha(e.senha),
    situacao: 'vigente',
    definida_em: agora,
    definida_por_usuario_id: ctx.usuario,
    tentativas_falhas: 0,
  });
  return { id, versao: 1 };
}

async function pedir(tx: TxOperacao, e: EntradaPedido, ctx: ContextoOperacao): Promise<Gravado> {
  const est = ctx.estabelecimento as number;
  const usuario = ctx.usuario as number;
  const restricao = await restricaoVigente(tx, est, e.paciente);
  if (!restricao)
    throw recusa('sem-restricao', 'O prontuário deste paciente não está restrito: abra normalmente.');
  const profissional = await profissionalDe(tx, usuario);
  if (profissional === null)
    throw recusa('usuario-sem-profissional', 'O pedido de acesso exige a conta ligada a um profissional.');
  const motivo = await tx.uma<Linha>(
    'SELECT id, ativo, tipo, exige_complemento FROM motivo_acesso_prontuario_restrito WHERE id = ?',
    [e.motivo],
  );
  const c = await configuracaoDe(tx, est);
  const aut = await autorizacaoDoUsuario(tx, est, e.paciente, usuario);
  const jaAutorizado =
    aut !== null &&
    avaliarAbertura(
      {
        vigenciaInicio: instante(aut['vigencia_inicio']) ?? '',
        vigenciaFim: instante(aut['vigencia_fim']),
        revogadaEm: null,
        acessosRealizados: num(aut['acessos']),
        limiteAcessos: numN(aut['limite_acessos']),
      },
      await agoraDoBanco(tx),
    ).permitido;
  const pend = await tx.consultarParaAtualizar<Linha>(
    `SELECT id FROM pedido_acesso_prontuario_restrito
      WHERE paciente_id = ? AND solicitante_usuario_id = ? AND situacao = 'pendente' AND excluido_em IS NULL`,
    [e.paciente, usuario],
  );
  const erros = validarPedidoAcesso(
    {
      tipo: e.tipo,
      justificativa: e.justificativa,
      motivoAtivo: Boolean(motivo && num(motivo['ativo'])),
      motivoTipo: motivo ? String(motivo['tipo']) : '',
      motivoExigeComplemento: Boolean(motivo && num(motivo['exige_complemento'])),
      jaAutorizado,
      pendenteDoMesmo: pend.length > 0,
    },
    c,
  );
  if (Object.keys(erros).length) throw erroCampos(erros);
  const agora = await agoraDoBanco(tx);
  const id = await tx.incluir(T_PEDIDO, {
    estabelecimento_id: est,
    restricao_prontuario_id: num(restricao['id']),
    paciente_id: e.paciente,
    atendimento_id: e.atendimento,
    solicitante_profissional_id: profissional,
    solicitante_usuario_id: usuario,
    motivo_acesso_prontuario_restrito_id: e.motivo,
    justificativa: e.justificativa.trim() || '(sem complemento)',
    solicitado_em: paraBanco(agora),
    tipo: e.tipo,
    situacao: 'pendente',
  });
  return { id, versao: 1 };
}

export type ResultadoDecisao = Gravado & {
  readonly situacao: 'aprovado' | 'negado' | 'expirado' | 'senha-recusada' | 'senha-bloqueada';
  readonly autorizacao: number | null;
};

async function decidir(tx: TxOperacao, e: EntradaDecisao, ctx: ContextoOperacao): Promise<ResultadoDecisao> {
  const est = ctx.estabelecimento as number;
  const usuario = ctx.usuario as number;
  const ps = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, paciente_id, atendimento_id, solicitante_usuario_id, solicitante_profissional_id, solicitado_em,
            situacao, versao FROM pedido_acesso_prontuario_restrito
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [e.pedido, est],
  );
  const p = ps[0];
  if (!p)
    throw new ErroOperacao(404, 'nao-encontrado', 'Pedido', 'O pedido de acesso não existe nesta unidade.');
  if (num(p['versao']) !== e.versao)
    throw new ErroOperacao(
      409,
      'conflito-versao',
      'Conflito',
      'O pedido mudou: recarregue e decida de novo.',
    );
  const erros = validarDecisaoPedido({
    situacao: String(p['situacao']) as never,
    aprovar: e.aprovar,
    motivoDecisao: e.motivoDecisao,
  });
  if (Object.keys(erros).length) throw erroCampos(erros);
  const c = await configuracaoDe(tx, est);
  const agora = await agoraDoBanco(tx);
  const paciente = num(p['paciente_id']);
  if (pedidoExpirado(instante(p['solicitado_em']) ?? agora, agora, c)) {
    const versao = await tx.alterar(T_PEDIDO, e.pedido, e.versao, { situacao: 'expirado' });
    return { id: e.pedido, versao, situacao: 'expirado', autorizacao: null };
  }
  // Quem decide: pelo paciente (com a senha dele) ou pela configuração (médico responsável, papel, diretoria).
  let concedidaPor: 'equipe_responsavel' | 'paciente' | 'administrador';
  if (e.pelopaciente) {
    if (!e.aprovar)
      throw recusa('entrada-invalida', 'Pelo paciente, a senha só aprova; a negativa é da equipe.');
    concedidaPor = 'paciente';
  } else {
    const prof = await profissionalDe(tx, usuario);
    const quem = podeDecidirPedido(
      {
        usuarioId: usuario,
        solicitanteUsuarioId: num(p['solicitante_usuario_id']),
        ehMedicoResponsavel: await ehMedicoResponsavel(tx, est, paciente, prof),
        temPapel: await temPapel(tx, usuario, c.papelId),
        ...(await perfisDe(tx, est, usuario)),
      },
      c,
      e.aprovar ? 'aprovar' : 'negar',
    );
    if (!quem.ok) throw new ErroOperacao(403, 'sem-alcada', 'Sem alçada', quem.motivo);
    concedidaPor = quem.concedidaPor === 'administrador' ? 'administrador' : 'equipe_responsavel';
  }
  if (usuario === num(p['solicitante_usuario_id']))
    throw new ErroOperacao(
      403,
      'sem-alcada',
      'Sem alçada',
      'Quem pediu o acesso não decide o próprio pedido.',
    );
  // A senha do paciente: exigida quando o paciente autoriza ou a configuração pede. O erro conta e fica gravado.
  let senhaConferida = false;
  if (e.aprovar && (e.pelopaciente || c.exigeSenhaPaciente)) {
    const s = await senhaVigente(tx, paciente);
    if (!s) throw recusa('sem-senha', 'O paciente ainda não definiu a senha do prontuário.');
    const estado = {
      tentativasFalhas: num(s['tentativas_falhas']),
      bloqueadaAte: instante(s['bloqueada_ate']),
    };
    if (senhaBloqueada(estado, agora))
      return { id: e.pedido, versao: e.versao, situacao: 'senha-bloqueada', autorizacao: null };
    const acertou = conferirSenha(e.senhaPaciente ?? '', String(s['senha_resumo']));
    const novo = aposConferencia(estado, acertou, agora);
    await tx.alterar(T_SENHA, num(s['id']), num(s['versao']), {
      tentativas_falhas: novo.tentativasFalhas,
      bloqueada_ate: novo.bloqueadaAte ? paraBanco(novo.bloqueadaAte) : null,
    });
    if (!acertou)
      return {
        id: e.pedido,
        versao: e.versao,
        situacao: novo.bloqueadaAte ? 'senha-bloqueada' : 'senha-recusada',
        autorizacao: null,
      };
    senhaConferida = true;
  }
  if (!e.aprovar) {
    const versao = await tx.alterar(T_PEDIDO, e.pedido, e.versao, {
      situacao: 'negado',
      decidido_em: paraBanco(agora),
      decisor_usuario_id: usuario,
      motivo_decisao: e.motivoDecisao.trim(),
    });
    return { id: e.pedido, versao, situacao: 'negado', autorizacao: null };
  }
  const fim = fimDoAcesso(agora, c);
  const versao = await tx.alterar(T_PEDIDO, e.pedido, e.versao, {
    situacao: 'aprovado',
    decidido_em: paraBanco(agora),
    decisor_usuario_id: usuario,
    motivo_decisao: e.motivoDecisao.trim() || null,
    acesso_inicio_em: paraBanco(agora),
    acesso_fim_em: paraBanco(fim),
  });
  const autorizacao = await tx.incluir(T_AUTORIZACAO, {
    estabelecimento_id: est,
    paciente_id: paciente,
    atendimento_id: numN(p['atendimento_id']),
    pedido_acesso_prontuario_restrito_id: e.pedido,
    autorizado_profissional_id: numN(p['solicitante_profissional_id']),
    autorizado_usuario_id: num(p['solicitante_usuario_id']),
    concedida_por: concedidaPor,
    concedente_usuario_id: usuario,
    senha_conferida: senhaConferida,
    tipo_autorizacao: e.tipoAutorizacao,
    vigencia_inicio: paraBanco(agora),
    vigencia_fim: paraBanco(fim),
    // O limite concedido fica na autorização: mudar a configuração depois não o altera.
    limite_acessos: c.limiteAcessos,
  });
  return { id: e.pedido, versao, situacao: 'aprovado', autorizacao };
}

async function revogar(tx: TxOperacao, e: EntradaRevogar, ctx: ContextoOperacao): Promise<Gravado> {
  const est = ctx.estabelecimento as number;
  const usuario = ctx.usuario as number;
  const a = await tx.uma<Linha>(
    `SELECT id, paciente_id, revogada_em, concedente_usuario_id, autorizado_usuario_id,
            pedido_acesso_prontuario_restrito_id AS pedido
       FROM autorizacao_acesso_prontuario_restrito
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [e.autorizacao, est],
  );
  if (!a)
    throw new ErroOperacao(404, 'nao-encontrado', 'Autorização', 'A autorização não existe nesta unidade.');
  if (a['revogada_em'] !== null) throw recusa('ja-revogada', 'A autorização já foi revogada.');
  const c = await configuracaoDe(tx, est);
  const alcada = podeRevogarAutorizacao(
    {
      usuarioId: usuario,
      concedenteUsuarioId: numN(a['concedente_usuario_id']),
      autorizadoUsuarioId: numN(a['autorizado_usuario_id']),
      ehMedicoResponsavel: await ehMedicoResponsavel(
        tx,
        est,
        num(a['paciente_id']),
        await profissionalDe(tx, usuario),
      ),
      temPapel: await temPapel(tx, usuario, c.papelId),
      ...(await perfisDe(tx, est, usuario)),
    },
    c,
  );
  if (!alcada.ok) throw new ErroOperacao(403, 'sem-alcada', 'Sem alçada', alcada.motivo);
  const agora = paraBanco(await agoraDoBanco(tx));
  const versao = await tx.alterar(T_AUTORIZACAO, e.autorizacao, e.versao, {
    revogada_em: agora,
    revogada_por_usuario_id: ctx.usuario,
    motivo_revogacao: e.motivo,
  });
  const pedido = numN(a['pedido']);
  if (pedido !== null) {
    const p = await tx.uma<Linha>(
      'SELECT versao, situacao FROM pedido_acesso_prontuario_restrito WHERE id = ?',
      [pedido],
    );
    if (p && p['situacao'] === 'aprovado')
      await tx.alterar(T_PEDIDO, pedido, num(p['versao']), { situacao: 'revogado' });
  }
  return { id: e.autorizacao, versao };
}

async function cancelarPedido(
  tx: TxOperacao,
  e: EntradaCancelarPedido,
  ctx: ContextoOperacao,
): Promise<Gravado> {
  const p = await tx.uma<Linha>(
    'SELECT solicitante_usuario_id, situacao FROM pedido_acesso_prontuario_restrito WHERE id = ? AND estabelecimento_id = ?',
    [e.pedido, ctx.estabelecimento],
  );
  if (!p)
    throw new ErroOperacao(404, 'nao-encontrado', 'Pedido', 'O pedido de acesso não existe nesta unidade.');
  if (num(p['solicitante_usuario_id']) !== ctx.usuario)
    throw new ErroOperacao(403, 'sem-alcada', 'Sem alçada', 'Só quem pediu cancela o pedido.');
  if (p['situacao'] !== 'pendente') throw recusa('ja-decidido', 'O pedido já foi decidido ou encerrado.');
  const versao = await tx.alterar(T_PEDIDO, e.pedido, e.versao, { situacao: 'cancelado' });
  return { id: e.pedido, versao };
}

export type ResultadoAbertura = Gravado & {
  readonly numero: number;
  readonly restantes: number | null;
  readonly avisaResponsavel: boolean;
};

async function abrir(tx: TxOperacao, e: EntradaAbrir, ctx: ContextoOperacao): Promise<ResultadoAbertura> {
  const est = ctx.estabelecimento as number;
  const usuario = ctx.usuario as number;
  const restricao = await restricaoVigente(tx, est, e.paciente);
  if (!restricao)
    throw recusa('sem-restricao', 'O prontuário deste paciente não está restrito: abra normalmente.');
  const c = await configuracaoDe(tx, est);
  const aut = await autorizacaoDoUsuario(tx, est, e.paciente, usuario);
  if (aut)
    await tx.consultarParaAtualizar('SELECT id FROM autorizacao_acesso_prontuario_restrito WHERE id = ?', [
      num(aut['id']),
    ]);
  const agora = await agoraDoBanco(tx);
  const r = avaliarAbertura(
    aut
      ? {
          vigenciaInicio: instante(aut['vigencia_inicio']) ?? '',
          vigenciaFim: instante(aut['vigencia_fim']),
          revogadaEm: instante(aut['revogada_em']),
          acessosRealizados: num(aut['acessos']),
          limiteAcessos: numN(aut['limite_acessos']),
        }
      : null,
    agora,
  );
  if (!r.permitido) throw new ErroOperacao(403, r.motivo, 'Prontuário restrito', r.mensagem);
  const autorizacao = num(aut!['id']);
  const leitura = await tx.incluir(T_LEITURA, {
    estabelecimento_id: est,
    paciente_id: e.paciente,
    tipo_acesso: 'acesso_restrito_autorizado',
    profissional_id: await profissionalDe(tx, usuario),
    ocorrido_em: paraBanco(agora),
    usuario_id: usuario,
    dados: JSON.stringify({ autorizacao, numero: r.numero }),
  });
  const id = await tx.incluir(T_ACESSO, {
    autorizacao_acesso_prontuario_restrito_id: autorizacao,
    paciente_id: e.paciente,
    usuario_id: usuario,
    numero_acesso: r.numero,
    acessado_em: paraBanco(agora),
    leitura_prontuario_id: leitura,
  });
  return { id, versao: 1, numero: r.numero, restantes: r.restantes, avisaResponsavel: c.avisaResponsavel };
}

// ---- visão ----
export interface ContextoRestrito {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoRestrito = ContextoRestrito & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface PedidoVisao {
  readonly id: number;
  readonly versao: number;
  readonly paciente: number;
  readonly prontuario: string | null;
  readonly solicitante: string | null;
  readonly doUsuario: boolean;
  readonly motivo: string;
  readonly justificativa: string;
  readonly tipo: string;
  readonly situacao: string;
  readonly solicitadoEm: string | null;
  readonly decididoEm: string | null;
  readonly motivoDecisao: string | null;
  readonly acessoFim: string | null;
}
export interface AutorizacaoVisao {
  readonly id: number;
  readonly versao: number;
  readonly autorizado: string | null;
  readonly concedidaPor: string;
  readonly senhaConferida: boolean;
  readonly tipo: string;
  readonly inicio: string | null;
  readonly fim: string | null;
  readonly revogadaEm: string | null;
  readonly motivoRevogacao: string | null;
  readonly acessos: number;
  readonly limite: number | null;
  readonly vigente: boolean;
}
export interface PainelRestrito {
  readonly paciente: number;
  readonly prontuario: string | null;
  readonly restricao: {
    readonly id: number;
    readonly versao: number;
    readonly modo: string;
    readonly categoria: string;
    readonly motivo: string;
    readonly desde: string | null;
    readonly permiteEmergencial: boolean;
  } | null;
  readonly configuracao: ConfiguracaoProntuarioRestrito & {
    readonly daUnidade: boolean;
    readonly versao: number;
  };
  readonly senha: { readonly definida: boolean; readonly bloqueada: boolean };
  readonly minha: {
    readonly permitido: boolean;
    readonly mensagem: string | null;
    readonly restantes: number | null;
  };
  readonly podeDecidir: boolean;
  readonly pedidos: PedidoVisao[];
  readonly autorizacoes: AutorizacaoVisao[];
  readonly motivos: {
    readonly id: number;
    readonly descricao: string;
    readonly textoPadrao: string | null;
    readonly exigeComplemento: boolean;
  }[];
}

const SQL_PEDIDOS = `SELECT p.id, p.versao, p.paciente_id, pc.numero_prontuario, u.login AS solicitante, p.solicitante_usuario_id,
            m.descricao AS motivo, p.justificativa, p.tipo, p.situacao, p.solicitado_em, p.decidido_em, p.motivo_decisao,
            p.acesso_fim_em
       FROM pedido_acesso_prontuario_restrito p
       JOIN motivo_acesso_prontuario_restrito m ON m.id = p.motivo_acesso_prontuario_restrito_id
       JOIN paciente pc ON pc.id = p.paciente_id
       LEFT JOIN usuario u ON u.id = p.solicitante_usuario_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

function pedidoVisao(
  x: Linha,
  usuario: number | null,
  agora: string,
  c: ConfiguracaoProntuarioRestrito,
): PedidoVisao {
  const situacao = String(x['situacao']);
  const solicitadoEm = instante(x['solicitado_em']);
  return {
    id: num(x['id']),
    versao: num(x['versao']),
    paciente: num(x['paciente_id']),
    prontuario: txt(x['numero_prontuario']),
    solicitante: txt(x['solicitante']),
    doUsuario: usuario !== null && num(x['solicitante_usuario_id']) === usuario,
    motivo: String(x['motivo']),
    justificativa: String(x['justificativa']),
    tipo: String(x['tipo']),
    situacao:
      situacao === 'pendente' && solicitadoEm && pedidoExpirado(solicitadoEm, agora, c)
        ? 'expirado'
        : situacao,
    solicitadoEm,
    decididoEm: instante(x['decidido_em']),
    motivoDecisao: txt(x['motivo_decisao']),
    acessoFim: instante(x['acesso_fim_em']),
  };
}

export interface NucleoProntuarioRestrito {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export class PortaProntuarioRestritoPropria {
  private readonly executor: Executor;
  private readonly ops = {
    configurar: definirOperacao<EntradaConfiguracao, Gravado>({
      nome: 'pep.configurar_prontuario_restrito',
      tabelas: [T_CONFIG],
      entrada: esquemaConfiguracao as unknown as z.ZodType<EntradaConfiguracao>,
      gravar: configurar,
      alvo: (_e, r) => ({ tabela: T_CONFIG, id: r.id }),
    }),
    restringir: definirOperacao<EntradaRestringir, Gravado>({
      nome: 'pep.restringir_prontuario',
      tabelas: [T_RESTRICAO],
      entrada: esquemaRestringir as unknown as z.ZodType<EntradaRestringir>,
      travar: (e) => ({ tabela: 'paciente', id: e.paciente }),
      gravar: restringir,
      alvo: (_e, r) => ({ tabela: T_RESTRICAO, id: r.id }),
    }),
    encerrar: definirOperacao<EntradaEncerrarRestricao, Gravado>({
      nome: 'pep.encerrar_restricao_prontuario',
      tabelas: [T_RESTRICAO],
      entrada: esquemaEncerrarRestricao as unknown as z.ZodType<EntradaEncerrarRestricao>,
      gravar: encerrarRestricao,
      alvo: (e) => ({ tabela: T_RESTRICAO, id: e.restricao }),
    }),
    senha: definirOperacao<EntradaSenha, Gravado>({
      nome: 'pep.definir_senha_prontuario_paciente',
      tabelas: [T_SENHA],
      entrada: esquemaSenha as unknown as z.ZodType<EntradaSenha>,
      travar: (e) => ({ tabela: 'paciente', id: e.paciente }),
      gravar: definirSenha,
      alvo: (_e, r) => ({ tabela: T_SENHA, id: r.id }),
    }),
    pedir: definirOperacao<EntradaPedido, Gravado>({
      nome: 'pep.pedir_acesso_prontuario_restrito',
      tabelas: [T_PEDIDO],
      entrada: esquemaPedido as unknown as z.ZodType<EntradaPedido>,
      travar: (e) => ({ tabela: 'paciente', id: e.paciente }),
      gravar: pedir,
      alvo: (_e, r) => ({ tabela: T_PEDIDO, id: r.id }),
    }),
    decidir: definirOperacao<EntradaDecisao, ResultadoDecisao>({
      nome: 'pep.decidir_acesso_prontuario_restrito',
      tabelas: [T_PEDIDO, T_AUTORIZACAO, T_SENHA],
      entrada: esquemaDecisao as unknown as z.ZodType<EntradaDecisao>,
      gravar: decidir,
      alvo: (e) => ({ tabela: T_PEDIDO, id: e.pedido }),
    }),
    revogar: definirOperacao<EntradaRevogar, Gravado>({
      nome: 'pep.revogar_acesso_prontuario_restrito',
      tabelas: [T_AUTORIZACAO, T_PEDIDO],
      entrada: esquemaRevogar as unknown as z.ZodType<EntradaRevogar>,
      gravar: revogar,
      alvo: (e) => ({ tabela: T_AUTORIZACAO, id: e.autorizacao }),
    }),
    cancelar: definirOperacao<EntradaCancelarPedido, Gravado>({
      nome: 'pep.cancelar_pedido_prontuario_restrito',
      tabelas: [T_PEDIDO],
      entrada: esquemaCancelarPedido as unknown as z.ZodType<EntradaCancelarPedido>,
      gravar: cancelarPedido,
      alvo: (e) => ({ tabela: T_PEDIDO, id: e.pedido }),
    }),
    abrir: definirOperacao<EntradaAbrir, ResultadoAbertura>({
      nome: 'pep.abrir_prontuario_restrito',
      tabelas: [T_ACESSO, T_LEITURA],
      entrada: esquemaAbrir as unknown as z.ZodType<EntradaAbrir>,
      gravar: abrir,
      alvo: (_e, r) => ({ tabela: T_ACESSO, id: r.id }),
    }),
  };

  constructor(
    private readonly nucleo: NucleoProntuarioRestrito,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'prontuario-restrito' }, fn);
  }

  private async quem(
    l: Leitor,
    c: ContextoRestrito,
  ): Promise<{ estabelecimento: number; usuario: number | null }> {
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
  }

  /** Visão por paciente: restrição, configuração, senha (só se existe), a minha situação, pedidos e autorizações. */
  painel(c: ContextoRestrito, paciente: number): Promise<PainelRestrito> {
    return this.ler(async (l) => {
      const q = await this.quem(l, c);
      const est = q.estabelecimento;
      const pc = await l.uma<Linha>(
        'SELECT numero_prontuario FROM paciente WHERE id = ? AND excluido_em IS NULL',
        [paciente],
      );
      if (!pc) throw new ErroOperacao(404, 'nao-encontrado', 'Paciente', 'O paciente não existe.');
      const agora = await agoraDoBanco(l);
      const cfg = await configuracaoDe(l, est);
      const r = await restricaoVigente(l, est, paciente);
      const s = await senhaVigente(l, paciente);
      const pedidos = (
        await l.consultar<Linha>(
          `${SQL_PEDIDOS} AND p.paciente_id = ? ORDER BY p.solicitado_em DESC, p.id DESC`,
          [est, paciente],
          { teto: 500 },
        )
      ).map((x) => pedidoVisao(x, q.usuario, agora, cfg));
      const autorizacoes = (
        await l.consultar<Linha>(
          `SELECT a.id, a.versao, u.login AS autorizado, a.concedida_por, a.senha_conferida, a.tipo_autorizacao, a.limite_acessos,
                  a.vigencia_inicio, a.vigencia_fim, a.revogada_em, a.motivo_revogacao,
                  (SELECT COUNT(*) FROM acesso_prontuario_restrito x WHERE x.autorizacao_acesso_prontuario_restrito_id = a.id) AS acessos
             FROM autorizacao_acesso_prontuario_restrito a LEFT JOIN usuario u ON u.id = a.autorizado_usuario_id
            WHERE a.paciente_id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL
            ORDER BY a.vigencia_inicio DESC, a.id DESC`,
          [paciente, est],
          { teto: 500 },
        )
      ).map((x): AutorizacaoVisao => {
        const inicio = instante(x['vigencia_inicio']);
        const fim = instante(x['vigencia_fim']);
        const revogadaEm = instante(x['revogada_em']);
        return {
          id: num(x['id']),
          versao: num(x['versao']),
          autorizado: txt(x['autorizado']),
          concedidaPor: String(x['concedida_por']),
          senhaConferida: Boolean(num(x['senha_conferida'])),
          tipo: String(x['tipo_autorizacao']),
          inicio,
          fim,
          revogadaEm,
          motivoRevogacao: txt(x['motivo_revogacao']),
          acessos: num(x['acessos']),
          limite: numN(x['limite_acessos']),
          vigente: revogadaEm === null && (inicio ?? '') <= agora && (fim === null || fim > agora),
        };
      });
      let minha: PainelRestrito['minha'] = { permitido: r === null, mensagem: null, restantes: null };
      let podeDecidir = false;
      if (r && q.usuario !== null) {
        const a = await autorizacaoDoUsuario(l, est, paciente, q.usuario);
        const av = avaliarAbertura(
          a
            ? {
                vigenciaInicio: instante(a['vigencia_inicio']) ?? '',
                vigenciaFim: instante(a['vigencia_fim']),
                revogadaEm: null,
                acessosRealizados: num(a['acessos']),
                limiteAcessos: numN(a['limite_acessos']),
              }
            : null,
          agora,
        );
        minha = av.permitido
          ? { permitido: true, mensagem: null, restantes: av.restantes }
          : { permitido: false, mensagem: av.mensagem, restantes: null };
        const prof = await profissionalDe(l, q.usuario);
        podeDecidir = podeDecidirPedido(
          {
            usuarioId: q.usuario,
            solicitanteUsuarioId: -1,
            ehMedicoResponsavel: await ehMedicoResponsavel(l, est, paciente, prof),
            temPapel: await temPapel(l, q.usuario, cfg.papelId),
            ...(await perfisDe(l, est, q.usuario)),
          },
          cfg,
        ).ok;
      }
      const motivos = (
        await l.consultar<Linha>(
          "SELECT id, descricao, texto_padrao, exige_complemento FROM motivo_acesso_prontuario_restrito WHERE ativo AND tipo = 'solicitacao' ORDER BY descricao",
          [],
          { teto: 200 },
        )
      ).map((x) => ({
        id: num(x['id']),
        descricao: String(x['descricao']),
        textoPadrao: txt(x['texto_padrao']),
        exigeComplemento: Boolean(num(x['exige_complemento'])),
      }));
      return {
        paciente,
        prontuario: txt(pc['numero_prontuario']),
        restricao: r
          ? {
              id: num(r['id']),
              versao: num(r['versao']),
              modo: String(r['modo']),
              categoria: String(r['categoria_motivo']),
              motivo: String(r['motivo']),
              desde: instante(r['vigencia_inicio']),
              permiteEmergencial: Boolean(num(r['permite_acesso_emergencial'])),
            }
          : null,
        configuracao: {
          autorizador: cfg.autorizador,
          papelId: cfg.papelId,
          validadeHoras: cfg.validadeHoras,
          exigeSenhaPaciente: cfg.exigeSenhaPaciente,
          limiteAcessos: cfg.limiteAcessos,
          exigeMotivo: cfg.exigeMotivo,
          avisaResponsavel: cfg.avisaResponsavel,
          daUnidade: cfg.daUnidade,
          versao: cfg.versao,
        },
        senha: {
          definida: Boolean(s),
          bloqueada: s
            ? senhaBloqueada(
                { tentativasFalhas: num(s['tentativas_falhas']), bloqueadaAte: instante(s['bloqueada_ate']) },
                agora,
              )
            : false,
        },
        minha,
        podeDecidir,
        pedidos,
        autorizacoes,
        motivos,
      };
    });
  }

  /** A fila da unidade: pedidos pendentes (os vencidos aparecem como expirados) e a configuração vigente. */
  fila(c: ContextoRestrito): Promise<{
    pedidos: PedidoVisao[];
    configuracao: ConfiguracaoProntuarioRestrito & { daUnidade: boolean; versao: number };
    papeis: { id: number; rotulo: string }[];
  }> {
    return this.ler(async (l) => {
      const q = await this.quem(l, c);
      const agora = await agoraDoBanco(l);
      const cfg = await configuracaoDe(l, q.estabelecimento);
      const pedidos = (
        await l.consultar<Linha>(
          `${SQL_PEDIDOS} AND p.situacao = 'pendente' ORDER BY p.tipo = 'emergencial' DESC, p.solicitado_em`,
          [q.estabelecimento],
          { teto: 500 },
        )
      ).map((x) => pedidoVisao(x, q.usuario, agora, cfg));
      const papeis = (
        await l.consultar<Linha>('SELECT id, nome FROM papel_seguranca ORDER BY nome', [], { teto: 300 })
      ).map((x) => ({ id: num(x['id']), rotulo: String(x['nome']) }));
      const { id, ...resto } = cfg;
      void id;
      return { pedidos, configuracao: resto, papeis };
    });
  }

  private async executar<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    c: ContextoGravacaoRestrito,
    entrada: unknown,
    exigencia: string,
  ) {
    const q = await this.ler((l) => this.quem(l, c));
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        `${exigencia} exige uma conta de usuário do cliente (o responsável fica no registro).`,
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  configurar(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.configurar, c, e, 'Configurar o prontuário restrito');
  }
  restringir(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.restringir, c, e, 'Restringir o prontuário');
  }
  encerrarRestricao(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.encerrar, c, e, 'Encerrar a restrição');
  }
  definirSenha(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.senha, c, e, 'Definir a senha do paciente');
  }
  pedir(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.pedir, c, e, 'Pedir acesso');
  }
  decidir(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.decidir, c, e, 'Decidir o pedido');
  }
  revogar(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.revogar, c, e, 'Revogar a autorização');
  }
  cancelarPedido(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.cancelar, c, e, 'Cancelar o pedido');
  }
  abrir(c: ContextoGravacaoRestrito, e: unknown) {
    return this.executar(this.ops.abrir, c, e, 'Abrir o prontuário restrito');
  }
}
