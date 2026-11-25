// Movimentos da conta do paciente sobre o banco do cliente (F3.7, 06-FAT linhas 14, 15 e 16). Leituras pelo Leitor e
// gravações pelo Executor (trilha, autoria e idempotência na mesma transação). As regras são do
// @sgh/dominio-faturamento (conta/movimentos): aqui só se lê, confere pelo domínio e grava.
// Contrato de efeito (conta-movimentos-propria.int.spec.ts):
// - equipe: conta_hospitalar_item_participante por item (sequencial, função, grau, forma de pagamento, valor do ato pelo
//   honorário do item); quem sai da equipe fica marcado excluído (com autor e data), quem volta é restaurado na mesma
//   linha; a memória do item (conta_hospitalar_item_memoria, operação "alteracao") guarda a equipe calculada.
// - kit.lancar: um conta_hospitalar_item por linha do kit (kit_cobranca_id preenchido, preço da tabela da conta ou zero
//   com a memória "sem_preco_vigente"), a memória de cada um e o total da conta refeito.
// - kit.cadastrar: kit_cobranca e kit_cobranca_item.
// - transferir: transferencia_conta (número de negócio, tipo pelo domínio, valores de origem e de destino) e uma
//   transferencia_conta_item por item; o item de origem fica "transferido" (nunca apagado) e nasce o item na conta de
//   destino com o preço refeito pela tabela do destino (sem preço lá: o valor de origem, com a memória dizendo isso);
//   os participantes acompanham o item; o total das duas contas é refeito.
import {
  adicionalDaEquipe,
  avaliarCoberturaDestino,
  calcularEquipeItem,
  contaEditavel,
  FORMAS_PAGAMENTO_PARTICIPANTE,
  type FuncaoEquipe,
  type KitCobranca,
  lancamentoDoKit,
  type ParticipanteCalculado,
  validarDefinicaoKit,
  validarEquipeItem,
  validarTransferencia,
  valorItemComEquipe,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { esquemaLancarItem } from '@sgh/contratos';
import { lancarItem, totalDosItens } from './operacoes.js';
import { lancarLinhasDoKit } from './kit-lancamento.js';
import { conferirLancamentoNoPeriodo } from './conta-periodos-propria.js';
import { type PrecoVigente, precoVigente, tabelasDePreco } from './preco-conta.js';
import { criticarCoberturaDoItemConta } from './cobertura-item-conta.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const r2 = (x: number) => Math.round(x * 100) / 100;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const hoje = () => new Date().toISOString().slice(0, 10);

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}

interface ContaLida {
  id: number;
  versao: number;
  estabelecimento: number;
  numero: string;
  situacao: string;
  paciente: number;
  fontePagadora: number;
  plano: number | null;
  tabela: number | null;
  inicio: string | null;
  fim: string | null;
}
const COLUNAS_CONTA = `id, versao, estabelecimento_id, numero, situacao, paciente_id, fonte_pagadora_id,
  plano_fonte_pagadora_id, tabela_preco_id, inicio_em, fim_em`;
/** AAAA-MM-DD de uma data lida do banco (nulo quando não há). */
/** O dia do item (data do lançamento): o mesmo critério no período da conta, na prévia e no preço do destino. */
export const diaDe = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const comoConta = (c: Linha): ContaLida => ({
  id: n(c['id']),
  versao: n(c['versao']),
  estabelecimento: n(c['estabelecimento_id']),
  numero: txt(c['numero']),
  situacao: txt(c['situacao']),
  paciente: n(c['paciente_id']),
  fontePagadora: n(c['fonte_pagadora_id']),
  plano: nn(c['plano_fonte_pagadora_id']),
  tabela: nn(c['tabela_preco_id']),
  inicio: diaDe(c['inicio_em']),
  fim: diaDe(c['fim_em']),
});

/**
 * O usuário pode a ação no estabelecimento dado? Mesma regra da sessão (fonte-propria): vínculo com o estabelecimento,
 * perfil vigente nele (administrador do estabelecimento ou com a ação permitida) e nenhuma negação explícita da ação
 * em perfil vigente dele ali. Usado quando a operação alcança conta de outro estabelecimento que não o da sessão.
 */
export async function podeNoEstabelecimento(
  l: Consulta,
  usuario: number | null,
  est: number,
  acao: string,
): Promise<boolean> {
  if (usuario === null) return false;
  const vigente = `up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL
            AND up.vigencia_inicio <= UTC_DATE() AND (up.vigencia_fim IS NULL OR up.vigencia_fim >= UTC_DATE())`;
  const r = await l.uma<Linha>(
    `SELECT 1 AS ok FROM usuario_estabelecimento ue
      WHERE ue.usuario_id = ? AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL
        AND ue.vigencia_inicio <= UTC_DATE() AND (ue.vigencia_fim IS NULL OR ue.vigencia_fim >= UTC_DATE())
        AND EXISTS (
          SELECT 1 FROM usuario_perfil up
            JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.ativo AND p.excluido_em IS NULL
             AND (p.estabelecimento_id IS NULL OR p.estabelecimento_id = up.estabelecimento_id)
           WHERE ${vigente}
             AND (p.administrador OR EXISTS (
               SELECT 1 FROM perfil_acao pa JOIN acao_sistema a ON a.id = pa.acao_sistema_id AND a.ativo AND a.permissionavel
                WHERE pa.perfil_acesso_id = p.id AND pa.excluido_em IS NULL AND pa.permitido AND a.codigo = ?)))
        AND NOT EXISTS (
          SELECT 1 FROM usuario_perfil up
            JOIN perfil_acesso p ON p.id = up.perfil_acesso_id AND p.ativo AND p.excluido_em IS NULL
            JOIN perfil_acao pa ON pa.perfil_acesso_id = p.id AND pa.excluido_em IS NULL AND NOT pa.permitido
            JOIN acao_sistema a ON a.id = pa.acao_sistema_id AND a.codigo = ?
           WHERE ${vigente})
      LIMIT 1`,
    [usuario, est, usuario, est, acao, acao, usuario, est],
  );
  return Boolean(r);
}

