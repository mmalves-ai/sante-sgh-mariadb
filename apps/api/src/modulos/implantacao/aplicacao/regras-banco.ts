// M60, etapa 2: as regras da conferência que dependem do motor do banco do cliente (MariaDB), puras e testadas. Elas
// trocam, na saída das regras gerais (@sgh/dominio-config), os itens que lá ainda falam do motor antigo: versão do
// motor, autenticação, canal cifrado, codificação do texto e conta própria. O resto (papel, scripts, versão) segue as
// regras gerais. Pedido do lote 02-08: levar estas regras para o @sgh/dominio-config e aposentar as antigas.
// Melhoria: motores homologados pelo produto (MariaDB 11 e 12), autenticação moderna (ed25519, parsec, caching_sha2),
// texto só em utf8mb4 no banco e na conexão, conta root recusada em produção.
import type { ItemConferencia, SituacaoItemConferencia } from '@sgh/contratos';
import type { ConexaoBanco, MigracaoRegistrada } from '../porta.js';

/** Versões maiores do MariaDB homologadas para o produto. */
export const MARIADB_HOMOLOGADAS: readonly number[] = [11, 12];
/** Métodos de autenticação aceitos na conta da aplicação. */
export const AUTENTICACOES_MODERNAS: readonly string[] = ['ed25519', 'parsec', 'caching_sha2_password'];
/** Contas administrativas que a aplicação nunca usa. */
export const CONTAS_ADMINISTRATIVAS: readonly string[] = ['root', 'mariadb.sys', 'mysql'];
export const CHARSET_TEXTO = 'utf8mb4';

const grave = (ambiente: string): SituacaoItemConferencia => (ambiente === 'producao' ? 'falha' : 'alerta');
const item = (
  codigo: ItemConferencia['codigo'],
  titulo: string,
  situacao: SituacaoItemConferencia,
  detalhe: string,
): ItemConferencia => ({ codigo, titulo, situacao, detalhe });

/** "12.3.1-MariaDB-log" → 12; nulo fora do formato. */
export function versaoMaiorDoMotor(versao: string): number | null {
  const m = /^(\d+)\.\d+/.exec(versao.trim());
  return m ? Number(m[1]) : null;
}

export function itemMotor(c: ConexaoBanco): ItemConferencia {
  const titulo = 'Versão do motor do banco';
  const maior = versaoMaiorDoMotor(c.versaoMotor);
  if (maior === null) return item('motor', titulo, 'falha', 'A versão do motor não foi reconhecida.');
  const nome = c.versaoMotor.split('-')[0];
  return MARIADB_HOMOLOGADAS.includes(maior)
    ? item('motor', titulo, 'ok', `MariaDB ${nome}.`)
    : item('motor', titulo, 'alerta', `MariaDB ${nome}: versão não homologada para o produto.`);
}

export function itemAutenticacao(c: ConexaoBanco, ambiente: string): ItemConferencia {
  const titulo = 'Autenticação da conexão';
  const a = c.autenticacao;
  if (a !== null && AUTENTICACOES_MODERNAS.includes(a))
    return item('autenticacao', titulo, 'ok', `Autenticação ${a}.`);
  if (a === null)
    return item(
      'autenticacao',
      titulo,
      grave(ambiente),
      'O banco não informou o método de autenticação da conta da aplicação.',
    );
  return item(
    'autenticacao',
    titulo,
    grave(ambiente),
    `Autenticação ${a}: crie a conta da aplicação com ${AUTENTICACOES_MODERNAS.join(' ou ')}.`,
  );
}

export function itemCanal(c: ConexaoBanco, ambiente: string): ItemConferencia {
  const titulo = 'Canal cifrado entre o servidor e o banco';
  if (c.canalCifrado === true)
    return item('canal-cifrado', titulo, 'ok', 'O canal com o banco está cifrado (TLS).');
  return item(
    'canal-cifrado',
    titulo,
    grave(ambiente),
    c.canalCifrado === null
      ? 'O banco não informou se o canal está cifrado.'
      : 'O canal com o banco não está cifrado: exija TLS na conta da aplicação (REQUIRE SSL) e no cliente.',
  );
}

export function itemCharset(c: ConexaoBanco): ItemConferencia {
  const titulo = 'Codificação do texto';
  const banco = c.charsetBanco.trim().toLowerCase();
  const conexao = (c.charsetConexao ?? '').trim().toLowerCase();
  if (banco === CHARSET_TEXTO && conexao === CHARSET_TEXTO)
    return item('charset', titulo, 'ok', `Banco e conexão em ${CHARSET_TEXTO}.`);
  return item(
    'charset',
    titulo,
    'falha',
    `Banco em ${c.charsetBanco || '—'} e conexão em ${c.charsetConexao ?? '—'}: o produto grava texto só em ${CHARSET_TEXTO}.`,
  );
}

export function itemConta(c: ConexaoBanco, ambiente: string): ItemConferencia {
  const titulo = 'Conta própria da aplicação';
  if (!CONTAS_ADMINISTRATIVAS.includes(c.conta.trim().toLowerCase()))
    return item('conta-propria', titulo, 'ok', `Conta técnica ${c.conta}.`);
  return item(
    'conta-propria',
    titulo,
    grave(ambiente),
    `A aplicação está conectada com a conta administrativa ${c.conta}: crie a conta própria da aplicação e configure-a no arquivo de ambiente.`,
  );
}

/** O item das migrações quando o banco do cliente ainda não as registra (pedido de modelo). */
export function itemSemRegistroDeMigracoes(noPacote: number): ItemConferencia {
  return item(
    'scripts',
    'Objetos do produto no banco',
    'alerta',
    `O banco do cliente ainda não registra as migrações aplicadas: não há como conferir as ${noPacote} do pacote.`,
  );
}

/** Troca, nos itens das regras gerais, os que dependem do motor do banco. */
export function itensDoMotor(
  itens: readonly ItemConferencia[],
  c: ConexaoBanco,
  ambiente: string,
  registradas: readonly MigracaoRegistrada[] | null | 'sem-registro',
  noPacote: number,
): ItemConferencia[] {
  const proprios: Partial<Record<ItemConferencia['codigo'], ItemConferencia>> = {
    motor: itemMotor(c),
    autenticacao: itemAutenticacao(c, ambiente),
    'canal-cifrado': itemCanal(c, ambiente),
    charset: itemCharset(c),
    'conta-propria': itemConta(c, ambiente),
    ...(registradas === 'sem-registro' ? { scripts: itemSemRegistroDeMigracoes(noPacote) } : {}),
  };
  return itens.map((i) => proprios[i.codigo] ?? i);
}
