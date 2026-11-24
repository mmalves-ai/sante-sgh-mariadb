// Glosa aceita do faturamento no título a receber (M32, ficha seções 5 e 10), sobre o banco próprio do cliente: o evento
// `faturamento.glosa.aceita` do item da conta vira uma linha em glosa_titulo_receber (meio "evento", chave do evento) e
// o título a receber da conta passa a carregar o valor aceito. Roda dentro de UMA operação do Executor (acesso.gravar):
// a trilha, a idempotência e o título na mesma transação. A regra do valor (aplicarGlosaAceita) é pura e testada.
// Melhoria: a repetição do evento é reconhecida pela chave única do banco (uq_glosa_titulo_receber_chave_evento), não
//   por uma conferência em memória; o título é relido com trava (FOR UPDATE) e gravado pela versão.
// Melhoria: só o que ainda não foi lançado no título entra (aceito no item − glosas aceitas já registradas para o
//   mesmo item no mesmo título): duas entregas com chaves diferentes não contam a glosa duas vezes, nem em paralelo
//   (trava do título antes de qualquer leitura; somas lidas com FOR UPDATE, que enxerga o último valor gravado).
// Melhoria: o título cancelado ou renegociado, ou de outro estabelecimento, não recebe glosa (fica "sem-titulo").
// Melhoria: a glosa total do título nunca fica abaixo da aceita (ck_titulo_receber_valores), conferido na regra.
import { sincronizarGlosaDoItem } from '@sgh/dominio-repasse';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { portaProducaoConta, TABELAS_PRODUCAO_CONTA } from '@sgh/persistencia';

/** As tabelas que a operação da glosa do evento grava. */
export const TABELAS_GLOSA_EVENTO: readonly string[] = [
  'glosa_titulo_receber',
  'titulo_receber',
  ...TABELAS_PRODUCAO_CONTA,
];
/** Nome da operação na trilha. */
export const OPERACAO_GLOSA_EVENTO = 'financeiro.glosa.aceita-do-evento';

export interface GlosaAceitaDoEvento {
  /** Id do item da conta (conta_hospitalar_item.id). */
  readonly item: number;
  /** Chave do evento da outbox (idempotência do efeito). */
  readonly chaveEvento: string;
}

export interface ResultadoGlosaDoEvento {
  readonly resultado: 'registrada' | 'repetida' | 'sem-titulo' | 'sem-glosa';
  readonly id: number | null;
}

export interface ValoresGlosaTitulo {
  readonly glosa: number;
  readonly glosaAceita: number;
}

const centavos = (n: number): number => Math.round(n * 100);

/** O título depois de receber `valor` de glosa aceita (em reais; conta em centavos). */
export function aplicarGlosaAceita(atual: ValoresGlosaTitulo, valor: number): ValoresGlosaTitulo {
  if (!Number.isFinite(valor) || centavos(valor) <= 0)
    throw new RangeError('A glosa aceita precisa de valor positivo.');
  const aceita = centavos(atual.glosaAceita) + centavos(valor);
  const glosa = Math.max(centavos(atual.glosa), aceita);
  return { glosa: glosa / 100, glosaAceita: aceita / 100 };
}

/** Quanto do aceito no item ainda falta lançar no título (nunca negativo). */
export function valorAindaNaoLancado(aceitoNoItem: number, jaLancado: number): number {
  return Math.max(0, centavos(aceitoNoItem) - centavos(jaLancado)) / 100;
}

const MOTIVO = 'Glosa aceita no faturamento (lançada pelo evento)';

export async function registrarGlosaAceitaDoEvento(
  tx: TxOperacao,
  d: GlosaAceitaDoEvento,
): Promise<ResultadoGlosaDoEvento> {
  const est = Number(tx.contexto.estabelecimento);
  if (!Number.isInteger(est) || est <= 0)
    throw recusa('estabelecimento-desconhecido', 'Gravação sem estabelecimento.');
  const r = await glosaNoTitulo(tx, est, d);
  // A produção do repasse acompanha a glosa do item, na mesma transação, em todo caminho (com ou sem título, entrega
  // repetida): o item passa a guardar a soma das glosas aceitas (glosadoAceitoDoItem, a mesma regra da decisão da
  // TISS) e a sincronização (@sgh/dominio-repasse + @sgh/persistencia) é idempotente.
  const item = await tx.uma<{ conta: unknown }>(
    'SELECT conta_hospitalar_id AS conta FROM conta_hospitalar_item WHERE id = ?',
    [d.item],
  );
  if (!item) return r;
  // O evento do worker não traz usuário: o autor do débito do repasse é quem decidiu a glosa aceita do item (a
  // decisão que o causou). Sem glosa decidida no item não há nada a levar ao repasse; com glosa aceita sem autor
  // (carga antiga), recusa: a operação inteira volta e o evento fica em erro, nunca fora do repasse sem aviso.
  const decisor = await tx.uma<{ usuario: unknown }>(
    `SELECT gi.decidido_por_usuario_id AS usuario FROM glosa_item gi
      WHERE gi.conta_hospitalar_item_id = ? AND gi.decisao <> 'pendente' AND gi.excluido_em IS NULL
      ORDER BY gi.decidido_em DESC, gi.id DESC LIMIT 1`,
    [d.item],
  );
  if (tx.contexto.usuario === null && !decisor) return r;
  const usuario = tx.contexto.usuario ?? (decisor?.usuario == null ? null : Number(decisor.usuario));
  if (usuario === null)
    throw recusa(
      'sem-usuario',
      'A glosa aceita do item não tem quem a decidiu: o débito do repasse precisa de autor.',
    );
  await sincronizarGlosaDoItem(portaProducaoConta(tx, { estabelecimento: est, usuario }), {
    conta: Number(item.conta),
    item: d.item,
  });
  return r;
}