/** Quem lê: o usuário da sessão e se é o administrador da plataforma (que pode tudo, ADR 0002). */
export interface AcessoLeitura {
  readonly usuario: number | null;
  readonly total: boolean;
}

/** A conta do estabelecimento da sessão (a de destino de uma transferência pode ser de outro: `qualquerEst`). */
async function contaDo(l: Consulta, est: number | null, conta: number): Promise<ContaLida> {
  const c = await l.uma<Linha>(
    `SELECT ${COLUNAS_CONTA} FROM conta_hospitalar WHERE id = ? AND excluido_em IS NULL${est === null ? '' : ' AND estabelecimento_id = ?'}`,
    est === null ? [conta] : [conta, est],
  );
  if (!c)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return comoConta(c);
}

async function funcoesEquipe(l: Consulta): Promise<Map<number, FuncaoEquipe>> {
  const fs = await l.consultar<Linha>(
    `SELECT id, codigo, descricao, ativo, tipo_funcao, percentual_cobranca, grau_participacao_termo_terminologia_id AS grau,
            ordem_auxiliar, ordem_apresentacao
       FROM funcao_equipe_cobranca ORDER BY COALESCE(ordem_apresentacao, 1000), id`,
    [],
    { teto: 500 },
  );
  return new Map(
    fs.map((f) => [
      n(f['id']),
      {
        id: n(f['id']),
        tipo: txt(f['tipo_funcao']),
        ativo: Boolean(n(f['ativo'])),
        percentual: f['percentual_cobranca'] === null ? null : n(f['percentual_cobranca']),
        grau: nn(f['grau']),
        ordemAuxiliar: nn(f['ordem_auxiliar']),
        ordemApresentacao: nn(f['ordem_apresentacao']),
        codigo: txt(f['codigo']),
        descricao: txt(f['descricao']),
      } as FuncaoEquipe & { codigo: string; descricao: string },
    ]),
  );
}

