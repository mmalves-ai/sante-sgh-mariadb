// Gravação PRÓPRIA da revisão de um prontuário pela comissão (qualidade.revisarProntuario, F3.9-Q4): o checklist
// respondido item a item, o resultado e as pendências ao profissional, numa transação só. A porta própria completa da
// gestão espalha esta gravação no seu gravador (a da base falhava fechada com `modelo-pendente`).
// Mapeamento para o modelo próprio:
// - revisao_prontuario: travada e conferida pela versão; só a da amostra ativa (sorteio não cancelado), sem aval e não
//   cancelada. Grava o resultado (conforme ou nao_conforme), o percentual de conformidade dos itens aplicáveis, as
//   pendências geradas, a observação, quem revisou, quando, a situação 'concluida' e, na correção, a justificativa.
// - revisao_prontuario_item: uma linha por item do checklist da versão gravada com a amostra (a sequência é a do item
//   no checklist); o resultado, a observação, o profissional cobrado no item não conforme e a pendência do item. A
//   correção altera a linha (nunca apaga): a linha anterior vai inteira à trilha.
// - pendencia_prontuario: a regra do plano (domínio, planoRevisaoProntuario) decide criar, reabrir ou cancelar. A nova
//   leva o tipo da revisão da comissão (semente `revisao_comissao`), o atendimento e o paciente da revisão, o médico
//   responsável, a descrição, o prazo (fim do dia) e quem apontou; a reaberta volta a 'aberta' sem a resolução; a do
//   item que deixou de ser não conforme vai a 'cancelada' com o motivo em `resolucao` (convenção do Q3 e do Q5).
// - O item do checklist é casado pelo código efetivo (o próprio ou `item<sequência>` quando o item não tem código), o
//   mesmo da leitura que monta a tela e do controlador; o peso e o "aceita não se aplica" do item vão ao plano.
// - Correção (revisão já gravada): exige a justificativa; a revisão, os itens e as pendências como estavam vão à
//   trilha (dados.versaoAnterior, lida pelas versões do registro).
import { esquemaRespostaItemRevisao, type RespostaItemRevisao } from '@sgh/contratos';
import {
  codigoItemChecklist,
  motivoCancelamentoPorCorrecao,
  planoRevisaoProntuario,
} from '@sgh/dominio-qualidade';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import { exigirUsuario, instante, type Linha, marcas, n, paraBanco, texto } from './apoio-propria.js';
import type { GravadorGestao } from './porta-gestao.js';
import { recusaVersaoGestao, type RevisaoNova } from './tipos.js';

/** As tabelas que a gravação da revisão grava (somadas às da porta completa). */
export const TABELAS_REVISAR_PRONTUARIO = [
  'revisao_prontuario',
  'revisao_prontuario_item',
  'pendencia_prontuario',
] as const;

/** O código do tipo de pendência da revisão pela comissão (semente da qualidade, db/sementes/18_qualidade.json). */
export const TIPO_PENDENCIA_REVISAO = 'revisao_comissao';

const RESULTADO_BANCO: Record<RespostaItemRevisao['resultado'], string> = {
  conforme: 'conforme',
  naoConforme: 'nao_conforme',
  naoAplicavel: 'nao_se_aplica',
};

const respostasValidas = z.array(esquemaRespostaItemRevisao);

const situacaoPlano = (s: string): 'aberta' | 'resolvida' | 'cancelada' =>
  s === 'aberta' || s === 'em_resolucao'
    ? 'aberta'
    : s === 'resolvida' || s === 'justificada'
      ? 'resolvida'
      : 'cancelada';

/** A linha como estava (datas no formato local), para a versão anterior na trilha. */
const retrato = (r: Linha): Record<string, unknown> =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));

/** O prazo da pendência (data) como o fim do dia no DATETIME do banco. */
const prazoBanco = (d: string): string => `${d.slice(0, 10)} 23:59:59`;

