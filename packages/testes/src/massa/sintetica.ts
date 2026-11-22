// Massa sintética dos testes (nunca dado pessoal real), sobre o modelo próprio no MariaDB (pelo @sgh/nucleo).
// Nomes marcados "SINTETICO SGH M04", CPF válido gerado e conferido livre no banco (pessoa e usuário), CEP do
// catálogo público de CEPs (logradouro, não pessoa), telefones e e-mail fictícios (domínio .invalid). Os valores
// ficam em memória do teste; nada é impresso nem gravado em arquivo. As gravações são massa de teste (não são
// operações de negócio): rodam na transação do preparo do teste, de preferência desfeita no fim.
// Melhoria: o CPF livre é conferido em pessoa_fisica E em usuario (o antigo olhava só o cadastro de pacientes).
// Melhoria: o CEP "completo" é o do catálogo próprio (logradouro, bairro, espécie, município e UF por chave), sem a
//   lista de "tipos de logradouro já vistos" que só existia para contornar o codec do sistema de origem.
// Melhoria: papel, perfil e estabelecimento do usuário sintético entram com vigência (vigencia_inicio), como o
//   modelo exige, e as leituras filtram excluido_em IS NULL.
// Melhoria: o perfil de acesso é procurado só no estabelecimento pedido ou na rede (nunca o de outro estabelecimento).
import type { CadastrarPacienteEntrada, CriarUsuarioIntegracaoEntrada } from '@sgh/contratos';
import { cpfValido } from '@sgh/contratos';
import type { Escritor, Leitor } from '@sgh/nucleo';

/** Marca de todo registro sintético (procurável e removível; nunca coincide com cadastro real). */
export const MARCA_SINTETICA = 'SINTETICO SGH M04';

type Consulta = Pick<Leitor, 'consultar'>;

/** CPF válido a partir de uma base de 9 dígitos. */
export function cpfComDigitos(base9: string): string {
  if (!/^\d{9}$/.test(base9)) throw new Error('Base do CPF com 9 dígitos.');
  const dv = (b: string) => {
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[i]) * (b.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  const cpf = `${base9}${d1}${dv(`${base9}${d1}`)}`;
  if (!cpfValido(cpf)) throw new Error('CPF sintético inválido.');
  return cpf;
}

/**
 * CPF com dígitos válidos na faixa 9xxxxxxxx que não existe em pessoa_fisica nem em usuario (procura a partir da
 * semente). Não há faixa de CPF garantidamente não emitida: o número pode pertencer a alguém fora do banco. Por
 * isso ele fica só em memória e só em massa marcada como sintética, nunca em log ou arquivo.
 */
export async function cpfLivre(l: Consulta, semente: number): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const base = String(900_000_000 + ((semente + i * 7919) % 99_999_999)).padStart(9, '0');
    const cpf = cpfComDigitos(base);
    if (/^(\d)\1{10}$/.test(cpf)) continue;
    const r = await l.consultar(
      `SELECT 1 AS achou FROM pessoa_fisica WHERE cpf = ?
       UNION ALL SELECT 1 FROM usuario WHERE cpf = ? LIMIT 1`,
      [cpf, cpf],
      { teto: 1 },
    );
    if (r.length === 0) return cpf;
  }
  throw new Error('Nenhum CPF sintético livre.');
}

/** Filtro de um CEP "completo" no catálogo próprio (logradouro, bairro, espécie, município e UF). */
const CEP_COMPLETO = `c.ativo = TRUE AND c.tipo_cep = 'logradouro' AND c.logradouro IS NOT NULL AND c.logradouro <> ''
  AND c.bairro_id IS NOT NULL AND c.especie_logradouro_id IS NOT NULL`;