async function kitDo(
  l: Consulta,
  est: number,
  id: number,
): Promise<KitCobranca & { codigo: string; descricao: string }> {
  const k = await l.uma<Linha>(
    `SELECT id, codigo, descricao, ativo, modo_cobranca, item_faturavel_id, fonte_pagadora_id, plano_fonte_pagadora_id
       FROM kit_cobranca WHERE id = ? AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)`,
    [id, est],
  );
  if (!k) throw recusa('nao-encontrado', 'O kit não existe.', { campos: ['kitId'] });
  const cs = await l.consultar<Linha>(
    `SELECT item_faturavel_id, equipamento_saude_id, quantidade FROM kit_cobranca_item
      WHERE kit_cobranca_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
    [id],
    { teto: 500 },
  );
  return {
    id,
    codigo: txt(k['codigo']),
    descricao: txt(k['descricao']),
    ativo: Boolean(n(k['ativo'])),
    modo: txt(k['modo_cobranca']) === 'fechado' ? 'fechado' : 'aberto',
    item: nn(k['item_faturavel_id']),
    fontePagadora: nn(k['fonte_pagadora_id']),
    plano: nn(k['plano_fonte_pagadora_id']),
    componentes: cs.map((c) => ({
      item: nn(c['item_faturavel_id']),
      equipamento: nn(c['equipamento_saude_id']),
      quantidade: n(c['quantidade']),
    })),
  };
}

// ── Leitura: a visão da conta para os três movimentos ─────────────────────────────────────────────

export async function movimentosContaPropria(
  l: Leitor,
  est: number,
  conta: number,
  acesso: AcessoLeitura = { usuario: null, total: false },
) {
  const c = await contaDo(l, est, conta);
  const itens = await l.consultar<Linha>(
    `SELECT i.id, i.sequencia, i.quantidade, i.valor_total, i.valor_honorario, i.situacao, i.kit_cobranca_id,
            f.codigo, f.descricao
       FROM conta_hospitalar_item i JOIN item_faturavel f ON f.id = i.item_faturavel_id
      WHERE i.conta_hospitalar_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
    [c.id],
    { teto: 5000 },
  );
  const ids = itens.map((i) => n(i['id']));
  const parts = ids.length
    ? await l.consultar<Linha>(
        `SELECT p.id, p.conta_hospitalar_item_id AS item, p.sequencia, p.profissional_id, p.funcao_equipe_cobranca_id AS funcao,
                p.grau_participacao_termo_terminologia_id AS grau, p.forma_pagamento, p.percentual_cobranca, p.valor_ato, pf.nome
           FROM conta_hospitalar_item_participante p
           JOIN profissional pr ON pr.id = p.profissional_id JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE p.conta_hospitalar_item_id IN (${lista(ids.length)}) AND p.excluido_em IS NULL ORDER BY p.sequencia`,
        ids,
        { teto: 20000 },
      )
    : [];
  const funcoes = [...(await funcoesEquipe(l)).values()].filter((f) => f.ativo) as (FuncaoEquipe & {
    codigo: string;
    descricao: string;
  })[];
  const kits = await l.consultar<Linha>(
    `SELECT id, codigo, descricao, modo_cobranca FROM kit_cobranca
      WHERE ativo = TRUE AND (estabelecimento_id IS NULL OR estabelecimento_id = ?)
        AND (fonte_pagadora_id IS NULL OR fonte_pagadora_id = ?)
        AND (plano_fonte_pagadora_id IS NULL OR plano_fonte_pagadora_id <=> ?) ORDER BY descricao`,
    [est, c.fontePagadora, c.plano],
    { teto: 1000 },
  );
  // As contas de destino: as outras contas do mesmo paciente; a de outro estabelecimento só aparece a quem pode ler
  // conta lá (o administrador da plataforma vê todas).
  const todasDoPaciente = await l.consultar<Linha>(
    `SELECT c.id, c.numero, c.situacao, c.estabelecimento_id, fp.nome AS fonte
       FROM conta_hospitalar c JOIN fonte_pagadora fp ON fp.id = c.fonte_pagadora_id
      WHERE c.paciente_id = ? AND c.id <> ? AND c.excluido_em IS NULL ORDER BY c.id DESC`,
    [c.paciente, c.id],
    { teto: 200 },
  );
  const liberados = new Map<number, boolean>([[est, true]]);
  for (const e of new Set(todasDoPaciente.map((d) => n(d['estabelecimento_id']))))
    if (!liberados.has(e))
      liberados.set(
        e,
        acesso.total || (await podeNoEstabelecimento(l, acesso.usuario, e, 'faturamento.conta.ler')),
      );
  const destinos = todasDoPaciente.filter((d) => liberados.get(n(d['estabelecimento_id'])));
  // Grau de participação (terminologia TISS, tabela 35) para a escolha na equipe.
  const graus = await l.consultar<Linha>(
    `SELECT t.id, t.codigo_termo, t.descricao FROM termo_terminologia t
       JOIN terminologia g ON g.id = t.terminologia_id WHERE g.numero_tabela_tiss = '35' AND t.ativo
      ORDER BY t.codigo_termo`,
    [],
    { teto: 100 },
  );
  // Os profissionais sugeridos para a equipe: o do atendimento, os executantes e solicitantes da conta e quem já está
  // em alguma equipe dela (a tela aceita também o código do profissional).
  const sugeridos = await l.consultar<Linha>(
    `SELECT pr.id, pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE pr.id IN (
        SELECT a.profissional_id FROM atendimento a JOIN conta_hospitalar c ON c.atendimento_id = a.id WHERE c.id = ?
        UNION SELECT executante_profissional_id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?
        UNION SELECT solicitante_profissional_id FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?
        UNION SELECT p.profissional_id FROM conta_hospitalar_item_participante p
              JOIN conta_hospitalar_item i ON i.id = p.conta_hospitalar_item_id WHERE i.conta_hospitalar_id = ?)
      ORDER BY pf.nome`,
    [c.id, c.id, c.id, c.id],
    { teto: 300 },
  );
  const transferencias = await l.consultar<Linha>(
    `SELECT t.id, t.numero, t.tipo, t.conta_origem_id, t.conta_destino_id, t.motivo, t.transferido_em,
            t.valor_total_origem, t.valor_total_destino, t.situacao,
            (SELECT COUNT(*) FROM transferencia_conta_item ti WHERE ti.transferencia_conta_id = t.id) AS itens
       FROM transferencia_conta t WHERE (t.conta_origem_id = ? OR t.conta_destino_id = ?) AND t.excluido_em IS NULL
      ORDER BY t.id DESC`,
    [c.id, c.id],
    { teto: 500 },
  );
  return {
    contaId: c.id,
    numero: c.numero,
    situacao: c.situacao,
    editavel: contaEditavel(c.situacao),
    fontePagadoraId: c.fontePagadora,
    fonte: txt(
      (await l.uma<Linha>('SELECT nome FROM fonte_pagadora WHERE id = ?', [c.fontePagadora]))?.['nome'],
    ),
    itens: itens.map((i) => ({
      id: n(i['id']),
      sequencia: n(i['sequencia']),
      codigo: txt(i['codigo']),
      descricao: txt(i['descricao']),
      quantidade: n(i['quantidade']),
      valorTotal: n(i['valor_total']),
      honorario: n(i['valor_honorario']),
      situacao: txt(i['situacao']),
      kitId: nn(i['kit_cobranca_id']),
      equipe: parts
        .filter((p) => n(p['item']) === n(i['id']))
        .map((p) => ({
          sequencia: n(p['sequencia']),
          profissionalId: n(p['profissional_id']),
          nome: txt(p['nome']),
          funcaoId: n(p['funcao']),
          grauId: nn(p['grau']),
          percentual: nn(p['percentual_cobranca']),
          formaPagamento: txt(p['forma_pagamento']),
          valorAto: n(p['valor_ato']),
        })),
    })),
    funcoes: funcoes.map((f) => ({
      id: f.id,
      codigo: f.codigo,
      descricao: f.descricao,
      tipo: f.tipo,
      ativo: f.ativo,
      percentual: f.percentual,
      grau: f.grau,
      ordemAuxiliar: f.ordemAuxiliar,
      ordemApresentacao: f.ordemApresentacao,
    })),
    graus: graus.map((g) => ({
      id: n(g['id']),
      codigo: txt(g['codigo_termo']),
      descricao: txt(g['descricao']),
    })),
    kits: kits.map((k) => ({
      id: n(k['id']),
      codigo: txt(k['codigo']),
      descricao: txt(k['descricao']),
      modo: txt(k['modo_cobranca']),
    })),
    profissionais: sugeridos.map((p) => ({ id: n(p['id']), nome: txt(p['nome']) })),
    destinos: destinos.map((d) => ({
      id: n(d['id']),
      numero: txt(d['numero']),
      situacao: txt(d['situacao']),
      fonte: txt(d['fonte']),
      outroEstabelecimento: n(d['estabelecimento_id']) !== est,
      aberta: contaEditavel(txt(d['situacao'])),
    })),
    transferencias: transferencias.map((t) => ({
      id: n(t['id']),
      numero: n(t['numero']),
      tipo: txt(t['tipo']),
      saiu: n(t['conta_origem_id']) === c.id,
      outraConta: n(t['conta_origem_id']) === c.id ? n(t['conta_destino_id']) : n(t['conta_origem_id']),
      motivo: txt(t['motivo']),
      em:
        t['transferido_em'] instanceof Date
          ? (t['transferido_em'] as Date).toISOString()
          : txt(t['transferido_em']),
      valorOrigem: n(t['valor_total_origem']),
      valorDestino: n(t['valor_total_destino']),
      situacao: txt(t['situacao']),
      itens: n(t['itens']),
    })),
  };
}