async function revisarProntuario(
  tx: TxOperacao,
  est: number,
  r: RevisaoNova,
  anotacao: AnotacaoGravacao,
): Promise<{ versao: number }> {
  const [antes] = await tx.consultarParaAtualizar<Linha>(
    `SELECT * FROM revisao_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [r.id, est],
    { teto: 1 },
  );
  if (
    !antes ||
    n(antes['versao']) !== r.versao ||
    antes['avalizada_em'] !== null ||
    !['em_andamento', 'concluida'].includes(texto(antes['situacao']))
  )
    throw recusaVersaoGestao('O prontuário');
  const sorteio = antes['sorteio_revisao_prontuario_id'];
  if (sorteio !== null) {
    const s = await tx.uma<{ situacao: string }>(
      'SELECT situacao FROM sorteio_revisao_prontuario WHERE id = ? AND estabelecimento_id = ?',
      [sorteio, est],
    );
    if (!s || texto(s.situacao) === 'cancelado')
      throw recusa('sorteio-cancelado', 'O sorteio desta amostra foi cancelado: a revisão não se grava.');
  }
  const corrigindo = antes['revisada_em'] !== null;
  const justificativa = r.justificativa?.trim() ?? '';
  if (corrigindo && justificativa.length < 10)
    throw recusa(
      'justificativa-obrigatoria',
      'A correção da revisão já gravada exige a justificativa (ao menos 10 caracteres).',
    );

  // As respostas contra o checklist da versão gravada com a amostra: todos os itens, cada um uma vez.
  const lidas = respostasValidas.safeParse(JSON.parse(r.respostas));
  if (!lidas.success)
    throw recusa('resposta-invalida', 'As respostas da revisão não vieram no formato do contrato.');
  const respostas = lidas.data;
  const itensChecklist = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, sequencia, codigo, peso, aceita_nao_aplicavel FROM modelo_checklist_qualidade_item
      WHERE modelo_checklist_qualidade_versao_id = ? ORDER BY sequencia`,
    [antes['modelo_checklist_qualidade_versao_id']],
    { teto: 500 },
  );
  const codigoDe = (i: Linha): string =>
    codigoItemChecklist(i['codigo'] === null ? null : texto(i['codigo']), n(i['sequencia']));
  const doChecklist = new Map(itensChecklist.map((i) => [codigoDe(i), i]));
  const vistos = new Set(respostas.map((x) => x.item));
  if (respostas.some((x) => !doChecklist.has(x.item)))
    throw recusa('item-fora-do-checklist', 'Há resposta a item que não é do checklist desta revisão.');
  if (vistos.size !== doChecklist.size || respostas.length !== doChecklist.size)
    throw recusa('resposta-incompleta', 'A revisão responde cada item do checklist uma vez.');

  // Os itens já gravados e as pendências deles, travados.
  const itensAntes = await tx.consultarParaAtualizar<Linha>(
    `SELECT ri.*, mi.codigo AS item_codigo, mi.sequencia AS item_sequencia FROM revisao_prontuario_item ri
       JOIN modelo_checklist_qualidade_item mi ON mi.id = ri.modelo_checklist_qualidade_item_id
      WHERE ri.revisao_prontuario_id = ? AND ri.excluido_em IS NULL`,
    [r.id],
    { teto: 501 },
  );
  const idsPend = itensAntes
    .map((i) => i['pendencia_prontuario_id'])
    .filter((x) => x !== null)
    .map(n);
  const pendAntes =
    idsPend.length === 0
      ? []
      : await tx.consultarParaAtualizar<Linha>(
          `SELECT * FROM pendencia_prontuario
            WHERE id IN (${marcas(idsPend.length)}) AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [...idsPend, est],
          { teto: idsPend.length },
        );
  const pendPorId = new Map(pendAntes.map((p) => [n(p['id']), p]));
  const codigoAntes = (i: Linha): string =>
    codigoItemChecklist(i['item_codigo'] === null ? null : texto(i['item_codigo']), n(i['item_sequencia']));
  const itemPorCodigo = new Map(itensAntes.map((i) => [codigoAntes(i), i]));
  const existentes = itensAntes.flatMap((i) => {
    const p =
      i['pendencia_prontuario_id'] === null ? undefined : pendPorId.get(n(i['pendencia_prontuario_id']));
    return p ? [{ id: n(p['id']), item: codigoAntes(i), situacao: situacaoPlano(texto(p['situacao'])) }] : [];
  });

  const responsavel = r.profissional.registro;
  const plano = planoRevisaoProntuario(
    respostas,
    existentes,
    responsavel !== null,
    itensChecklist.map((i) => ({
      codigo: codigoDe(i),
      peso: Number(i['peso'] ?? 1),
      aceitaNaoAplicavel: Boolean(n(i['aceita_nao_aplicavel'] ?? 1)),
    })),
  );
  if (!plano.ok)
    throw recusa(
      plano.motivo,
      plano.motivo === 'nao-aplicavel-nao-aceito'
        ? 'Há item respondido como "não se aplica" que o checklist não aceita assim.'
        : 'A internação não tem médico assistente: a pendência do item não conforme não teria a quem ser cobrada.',
    );
  const p = plano.plano;
  if (p.resultado !== r.situacao)
    throw recusa('resultado-divergente', 'O resultado informado não confere com as respostas da revisão.');

  const usuario = await exigirUsuario(tx, r.usuario);
  const agora = paraBanco(r.agora);
  const descricaoDe = (item: string): string =>
    r.pendencias.find((x) => x.item === item)?.descricao ?? `Item não conforme: ${item}.`;
  const prazoDe = (item: string): string | null => {
    const d = r.pendencias.find((x) => x.item === item)?.prazo;
    return d ? prazoBanco(d) : null;
  };

  // A versão anterior (revisão, itens e pendências como estavam) vai à trilha na correção.
  if (corrigindo) {
    anotacao.motivo = justificativa;
    anotacao.dados = {
      ...(anotacao.dados ?? {}),
      versaoAnterior: {
        tabela: 'revisao_prontuario',
        id: n(antes['id']),
        versao: n(antes['versao']),
        acao: 'correcao',
        motivo: justificativa,
        dados: { ...retrato(antes), itens: itensAntes.map(retrato), pendencias: pendAntes.map(retrato) },
      },
    };
  }

  // Pendências: novas, reabertas e canceladas pela correção.
  const novas = new Map<string, number>();
  if (p.criar.length > 0) {
    const tipo = await tx.uma<{ id: number }>(
      'SELECT id FROM tipo_pendencia_prontuario WHERE codigo = ? AND ativo = TRUE',
      [TIPO_PENDENCIA_REVISAO],
    );
    if (!tipo)
      throw recusa(
        'nao-cadastrado',
        'O tipo de pendência da revisão pela comissão não está cadastrado (ou está inativo) neste cliente.',
      );
    for (const item of p.criar)
      novas.set(
        item,
        await tx.incluir('pendencia_prontuario', {
          estabelecimento_id: est,
          atendimento_id: antes['atendimento_id'],
          paciente_id: antes['paciente_id'],
          tipo_pendencia_prontuario_id: n(tipo.id),
          responsavel_profissional_id: responsavel,
          descricao: descricaoDe(item),
          apontada_em: agora,
          apontada_por_usuario_id: usuario,
          prazo_em: prazoDe(item),
          situacao: 'aberta',
        }),
      );
  }
  const itemDaPendencia = new Map(existentes.map((e) => [e.id, e.item]));
  for (const id of p.reabrir) {
    const pend = pendPorId.get(id)!;
    const item = itemDaPendencia.get(id)!;
    await tx.alterar('pendencia_prontuario', id, n(pend['versao']), {
      situacao: 'aberta',
      descricao: descricaoDe(item),
      prazo_em: prazoDe(item),
      responsavel_profissional_id: responsavel,
      resolucao: null,
      resolvida_em: null,
      resolvida_por_usuario_id: null,
    });
  }
  const motivo = motivoCancelamentoPorCorrecao(justificativa || null);
  for (const id of p.cancelar)
    await tx.alterar('pendencia_prontuario', id, n(pendPorId.get(id)!['versao']), {
      situacao: 'cancelada',
      resolucao: motivo,
      resolvida_em: agora,
      resolvida_por_usuario_id: usuario,
    });

  // Itens: um por item do checklist, alterado quando já existe (nunca apagado).
  let comPendencia = 0;
  for (const x of respostas) {
    const ck = doChecklist.get(x.item)!;
    const ja = itemPorCodigo.get(x.item);
    const naoConforme = x.resultado === 'naoConforme';
    const pendencia =
      novas.get(x.item) ??
      (ja && ja['pendencia_prontuario_id'] !== null ? n(ja['pendencia_prontuario_id']) : null);
    if (pendencia !== null) comPendencia += 1;
    const valores = {
      resultado: RESULTADO_BANCO[x.resultado],
      observacao: x.observacao,
      responsavel_profissional_id: naoConforme ? responsavel : null,
      pendencia_prontuario_id: pendencia,
    };
    if (!ja)
      await tx.incluir('revisao_prontuario_item', {
        revisao_prontuario_id: r.id,
        sequencia: n(ck['sequencia']),
        modelo_checklist_qualidade_item_id: n(ck['id']),
        ...valores,
      });
    else if (
      texto(ja['resultado']) !== valores.resultado ||
      (ja['observacao'] ?? null) !== valores.observacao ||
      (ja['responsavel_profissional_id'] === null ? null : n(ja['responsavel_profissional_id'])) !==
        valores.responsavel_profissional_id ||
      (ja['pendencia_prontuario_id'] === null ? null : n(ja['pendencia_prontuario_id'])) !== pendencia
    )
      await tx.alterar('revisao_prontuario_item', n(ja['id']), n(ja['versao']), valores);
  }

  const versao = await tx.alterar('revisao_prontuario', r.id, r.versao, {
    resultado: p.resultado === 'naoConforme' ? 'nao_conforme' : 'conforme',
    percentual_conformidade: p.percentual,
    pendencias_geradas: comPendencia,
    observacao: r.observacao,
    situacao: 'concluida',
    revisada_em: agora,
    revisor_usuario_id: usuario,
    justificativa: corrigindo ? justificativa : null,
  });
  return { versao };
}

/** A gravação da revisão do prontuário, para o gravador da porta própria completa da gestão. */
export function gravacaoRevisarProntuario(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao = { motivo: null, dados: null },
): Pick<GravadorGestao, 'revisarProntuario'> {
  return { revisarProntuario: (r) => revisarProntuario(tx, est, r as RevisaoNova, anotacao) };
}
