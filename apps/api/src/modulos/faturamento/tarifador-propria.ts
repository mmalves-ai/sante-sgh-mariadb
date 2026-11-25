// Serviços acessórios da conta sobre o banco do cliente (F8, 06-FAT linha 23): layout do arquivo do tarifador e a
// importação das ligações. A leitura do arquivo e a classificação do número são do @sgh/dominio-faturamento
// (conta/tarifador); aqui só se lê o cadastro, chama o domínio e grava pelo Executor (trilha, autoria e idempotência
// na mesma transação).
// - O layout é do estabelecimento; inativar é marcar ativo = falso (nada se apaga).
// - A importação registra cada ligação como pendente (origem integracao), com o tipo cadastrado da mesma abrangência,
//   o ramal reconhecido pelo número e o atendimento pela coluna do arquivo ou pela conta de onde se importa. A
//   ligação já registrada (mesmo atendimento, início, destino e duração) não se repete: reimportar o mesmo arquivo
//   não duplica a cobrança. A linha recusada volta só com o número da linha e o motivo.
// - O lançamento na conta continua sendo o das regras comerciais (lancar-ligacoes): preço da tabela ou valor do
//   tarifador, conforme a regra do tipo.
import {
  type AbrangenciaNumero,
  FORMATOS_DATA_TARIFADOR,
  FORMATOS_DURACAO_TARIFADOR,
  type LayoutTarifador,
  lerArquivoTarifador,
  MAX_CONTEUDO_TARIFADOR,
  SEPARADORES_TARIFADOR,
  tipoDaLigacao,
  validarLayoutTarifador,
} from '@sgh/dominio-faturamento';
import { type ContextoOperacao, definirOperacao, type Executor, type Leitor, recusa } from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';

function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

const id = z.number().int().positive();
const coluna = z.number().int().min(1).max(60);

function layoutDaLinha(
  r: Linha,
): LayoutTarifador & { id: number; versao: number; descricao: string; ativo: boolean } {
  return {
    id: n(r['id']),
    versao: n(r['versao']),
    descricao: String(r['descricao']),
    ativo: bool(r['ativo']),
    separador: String(r['separador']) as LayoutTarifador['separador'],
    cabecalho: bool(r['tem_cabecalho']),
    formatoData: String(r['formato_data']) as LayoutTarifador['formatoData'],
    formatoDuracao: String(r['formato_duracao']) as LayoutTarifador['formatoDuracao'],
    decimal: String(r['separador_decimal']) === '.' ? '.' : ',',
    dddLocal: r['ddd_local'] === null || r['ddd_local'] === undefined ? null : String(r['ddd_local']),
    colunaRamal: nn(r['coluna_ramal']),
    colunaDataHora: n(r['coluna_data_hora']),
    colunaHora: nn(r['coluna_hora']),
    colunaDuracao: n(r['coluna_duracao']),
    colunaNumero: n(r['coluna_numero']),
    colunaValor: nn(r['coluna_valor']),
    colunaAtendimento: nn(r['coluna_atendimento']),
  };
}

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────