/** Profissionais por nome (parte dele) ou pelo número da inscrição no conselho, para a equipe do item. */
export async function buscarProfissionaisPropria(l: Leitor, termo: string) {
  const t = termo.trim().slice(0, 80);
  if (t.length < 3) return [];
  const linhas = await l.consultar<Linha>(
    `SELECT pr.id, pf.nome,
            (SELECT ic.numero_inscricao FROM inscricao_conselho ic WHERE ic.profissional_id = pr.id AND ic.excluido_em IS NULL
              ORDER BY ic.principal DESC, ic.sequencia LIMIT 1) AS inscricao
       FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE pr.excluido_em IS NULL
        AND (pf.nome LIKE ? OR EXISTS (SELECT 1 FROM inscricao_conselho ic WHERE ic.profissional_id = pr.id
              AND ic.excluido_em IS NULL AND ic.numero_inscricao = ?))
      ORDER BY pf.nome LIMIT 30`,
    [`%${t.replace(/[%_\\]/g, (x) => `\\${x}`)}%`, t],
    { teto: 30 },
  );
  return linhas.map((p) => ({ id: n(p['id']), nome: txt(p['nome']), inscricao: txt(p['inscricao']) }));
}

/** Itens cobráveis ativos por código (exato ou início) ou parte da descrição: o cadastro do kit escolhe por aqui. */
export async function buscarItensCobrancaPropria(l: Leitor, termo: string) {
  const t = termo.trim().slice(0, 80);
  if (t.length < 2) return [];
  const esc = t.replace(/[%_\\]/g, (x) => `\\${x}`);
  const linhas = await l.consultar<Linha>(
    `SELECT id, codigo, descricao FROM item_faturavel
      WHERE excluido_em IS NULL AND situacao = 'ativo' AND (codigo LIKE ? OR descricao LIKE ?)
      ORDER BY codigo = ? DESC, codigo LIMIT 30`,
    [`${esc}%`, `%${esc}%`, t],
    { teto: 30 },
  );
  return linhas.map((i) => ({ id: n(i['id']), codigo: txt(i['codigo']), descricao: txt(i['descricao']) }));
}

// ── Linha 15: equipe do item ──────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
export const esquemaEquipe = z.object({
  itemId: id,
  participantes: z
    .array(
      z.object({
        profissionalId: id,
        funcaoId: id,
        grauId: id.nullable().default(null),
        percentual: z.number().min(0).max(100).nullable().default(null),
        formaPagamento: z.enum(FORMAS_PAGAMENTO_PARTICIPANTE).default('via_hospital'),
      }),
    )
    .max(30),
});

async function itemDaConta(tx: TxOperacao, est: number, item: number) {
  const i = await tx.uma<Linha>(
    `SELECT i.id, i.versao, i.conta_hospitalar_id, i.situacao, i.valor_honorario, i.valor_total
       FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id
      WHERE i.id = ? AND c.estabelecimento_id = ? AND i.excluido_em IS NULL`,
    [item, est],
  );
  if (!i) throw recusa('nao-encontrado', 'O item não existe nesta conta.', { campos: ['itemId'] });
  return i;
}

/** A linha gravada da equipe na forma do domínio (só o que o adicional usa: função, forma e valor do ato). */
const comoCalculado = (a: Linha): ParticipanteCalculado => ({
  sequencia: n(a['sequencia']),
  profissional: n(a['profissional_id']),
  funcao: n(a['funcao_equipe_cobranca_id']),
  grau: null,
  percentual: 0,
  formaPagamento: txt(a['forma_pagamento']) as ParticipanteCalculado['formaPagamento'],
  valorAto: n(a['valor_ato']),
});

