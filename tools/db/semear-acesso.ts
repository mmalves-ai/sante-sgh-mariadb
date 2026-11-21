// Semeador do acesso (F2-L, lote 5): deixa um cliente recém-criado pronto para o primeiro login. Idempotente.
//
// No banco do cliente (cliente_<codigo>), pelo @sgh/nucleo (NucleoProprio.escrever, uma transação):
// - 1 estabelecimento, só se o banco não tiver nenhum (senão usa o primeiro);
// - a política de senha padrão do estabelecimento (se não houver);
// - os perfis ADMIN (administrador do cliente) e TESTE (só as ações de consulta, tipo 'ver', do catálogo
//   acao_sistema que o "criar novo cliente" carregou);
// - o usuário de teste, com vínculo vigente ao estabelecimento, o perfil TESTE e a credencial argon2id com troca
//   obrigatória no primeiro acesso.
// No banco plataforma (decisão do dono 2026-11-20, b), por tools/db/sql.sh (como o criar_cliente.py):
// - o administrador da plataforma (nome e e-mail) e a credencial dele (db/plataforma/0002, argon2id, troca obrigatória
//   no primeiro acesso). NADA de usuário-espelho no banco do cliente: ele entra pelo login da plataforma.
//
// Senhas iniciais e logins vêm do ambiente (.env ou processo), nunca impressos: SEMEAR_ADMIN_LOGIN,
// SEMEAR_ADMIN_SENHA, SEMEAR_ADMIN_EMAIL, SEMEAR_ADMIN_NOME (opcional), SEMEAR_TESTE_LOGIN, SEMEAR_TESTE_SENHA. Sem
// alguma obrigatória, recusa. Credencial já existente é mantida (a pessoa pode ter trocado a senha); só
// --redefinir-senhas regrava as duas, de novo com troca obrigatória. A saída tem só situações e contagens.
//
// uso: node --experimental-transform-types --import ./tools/verificadores/src/caminhos-sgh.ts tools/db/semear-acesso.ts <codigo-cliente> [--redefinir-senhas]
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { type Ambiente, type Escritor, FORMATO_CLIENTE, NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';

/** Mínimo das senhas iniciais (o da política padrão gravada aqui e o das contas da plataforma). */
export const MINIMO_SENHA_INICIAL = 12;
/** Código do estabelecimento criado quando o banco não tem nenhum (esquemaCodigoEstabelecimento). */
export const ESTABELECIMENTO_PADRAO = { codigo: 'principal', nome: 'Estabelecimento principal' } as const;
export const PERFIS = [
  { codigo: 'ADMIN', nome: 'Administrador do cliente', administrador: true },
  { codigo: 'TESTE', nome: 'Teste (só consulta)', administrador: false },
] as const;

export interface EntradaSemeador {
  readonly admin: { readonly login: string; readonly senha: string; readonly email: string; readonly nome: string };
  readonly teste: { readonly login: string; readonly senha: string };
}

// eslint-disable-next-line no-control-regex -- recusa de caracteres de controle é a intenção
const CONTROLE = /[\u0000-\u001f\u007f]/;

/** Lê e confere as variáveis do semeador. Recusa só pelo NOME da variável, nunca com o valor. */
export function lerEntradaSemeador(env: Ambiente): EntradaSemeador {
  const erros: string[] = [];
  const v = (nome: string, max: number, obrigatoria = true): string => {
    const x = env[nome] ?? '';
    if (!x) {
      if (obrigatoria) erros.push(`${nome} ausente`);
      return '';
    }
    if (x !== x.trim() || CONTROLE.test(x) || x.length > max) erros.push(`${nome} fora do formato`);
    return x;
  };
  const senha = (nome: string): string => {
    const x = env[nome] ?? '';
    if (!x) erros.push(`${nome} ausente`);
    else if (x.length < MINIMO_SENHA_INICIAL || x.length > 200 || CONTROLE.test(x))
      erros.push(`${nome} precisa de ${MINIMO_SENHA_INICIAL} a 200 caracteres, sem controle`);
    return x;
  };
  const entrada: EntradaSemeador = {
    admin: {
      login: v('SEMEAR_ADMIN_LOGIN', 80).toLowerCase(),
      senha: senha('SEMEAR_ADMIN_SENHA'),
      email: v('SEMEAR_ADMIN_EMAIL', 254),
      nome: v('SEMEAR_ADMIN_NOME', 150, false) || 'Administrador da plataforma',
    },
    teste: { login: v('SEMEAR_TESTE_LOGIN', 31), senha: senha('SEMEAR_TESTE_SENHA') },
  };
  if (entrada.admin.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entrada.admin.email))
    erros.push('SEMEAR_ADMIN_EMAIL fora do formato');
  if (entrada.teste.login.includes(':')) erros.push('SEMEAR_TESTE_LOGIN fora do formato');
  // O mesmo formato do contrato e do ck da 0002 (ASCII; a colação do banco ignora invisíveis e acentos).
  if (entrada.admin.login && !/^[a-z0-9._-]{1,80}$/.test(entrada.admin.login))
    erros.push('SEMEAR_ADMIN_LOGIN fora do formato (letras sem acento, dígitos, ponto, hífen e sublinhado)');
  if (erros.length) throw new Error(`semeador recusado: ${erros.join('; ')}`);
  return entrada;
}

