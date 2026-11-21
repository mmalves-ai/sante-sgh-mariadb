// Estabelecimentos da fonte SINTÉTICA (dev/ci e testes; F2-L): códigos de ESTABELECIMENTOS e nome de exibição em
// ESTABELECIMENTO_<COD>_NOME (ausente: "Estabelecimento <cod>"). Nada de conexão: a fonte sintética não abre banco.
// Com a fonte própria, os estabelecimentos vêm do banco do cliente.
import type { Ambiente } from '@sgh/nucleo';

/** Código curto e imutável do estabelecimento: de 2 a 10 letras minúsculas e dígitos, começando por letra. */
export const FORMATO_CODIGO_ESTABELECIMENTO = /^[a-z][a-z0-9]{1,9}$/;

export interface EstabelecimentoSintetico {
  readonly codigo: string;
  readonly nome: string;
}

/** Lê os estabelecimentos sintéticos; código inválido ou repetido recusa (a mensagem cita só a chave). */
export function lerEstabelecimentosSinteticos(env: Ambiente): EstabelecimentoSintetico[] {
  const bruto = env['ESTABELECIMENTOS']?.trim() ?? '';
  if (bruto === '') return [];
  const vistos = new Set<string>();
  return bruto.split(',').map((c) => {
    const codigo = c.trim();
    if (!FORMATO_CODIGO_ESTABELECIMENTO.test(codigo))
      throw new Error(
        'ESTABELECIMENTOS: código inválido (use de 2 a 10 letras minúsculas e dígitos, começando por letra).',
      );
    if (vistos.has(codigo)) throw new Error('ESTABELECIMENTOS: código repetido.');
    vistos.add(codigo);
    const nome = env[`ESTABELECIMENTO_${codigo.toUpperCase()}_NOME`]?.trim() || `Estabelecimento ${codigo}`;
    return { codigo, nome };
  });
}