/** CEP do catálogo de CEPs que completa o endereço (logradouro, bairro, espécie, município IBGE e UF). */
export async function cepCompleto(l: Consulta): Promise<string> {
  const [r] = await l.consultar<{ codigo_cep: string }>(
    `SELECT c.codigo_cep FROM logradouro_cep c WHERE ${CEP_COMPLETO} AND c.codigo_cep >= '10000000'
      ORDER BY c.codigo_cep LIMIT 1`,
    [],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  const cep = String(r?.codigo_cep ?? '');
  if (!/^\d{8}$/.test(cep)) throw new Error('Nenhum CEP completo no catálogo de CEPs.');
  return cep;
}

/** Nome acentuado do corpus de acentuação (grava e relê sem caractere de substituição). */
export const NOME_ACENTUADO = `PACIENTE ${MARCA_SINTETICA} ÁÉÍÓÚ ÂÊÔ ÃÕ ÇÜ`;

export function pacienteSintetico(
  cenario: 'com-cep' | 'minimo' | 'com-responsavel',
  cpf: string,
  cep: string,
): CadastrarPacienteEntrada {
  const base = {
    nome: NOME_ACENTUADO,
    nascimento: '2000-01-01',
    sexo: 'F' as const,
    cpf,
    naturalidade: 'CIDADE SINTETICA',
    cep,
  };
  if (cenario === 'minimo') return base;
  // Mãe e responsável/contato.
  if (cenario === 'com-responsavel')
    return {
      ...base,
      nomeMae: `MAE ${MARCA_SINTETICA}`,
      contatoNome: `CONTATO ${MARCA_SINTETICA}`,
      contatoTelefone: '21900000001',
    };
  return {
    ...base,
    nomeMae: `MAE ${MARCA_SINTETICA}`,
    ufNaturalidade: 'RJ',
    numero: 100,
    complemento: 'SALA 1',
    celular: '21900000000',
    email: 'paciente.sintetico.m04@exemplo.invalid',
  };
}

/** Login técnico sintético que não existe em usuario (comparação exata). */
export async function loginLivre(l: Consulta, semente: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const nome = `sgh.m04.${(semente + i).toString(36)}`.slice(0, 31);
    if (!(await loginExiste(l, nome))) return nome;
  }
  throw new Error('Nenhum login sintético livre.');
}

/** O login (comparação exata) já existe em usuario? (inclui o excluído: o login é único na tabela inteira). */
export async function loginExiste(l: Consulta, nome: string): Promise<boolean> {
  const r = await l.consultar('SELECT id FROM usuario WHERE login = ? LIMIT 1', [nome], { teto: 1 });
  return r.length > 0;
}

export function usuarioSintetico(
  cenario: 'usuario-tecnico' | 'variante-nomec',
  nome: string,
): CriarUsuarioIntegracaoEntrada {
  return {
    nome,
    nomeCompleto:
      cenario === 'usuario-tecnico'
        ? `USUARIO TECNICO ${MARCA_SINTETICA}`
        : `INTEGRACAO ${MARCA_SINTETICA} VARIANTE`,
  };
}

// ── Trilha ─────────────────────────────────────────────────────────────────────────────────────────

/** Estação sintética da trilha (nunca uma máquina real). */
export const ESTACAO_SINTETICA = 'SGH-TESTE:sintetico';

async function idDoUsuario(e: Consulta, login: string): Promise<number> {
  const [u] = await e.consultar<{ id: number }>(
    'SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL',
    [login],
    { teto: 1 },
  );
  if (!u) throw new Error('Usuário sintético não encontrado.');
  return Number(u.id);
}

async function idPorCodigo(
  e: Consulta,
  tabela: 'papel_seguranca' | 'perfil_acesso',
  codigo: string,
  estabelecimento?: number,
) {
  // O perfil de acesso é único por (estabelecimento ou rede, código): só vale o do próprio estabelecimento ou o da
  // rede, com preferência pelo do estabelecimento. Nunca o de outro estabelecimento.
  const [r] =
    tabela === 'papel_seguranca'
      ? await e.consultar<{ id: number }>(
          'SELECT id FROM papel_seguranca WHERE codigo = ? AND ativo = TRUE AND excluido_em IS NULL',
          [codigo],
          { teto: 1 },
        )
      : await e.consultar<{ id: number }>(
          `SELECT id FROM perfil_acesso
            WHERE codigo = ? AND ativo = TRUE AND excluido_em IS NULL
              AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
            ORDER BY estabelecimento_id IS NULL, id`,
          [codigo, estabelecimento ?? null],
          { teto: 2 },
        );
  if (!r) throw new Error(`Código inexistente em ${tabela}.`);
  return Number(r.id);
}

/**
 * Papel de segurança ativo para o usuário sintético (usuario_papel_seguranca, vigente desde hoje), pelo código do
 * papel. Massa de teste: a concessão de negócio é operação do módulo de acesso.
 */