/** Literal SQL de texto (o valor já passou por lerEntradaSemeador: sem caractere de controle). */
export function textoSql(v: string): string {
  if (CONTROLE.test(v)) throw new Error('texto com caractere de controle');
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/**
 * SQL do banco plataforma (uma transação): administrador por e-mail e credencial argon2id com troca obrigatória. O
 * resumo é argon2id (nunca a senha). Devolve, na última linha, "administrador credencial" com criado/existente e
 * criada/mantida/redefinida.
 */
export function sqlPlataforma(e: EntradaSemeador['admin'], resumo: string, redefinir: boolean): string {
  if (!resumo.startsWith('$argon2id$')) throw new Error('resumo fora do formato argon2id');
  const email = textoSql(e.email);
  return `SET @agora = NOW(3);
START TRANSACTION;
SET @tinha_adm = (SELECT COUNT(*) FROM administrador_plataforma WHERE email = ${email});
INSERT INTO administrador_plataforma (nome, email, ativo, criado_em)
  SELECT ${textoSql(e.nome)}, ${email}, TRUE, @agora FROM DUAL WHERE @tinha_adm = 0;
SET @adm = (SELECT id FROM administrador_plataforma WHERE email = ${email});
SET @tinha_cred = (SELECT COUNT(*) FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = @adm);
INSERT INTO credencial_administrador_plataforma
    (administrador_plataforma_id, login, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
  SELECT @adm, ${textoSql(e.login)}, ${textoSql(resumo)}, @agora, TRUE, @agora FROM DUAL WHERE @tinha_cred = 0;
UPDATE credencial_administrador_plataforma
   SET resumo_senha = ${textoSql(resumo)}, senha_alterada_em = @agora, troca_obrigatoria = TRUE,
       tentativas_falhas = 0, bloqueado_ate = NULL, alterado_em = @agora, versao = versao + 1
 WHERE administrador_plataforma_id = @adm AND @tinha_cred = 1 AND ${redefinir ? 'TRUE' : 'FALSE'};
COMMIT;
SELECT IF(@tinha_adm = 0, 'criado', 'existente'),
       IF(@tinha_cred = 0, 'criada', IF(${redefinir ? 'TRUE' : 'FALSE'}, 'redefinida', 'mantida'));
`;
}

type Situacao = 'criado' | 'existente';

export interface ResumoCliente {
  estabelecimento: Situacao;
  politica_senha: Situacao;
  perfis_criados: number;
  acoes_consulta_no_catalogo: number;
  acoes_teste_concedidas: number;
  usuario_teste: Situacao;
  vinculo_teste: Situacao;
  perfil_teste: Situacao;
  credencial_teste: 'criada' | 'mantida' | 'redefinida';
}

/** As gravações no banco do cliente (uma transação, pelo Escritor do núcleo). */
export async function semearCliente(
  w: Escritor,
  teste: EntradaSemeador['teste'],
  resumo: string,
  redefinir: boolean,
  agora: Date,
): Promise<ResumoCliente> {
  const id = (l: { id: unknown } | null): number | null => (l ? Number(l.id) : null);
  let estId = id(
    await w.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
  );
  const estabelecimento: Situacao = estId === null ? 'criado' : 'existente';
  estId ??= await w.inserir(
    'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
    [ESTABELECIMENTO_PADRAO.codigo, ESTABELECIMENTO_PADRAO.nome, ESTABELECIMENTO_PADRAO.nome, agora],
  );

  const temPolitica = await w.uma('SELECT id FROM politica_senha WHERE estabelecimento_id = ?', [estId]);
  if (!temPolitica)
    await w.inserir(
      `INSERT INTO politica_senha (estabelecimento_id, tamanho_minimo, exige_numero, tentativas_ate_bloqueio,
                                   inatividade_sessao_minutos, criado_em)
       VALUES (?, ?, TRUE, 5, 30, ?)`,
      [estId, MINIMO_SENHA_INICIAL, agora],
    );

  let perfisCriados = 0;
  const perfil: Record<string, number> = {};
  for (const p of PERFIS) {
    let pid = id(
      await w.uma<{ id: number }>(
        'SELECT id FROM perfil_acesso WHERE estabelecimento_id IS NULL AND codigo = ?',
        [p.codigo],
      ),
    );
    if (pid === null) {
      pid = await w.inserir(
        'INSERT INTO perfil_acesso (codigo, nome, administrador, criado_em) VALUES (?, ?, ?, ?)',
        [p.codigo, p.nome, p.administrador, agora],
      );
      perfisCriados++;
    }
    perfil[p.codigo] = pid;
  }
  const perfilTeste = perfil['TESTE'] as number;

  const consulta = await w.uma<{ n: number }>(
    "SELECT COUNT(*) AS n FROM acao_sistema WHERE ativo AND permissionavel AND tipo_acao = 'ver'",
  );
  const concedidas = await w.executar(
    `INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em)
     SELECT ?, a.id, ? FROM acao_sistema a
      WHERE a.ativo AND a.permissionavel AND a.tipo_acao = 'ver'
        AND NOT EXISTS (SELECT 1 FROM perfil_acao x WHERE x.perfil_acesso_id = ? AND x.acao_sistema_id = a.id)`,
    [perfilTeste, agora, perfilTeste],
  );

  let usuarioId = id(await w.uma<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [teste.login]));
  const usuario: Situacao = usuarioId === null ? 'criado' : 'existente';
  usuarioId ??= await w.inserir(
    "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
    [teste.login, 'Usuário de teste', agora],
  );

  const vigente = 'vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)';
  const temVinculo = await w.uma(
    `SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ? AND ${vigente}`,
    [usuarioId, estId],
  );
  if (!temVinculo)
    await w.inserir(
      `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, padrao, vigencia_inicio, criado_em)
       VALUES (?, ?, TRUE, CURRENT_DATE, ?)`,
      [usuarioId, estId, agora],
    );
  const temPerfil = await w.uma(
    `SELECT id FROM usuario_perfil
      WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ? AND ${vigente}`,
    [usuarioId, perfilTeste, estId],
  );
  if (!temPerfil)
    await w.inserir(
      `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
       VALUES (?, ?, ?, CURRENT_DATE, ?)`,
      [usuarioId, perfilTeste, estId, agora],
    );

  const temCredencial = await w.uma('SELECT id FROM credencial_usuario WHERE usuario_id = ?', [usuarioId]);
  let credencial: ResumoCliente['credencial_teste'] = 'mantida';
  if (!temCredencial) {
    await w.inserir(
      `INSERT INTO credencial_usuario (usuario_id, algoritmo, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
       VALUES (?, 'argon2id', ?, ?, TRUE, ?)`,
      [usuarioId, resumo, agora, agora],
    );
    credencial = 'criada';
  } else if (redefinir) {
    await w.executar(
      `UPDATE credencial_usuario
          SET algoritmo = 'argon2id', resumo_senha = ?, senha_alterada_em = ?, troca_obrigatoria = TRUE,
              tentativas_invalidas = 0, alterado_em = ?, versao = versao + 1
        WHERE usuario_id = ?`,
      [resumo, agora, agora, usuarioId],
    );
    credencial = 'redefinida';
  }
  return {
    estabelecimento,
    politica_senha: temPolitica ? 'existente' : 'criado',
    perfis_criados: perfisCriados,
    acoes_consulta_no_catalogo: Number(consulta?.n ?? 0),
    acoes_teste_concedidas: concedidas,
    usuario_teste: usuario,
    vinculo_teste: temVinculo ? 'existente' : 'criado',
    perfil_teste: temPerfil ? 'existente' : 'criado',
    credencial_teste: credencial,
  };
}

