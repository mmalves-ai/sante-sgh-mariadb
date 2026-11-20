// Regra 8 do M12 (e do M09): credencial de prestador, de portal e de webservice nunca sai pela API. Esta é a
// conferência sobre as RESPOSTAS (o E2E @M12 passa a ela os corpos JSON de /api/cadastros/convenios*,
// /api/faturamento* e /api/precos*); a guarda estática do SQL fica em tools/verificadores
// (colunas-proibidas.ts), que confere que as duas listas são a mesma.

/** Colunas de credencial (TBTISS, TBTISSWEBSERV, TBCONVEN e TBCODATI), só os nomes das colunas. */
export const COLUNAS_CREDENCIAL: readonly string[] = [
  'SENHA_CERTIFICADO_DIG_WS_TISS',
  'CERTIFICADO_DIG_WS_TISS',
  'SENHA_PRESTADOR',
  'LOGIN_PRESTADOR',
  'SENHA',
  'CPF_RESPONSAVEL_CONVENIO',
  // M26 (regra 10): os segredos dos parâmetros do diagnóstico e as senhas dos portais antigos.
  'SENHAGERENCIAL',
  'SENHAALTRES',
  'TOKEN',
  'HEADER_WS',
  'SENHA_WEB_PACIENTE',
  // M34 (seção 5): as credenciais das interfaces de equipamento, do estabelecimento e dos bancos externos.
  'SENHA_EXPORTACAO',
  'USUARIO_FTP',
  'SENHA_FTP',
  'SENHAPROV',
  'USUARIO_PROXY',
  'SENHA_PROXY',
  'AXREG_INSTITUTION_KEY',
  'D4H_API_KEY',
  'SENHA_ASSINATURA',
];

const normal = (t: string) => t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const PROIBIDOS = new Set(COLUNAS_CREDENCIAL.map(normal));

export interface AchadoCredencial {
  readonly caminho: string;
  readonly motivo: string;
}

/**
 * Procura, no corpo JSON de uma resposta, chave ou valor de texto que seja uma coluna de credencial (na forma
 * do banco ou em camelCase: `SENHA_PRESTADOR`, `senhaPrestador`, `login_prestador`). Campo cujo nome só
 * CONTÉM a palavra (ex.: `senhaObrigatoria`, a regra de autorização do convênio) não é credencial.
 */
export function credenciaisNaResposta(corpo: unknown, caminho = '$'): AchadoCredencial[] {
  const achados: AchadoCredencial[] = [];
  if (Array.isArray(corpo)) {
    corpo.forEach((v, i) => achados.push(...credenciaisNaResposta(v, `${caminho}[${i}]`)));
  } else if (corpo && typeof corpo === 'object') {
    for (const [k, v] of Object.entries(corpo)) {
      if (PROIBIDOS.has(normal(k)))
        achados.push({ caminho: `${caminho}.${k}`, motivo: `chave de credencial ${k}` });
      achados.push(...credenciaisNaResposta(v, `${caminho}.${k}`));
    }
  } else if (typeof corpo === 'string' && PROIBIDOS.has(normal(corpo))) {
    achados.push({ caminho, motivo: `coluna de credencial citada: ${corpo}` });
  }
  return achados;
}
