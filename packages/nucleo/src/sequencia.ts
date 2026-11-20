// Números de negócio (prontuário, atendimento, conta, guia…) pela sequencia_negocio (ADR 0002): a linha da
// sequência é travada (SELECT ... FOR UPDATE), o valor é lido e o próximo é gravado na mesma transação da
// operação. Desfeita a operação, o número volta. Nunca MAX + 1, nunca o id.
import { ErroOperacao } from './erros.js';
import { type Carimbo, conferirNome } from './gravacao.js';
import type { Escritor } from './transacao.js';

export const FORMATO_TIPO_SEQUENCIA = /^[a-z][a-z0-9_]{0,59}$/;

export interface NumeroNegocio {
  readonly valor: number;
  /** Prefixo + valor (ex.: "AT-1024"). */
  readonly formatado: string;
}

interface LinhaSequencia {
  readonly id: number;
  readonly prefixo: string | null;
  readonly proximo_valor: number | string;
  readonly incremento: number | string;
  readonly valor_maximo: number | string | null;
  readonly ativo: number | boolean;
}

const erroSequencia = (codigo: string, detail: string) =>
  new ErroOperacao(409, codigo, 'Numeração indisponível', detail);

function conferirTipo(tipo: string): string {
  if (!FORMATO_TIPO_SEQUENCIA.test(tipo)) throw new Error('Tipo de sequência inválido.');
  return tipo;
}

/** O próximo número do tipo no estabelecimento (null: sequência do cliente inteiro). */
export async function proximoNumero(
  e: Escritor,
  tipo: string,
  estabelecimento: number | null,
  carimbo: Carimbo,
): Promise<NumeroNegocio> {
  conferirTipo(tipo);
  const [s] = await e.consultarParaAtualizar<LinhaSequencia & Record<string, unknown>>(
    'SELECT id, prefixo, proximo_valor, incremento, valor_maximo, ativo FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id <=> ?',
    [tipo, estabelecimento],
    { teto: 1 },
  );
  if (!s)
    throw erroSequencia(
      'sequencia-nao-configurada',
      `A numeração "${tipo}" não está configurada para este estabelecimento.`,
    );
  if (!Number(s.ativo)) throw erroSequencia('sequencia-inativa', `A numeração "${tipo}" está inativa.`);
  const valor = Number(s.proximo_valor);
  const incremento = Number(s.incremento);
  if (!Number.isSafeInteger(valor) || !Number.isSafeInteger(incremento) || incremento <= 0)
    throw new Error(`Sequência ${tipo} ilegível.`);
  if (s.valor_maximo !== null && valor > Number(s.valor_maximo))
    throw erroSequencia('sequencia-esgotada', `A numeração "${tipo}" chegou ao valor máximo.`);
  await e.executar(
    'UPDATE sequencia_negocio SET proximo_valor = proximo_valor + incremento, alterado_em = ?, alterado_por = ?, versao = versao + 1 WHERE id = ?',
    [carimbo.agora, carimbo.usuario, s.id],
  );
  return { valor, formatado: `${s.prefixo ?? ''}${valor}` };
}

export interface NovaSequencia {
  readonly tipo: string;
  readonly estabelecimento: number | null;
  readonly prefixo?: string | null;
  readonly inicio?: number;
  readonly incremento?: number;
  readonly valorMaximo?: number | null;
}

/** Cria a sequência se ainda não existir (configuração); devolve o id dela. */
export async function garantirSequencia(e: Escritor, s: NovaSequencia, carimbo: Carimbo): Promise<number> {
  conferirTipo(s.tipo);
  conferirNome('sequencia_negocio');
  const [atual] = await e.consultarParaAtualizar<{ id: number }>(
    'SELECT id FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id <=> ?',
    [s.tipo, s.estabelecimento],
    { teto: 1 },
  );
  if (atual) return atual.id;
  return e.inserir(
    'INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, incremento, valor_maximo, ativo, criado_em, criado_por, versao) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, 1)',
    [
      s.estabelecimento,
      s.tipo,
      s.prefixo ?? null,
      s.inicio ?? 1,
      s.incremento ?? 1,
      s.valorMaximo ?? null,
      carimbo.agora,
      carimbo.usuario,
    ],
  );
}
