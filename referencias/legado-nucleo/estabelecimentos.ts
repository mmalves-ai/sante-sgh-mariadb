// Estabelecimentos da Rede (ARQ-1, seção 4.4) e rede padrão de localhost (ARQ-2).
// A lista vem de ESTABELECIMENTOS e das chaves FB_<COD>_* do .env.sante: nenhum código fixo no código.
// O vínculo com TBHOSPIT, TBUNIDAD e TBEMPHOS de cada banco é lido no M02, com o pool.
import type { Ambiente } from './arquivo-ambiente.js';

/** Código curto e imutável: chave interna do estabelecimento (o nome é só exibição). */
export const FORMATO_CODIGO = /^[a-z][a-z0-9]{1,9}$/;
/** Código da rede: minúsculas, dígitos e hífen (vira subdomínio no M05). */
export const FORMATO_REDE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const CAMPOS_FB = ['HOST', 'PORTA', 'BANCO', 'USUARIO', 'SENHA', 'NOME'] as const;
export type CampoFb = (typeof CAMPOS_FB)[number];

export interface Estabelecimento {
  readonly codigo: string;
  readonly nome: string;
  readonly host: string;
  readonly porta: number;
  readonly banco: string;
  readonly usuario: string;
  /** Não enumerável: fica fora de JSON.stringify, de log e de comparação de objetos. */
  readonly senha: string;
}

export class ErroConfiguracaoEstabelecimentos extends Error {
  override readonly name = 'ErroConfiguracaoEstabelecimentos';
}

export function chaveFb(codigo: string, campo: CampoFb): string {
  return `FB_${codigo.toUpperCase()}_${campo}`;
}

/** Códigos de ESTABELECIMENTOS, na ordem dada. Ausente ou vazio: lista vazia (nenhum banco configurado). */
export function lerCodigos(env: Ambiente): string[] {
  const bruto = env['ESTABELECIMENTOS']?.trim() ?? '';
  if (bruto === '') return [];
  const codigos = bruto.split(',').map((c) => c.trim());
  const vistos = new Set<string>();
  for (const c of codigos) {
    if (!FORMATO_CODIGO.test(c)) {
      throw new ErroConfiguracaoEstabelecimentos(
        `ESTABELECIMENTOS: código inválido "${c}" (use de 2 a 10 letras minúsculas e dígitos, começando por letra).`,
      );
    }
    if (vistos.has(c))
      throw new ErroConfiguracaoEstabelecimentos(`ESTABELECIMENTOS: código repetido "${c}".`);
    vistos.add(c);
  }
  return codigos;
}

/** Lê os estabelecimentos. As mensagens de erro citam só nomes de chave, nunca valores. */
export function lerEstabelecimentos(env: Ambiente): Estabelecimento[] {
  return lerCodigos(env).map((codigo) => {
    const valor = (campo: CampoFb): string => env[chaveFb(codigo, campo)]?.trim() ?? '';
    const faltam = CAMPOS_FB.filter((c) => c !== 'SENHA' && valor(c) === '').map((c) => chaveFb(codigo, c));
    if (faltam.length > 0) {
      throw new ErroConfiguracaoEstabelecimentos(
        `Estabelecimento "${codigo}": faltam ${faltam.join(', ')} no arquivo de ambiente.`,
      );
    }
    const porta = Number(valor('PORTA'));
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
      throw new ErroConfiguracaoEstabelecimentos(`${chaveFb(codigo, 'PORTA')}: porta inválida.`);
    }
    const est = {
      codigo,
      nome: valor('NOME'),
      host: valor('HOST'),
      porta,
      banco: valor('BANCO'),
      usuario: valor('USUARIO'),
    };
    Object.defineProperty(est, 'senha', { value: env[chaveFb(codigo, 'SENHA')] ?? '', enumerable: false });
    return Object.freeze(est) as Estabelecimento;
  });
}

/**
 * M59-F1 (regra 4; D-PAPEL-59): a conta de cada módulo no banco do estabelecimento, quando a TI já aplicou os papéis
 * por módulo e pôs a conta no arquivo de ambiente: `FB_<COD>_MOD_<MODULO>_USUARIO` e `FB_<COD>_MOD_<MODULO>_SENHA` (como
 * `FB_<COD>_SCRIPTS_USUARIO`; o sufixo é o do papel, `SGH_MOD_<MODULO>`). Módulo sem conta usa a conta única do estabelecimento. Mensagens só com nomes de
 * chave; a senha fica não enumerável, como na conta única.
 */
export interface ContaModulo {
  /** Sufixo do módulo no banco (`ACESSO`, `FATURAMENTO_TISS`). */
  readonly sufixo: string;
  readonly usuario: string;
  readonly senha: string;
}

export function lerContasDeModulo(codigo: string, env: Ambiente): ContaModulo[] {
  const prefixo = `FB_${codigo.toUpperCase()}_MOD_`;
  const contas: ContaModulo[] = [];
  for (const chave of Object.keys(env).sort()) {
    if (!chave.startsWith(prefixo) || !chave.endsWith('_USUARIO')) continue;
    const sufixo = chave.slice(prefixo.length, -'_USUARIO'.length);
    if (!/^[A-Z][A-Z0-9_]{0,54}$/.test(sufixo)) {
      throw new ErroConfiguracaoEstabelecimentos(`${chave}: sufixo de módulo inválido.`);
    }
    const usuario = env[chave]?.trim() ?? '';
    if (usuario === '') continue;
    if (usuario.toUpperCase() === 'SYSDBA') {
      throw new ErroConfiguracaoEstabelecimentos(
        `${chave}: o administrador do servidor é recusado (regra 4).`,
      );
    }
    const conta = { sufixo, usuario };
    Object.defineProperty(conta, 'senha', {
      value: env[`${prefixo}${sufixo}_SENHA`] ?? '',
      enumerable: false,
    });
    contas.push(Object.freeze(conta) as ContaModulo);
  }
  return contas;
}

/** Rede padrão de localhost (ARQ-2). Ausente: null (o M05 resolve a rede pelo endereço de acesso). */
export function lerRedePadrao(env: Ambiente): string | null {
  const rede = env['REDE_PADRAO']?.trim() ?? '';
  if (rede === '') return null;
  if (!FORMATO_REDE.test(rede)) {
    throw new ErroConfiguracaoEstabelecimentos(
      'REDE_PADRAO: use letras minúsculas, dígitos e hífen (até 63 caracteres).',
    );
  }
  return rede;
}

export function buscarEstabelecimento(lista: readonly Estabelecimento[], codigo: string): Estabelecimento {
  const est = lista.find((e) => e.codigo === codigo);
  if (!est) {
    const conhecidos = lista.map((e) => e.codigo).join(', ') || 'nenhum';
    throw new ErroConfiguracaoEstabelecimentos(
      `Estabelecimento "${codigo}" não está em ESTABELECIMENTOS (configurados: ${conhecidos}).`,
    );
  }
  return est;
}
