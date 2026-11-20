// Massa sintética das operações do M04 (nunca dado pessoal real): nomes marcados "SINTETICO SGH M04", CPF
// válido gerado (conferido livre na cópia, dentro da transação), CEP real do cadastro público de CEPs
// (TBCEP: logradouro, não pessoa), telefones e e-mail fictícios (domínio .invalid). Os valores ficam em
// memória do teste; nada é impresso nem gravado em arquivo. Tudo roda em transação desfeita.
import type { CadastrarPacienteEntrada, CriarUsuarioIntegracaoEntrada } from '@sgh/contratos';
import { cpfValido } from '@sgh/contratos';
import type { Escritor, Leitor } from '@sgh/legado';

/** Marca de todo registro sintético (procurável e removível; nunca coincide com cadastro real). */
export const MARCA_SINTETICA = 'SINTETICO SGH M04';

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
 * CPF com dígitos válidos na faixa 9xxxxxxxx que não existe em RICADPAC (procura a partir da semente). Não há
 * faixa de CPF garantidamente não emitida: o número pode pertencer a alguém fora do cadastro. Por isso ele
 * fica só em memória, só em transação desfeita (ou com marca sintética e desfeito), e nunca em log ou arquivo.
 */
export async function cpfLivre(l: Leitor, semente: number): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const base = String(900_000_000 + ((semente + i * 7919) % 99_999_999)).padStart(9, '0');
    const cpf = cpfComDigitos(base);
    if (/^(\d)\1{10}$/.test(cpf)) continue;
    const r = await l.consultar('SELECT FIRST 1 ID FROM RICADPAC WHERE CPF = ?', [Number(cpf)], { teto: 1 });
    if (r.length === 0) return cpf;
  }
  throw new Error('Nenhum CPF sintético livre.');
}

/** CEP do cadastro de CEPs que completa o endereço (logradouro, bairro, cidade, UF e município IBGE). */
export async function cepCompleto(l: Leitor, tiposVistos: ReadonlySet<string>): Promise<string> {
  const linhas = await l.consultar(
    `SELECT FIRST 200 CAST(c.CEP AS VARCHAR(8)) CEP, c.TPLGR FROM TBCEP c
      WHERE c.CEP >= 10000000 AND c.LOGRA <> '' AND c.BAIRRO <> '' AND c.CIDADE <> '' AND c.UF <> ''
        AND c.ID_TBMUIBGE IS NOT NULL AND CHAR_LENGTH(c.CIDADE) <= 30 AND CHAR_LENGTH(c.BAIRRO) <= 30
        AND c.TPLGR > 0
      ORDER BY c.CEP`,
    [],
    { teto: 200, tempoMaximoMs: 120_000 },
  );
  // Tipo de logradouro já visto no cadastro (99% dos pacientes têm TPLGR): o codec recusa valor nunca visto.
  const r = linhas.find((x) => x['TPLGR'] !== null && tiposVistos.has(String(x['TPLGR'])));
  const cep = String(r?.['CEP'] ?? '').padStart(8, '0');
  if (!/^\d{8}$/.test(cep)) throw new Error('Nenhum CEP completo no cadastro de CEPs.');
  return cep;
}

/** Nome acentuado do corpus CP1252 do M02 (grava e relê sem caractere de substituição). */
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
  // M11: mãe e responsável/contato (o trigger retrata o telefone do contato, tipo 5).
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

/** Login técnico sintético que não existe em TBUSERS (comparação exata). */
export async function loginLivre(l: Leitor, semente: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const nome = `sgh.m04.${(semente + i).toString(36)}`.slice(0, 31);
    const r = await l.consultar('SELECT FIRST 1 ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [nome], { teto: 1 });
    if (r.length === 0) return nome;
  }
  throw new Error('Nenhum login sintético livre.');
}