export const esquemaSalvarLayoutTarifador = z.object({
  id: id.optional(),
  versao: z.number().int().positive().optional(),
  descricao: z.string().trim().min(2).max(100),
  separador: z.enum(SEPARADORES_TARIFADOR),
  cabecalho: z.boolean().default(true),
  formatoData: z.enum(FORMATOS_DATA_TARIFADOR),
  formatoDuracao: z.enum(FORMATOS_DURACAO_TARIFADOR),
  decimal: z.enum([',', '.']).default(','),
  dddLocal: z.string().trim().max(2).nullable().default(null),
  colunaRamal: coluna.nullable().default(null),
  colunaDataHora: coluna,
  colunaHora: coluna.nullable().default(null),
  colunaDuracao: coluna,
  colunaNumero: coluna,
  colunaValor: coluna.nullable().default(null),
  colunaAtendimento: coluna.nullable().default(null),
  ativo: z.boolean().default(true),
});
export const opSalvarLayoutTarifador = definirOperacao({
  nome: 'faturamento.salvar-layout-tarifador',
  tabelas: ['layout_tarifador'],
  entrada: esquemaSalvarLayoutTarifador,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const dddLocal = e.dddLocal ? e.dddLocal : null;
    const erros = validarLayoutTarifador({ ...e, dddLocal });
    if (Object.keys(erros).length)
      throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });
    const igual = await tx.uma<Linha>(
      'SELECT id FROM layout_tarifador WHERE estabelecimento_id = ? AND descricao = ? AND id <> ?',
      [est, e.descricao, e.id ?? 0],
    );
    if (igual) throw recusa('conflito', 'Já existe um layout com esta descrição.', { campos: ['descricao'] });
    const valores = {
      descricao: e.descricao,
      separador: e.separador,
      tem_cabecalho: e.cabecalho,
      formato_data: e.formatoData,
      formato_duracao: e.formatoDuracao,
      separador_decimal: e.decimal,
      ddd_local: dddLocal,
      coluna_ramal: e.colunaRamal,
      coluna_data_hora: e.colunaDataHora,
      coluna_hora: e.colunaHora,
      coluna_duracao: e.colunaDuracao,
      coluna_numero: e.colunaNumero,
      coluna_valor: e.colunaValor,
      coluna_atendimento: e.colunaAtendimento,
      ativo: e.ativo,
    };
    if (e.id) {
      const atual = await tx.uma<Linha>(
        'SELECT id FROM layout_tarifador WHERE id = ? AND estabelecimento_id = ?',
        [e.id, est],
      );
      if (!atual) throw recusa('nao-encontrado', 'Layout não encontrado.', { campos: ['id'] });
      if (!e.versao) throw recusa('entrada-invalida', 'Informe a versão do layout.', { campos: ['versao'] });
      await tx.alterar('layout_tarifador', e.id, e.versao, valores);
      return { id: e.id };
    }
    return { id: await tx.incluir('layout_tarifador', { estabelecimento_id: est, ...valores }) };
  },
  alvo: (_e, s) => ({ tabela: 'layout_tarifador', id: s.id }),
});

// ── Importação ────────────────────────────────────────────────────────────────────────────────────────

export const esquemaImportarLigacoes = z.object({
  layoutId: id,
  /** Conteúdo do arquivo em texto (cabe no limite de 1 MB do corpo da requisição). */
  conteudo: z.string().min(1).max(MAX_CONTEUDO_TARIFADOR),
  /** Importação a partir da conta: as ligações vão para o atendimento dela. */
  contaId: id.nullable().default(null),
  /** Na importação a partir da conta, só as linhas deste ramal (o do quarto do paciente). */
  ramal: z.string().trim().max(10).nullable().default(null),
});

export type MotivoImportacao =
  | 'colunas_faltando'
  | 'data_invalida'
  | 'duracao_invalida'
  | 'numero_invalido'
  | 'valor_invalido'
  | 'limite_de_linhas'
  | 'sem_atendimento'
  | 'sem_tipo';

/** Resultado gravado na idempotência (só valores simples): as listas vão em JSON, sem dado de pessoa. */
export interface ResultadoImportacao {
  readonly [k: string]: number | string;
  readonly id: number;
  readonly lidas: number;
  readonly registradas: number;
  readonly repetidas: number;
  readonly outroRamal: number;
  readonly recusadas: number;
  /** JSON de { abrangência: quantidade } das registradas. */
  readonly porAbrangencia: string;
  /** JSON de [{ linha, motivo }] das linhas recusadas. */
  readonly linhasRecusadas: string;
}

/** O resultado da importação com as listas abertas, para a resposta da API. */
export function abrirResultadoImportacao(r: Record<string, unknown>) {
  const json = (v: unknown, padrao: unknown) => {
    try {
      return typeof v === 'string' ? (JSON.parse(v) as unknown) : padrao;
    } catch {
      return padrao;
    }
  };
  return {
    ...r,
    porAbrangencia: json(r['porAbrangencia'], {}) as Record<string, number>,
    linhasRecusadas: json(r['linhasRecusadas'], []) as { linha: number; motivo: MotivoImportacao }[],
  };
}