export const opGravarEquipe = definirOperacao({
  nome: 'faturamento.gravar-equipe-item',
  tabelas: [
    'conta_hospitalar_item_participante',
    'conta_hospitalar_item_memoria',
    'conta_hospitalar_item',
    'conta_hospitalar',
  ],
  entrada: esquemaEquipe,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const i = await itemDaConta(tx, est, e.itemId);
    const c = await contaDo(tx, est, n(i['conta_hospitalar_id']));
    if (!contaEditavel(c.situacao))
      throw recusa('conta-fechada', 'A conta não está aberta: reabra-a para mudar a equipe.', { campos: [] });
    if (['estornado', 'transferido'].includes(txt(i['situacao'])))
      throw recusa('item-inativo', 'O item foi estornado ou transferido: a equipe não muda.', {
        campos: ['itemId'],
      });
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar_item WHERE id = ?', [e.itemId]);
    const funcoes = await funcoesEquipe(tx);
    const informados = e.participantes.map((p) => ({
      profissional: p.profissionalId,
      funcao: p.funcaoId,
      grau: p.grauId,
      percentual: p.percentual,
      formaPagamento: p.formaPagamento,
    }));
    exigirValido(validarEquipeItem(informados, funcoes));
    const profs = [...new Set(informados.map((p) => p.profissional))];
    if (profs.length) {
      const achados = await tx.consultar<Linha>(
        `SELECT id FROM profissional WHERE id IN (${lista(profs.length)}) AND excluido_em IS NULL`,
        profs,
        { teto: profs.length },
      );
      if (achados.length !== profs.length)
        throw recusa('referencia-inexistente', 'Há profissional que não existe.', {
          campos: ['participantes'],
        });
    }
    const calc = calcularEquipeItem(informados, funcoes, n(i['valor_honorario']));
    const atuais = await tx.consultar<Linha>(
      `SELECT id, versao, sequencia, profissional_id, funcao_equipe_cobranca_id, forma_pagamento, valor_ato, excluido_em
         FROM conta_hospitalar_item_participante WHERE conta_hospitalar_item_id = ? ORDER BY sequencia`,
      [e.itemId],
      { teto: 500 },
    );
    const chave = (p: number, f: number) => `${p}:${f}`;
    const chaveDe = (a: Linha) => chave(n(a['profissional_id']), n(a['funcao_equipe_cobranca_id']));
    const desejado = new Map(calc.map((p) => [chave(p.profissional, p.funcao), p]));
    // O adicional da equipe que já estava no valor do item (para trocá-lo pelo novo sem mexer no resto do item).
    const adicionalAnterior = adicionalDaEquipe(
      atuais.filter((a) => a['excluido_em'] === null).map((a) => comoCalculado(a)),
      funcoes,
    );
    const adicionalNovo = adicionalDaEquipe(calc, funcoes);
    const valorNovo = valorItemComEquipe(n(i['valor_total']), adicionalAnterior, adicionalNovo);
    const agora = new Date();
    // A unicidade (item, sequência) vale também para as linhas retiradas: primeiro todas sobem para uma faixa livre,
    // depois a equipe recebe 1..n na ordem calculada e as retiradas, n+1 em diante (nada se apaga).
    // A faixa livre fica acima de qualquer número final (equipe nova + todas as linhas já gravadas).
    const topo =
      Math.max(
        atuais.reduce((m, a) => Math.max(m, n(a['sequencia'])), 0),
        atuais.length + calc.length,
      ) + 1;
    const versoes = new Map<number, number>();
    let k = 0;
    for (const a of atuais) {
      const fora = !desejado.has(chaveDe(a));
      versoes.set(
        n(a['id']),
        await tx.alterar('conta_hospitalar_item_participante', n(a['id']), n(a['versao']), {
          sequencia: topo + k++,
          ...(fora && a['excluido_em'] === null ? { excluido_em: agora, excluido_por: ctx.usuario } : {}),
        }),
      );
    }
    for (const p of calc) {
      const a = atuais.find((x) => chaveDe(x) === chave(p.profissional, p.funcao));
      const valores = {
        sequencia: p.sequencia,
        grau_participacao_termo_terminologia_id: p.grau,
        forma_pagamento: p.formaPagamento,
        percentual_cobranca: p.percentual,
        valor_ato: p.valorAto,
        valor_liquido: p.valorAto,
        paciente_paga: p.formaPagamento === 'paciente',
      };
      if (a)
        versoes.set(
          n(a['id']),
          await tx.alterar('conta_hospitalar_item_participante', n(a['id']), versoes.get(n(a['id']))!, {
            ...valores,
            excluido_em: null,
            excluido_por: null,
          }),
        );
      else
        await tx.incluir('conta_hospitalar_item_participante', {
          conta_hospitalar_item_id: e.itemId,
          profissional_id: p.profissional,
          funcao_equipe_cobranca_id: p.funcao,
          ...valores,
        });
    }
    let fora = calc.length;
    for (const a of atuais)
      if (!desejado.has(chaveDe(a)))
        await tx.alterar('conta_hospitalar_item_participante', n(a['id']), versoes.get(n(a['id']))!, {
          sequencia: ++fora,
        });
    // O ato dos participantes cobrados pelo hospital (além do titular) compõe o valor do item e o total da conta.
    if (valorNovo !== n(i['valor_total'])) {
      await tx.alterar('conta_hospitalar_item', e.itemId, n(i['versao']), { valor_total: valorNovo });
      await tx.alterar('conta_hospitalar', c.id, c.versao, await totalDosItens(tx, c.id));
    }
    await tx.incluir('conta_hospitalar_item_memoria', {
      conta_hospitalar_item_id: e.itemId,
      valor_total_calculado: valorNovo,
      preco_manual: 0,
      operacao: 'alteracao',
      dados: JSON.stringify({
        origem: 'equipe',
        honorario: n(i['valor_honorario']),
        valorAnterior: n(i['valor_total']),
        adicionalAnterior,
        adicionalEquipe: adicionalNovo,
        equipe: calc,
      }),
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    return {
      itemId: e.itemId,
      participantes: calc.length,
      valorItem: valorNovo,
      adicionalEquipe: adicionalNovo,
    };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar_item', id: e.itemId }),
});

// ── Linha 16: kit de cobrança ─────────────────────────────────────────────────────────────────────

const dataZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data AAAA-MM-DD.');
export const esquemaLancarKit = z.object({
  contaId: id,
  kitId: id,
  vezes: z.number().positive().max(1000).default(1),
  data: dataZ.optional(),
});

export const opLancarKit = definirOperacao({
  nome: 'faturamento.lancar-kit',
  tabelas: ['conta_hospitalar_item', 'conta_hospitalar_item_memoria', 'conta_hospitalar'],
  entrada: esquemaLancarKit,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    const c = await contaDo(tx, est, e.contaId);
    if (!contaEditavel(c.situacao))
      throw recusa('conta-fechada', 'A conta não está aberta: o kit não entra nela.', { campos: [] });
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c.id]);
    const kit = await kitDo(tx, est, e.kitId);
    const r = lancamentoDoKit(kit, { fontePagadora: c.fontePagadora, plano: c.plano }, e.vezes);
    exigirValido(r.erros);
    const { itens: lancados, semPreco } = await lancarLinhasDoKit(
      tx,
      est,
      { id: c.id, fontePagadora: c.fontePagadora, plano: c.plano, tabela: c.tabela },
      kit,
      r.linhas,
      e.vezes,
      e.data ?? hoje(),
      ctx.usuario,
    );
    await tx.alterar('conta_hospitalar', c.id, c.versao, await totalDosItens(tx, c.id));
    return { contaId: c.id, itens: lancados.length, semPreco, avisos: r.avisos.join(',') };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.contaId }),
});

export const esquemaCadastrarKit = z.object({
  codigo: z.string().trim().max(30),
  descricao: z.string().trim().max(150),
  tipoKit: z.enum(['procedimento', 'sala', 'cota', 'outro']).default('procedimento'),
  modo: z.enum(['aberto', 'fechado']).default('aberto'),
  itemId: id.nullable().default(null),
  gatilhoItemId: id.nullable().default(null),
  fontePagadoraId: id.nullable().default(null),
  planoId: id.nullable().default(null),
  todosEstabelecimentos: z.boolean().default(false),
  componentes: z
    .array(
      z.object({
        itemId: id.nullable().default(null),
        equipamentoId: id.nullable().default(null),
        quantidade: z.number(),
        inclusoNoPacote: z.boolean().default(false),
      }),
    )
    .max(200),
});