async function glosaNoTitulo(
  tx: TxOperacao,
  est: number,
  d: GlosaAceitaDoEvento,
): Promise<ResultadoGlosaDoEvento> {
  // Ordem contra a corrida (REPEATABLE READ): primeiro a trava do título, e só depois as leituras, todas travadas
  // (FOR UPDATE lê o último valor gravado, não a foto da transação). Duas entregas com chaves diferentes para o mesmo
  // item ficam em fila no título; a segunda enxerga a linha que a primeira gravou e não lança de novo.
  const titulo = (
    await tx.consultarParaAtualizar<{
      id: unknown;
      versao: unknown;
      valor_glosa: unknown;
      valor_glosa_aceita: unknown;
    }>(
      `SELECT t.id, t.versao, t.valor_glosa, t.valor_glosa_aceita
         FROM conta_hospitalar_item i
         JOIN titulo_receber t ON t.conta_hospitalar_id = i.conta_hospitalar_id
        WHERE i.id = ? AND t.estabelecimento_id = ? AND t.excluido_em IS NULL
          AND t.situacao NOT IN ('cancelado', 'renegociado')
        ORDER BY t.id`,
      [d.item, est],
      { teto: 50 },
    )
  )[0];
  // A chave do evento é única no banco (mesmo numa linha excluída): por isso a busca não filtra excluido_em.
  const chaveSql = 'SELECT id FROM glosa_titulo_receber WHERE chave_evento = ?';
  if (!titulo) {
    const ja = await tx.uma<{ id: unknown }>(chaveSql, [d.chaveEvento]);
    return ja ? { resultado: 'repetida', id: Number(ja.id) } : { resultado: 'sem-titulo', id: null };
  }
  const tituloId = Number(titulo.id);
  const ja = (await tx.consultarParaAtualizar<{ id: unknown }>(chaveSql, [d.chaveEvento], { teto: 1 }))[0];
  if (ja) return { resultado: 'repetida', id: Number(ja.id) };
  const somar = (linhas: readonly { valor: unknown }[]) => linhas.reduce((t, l) => t + Number(l.valor), 0);
  const aceito = somar(
    await tx.consultarParaAtualizar<{ valor: unknown }>(
      `SELECT valor_aceito AS valor FROM glosa_item
        WHERE conta_hospitalar_item_id = ? AND decisao IN ('aceitar', 'aceitar_parcial') AND excluido_em IS NULL`,
      [d.item],
      { teto: 500 },
    ),
  );
  const lancado = somar(
    await tx.consultarParaAtualizar<{ valor: unknown }>(
      `SELECT valor FROM glosa_titulo_receber
        WHERE titulo_receber_id = ? AND conta_hospitalar_item_id = ? AND situacao = 'aceita' AND excluido_em IS NULL`,
      [tituloId, d.item],
      { teto: 500 },
    ),
  );
  const valor = valorAindaNaoLancado(aceito, lancado);
  if (valor <= 0) return { resultado: 'sem-glosa', id: null };
  const novo = aplicarGlosaAceita(
    { glosa: Number(titulo.valor_glosa), glosaAceita: Number(titulo.valor_glosa_aceita) },
    valor,
  );
  const id = await tx.incluir('glosa_titulo_receber', {
    titulo_receber_id: tituloId,
    conta_hospitalar_item_id: d.item,
    situacao: 'aceita',
    valor,
    motivo: MOTIVO,
    meio: 'evento',
    chave_evento: d.chaveEvento,
  });
  await tx.alterar('titulo_receber', tituloId, Number(titulo.versao), {
    valor_glosa: novo.glosa,
    valor_glosa_aceita: novo.glosaAceita,
  });
  return { resultado: 'registrada', id };
}