export const opImportarLigacoes = definirOperacao({
  nome: 'faturamento.importar-ligacoes-tarifador',
  tabelas: ['ligacao_tarifada'],
  entrada: esquemaImportarLigacoes,
  async gravar(tx, e): Promise<ResultadoImportacao> {
    const est = estDe(tx.contexto);
    const lr = await tx.uma<Linha>('SELECT * FROM layout_tarifador WHERE id = ? AND estabelecimento_id = ?', [
      e.layoutId,
      est,
    ]);
    if (!lr || !bool(lr['ativo']))
      throw recusa('nao-encontrado', 'Layout do tarifador não encontrado ou inativo.', {
        campos: ['layoutId'],
      });
    const layout = layoutDaLinha(lr);
    let atendimentoFixo: number | null = null;
    if (e.contaId) {
      const c = await tx.uma<Linha>(
        'SELECT atendimento_id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.contaId, est],
      );
      if (!c) throw recusa('nao-encontrado', 'Conta não encontrada.', { campos: ['contaId'] });
      atendimentoFixo = nn(c['atendimento_id']);
      if (atendimentoFixo === null)
        throw recusa('entrada-invalida', 'A conta não tem atendimento.', { campos: ['contaId'] });
    } else if (layout.colunaAtendimento === null)
      throw recusa(
        'entrada-invalida',
        'O layout não traz o atendimento: importe a partir da conta do paciente.',
        { campos: ['contaId'] },
      );

    const leitura = lerArquivoTarifador(e.conteudo, layout);
    const tipos = new Map<string, { id: number; abrangencia: string }>();
    for (const t of await tx.consultar<Linha>(
      'SELECT id, abrangencia FROM tipo_ligacao_tarifada WHERE ativo = 1 ORDER BY codigo, id',
      [],
    ))
      if (!tipos.has(String(t['abrangencia'])))
        tipos.set(String(t['abrangencia']), { id: n(t['id']), abrangencia: String(t['abrangencia']) });
    const ramais = new Map<string, number | null>();
    for (const r of await tx.consultar<Linha>(
      'SELECT id, numero_ramal FROM ramal_telefonico WHERE estabelecimento_id = ? AND ativo = 1 AND excluido_em IS NULL',
      [est],
    )) {
      const k = String(r['numero_ramal']);
      ramais.set(k, ramais.has(k) ? null : n(r['id']));
    }
    const regras = new Map<number, number>();
    for (const r of await tx.consultar<Linha>(
      'SELECT id, tipo_ligacao_tarifada_id FROM regra_cobranca_ligacao WHERE estabelecimento_id = ?',
      [est],
    ))
      regras.set(n(r['tipo_ligacao_tarifada_id']), n(r['id']));
    const atendimentos = new Map<string, number | null>();

    const recusadas: { linha: number; motivo: MotivoImportacao }[] = [...leitura.recusadas];
    const porAbrangencia: Partial<Record<AbrangenciaNumero, number>> = {};
    let registradas = 0;
    let repetidas = 0;
    let outroRamal = 0;
    let primeira = 0;
    for (const l of leitura.ligacoes) {
      if (e.ramal && l.ramal !== null && l.ramal !== e.ramal) {
        outroRamal++;
        continue;
      }
      let atendimento = atendimentoFixo;
      if (atendimento === null && l.atendimento !== null) {
        if (!atendimentos.has(l.atendimento)) {
          const a = await tx.uma<Linha>(
            'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL',
            [est, l.atendimento],
          );
          atendimentos.set(l.atendimento, nn(a?.['id']));
        }
        atendimento = atendimentos.get(l.atendimento) ?? null;
      }
      if (atendimento === null) {
        recusadas.push({ linha: l.linha, motivo: 'sem_atendimento' });
        continue;
      }
      const tipo = tipos.get(l.abrangencia);
      if (!tipo) {
        recusadas.push({ linha: l.linha, motivo: 'sem_tipo' });
        continue;
      }
      const ja = await tx.uma<Linha>(
        `SELECT id FROM ligacao_tarifada WHERE estabelecimento_id = ? AND atendimento_id = ? AND iniciada_em = ?
            AND telefone_destino = ? AND duracao_segundos = ? AND excluido_em IS NULL LIMIT 1`,
        [est, atendimento, l.iniciadaEm, l.telefone, l.duracaoSegundos],
      );
      if (ja) {
        repetidas++;
        continue;
      }
      const lid = await tx.incluir('ligacao_tarifada', {
        estabelecimento_id: est,
        atendimento_id: atendimento,
        ramal_telefonico_id: l.ramal === null ? null : (ramais.get(l.ramal) ?? null),
        regra_cobranca_ligacao_id: regras.get(tipo.id) ?? null,
        tipo_ligacao_tarifada_id: tipo.id,
        tipo_ligacao: tipoDaLigacao(tipo.abrangencia),
        iniciada_em: l.iniciadaEm,
        duracao_segundos: l.duracaoSegundos,
        ddi: l.ddi,
        ddd: l.ddd,
        telefone_destino: l.telefone,
        valor: l.valor,
        situacao: 'pendente',
        origem: 'integracao',
      });
      if (!primeira) primeira = lid;
      registradas++;
      porAbrangencia[l.abrangencia] = (porAbrangencia[l.abrangencia] ?? 0) + 1;
    }
    recusadas.sort((a, b) => a.linha - b.linha);
    return {
      id: primeira || e.layoutId,
      lidas: leitura.lidas,
      registradas,
      repetidas,
      outroRamal,
      recusadas: recusadas.length,
      porAbrangencia: JSON.stringify(porAbrangencia),
      linhasRecusadas: JSON.stringify(recusadas),
    };
  },
  alvo: (e, s) =>
    s.registradas ? { tabela: 'ligacao_tarifada', id: s.id } : { tabela: 'layout_tarifador', id: e.layoutId },
  // A trilha guarda só as contagens: o número discado é dado pessoal e não vai para a trilha.
  trilha: (_e, s) => ({
    dados: { lidas: s.lidas, registradas: s.registradas, repetidas: s.repetidas, recusadas: s.recusadas },
  }),
});