export const opCadastrarKit = definirOperacao({
  nome: 'faturamento.cadastrar-kit',
  tabelas: ['kit_cobranca', 'kit_cobranca_item'],
  entrada: esquemaCadastrarKit,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    exigirValido(
      validarDefinicaoKit({
        codigo: e.codigo,
        descricao: e.descricao,
        modo: e.modo,
        item: e.itemId,
        gatilho: e.gatilhoItemId,
        componentes: e.componentes.map((c) => ({
          item: c.itemId,
          equipamento: c.equipamentoId,
          quantidade: c.quantidade,
        })),
      }),
    );
    if (await tx.uma('SELECT id FROM kit_cobranca WHERE codigo = ?', [e.codigo]))
      throw recusa('codigo-repetido', 'Já existe kit com este código.', { campos: ['codigo'] });
    const kit = await tx.incluir('kit_cobranca', {
      estabelecimento_id: e.todosEstabelecimentos ? null : est,
      codigo: e.codigo,
      descricao: e.descricao,
      tipo_kit: e.tipoKit,
      item_faturavel_id: e.itemId,
      item_gatilho_id: e.gatilhoItemId,
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      modo_cobranca: e.modo,
      ativo: true,
    });
    let s = 0;
    for (const c of e.componentes)
      await tx.incluir('kit_cobranca_item', {
        kit_cobranca_id: kit,
        sequencia: ++s,
        item_faturavel_id: c.itemId,
        equipamento_saude_id: c.equipamentoId,
        quantidade: c.quantidade,
        incluso_no_pacote: c.inclusoNoPacote,
      });
    return { id: kit, componentes: s };
  },
  alvo: (_e, r) => ({ tabela: 'kit_cobranca', id: r.id }),
});

// ── Linha 14: transferência de itens entre contas ─────────────────────────────────────────────────

/** Onde o item é precificado na transferência: o estabelecimento, a fonte, o plano e a tabela da conta de destino. */
export interface DestinoDoPreco {
  readonly estabelecimento: number;
  readonly fontePagadora: number;
  readonly plano: number | null;
  readonly tabela: number | null;
}

/**
 * O preço vigente de cada item nas tabelas do destino, no dia em que foi realizado. É a única busca do preço da
 * transferência: a prévia do painel e a gravação usam esta função com os mesmos argumentos.
 */
export async function precosNoDestino(
  l: Pick<Leitor, 'consultar' | 'uma'>,
  destino: DestinoDoPreco,
  itens: readonly { readonly id: number; readonly itemFaturavel: number; readonly realizadoEm: unknown }[],
): Promise<Map<number, PrecoVigente | null>> {
  const tabelas = await tabelasDePreco(
    l as Leitor,
    destino.estabelecimento,
    destino.fontePagadora,
    destino.plano,
    destino.tabela,
  );
  const precos = new Map<number, PrecoVigente | null>();
  for (const i of itens)
    precos.set(
      i.id,
      await precoVigente(l as Leitor, tabelas, i.itemFaturavel, diaDe(i.realizadoEm) ?? diaDe(new Date())!, {
        est: destino.estabelecimento,
        fonte: destino.fontePagadora,
      }),
    );
  return precos;
}

export const esquemaTransferir = z.object({
  contaOrigemId: id,
  contaDestinoId: id,
  itens: z.array(id).max(2000),
  motivo: z.string().trim().max(500),
  observacao: z.string().trim().max(1000).nullable().default(null),
  /** Item sem preço no destino só vai com o aceite e a justificativa (vale para toda transferência). */
  aceitarSemCobertura: z.boolean().default(false),
  justificativaCobertura: z.string().trim().max(400).nullable().default(null),
});

