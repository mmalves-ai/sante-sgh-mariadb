// Regra 10 do M10 (cap-08 §8.11, §8.15): segredos e dado pessoal do cadastro de usuários, do hospital e do servidor
// de e-mail nunca saem pela API: a senha, o sal e o código de verificação do usuário, as senhas secundárias das permissões complementares do usuário, as
// credenciais de estabelecimento e de configuração de e-mail, o CPF, o e-mail e a biometria. Esta é a conferência sobre as RESPOSTAS
// (os controladores do M10 passam por ela, e o E2E @M10 confere os corpos JSON); a guarda estática do SQL é o
// SELECT nomeado dos repositórios (o valor nunca é lido: CASE … THEN 0/1).

/** Colunas proibidas na resposta (forma do banco; a conferência também pega o camelCase). */
export const COLUNAS_SEGREDO_M10: readonly string[] = [
  'SENHA',
  'SALT',
  'CODIGO_VERIFICACAO',
  'SENHA_SEC',
  'SENHAPROV',
  'USERPROV',
  'SENHA_PROXY',
  'USUARIO_PROXY',
  'SENHA_AUTENTICACAO',
  'USUARIO_AUTENTICACAO',
  'EMAIL_RECUPERA_SENHA',
  'E_MAIL',
  'CPF',
  'CPF_DIR',
  'CPF_AUT',
  'DIGITAL',
  'FOTO',
  'SENHA_RESERVA',
  'CPF_RESERVA',
  'NOME_RESERVA',
];

const normal = (t: string) => t.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const PROIBIDOS = new Set(COLUNAS_SEGREDO_M10.map(normal));
/** Onze dígitos seguidos (forma de CPF) num texto de resposta. */
const CPF_EM_TEXTO = /(?<!\d)\d{11}(?!\d)/;

export interface AchadoSegredo {
  readonly caminho: string;
  readonly motivo: string;
}

/**
 * Exceção da regra 10 (ficha de usuários, 17/11/2026, pedido do dono): a conta da PLATAFORMA vê o CPF do usuário.
 * O controlador confere o resto da ficha com `segredosNaResposta` e só depois acrescenta este campo, com o valor
 * conferido aqui (11 dígitos ou null); nenhum outro caminho de resposta aceita o CPF.
 */
export function cpfDaPlataforma(valor: string | null): string | null {
  if (valor === null) return null;
  if (!/^\d{11}$/.test(valor)) throw new Error('CPF da plataforma fora da forma de 11 dígitos');
  return valor;
}

/** Procura chave proibida (`senha`, `cpf`, `SALT`…) ou texto em forma de CPF no corpo JSON de uma resposta. */
export function segredosNaResposta(corpo: unknown, caminho = '$'): AchadoSegredo[] {
  const achados: AchadoSegredo[] = [];
  if (Array.isArray(corpo))
    corpo.forEach((v, i) => achados.push(...segredosNaResposta(v, `${caminho}[${i}]`)));
  else if (corpo && typeof corpo === 'object') {
    for (const [k, v] of Object.entries(corpo)) {
      if (PROIBIDOS.has(normal(k)))
        achados.push({ caminho: `${caminho}.${k}`, motivo: `chave proibida ${k}` });
      achados.push(...segredosNaResposta(v, `${caminho}.${k}`));
    }
  } else if (typeof corpo === 'string') {
    if (PROIBIDOS.has(normal(corpo)) && /^[A-Z_]+$/.test(corpo))
      achados.push({ caminho, motivo: `coluna proibida citada: ${corpo}` });
    if (CPF_EM_TEXTO.test(corpo)) achados.push({ caminho, motivo: 'texto em forma de CPF' });
  }
  return achados;
}