// ── Leitura ───────────────────────────────────────────────────────────────────────────────────────────

/** Layouts do estabelecimento e a descrição dos itens usados nas regras de remoção e de ligação. */
export async function servicosAcessoriosPropria(l: Consulta, est: number) {
  const layouts = (
    await l.consultar<Linha>(
      'SELECT * FROM layout_tarifador WHERE estabelecimento_id = ? ORDER BY descricao',
      [est],
    )
  ).map(layoutDaLinha);
  const usados = await l.consultar<Linha>(
    `SELECT i.id, i.codigo, i.descricao FROM item_faturavel i
      WHERE i.id IN (SELECT item_faturavel_id FROM regra_cobranca_ambulancia WHERE estabelecimento_id = ?)
         OR i.id IN (SELECT item_faturavel_minuto_id FROM regra_cobranca_ligacao WHERE estabelecimento_id = ? AND item_faturavel_minuto_id IS NOT NULL)
         OR i.id IN (SELECT item_faturavel_segundo_id FROM regra_cobranca_ligacao WHERE estabelecimento_id = ? AND item_faturavel_segundo_id IS NOT NULL)`,
    [est, est, est],
  );
  return {
    layouts,
    itens: usados.map((i) => ({
      id: n(i['id']),
      codigo: String(i['codigo']),
      descricao: String(i['descricao']),
    })),
  };
}

/** Busca de item cobrável por código ou descrição, para as regras de remoção e de ligação. */
export async function buscarItensCobraveis(l: Consulta, termo: string) {
  const t = termo.trim();
  if (t.length < 2) return [];
  const linhas = await l.consultar<Linha>(
    `SELECT id, codigo, descricao FROM item_faturavel
      WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY codigo LIMIT 20`,
    [`${t}%`, `%${t}%`],
  );
  return linhas.map((i) => ({
    id: n(i['id']),
    codigo: String(i['codigo']),
    descricao: String(i['descricao']),
  }));
}

export const OPERACOES_TARIFADOR = {
  'salvar-layout-tarifador': opSalvarLayoutTarifador,
  'importar-ligacoes': opImportarLigacoes,
} as const;
export type NomeOperacaoTarifador = keyof typeof OPERACOES_TARIFADOR;

export async function gravarTarifador(
  executor: Executor,
  nome: NomeOperacaoTarifador,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_TARIFADOR[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