export const opTransferir = definirOperacao({
  nome: 'faturamento.transferir-itens-conta',
  tabelas: [
    'transferencia_conta',
    'transferencia_conta_item',
    'conta_hospitalar_item',
    'conta_hospitalar_item_participante',
    'conta_hospitalar_item_memoria',
    'conta_hospitalar',
  ],
  entrada: esquemaTransferir,
  async gravar(tx, e, ctx) {
    const est = estDe(ctx);
    if (ctx.usuario === null)
      throw recusa('sem-usuario', 'A transferência exige o usuário da sessão (autor).', { campos: [] });
    // Trava as duas contas na ordem do id (sem impasse com outra transferência no sentido contrário).
    for (const x of [e.contaOrigemId, e.contaDestinoId].sort((a, b) => a - b))
      await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [x]);
    const origem = await contaDo(tx, est, e.contaOrigemId);
    const destino = await contaDo(tx, null, e.contaDestinoId);
    // Conta de outro estabelecimento: só quem pode ajustar a conta lá (a permissão da sessão vale só no dela).
    if (
      destino.estabelecimento !== est &&
      !(await podeNoEstabelecimento(
        tx,
        ctx.usuario,
        destino.estabelecimento,
        'faturamento.auditoria.ajustar',
      ))
    )
      throw recusa(
        'sem-permissao-estabelecimento',
        'Você não tem acesso ao faturamento do estabelecimento da conta de destino.',
        { campos: ['contaDestinoId'] },
      );
    const itens = e.itens.length
      ? await tx.consultar<Linha>(
          `SELECT * FROM conta_hospitalar_item WHERE id IN (${lista(e.itens.length)}) AND excluido_em IS NULL`,
          e.itens,
          { teto: e.itens.length },
        )
      : [];
    const comoConta = (c: ContaLida) => ({
      id: c.id,
      situacao: c.situacao,
      estabelecimento: c.estabelecimento,
      fontePagadora: c.fontePagadora,
      paciente: c.paciente,
      inicio: c.inicio,
      fim: c.fim,
    });
    const v = validarTransferencia(
      comoConta(origem),
      comoConta(destino),
      itens.map((i) => ({
        id: n(i['id']),
        conta: n(i['conta_hospitalar_id']),
        situacao: txt(i['situacao']),
        realizado: diaDe(i['realizado_em']),
      })),
      e.itens,
      e.motivo,
    );
    exigirValido(v.erros);
    // Período fechado (C2-035): o item não sai da faixa fechada da origem nem entra na faixa fechada do destino.
    for (const i of itens) {
      const r = i['realizado_em'];
      const realizado = r instanceof Date ? r : new Date(String(r));
      const tipo = i['tipo_lancamento_id'] == null ? null : n(i['tipo_lancamento_id']);
      await conferirLancamentoNoPeriodo(tx, origem.id, realizado, tipo);
      await conferirLancamentoNoPeriodo(tx, destino.id, realizado, tipo);
    }
    // Cobertura no destino, num ponto só para toda transferência (itens marcados, conta inteira e lote).
    const precos = await precosNoDestino(
      tx,
      destino,
      itens.map((i) => ({
        id: n(i['id']),
        itemFaturavel: n(i['item_faturavel_id']),
        realizadoEm: i['realizado_em'],
      })),
    );
    const cob = avaliarCoberturaDestino(
      e.itens.map((idItem) => ({ id: idItem, precoNoDestino: Boolean(precos.get(idItem)) })),
      e.aceitarSemCobertura,
      e.justificativaCobertura,
    );
    exigirValido(cob.erros);
    const observacao =
      [
        e.observacao,
        cob.semCobertura.length
          ? `Sem cobertura no destino (${cob.semCobertura.length}): ${e.justificativaCobertura ?? ''}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 1000) || null;
    const agora = new Date();
    const numero = await tx.proximoNumero('transferencia_conta');
    const transf = await tx.incluir('transferencia_conta', {
      estabelecimento_id: est,
      numero: numero.valor,
      tipo: v.tipo,
      conta_origem_id: origem.id,
      conta_destino_id: destino.id,
      fonte_pagadora_origem_id: origem.fontePagadora,
      fonte_pagadora_destino_id: destino.fontePagadora,
      estabelecimento_destino_id: v.tipo === 'estabelecimento' ? destino.estabelecimento : null,
      motivo: e.motivo,
      observacao,
      transferido_em: agora,
      usuario_id: ctx.usuario,
      situacao: 'efetivada',
    });
    let totalOrigem = 0;
    let totalDestino = 0;
    let s = 0;
    let semPreco = 0;
    const funcoes = await funcoesEquipe(tx);
    for (const idItem of e.itens) {
      const i = itens.find((x) => n(x['id']) === idItem)!;
      const qtd = n(i['quantidade']);
      const preco = precos.get(idItem) ?? null;
      if (!preco) semPreco += 1;
      const unitario = preco?.unitario ?? n(i['valor_unitario']);
      const honorarioDestino = preco ? r2(preco.honorario * qtd) : n(i['valor_honorario']);
      // A equipe é refeita sobre o honorário do destino, com o percentual gravado de cada participante (sem ele, o da
      // função); o adicional dos participantes cobrados pelo hospital entra no valor do item de destino.
      const equipe = await tx.consultar<Linha>(
        `SELECT * FROM conta_hospitalar_item_participante
          WHERE conta_hospitalar_item_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [idItem],
        { teto: 100 },
      );
      const equipeDestino = calcularEquipeItem(
        equipe.map((p) => ({
          profissional: n(p['profissional_id']),
          funcao: n(p['funcao_equipe_cobranca_id']),
          grau: nn(p['grau_participacao_termo_terminologia_id']),
          percentual: nn(p['percentual_cobranca']),
          formaPagamento: txt(p['forma_pagamento']) as ParticipanteCalculado['formaPagamento'],
        })),
        funcoes,
        honorarioDestino,
      );
      const adicionalEquipe = adicionalDaEquipe(equipeDestino, funcoes);
      const valorDestino = r2(unitario * qtd + adicionalEquipe);
      totalOrigem += n(i['valor_total']);
      totalDestino += valorDestino;
      const seq = await tx.uma<Linha>(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
        [destino.id],
      );
      // F7 (09-AREA linha 76): a cobertura da fonte pagadora antes de incluir o item (o bloqueio recusa).
      await criticarCoberturaDoItemConta(tx, destino.estabelecimento, {
        conta: destino.id,
        item: Number(i['item_faturavel_id']),
        realizado: i['realizado_em'] as Date | string,
        quantidade: qtd,
        valorTotal: valorDestino,
      });
      const novo = await tx.incluir('conta_hospitalar_item', {
        conta_hospitalar_id: destino.id,
        sequencia: n(seq?.['s']),
        item_faturavel_id: i['item_faturavel_id'],
        grupo_faturamento_id: i['grupo_faturamento_id'],
        tipo_lancamento_id: i['tipo_lancamento_id'],
        item_pai_id: null,
        realizado_em: i['realizado_em'],
        realizado_fim_em: i['realizado_fim_em'],
        quantidade: qtd,
        valor_unitario: unitario,
        valor_honorario: honorarioDestino,
        valor_custo_operacional: preco ? r2(preco.custoOperacional * qtd) : i['valor_custo_operacional'],
        valor_filme: preco ? r2(preco.filme * qtd) : i['valor_filme'],
        valor_total: valorDestino,
        executante_profissional_id: i['executante_profissional_id'],
        solicitante_profissional_id: i['solicitante_profissional_id'],
        funcao_equipe_cobranca_id: i['funcao_equipe_cobranca_id'] ?? null,
        setor_funcional_id: v.tipo === 'estabelecimento' ? null : i['setor_funcional_id'],
        produtor_setor_funcional_id: v.tipo === 'estabelecimento' ? null : i['produtor_setor_funcional_id'],
        kit_cobranca_id: i['kit_cobranca_id'],
        numero_lote: i['numero_lote'],
        numero_serie: i['numero_serie'],
        registro_anvisa: i['registro_anvisa'],
        tipo_valorizacao: preco ? 'tabela' : 'manual',
        situacao: 'lancado',
        observacao: `Transferido da conta ${origem.numero} (transferência ${numero.formatado}).`.slice(
          0,
          2000,
        ),
      });
      await tx.alterar('conta_hospitalar_item', idItem, n(i['versao']), { situacao: 'transferido' });
      await tx.incluir('transferencia_conta_item', {
        transferencia_conta_id: transf,
        sequencia: ++s,
        item_origem_id: idItem,
        item_destino_id: novo,
        item_faturavel_id: i['item_faturavel_id'],
        quantidade: qtd,
        valor_origem: n(i['valor_total']),
        valor_recalculado: valorDestino,
      });
      await tx.incluir('conta_hospitalar_item_memoria', {
        conta_hospitalar_item_id: novo,
        tabela_preco_id: preco?.tabela ?? null,
        valor_unitario_calculado: unitario,
        valor_total_calculado: valorDestino,
        preco_manual: 0,
        operacao: 'inclusao',
        dados: JSON.stringify({
          origem: 'transferencia',
          transferencia: numero.formatado,
          itemOrigem: idItem,
          valorOrigem: n(i['valor_total']),
          origemPreco: preco ? 'tabela_destino' : 'valor_origem_sem_preco_destino',
          vigencia: preco?.vigencia ?? null,
          adicionalEquipe,
          equipe: equipeDestino,
        }),
        ocorrido_em: agora,
        usuario_id: ctx.usuario,
      });
      // A equipe acompanha o item: a cópia nasce no destino com o valor do ato refeito, e a da origem fica encerrada
      // pela transferência (marcada, com a referência dela; nunca apagada), para não contar o honorário duas vezes.
      for (const p of equipe) {
        const calc = equipeDestino.find(
          (x) => x.profissional === n(p['profissional_id']) && x.funcao === n(p['funcao_equipe_cobranca_id']),
        )!;
        await tx.incluir('conta_hospitalar_item_participante', {
          conta_hospitalar_item_id: novo,
          sequencia: calc.sequencia,
          profissional_id: p['profissional_id'],
          funcao_equipe_cobranca_id: p['funcao_equipe_cobranca_id'],
          grau_participacao_termo_terminologia_id: calc.grau,
          ocupacao_cbo_id: p['ocupacao_cbo_id'],
          recebedor_prestador_terceiro_id: p['recebedor_prestador_terceiro_id'],
          forma_pagamento: calc.formaPagamento,
          percentual_cobranca: calc.percentual,
          valor_ato: calc.valorAto,
          valor_liquido: calc.valorAto,
          paciente_paga: p['paciente_paga'],
        });
        await tx.alterar('conta_hospitalar_item_participante', n(p['id']), n(p['versao']), {
          excluido_em: agora,
          excluido_por: ctx.usuario,
          transferencia_conta_id: transf,
        });
      }
    }
    const vo = await tx.uma<Linha>('SELECT versao FROM conta_hospitalar WHERE id = ?', [origem.id]);
    await tx.alterar('conta_hospitalar', origem.id, n(vo?.['versao']), await totalDosItens(tx, origem.id));
    const vd = await tx.uma<Linha>('SELECT versao FROM conta_hospitalar WHERE id = ?', [destino.id]);
    await tx.alterar('conta_hospitalar', destino.id, n(vd?.['versao']), await totalDosItens(tx, destino.id));
    await tx.alterar('transferencia_conta', transf, 1, {
      valor_total_origem: r2(totalOrigem),
      valor_total_destino: r2(totalDestino),
    });
    return {
      id: transf,
      numero: numero.formatado,
      tipo: v.tipo,
      itens: s,
      valorOrigem: r2(totalOrigem),
      valorDestino: r2(totalDestino),
      semPreco,
    };
  },
  alvo: (_e, r) => ({ tabela: 'transferencia_conta', id: r.id }),
  trilha: (e) => ({ motivo: e.motivo, justificativaCobertura: e.justificativaCobertura }),
});