export async function papelSintetico(e: Escritor, login: string, codigoPapel: string): Promise<void> {
  const usuario = await idDoUsuario(e, login);
  const papel = await idPorCodigo(e, 'papel_seguranca', codigoPapel);
  const n = await e.executar(
    `INSERT INTO usuario_papel_seguranca (usuario_id, papel_seguranca_id, vigencia_inicio, criado_em)
     VALUES (?, ?, CURRENT_DATE, NOW(3))`,
    [usuario, papel],
  );
  if (n !== 1) throw new Error('Papel sintético não incluído.');
}

/**
 * Um atendimento existente do estabelecimento (só o identificador, para o vínculo que a trilha exige); nenhum dado
 * do atendimento é lido.
 */
export async function atendimentoExistente(l: Consulta, estabelecimento: number): Promise<number> {
  const [r] = await l.consultar<{ id: number }>(
    'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1',
    [estabelecimento],
    { teto: 1 },
  );
  const id = Number(r?.id ?? NaN);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Nenhum atendimento no estabelecimento.');
  return id;
}

// ── Concessões e escopos de usuários sintéticos ───────────────────────────────────────────────────

/**
 * Põe o usuário sintético num perfil de acesso (usuario_perfil) no estabelecimento, vigente desde hoje: as ações
 * do perfil passam a valer para ele. Massa de teste: a concessão de negócio é operação do módulo de acesso.
 */
export async function perfilSintetico(
  e: Escritor,
  login: string,
  codigoPerfil: string,
  estabelecimento: number,
): Promise<void> {
  const usuario = await idDoUsuario(e, login);
  const perfil = await idPorCodigo(e, 'perfil_acesso', codigoPerfil, estabelecimento);
  const n = await e.executar(
    `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
     VALUES (?, ?, ?, CURRENT_DATE, NOW(3))`,
    [usuario, perfil, estabelecimento],
  );
  if (n !== 1) throw new Error('Perfil sintético não incluído.');
}

/** Vínculo do usuário sintético a um estabelecimento (usuario_estabelecimento), vigente desde hoje. */
export async function estabelecimentoSintetico(
  e: Escritor,
  login: string,
  estabelecimento: number,
): Promise<void> {
  const usuario = await idDoUsuario(e, login);
  const n = await e.executar(
    `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em)
     VALUES (?, ?, CURRENT_DATE, NOW(3))`,
    [usuario, estabelecimento],
  );
  if (n !== 1) throw new Error('Estabelecimento sintético não incluído.');
}

/** Estabelecimentos ativos do cliente (dado da rede inteira: é a lista de onde o teste escolhe; não é pessoa). */
export async function estabelecimentosAtivos(l: Consulta, n = 3): Promise<number[]> {
  const limite = Math.max(1, Math.min(Math.trunc(n), 20));
  const linhas = await l.consultar<{ id: number }>(
    'SELECT id FROM estabelecimento WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY id LIMIT ?',
    [limite],
    { teto: 20 },
  );
  return linhas.map((x) => Number(x.id));
}

// ── Alteração do cadastro ─────────────────────────────────────────────────────────────────────────

/** CEP de 8 dígitos que NÃO existe no catálogo de CEPs (recusa cep-inexistente). */
export async function cepInexistente(l: Consulta): Promise<string> {
  for (let n = 99_999_999; n > 99_000_000; n -= 7) {
    const cep = String(n);
    const r = await l.consultar('SELECT id FROM logradouro_cep WHERE codigo_cep = ? LIMIT 1', [cep], {
      teto: 1,
    });
    if (r.length === 0) return cep;
  }
  throw new Error('Nenhum CEP inexistente.');
}

/**
 * Outro CEP completo, para a troca de endereço: outra UF (logo outro município), outro logradouro, outro bairro e
 * outra espécie de logradouro, para que a troca mude todas as partes do endereço.
 */
export async function outroCepCompleto(l: Consulta, atual: string): Promise<string> {
  const [r] = await l.consultar<{ codigo_cep: string }>(
    `SELECT c.codigo_cep FROM logradouro_cep c JOIN logradouro_cep a ON a.codigo_cep = ?
      WHERE ${CEP_COMPLETO} AND c.codigo_cep >= '10000000' AND c.codigo_cep <> a.codigo_cep
        AND c.unidade_federativa_id <> a.unidade_federativa_id AND c.logradouro <> a.logradouro
        AND c.bairro_id <> a.bairro_id AND c.especie_logradouro_id <> a.especie_logradouro_id
      ORDER BY c.codigo_cep LIMIT 1`,
    [atual],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!r) throw new Error('Nenhum outro CEP completo.');
  return String(r.codigo_cep);
}