/** W0-10: o login (comparação exata) já existe em TBUSERS? (o usuário fixo do portal, reaproveitado na cópia). */
export async function loginExiste(l: Leitor, nome: string): Promise<boolean> {
  const r = await l.consultar('SELECT FIRST 1 ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [nome], { teto: 1 });
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

// ── M06: trilha do legado ─────────────────────────────────────────────────────────────────────────

/** Estação sintética da trilha ("MÁQUINA:conta", como o Delphi grava; nunca uma máquina real). */
export const ESTACAO_SINTETICA = 'SGH-TESTE:sintetico';

/**
 * Papel "Operador de sistema" (TBPAPEL.ID 4) ativo para o usuário sintético, em TBUSERS_TBPAPEL, na
 * transação desfeita da reprodução (o Delphi grava o papel logado em todo evento da trilha; não há operação
 * do protocolo para papel antes do M10). O ID vem do TRG_TBUSERS_TBPAPEL_BIU (generator em laço).
 */
export async function papelSintetico(e: Escritor, login: string): Promise<void> {
  const n = await e.executar(
    `INSERT INTO TBUSERS_TBPAPEL (ID, USUARIO, ID_TBPAPEL, ATIVO) VALUES (0, ?, 4, 'T')`,
    [login],
  );
  if (n !== 1) throw new Error('Papel sintético não incluído.');
}

/**
 * Um atendimento existente (ATCABECATEND.ID: a FK de TBCABTRILHA exige) para o evento de consulta de RES.
 * Só o identificador, em memória e na transação desfeita; nenhum dado do atendimento é lido.
 */
export async function atendimentoExistente(l: Leitor): Promise<number> {
  const [r] = await l.consultar(
    'SELECT FIRST 1 CAST(ID AS VARCHAR(20)) ID FROM ATCABECATEND ORDER BY ID DESC',
    [],
    {
      teto: 1,
    },
  );
  const id = Number(r?.['ID'] ?? NaN);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Nenhum atendimento na cópia.');
  return id;
}

// ── M06: concessões e escopos de usuários sintéticos (transação desfeita) ───────────────────────────

/**
 * Põe o usuário sintético (criado pelo executor, sem grupo) num grupo do legado, na transação desfeita: as
 * permissões do grupo (TBPERUSU) passam a valer para ele (a gravação real de TBUSERS.GRUPO é operação do
 * protocolo do M10).
 */
export async function grupoSintetico(e: Escritor, login: string, grupo: string): Promise<void> {
  const n = await e.executar('UPDATE TBUSERS SET GRUPO = ? WHERE NOME = ?', [grupo, login]);
  if (n !== 1) throw new Error('Usuário sintético não encontrado para o grupo.');
}

/** Vínculo do usuário sintético a uma unidade (TBUNIUSE), na transação desfeita (escopo do M06). */
export async function unidadeSintetica(e: Escritor, login: string, unidade: number): Promise<void> {
  const n = await e.executar('INSERT INTO TBUNIUSE (UNID, USUARIO) VALUES (?, ?)', [unidade, login]);
  if (n !== 1) throw new Error('Unidade sintética não incluída.');
}

/** Unidades ativas do cadastro (TBUNIDAD: metadado da organização, não pessoa). */
export async function unidadesAtivas(l: Leitor, n = 3): Promise<number[]> {
  const linhas = await l.consultar(
    `SELECT FIRST ${Math.max(1, Math.min(n, 20))} COD FROM TBUNIDAD WHERE SITUACAO = 'A' ORDER BY COD`,
    [],
    {
      teto: 20,
    },
  );
  return linhas.map((x) => Number(x['COD']));
}

// ── M11: alteração do cadastro ────────────────────────────────────────────────────────────────────

/** CEP de 8 dígitos que NÃO existe no cadastro de CEPs (recusa cep-inexistente), procurado na transação. */
export async function cepInexistente(l: Leitor): Promise<string> {
  for (let n = 99_999_999; n > 99_000_000; n -= 7) {
    const r = await l.consultar('SELECT FIRST 1 CEP FROM TBCEP WHERE CEP = ?', [n], { teto: 1 });
    if (r.length === 0) return String(n);
  }
  throw new Error('Nenhum CEP inexistente.');
}

/** Outro CEP completo (diferente do dado), para a troca de endereço. */
export async function outroCepCompleto(
  l: Leitor,
  tiposVistos: ReadonlySet<string>,
  atual: string,
): Promise<string> {
  // Outra UF (outra cidade e outro município IBGE), outro logradouro, outro bairro e outro tipo de logradouro:
  // a troca muda todas as colunas do endereço (o novo só grava o que muda).
  const linhas = await l.consultar(
    `SELECT FIRST 400 CAST(c.CEP AS VARCHAR(8)) CEP, c.TPLGR FROM TBCEP c, TBCEP a
      WHERE a.CEP = ? AND c.CEP >= 10000000 AND c.LOGRA <> '' AND c.BAIRRO <> '' AND c.CIDADE <> '' AND c.UF <> ''
        AND c.ID_TBMUIBGE IS NOT NULL AND CHAR_LENGTH(c.CIDADE) <= 30 AND CHAR_LENGTH(c.BAIRRO) <= 30
        AND CHAR_LENGTH(c.LOGRA) <= 40 AND c.TPLGR > 0 AND c.UF <> a.UF AND c.TPLGR <> a.TPLGR
        AND c.LOGRA <> a.LOGRA AND c.BAIRRO <> a.BAIRRO
      ORDER BY c.CEP`,
    [Number(atual)],
    { teto: 400, tempoMaximoMs: 120_000 },
  );
  const r = linhas.find(
    (x) =>
      String(x['CEP']).padStart(8, '0') !== atual &&
      x['TPLGR'] !== null &&
      tiposVistos.has(String(x['TPLGR'])),
  );
  if (!r) throw new Error('Nenhum outro CEP completo.');
  return String(r['CEP']).padStart(8, '0');
}