// ── Linha 15: lançamento manual com a equipe no mesmo pedido ──────────────────────────────────────
// O item e a sua equipe entram na mesma transação: o lançamento é o de sempre (faturamento.lancar-item: preço, memória,
// competência, credenciamento e o evento do item lançado), e a equipe passa pela mesma regra da edição (validarEquipeItem,
// valor do ato pelo honorário do item recém-lançado). Recusada a equipe, o item também não entra.
export const esquemaLancarComEquipe = esquemaLancarItem.extend({
  equipe: esquemaEquipe.shape.participantes.min(1),
});
type LancarComEquipe = z.infer<typeof esquemaLancarComEquipe>;

export const opLancarComEquipe = definirOperacao({
  ...lancarItem,
  nome: 'faturamento.lancar-item-com-equipe',
  tabelas: [...new Set([...lancarItem.tabelas, ...opGravarEquipe.tabelas])],
  entrada: esquemaLancarComEquipe,
  travar: (e: LancarComEquipe, ctx: ContextoOperacao) => lancarItem.travar?.(e, ctx) ?? null,
  async gravar(tx, e: LancarComEquipe, ctx) {
    const { equipe, ...item } = e;
    const r = await lancarItem.gravar(tx, item, ctx);
    const itemId = Number(r['id']);
    const eq = await opGravarEquipe.gravar(tx, esquemaEquipe.parse({ itemId, participantes: equipe }), ctx);
    return {
      ...r,
      participantes: eq.participantes,
      valorItem: eq.valorItem,
      adicionalEquipe: eq.adicionalEquipe,
    };
  },
});

export const OPERACOES_MOVIMENTOS = {
  equipe: opGravarEquipe,
  'lancar.equipe': opLancarComEquipe,
  'kit.lancar': opLancarKit,
  'kit.cadastrar': opCadastrarKit,
  transferir: opTransferir,
} as const;
export type NomeOperacaoMovimentos = keyof typeof OPERACOES_MOVIMENTOS;

export async function gravarMovimentos(
  executor: Executor,
  nome: NomeOperacaoMovimentos,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_MOVIMENTOS[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
