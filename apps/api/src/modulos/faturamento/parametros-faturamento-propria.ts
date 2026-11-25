// Parâmetros, preferências e alçada do faturamento no banco próprio (F3.7, 06-FAT linha 38). As regras moram em
// `@sgh/dominio-faturamento` (parametros/parametros-faturamento.ts); aqui só se lê, confere pelo domínio e grava.
// - leitura: o valor efetivo de cada parâmetro `faturamento.*` do catálogo (parametro_definicao), com a vigência de
//   parametro_valor e a precedência usuário > estabelecimento > rede > padrão;
// - gravação da preferência do faturista (faturamento.preferencia-faturista.gravar), sempre da própria conta da sessão:
//   fecha a vigência anterior (nada é apagado) e grava a nova com o histórico (parametro_valor_historico);
// - alçada: os níveis da alçada vigente do documento do faturamento (alcada_aprovacao do tipo fat_*) e os cargos do
//   decisor no estabelecimento, conferidos pelo domínio (faixa por valor e cargo; quem pede não aprova).
import {
  conferirAlcadaFaturamento,
  conferirPreferenciasFaturista,
  DOCUMENTOS_ALCADA_FATURAMENTO,
  normalizarParametrosFaturamento,
  normalizarPreferenciasFaturista,
  PARAMETROS_FATURAMENTO,
  type NivelAlcadaAjuste,
  type ParametrosFaturamento,
  type PreferenciasFaturista,
  type ResultadoAlcadaFaturamento,
} from '@sgh/dominio-faturamento';
import { definirOperacao, recusa, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const PRECEDENCIA: Record<string, number> = { usuario: 3, estabelecimento: 2, rede: 1 };

/** Os valores vigentes das chaves `faturamento.*` para o estabelecimento (e o usuário, se houver), por precedência. */
export async function valoresFaturamento(
  l: Pick<Leitor, 'consultar'>,
  est: number | null,
  usuario: number | null,
): Promise<Record<string, string>> {
  const r = await l.consultar<Linha>(
    `SELECT d.chave, v.nivel, v.valor
       FROM parametro_definicao d
       JOIN parametro_valor v ON v.parametro_definicao_id = d.id
        AND v.vigencia_inicio <= NOW(3) AND (v.vigencia_fim IS NULL OR v.vigencia_fim > NOW(3))
      WHERE d.chave LIKE 'faturamento.%' AND d.ativo = TRUE
        AND (v.nivel = 'rede'
             OR (v.nivel = 'estabelecimento' AND v.estabelecimento_id = ?)
             OR (v.nivel = 'usuario' AND v.usuario_id = ?))`,
    [est ?? 0, usuario ?? 0],
    { teto: 500 },
  );
  const melhor = new Map<string, { p: number; valor: string }>();
  for (const x of r) {
    const p = PRECEDENCIA[String(x['nivel'])] ?? 0;
    const atual = melhor.get(String(x['chave']));
    if (!atual || p > atual.p) melhor.set(String(x['chave']), { p, valor: String(x['valor'] ?? '') });
  }
  return Object.fromEntries([...melhor].map(([k, v]) => [k, v.valor]));
}

export interface ParametrosFaturamentoLidos {
  readonly parametros: ParametrosFaturamento;
  readonly preferencias: PreferenciasFaturista;
  /** O catálogo para a tela: chave, tipo, faixa, opções e se é preferência do faturista. */
  readonly catalogo: typeof PARAMETROS_FATURAMENTO;
}

export async function lerParametrosFaturamento(
  l: Pick<Leitor, 'consultar'>,
  est: number | null,
  usuario: number | null,
): Promise<ParametrosFaturamentoLidos> {
  const v = await valoresFaturamento(l, est, usuario);
  const soRedeEstab = Object.fromEntries(
    Object.entries(v).filter(([k]) => !k.startsWith('faturamento.preferencia.')),
  );
  return {
    parametros: normalizarParametrosFaturamento(soRedeEstab),
    preferencias: normalizarPreferenciasFaturista(v),
    catalogo: PARAMETROS_FATURAMENTO,
  };
}

/** Os parâmetros de rede e estabelecimento (sem preferência de usuário): a rotina diária lê por aqui. */
export async function parametrosDoEstabelecimento(
  l: Pick<Leitor, 'consultar'>,
  est: number,
): Promise<ParametrosFaturamento> {
  return (await lerParametrosFaturamento(l, est, null)).parametros;
}

const esquemaPreferencias = z.object({
  preferencias: z.record(z.string().max(100), z.string().max(200)),
});

export const opGravarPreferenciasFaturista = definirOperacao({
  nome: 'faturamento.preferencia-faturista.gravar',
  tabelas: ['parametro_valor', 'parametro_valor_historico'],
  entrada: esquemaPreferencias,
  async gravar(tx, e, ctx) {
    if (ctx.usuario === null || ctx.usuario === undefined)
      throw recusa('sem-usuario', 'A preferência é da própria conta: entre com o seu usuário.');
    const erros = conferirPreferenciasFaturista(e.preferencias);
    if (erros.length)
      throw recusa('preferencia-invalida', erros.map((x) => x.mensagem).join(' '), {
        campos: erros.map((x) => x.campo),
      });
    const agora = (await tx.uma<{ agora: Date }>('SELECT NOW(3) AS agora'))!.agora;
    const gravados: string[] = [];
    for (const [chave, bruto] of Object.entries(e.preferencias)) {
      const valor = bruto.trim();
      const d = await tx.uma<Linha>(
        `SELECT id FROM parametro_definicao WHERE chave = ? AND ativo = TRUE AND permite_usuario = TRUE`,
        [chave],
      );
      if (!d)
        throw recusa('parametro-ausente', 'O catálogo de parâmetros do faturamento não está carregado.');
      const vigentes = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, valor FROM parametro_valor
          WHERE parametro_definicao_id = ? AND nivel = 'usuario' AND usuario_id = ? AND vigencia_fim IS NULL`,
        [n(d['id']), ctx.usuario],
      );
      if (vigentes.length === 1 && String(vigentes[0]!['valor']) === valor) continue;
      for (const v of vigentes)
        await tx.alterar('parametro_valor', n(v['id']), n(v['versao']), { vigencia_fim: agora });
      const id = await tx.incluir('parametro_valor', {
        parametro_definicao_id: n(d['id']),
        nivel: 'usuario',
        usuario_id: ctx.usuario,
        valor,
        vigencia_inicio: agora,
        motivo: 'Preferência do faturista',
      });
      await tx.incluir('parametro_valor_historico', {
        parametro_valor_id: id,
        operacao: vigentes.length ? 'alteracao' : 'inclusao',
        valor_anterior: vigentes[0] ? String(vigentes[0]['valor']) : null,
        valor_novo: valor,
        motivo: 'Preferência do faturista',
        endereco_ip: ctx.enderecoIp ?? null,
        ocorrido_em: agora,
        usuario_id: ctx.usuario,
      });
      gravados.push(chave);
    }
    return { usuario: String(ctx.usuario), gravados: gravados.join(',') };
  },
  alvo: (_e, r) => ({ tabela: 'usuario', id: Number(r.usuario) }),
  trilha: (e) => ({ motivo: 'Preferência do faturista', dados: { chaves: Object.keys(e.preferencias) } }),
});

export async function gravarPreferenciasFaturista(
  executor: Executor,
  ctx: Parameters<Executor['executar']>[3],
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const r = await executor.executar(
    opGravarPreferenciasFaturista as Parameters<Executor['executar']>[0],
    ctx.cliente,
    entrada,
    ctx,
  );
  return r.resultado as Record<string, unknown>;
}

/** Os níveis da alçada vigente do documento do faturamento no estabelecimento (vazio: sem alçada cadastrada). */
export async function niveisAlcadaFaturamento(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  documento: string,
  hoje: string,
): Promise<NivelAlcadaAjuste[]> {
  const r = await l.consultar<Linha>(
    `SELECT a.id AS alcada_id, nv.id, nv.nivel, nv.perfil_acesso_id, nv.aprovador_usuario_id,
            nv.valor_unitario_minimo, nv.valor_unitario_maximo, nv.obrigatorio
       FROM alcada_aprovacao a
       JOIN tipo_documento_aprovacao t ON t.id = a.tipo_documento_aprovacao_id AND t.codigo = ?
       JOIN alcada_aprovacao_nivel nv ON nv.alcada_aprovacao_id = a.id AND nv.excluido_em IS NULL
        AND (nv.vigencia_inicio IS NULL OR nv.vigencia_inicio <= ?) AND (nv.vigencia_fim IS NULL OR nv.vigencia_fim >= ?)
      WHERE a.estabelecimento_id = ? AND a.ativo = 1 AND a.vigencia_inicio <= ?
        AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= ?)
      ORDER BY a.vigencia_inicio DESC, nv.nivel, nv.sequencia`,
    [documento, hoje, hoje, est, hoje, hoje],
    { teto: 100 },
  );
  const alcada = r.length ? n(r[0]!['alcada_id']) : null;
  return r
    .filter((x) => n(x['alcada_id']) === alcada)
    .map((x) => ({
      id: n(x['id']),
      nivel: n(x['nivel']),
      perfilId: nn(x['perfil_acesso_id']),
      usuarioId: nn(x['aprovador_usuario_id']),
      valorMinimo: n(x['valor_unitario_minimo']),
      valorMaximo: nn(x['valor_unitario_maximo']),
      obrigatorio: Boolean(Number(x['obrigatorio'])),
    }));
}

/**
 * Confere a alçada do faturamento no banco: o decisor (com os cargos vigentes dele no estabelecimento) aprova o
 * documento deste valor pedido por `solicitante`? Os fluxos do faturamento chamam por aqui antes de aprovar.
 */
export async function conferirAlcadaFaturamentoNoBanco(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  documento: string,
  valor: number,
  solicitante: number,
  decisor: number | null,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<ResultadoAlcadaFaturamento> {
  if (!(DOCUMENTOS_ALCADA_FATURAMENTO as readonly string[]).includes(documento))
    throw recusa('documento-invalido', 'Documento do faturamento sem alçada.', { campos: ['documento'] });
  const niveis = await niveisAlcadaFaturamento(l, est, documento, hoje);
  const perfis = decisor
    ? (
        await l.consultar<Linha>(
          `SELECT perfil_acesso_id FROM usuario_perfil WHERE usuario_id = ? AND estabelecimento_id = ?
              AND excluido_em IS NULL AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
          [decisor, est, hoje, hoje],
          { teto: 200 },
        )
      ).map((x) => n(x['perfil_acesso_id']))
    : [];
  return conferirAlcadaFaturamento({ valor, solicitante, decisor, perfisDoDecisor: perfis, niveis });
}