async function principal(argv: readonly string[]): Promise<number> {
  const cliente = argv.find((a) => !a.startsWith('--')) ?? '';
  const redefinir = argv.includes('--redefinir-senhas');
  if (!FORMATO_CLIENTE.test(cliente)) {
    console.error('uso: semear-acesso.ts <codigo-cliente> [--redefinir-senhas]');
    return 2;
  }
  const { env } = ambienteEfetivo();
  const entrada = lerEntradaSemeador(env);
  const [resumoTeste, resumoAdmin] = await Promise.all([
    cifrarSenha(entrada.teste.senha),
    cifrarSenha(entrada.admin.senha),
  ]);
  const nucleo = new NucleoProprio({ env });
  let resumoCliente: ResumoCliente;
  try {
    resumoCliente = await nucleo.escrever({ cliente, correlacao: 'semear-acesso' }, (w) =>
      semearCliente(w, entrada.teste, resumoTeste, redefinir, new Date()),
    );
  } finally {
    await nucleo.encerrar();
  }
  const sh = resolve(import.meta.dirname, 'sql.sh');
  const r = spawnSync('sh', [sh, 'plataforma', '-N'], {
    input: sqlPlataforma(entrada.admin, resumoAdmin, redefinir),
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    // Só o número do erro do banco: a mensagem pode trazer o valor (login, e-mail) e o SQL leva o resumo.
    console.error(`plataforma: falhou (${/ERROR \d+/.exec(r.stderr ?? '')?.[0] ?? 'sem código'})`);
    return 1;
  }
  const [adm, cred] = (r.stdout.trim().split('\n').at(-1) ?? '').split('\t');
  console.log(
    JSON.stringify({
      cliente,
      ...resumoCliente,
      administrador_plataforma: adm,
      credencial_plataforma: cred,
    }),
  );
  if (resumoCliente.acoes_consulta_no_catalogo === 0)
    console.error('aviso: acao_sistema sem ações de consulta (rode o "criar novo cliente", que carrega o catálogo)');
  return 0;
}

if ((import.meta as { main?: boolean }).main) {
  principal(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      // A recusa do semeador cita só nomes de variáveis; erro de banco pode trazer valor: só o nome e o código.
      const m = e instanceof Error ? e.message : '';
      const codigo = (e as { code?: unknown } | null)?.code;
      console.error(
        m.startsWith('semeador recusado') ? m : `falhou: ${e instanceof Error ? e.name : 'erro'} ${String(codigo ?? '')}`,
      );
      process.exit(1);
    },
  );
}
