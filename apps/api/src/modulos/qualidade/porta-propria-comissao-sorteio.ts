// Gravações PRÓPRIAS das comissões e do sorteio da revisão de prontuários (F3.9-Q3): registrarComissao,
// registrarReuniaoComissao e sortearRevisao, que falhavam fechados na porta própria da gestão. Mesmo contrato da porta
// de memória, com o desenho melhorado do modelo próprio:
// - Comissão: comissao_hospitalar (tipo pelo código ativo de tipo_comissao; a inativa fica 'suspensa', nunca apagada)
//   e a composição em comissao_membro como PESSOAS: o membro com conta vira o colaborador ligado a ela ou, sem
//   colaborador, o profissional do vínculo vigente (usuario_profissional); a conta sem nenhum dos dois recusa
//   `conta-sem-cadastro` (nada de vínculo perdido em silêncio); o membro sem conta fica pelo nome externo. O papel sai
//   da função escrita (papelDaFuncao) e a função fica como foi escrita. Na alteração, só muda o que mudou
//   (mudancaDaComposicao): quem sai tem a vigência encerrada na véspera (o incluído no mesmo dia sai pela exclusão
//   lógica), quem só troca a função é alterado e quem entra começa hoje; a comissão e a composição anteriores vão à
//   trilha da mesma operação (dados.versaoAnterior). Inativar ou trocar o tipo confere os dependentes dentro da
//   transação (checklist vigente e sorteios com prontuário sem aval) e recusa `com-dependentes`.
// - Reunião: reuniao_comissao realizada, conferida pela versão da comissão (a composição que a tela leu); os presentes
//   são as POSIÇÕES marcadas nessa composição (presentesDaReuniao: cada membro pela linha, nunca pelo nome), vigentes
//   na data da reunião; a presença é de cada membro vigente NA DATA em reuniao_comissao_participante (presente ou não),
//   o nome dos presentes fica só no retrato da ata e o quórum é apurado sobre essa composição (quorumAtingido).
// - Sorteio: sorteio_revisao_prontuario com a semente e o resumo SHA-256 do universo e a amostra em revisao_prontuario
//   (o atendimento do estabelecimento, o paciente e a internação dele, a versão do checklist vigente da comissão).
//   Um sorteio ativo por comissão e competência: sortear de novo exige cancelar o anterior (cancelarSorteioRevisao).
// Ligação (porta própria completa): espalha gravacoesComissaoSorteio(tx, est, anotacao) no gravador, soma
// TABELAS_COMISSAO_SORTEIO às tabelas e responde `dependentes` da comissão por dependentesDaComissao.
import {
  chaveDaPessoaNaComposicao,
  mudancaDaComposicao,
  nomeComparavel,
  papelDaFuncao,
  type PapelMembroComissao,
  presentesDaReuniao,
  quorumAtingido,
  recusaAmostraSorteio,
} from '@sgh/dominio-qualidade';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import {
  cobra,
  exigirUsuario,
  instante,
  type L,
  type Linha,
  marcas,
  n,
  paraBanco,
  texto,
  textoN,
  usuarioPeloLogin,
} from './apoio-propria.js';
import type { GravadorGestao } from './porta-gestao.js';
import { type DependentesRegistro, recusaVersaoGestao } from './tipos.js';

/** Os métodos do gravador que este arquivo cobre. */
export const METODOS_COMISSAO_SORTEIO = [
  'registrarComissao',
  'registrarReuniaoComissao',
  'sortearRevisao',
] as const;

/** As tabelas que as gravações daqui escrevem (somadas às da porta completa). */
export const TABELAS_COMISSAO_SORTEIO = [
  'comissao_hospitalar',
  'comissao_membro',
  'reuniao_comissao',
  'reuniao_comissao_participante',
  'sorteio_revisao_prontuario',
  'revisao_prontuario',
] as const;

const ORDEM_PAPEL = `FIELD(m.papel, 'presidente', 'vice_presidente', 'secretario', 'membro_executor', 'membro', 'consultor')`;

/** A composição vigente na data `hoje` (na mesma ordem da leitura da comissão), com o nome de cada pessoa. */
const SQL_COMPOSICAO = `
  SELECT m.id, m.versao, m.colaborador_id, m.profissional_id, m.nome_externo, m.papel, m.funcao, m.vigencia_inicio,
         COALESCE(co.nome, pf.nome, m.nome_externo) AS nome
    FROM comissao_membro m
    LEFT JOIN colaborador co ON co.id = m.colaborador_id
    LEFT JOIN profissional p ON p.id = COALESCE(m.profissional_id, co.profissional_id)
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE m.comissao_hospitalar_id = ? AND m.excluido_em IS NULL
     AND m.vigencia_inicio <= ? AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= ?)
   ORDER BY ${ORDEM_PAPEL}, m.id`;

interface MembroDaTela {
  readonly nome: string;
  readonly funcao: string;
  readonly login: string | null;
}

interface MembroResolvido {
  readonly pessoa: string;
  readonly papel: PapelMembroComissao;
  readonly funcao: string;
  readonly colaborador: number | null;
  readonly profissional: number | null;
  readonly nomeExterno: string | null;
  /** As outras chaves da mesma conta (o colaborador e os profissionais ligados a ela). */
  readonly daConta: readonly string[];
}

interface MembroGravado {
  readonly id: number;
  readonly versao: number;
  readonly pessoa: string;
  readonly papel: PapelMembroComissao;
  readonly funcao: string;
  readonly inicio: string;
  readonly nome: string;
}

const chavePessoa = (colaborador: unknown, profissional: unknown, externo: unknown): string =>
  colaborador !== null && colaborador !== undefined
    ? `c:${n(colaborador)}`
    : profissional !== null && profissional !== undefined
      ? `p:${n(profissional)}`
      : `x:${nomeComparavel(texto(externo))}`;

const dataDe = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : texto(v).slice(0, 10);

/**
 * Sem as posições (chamada antiga, pelos nomes): cada nome tem de casar com UM membro da composição; o homônimo é
 * recusado, porque o nome não diz qual das pessoas esteve presente.
 */
function posicoesPelosNomes(nomes: readonly string[], daTela: readonly MembroGravado[]): number[] {
  return nomes.map((nome) => {
    const k = nomeComparavel(nome);
    const casa = daTela.flatMap((m, i) => (nomeComparavel(m.nome) === k ? [i] : []));
    if (casa.length > 1)
      throw recusa('presente-ambiguo', 'Há presente com o nome de mais de um membro: marque-o pela posição.');
    return casa[0] ?? -1;
  });
}

/** A véspera de uma data AAAA-MM-DD (o fim da vigência de quem sai da composição). */
export function vespera(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function composicao(l: L, comissao: number, hoje: string): Promise<MembroGravado[]> {
  const linhas = await l.consultar(SQL_COMPOSICAO, [comissao, hoje, hoje], { teto: 500 });
  return linhas.map((m) => ({
    id: n(m['id']),
    versao: n(m['versao']),
    pessoa: chavePessoa(m['colaborador_id'], m['profissional_id'], m['nome_externo']),
    papel: texto(m['papel']) as PapelMembroComissao,
    funcao: textoN(m['funcao']) ?? texto(m['papel']).replace(/_/g, ' '),
    inicio: dataDe(m['vigencia_inicio']),
    nome: texto(m['nome']),
  }));
}

/** O membro da tela como pessoa do cadastro: a conta leva ao colaborador ou ao profissional; sem conta, o nome. */
async function resolverMembro(tx: TxOperacao, m: MembroDaTela): Promise<MembroResolvido> {
  const funcao = m.funcao.trim();
  const papel = papelDaFuncao(funcao);
  if (m.login === null || !m.login.trim()) {
    const nome = m.nome.trim().replace(/\s+/g, ' ');
    return {
      pessoa: chavePessoa(null, null, nome),
      papel,
      funcao,
      colaborador: null,
      profissional: null,
      nomeExterno: nome,
      daConta: [],
    };
  }
  const usuario = await usuarioPeloLogin(tx, m.login);
  if (usuario === null)
    throw recusa(
      'usuario-inexistente',
      `A conta informada para o membro ${m.nome.trim()} não existe neste cliente.`,
    );
  const daConta = (
    await tx.consultar(
      `SELECT CONCAT('c:', id) AS k FROM colaborador WHERE usuario_id = ? AND excluido_em IS NULL
       UNION SELECT CONCAT('p:', profissional_id) FROM colaborador
              WHERE usuario_id = ? AND excluido_em IS NULL AND profissional_id IS NOT NULL
       UNION SELECT CONCAT('p:', profissional_id) FROM usuario_profissional WHERE usuario_id = ? AND excluido_em IS NULL`,
      [usuario, usuario, usuario],
      { teto: 100 },
    )
  ).map((r) => texto(r['k']));
  const co = await tx.uma<{ id: number }>(
    'SELECT id FROM colaborador WHERE usuario_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1',
    [usuario],
  );
  if (co)
    return {
      pessoa: chavePessoa(co.id, null, null),
      papel,
      funcao,
      colaborador: n(co.id),
      profissional: null,
      nomeExterno: null,
      daConta,
    };
  const pr = await tx.uma<{ profissional_id: number }>(
    `SELECT profissional_id FROM usuario_profissional
      WHERE usuario_id = ? AND vigencia_fim IS NULL AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
    [usuario],
  );
  if (pr)
    return {
      pessoa: chavePessoa(null, pr.profissional_id, null),
      papel,
      funcao,
      colaborador: null,
      profissional: n(pr.profissional_id),
      nomeExterno: null,
      daConta,
    };
  throw recusa(
    'conta-sem-cadastro',
    `A conta do membro ${m.nome.trim()} não está ligada a colaborador nem a profissional: ligue o cadastro ou registre o membro sem a conta.`,
  );
}

/** As dependências ativas da comissão: o checklist vigente e os sorteios com prontuário ainda sem aval. */
export async function dependentesDaComissao(l: L, est: number, id: number): Promise<DependentesRegistro[]> {
  const checklists = await l.consultar(
    `SELECT v.id FROM modelo_checklist_qualidade_versao v
       JOIN modelo_checklist_qualidade q ON q.id = v.modelo_checklist_qualidade_id
       JOIN comissao_hospitalar ch ON ch.id = q.comissao_hospitalar_id
      WHERE q.comissao_hospitalar_id = ? AND ch.estabelecimento_id = ? AND v.situacao = 'vigente' ORDER BY v.id`,
    [id, est],
    { teto: 100 },
  );
  const sorteios = await l.consultar(
    `SELECT s.id FROM sorteio_revisao_prontuario s
      WHERE s.comissao_hospitalar_id = ? AND s.estabelecimento_id = ? AND s.excluido_em IS NULL
        AND s.situacao <> 'cancelado'
        AND EXISTS (SELECT 1 FROM revisao_prontuario r WHERE r.sorteio_revisao_prontuario_id = s.id
                       AND r.excluido_em IS NULL AND r.avalizada_em IS NULL)
      ORDER BY s.id`,
    [id, est],
    { teto: 1000 },
  );
  const grupo = (g: string, dependente: string, linhas: Linha[]): DependentesRegistro[] =>
    linhas.length
      ? [{ grupo: g, dependente, quantidade: linhas.length, ids: linhas.map((r) => n(r['id'])) }]
      : [];
  return [
    ...grupo(
      'Checklist vigente da revisão de prontuários (inative-o antes)',
      'modelo_checklist_qualidade_versao',
      checklists,
    ),
    ...grupo(
      'Sorteios de prontuários em andamento (com prontuário sem o aval)',
      'sorteio_revisao_prontuario',
      sorteios,
    ),
  ];
}

/** O membro com a chave da pessoa trocada pela já gravada (as colunas da pessoa seguem a chave). */
function comChave(m: MembroResolvido, pessoa: string): MembroResolvido {
  if (pessoa === m.pessoa) return m;
  const id = Number(pessoa.slice(2));
  return {
    ...m,
    pessoa,
    colaborador: pessoa.startsWith('c:') ? id : null,
    profissional: pessoa.startsWith('p:') ? id : null,
  };
}

function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

type GravacoesComissaoSorteio = Pick<GravadorGestao, (typeof METODOS_COMISSAO_SORTEIO)[number]>;

/** As gravações daqui, na transação da gestão (a recusa desfaz tudo). */
export function gravacoesComissaoSorteio(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao = { motivo: null, dados: null },
): GravacoesComissaoSorteio {
  return {
    async registrarComissao(c) {
      const usuario = await exigirUsuario(tx, c.usuario);
      const hoje = c.agora.slice(0, 10);
      const tipo = await tx.uma<{ id: number }>(
        'SELECT id FROM tipo_comissao WHERE codigo = ? AND ativo = TRUE',
        [cobra(c.tipo)],
      );
      if (!tipo)
        throw recusa(
          'tipo-comissao-inexistente',
          'O tipo de comissão não está cadastrado (ativo) neste cliente.',
        );
      const repetida = await tx.uma(
        'SELECT id FROM comissao_hospitalar WHERE estabelecimento_id = ? AND nome = ? AND id <> ? AND excluido_em IS NULL',
        [est, c.nome, c.id ?? 0],
      );
      if (repetida) throw recusa('comissao-duplicada', 'Já existe comissão com este nome.');
      const daTela = JSON.parse(c.membros) as MembroDaTela[];
      const resolvidos: MembroResolvido[] = [];
      for (const m of daTela) resolvidos.push(await resolverMembro(tx, m));
      const dados = {
        tipo_comissao_id: n(tipo.id),
        nome: c.nome,
        periodicidade_reuniao: c.periodicidade,
        situacao: c.ativa ? 'ativa' : 'suspensa',
      };

      let id: number;
      let versao: number;
      let atuais: MembroGravado[] = [];
      if (c.id === null) {
        id = await tx.incluir('comissao_hospitalar', { estabelecimento_id: est, ...dados });
        versao = 1;
      } else {
        const [antes] = await tx.consultarParaAtualizar<Linha>(
          'SELECT * FROM comissao_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [c.id, est],
          { teto: 1 },
        );
        if (!antes || n(antes['versao']) !== c.versao || texto(antes['situacao']) === 'extinta')
          throw recusaVersaoGestao('A comissão');
        id = c.id;
        atuais = await composicao(tx, id, hoje);
        versao = await tx.alterar('comissao_hospitalar', id, n(antes['versao']), dados);
        const justificativa = c.justificativa ?? 'Alteração da comissão';
        anotacao.motivo = justificativa;
        anotacao.dados = {
          ...(anotacao.dados ?? {}),
          versaoAnterior: {
            tabela: 'comissao_hospitalar',
            id,
            versao: n(antes['versao']),
            acao: c.ativa ? 'correcao' : 'cancelamento',
            motivo: justificativa,
            dados: {
              ...retrato(antes),
              membros: atuais.map((m) => ({ nome: m.nome, papel: m.papel, funcao: m.funcao })),
            },
          },
        };
      }

      // A pessoa que já está na composição por outra chave da mesma conta fica com a chave gravada.
      const novos = resolvidos.map((m) =>
        comChave(m, chaveDaPessoaNaComposicao(m.pessoa, m.daConta, m.papel, atuais)),
      );
      const chaves = new Set(novos.map((m) => `${m.pessoa}|${m.papel}`));
      if (chaves.size !== novos.length)
        throw recusa('membro-repetido', 'A mesma pessoa aparece duas vezes com o mesmo papel na composição.');
      const mudanca = mudancaDaComposicao(atuais, novos);
      for (const t of mudanca.funcaoTrocada)
        await tx.alterar('comissao_membro', t.atual.id, t.atual.versao, { funcao: t.nova.funcao });
      for (const a of mudanca.encerrados)
        await tx.alterar(
          'comissao_membro',
          a.id,
          a.versao,
          a.inicio < hoje
            ? { vigencia_fim: vespera(hoje) }
            : { excluido_em: paraBanco(c.agora), excluido_por: usuario },
        );
      for (const m of mudanca.incluidos) {
        // O mesmo par que saiu hoje volta pela mesma linha (a chave única é pessoa, papel e início).
        const [voltando] =
          m.nomeExterno === null
            ? await tx.consultarParaAtualizar<Linha>(
                `SELECT id, versao FROM comissao_membro
                  WHERE comissao_hospitalar_id = ? AND colaborador_id <=> ? AND profissional_id <=> ? AND papel = ?
                    AND vigencia_inicio = ? AND excluido_em IS NOT NULL`,
                [id, m.colaborador, m.profissional, m.papel, hoje],
                { teto: 1 },
              )
            : [];
        if (voltando)
          await tx.alterar('comissao_membro', n(voltando['id']), n(voltando['versao']), {
            excluido_em: null,
            excluido_por: null,
            funcao: m.funcao,
          });
        else
          await tx.incluir('comissao_membro', {
            comissao_hospitalar_id: id,
            colaborador_id: m.colaborador,
            profissional_id: m.profissional,
            nome_externo: m.nomeExterno,
            funcao: m.funcao,
            papel: m.papel,
            vigencia_inicio: hoje,
          });
      }

      if (c.conferirDependentes && (await dependentesDaComissao(tx, est, id)).length)
        throw recusa(
          'com-dependentes',
          'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
        );
      return { id, versao, criada: c.id === null };
    },

    async registrarReuniaoComissao(r) {
      const usuario = await exigirUsuario(tx, r.usuario);
      const [c] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, situacao, quorum_minimo FROM comissao_hospitalar
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [r.comissao, est],
        { teto: 1 },
      );
      if (!c || n(c['versao']) !== r.versaoComissao) throw recusaVersaoGestao('A comissão');
      if (texto(c['situacao']) !== 'ativa') throw recusa('comissao-inativa', 'A comissão está inativa.');
      // A tela marcou posições da composição que leu (a do dia da reunião, ou a de hoje): o total confere a versão que
      // ela viu. A presença e o quórum são da composição vigente NA DATA da reunião (a retroativa não ganha quem entrou
      // depois e mostra quem saiu entre a reunião e hoje).
      const hoje = r.agora.slice(0, 10);
      const diaReuniao = r.realizadaEm.slice(0, 10);
      const diaTela = r.composicaoEm ?? hoje;
      if (diaTela !== hoje && diaTela !== diaReuniao) throw recusaVersaoGestao('A comissão');
      const daTela = await composicao(tx, r.comissao, diaTela);
      if (daTela.length !== r.membrosTotal) throw recusaVersaoGestao('A comissão');
      const naData = diaReuniao === diaTela ? daTela : await composicao(tx, r.comissao, diaReuniao);
      const posicoes = r.presentesPosicoes ?? posicoesPelosNomes(JSON.parse(r.presentes) as string[], daTela);
      const escolha = presentesDaReuniao(posicoes, daTela, naData);
      if ('recusa' in escolha)
        throw recusa(
          escolha.recusa,
          escolha.recusa === 'presente-fora-da-data'
            ? 'Há presente que não era membro vigente da comissão na data da reunião.'
            : 'Há presente que não é membro vigente da comissão (ou marcado duas vezes).',
        );
      if (escolha.presentes.length !== r.presentesTotal)
        throw recusa('presente-fora-da-composicao', 'A contagem dos presentes não confere com os marcados.');
      const presentes = new Set(escolha.presentes.map((m) => m.id));
      const quorumMinimo = c['quorum_minimo'] === null ? null : n(c['quorum_minimo']);
      const quando = paraBanco(r.realizadaEm);
      const id = await tx.incluir('reuniao_comissao', {
        comissao_hospitalar_id: r.comissao,
        tipo: r.tipo,
        situacao: 'realizada',
        agendada_para: quando,
        realizada_em: quando,
        pauta: r.pauta,
        ata: r.ata,
        deliberacoes: r.deliberacoes,
        // O nome fica só no retrato da ata (o do cadastro); a presença é de cada membro, pela linha da composição.
        presentes_registrados: JSON.stringify(escolha.presentes.map((m) => m.nome)),
        membros_quantidade: naData.length,
        presentes_quantidade: presentes.size,
        convidados: r.convidados,
        versao_composicao: r.versaoComissao,
        quorum_minimo: quorumMinimo,
        quorum_atingido: quorumAtingido(presentes.size, naData.length, quorumMinimo),
        secretario_usuario_id: usuario,
      });
      for (const m of naData)
        await tx.incluir('reuniao_comissao_participante', {
          reuniao_comissao_id: id,
          tipo_participacao: 'membro',
          comissao_membro_id: m.id,
          presente: presentes.has(m.id),
        });
      return { id };
    },

    async sortearRevisao(s) {
      const usuario = await exigirUsuario(tx, s.usuario);
      const [c] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, situacao FROM comissao_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [s.comissao, est],
        { teto: 1 },
      );
      if (!c) throw recusa('comissao-inexistente', 'A comissão não está cadastrada neste estabelecimento.');
      if (texto(c['situacao']) !== 'ativa') throw recusa('comissao-inativa', 'A comissão está inativa.');
      const checklist = await tx.uma(
        `SELECT v.id FROM modelo_checklist_qualidade_versao v
           JOIN modelo_checklist_qualidade q ON q.id = v.modelo_checklist_qualidade_id
          WHERE v.id = ? AND q.comissao_hospitalar_id = ? AND v.situacao = 'vigente'`,
        [s.checklist, s.comissao],
      );
      if (!checklist)
        throw recusa('checklist-ausente', 'A comissão não tem o checklist da revisão publicado (vigente).');
      const motivo = recusaAmostraSorteio(s.amostra, s.universo);
      if (motivo) throw recusa(motivo, 'A amostra do sorteio não confere com o universo das altas.');
      if (!/^[0-9a-f]{64}$/i.test(s.resumoUniverso) || !/^\d{4}-\d{2}$/.test(s.competencia))
        throw recusa('sorteio-invalido', 'O resumo do universo ou a competência do sorteio é inválido.');
      const competencia = `${s.competencia}-01`;
      const ativo = await tx.uma(
        `SELECT id FROM sorteio_revisao_prontuario
          WHERE comissao_hospitalar_id = ? AND estabelecimento_id = ? AND competencia = ?
            AND situacao <> 'cancelado' AND excluido_em IS NULL LIMIT 1`,
        [s.comissao, est, competencia],
      );
      if (ativo)
        throw recusa(
          'competencia-ja-sorteada',
          'A competência já tem sorteio ativo desta comissão: cancele-o antes de sortear de novo.',
        );
      const regs = s.amostra.map((a) => a.reg);
      const atendimentos = new Map(
        (
          await tx.consultar(
            `SELECT a.id, a.paciente_id,
                    (SELECT MAX(i.id) FROM internacao i WHERE i.atendimento_id = a.id AND i.excluido_em IS NULL) AS internacao
               FROM atendimento a
              WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.id IN (${marcas(regs.length)})`,
            [est, ...regs],
            { teto: regs.length + 1 },
          )
        ).map((a) => [n(a['id']), a]),
      );
      for (const a of s.amostra) {
        const at = atendimentos.get(a.reg);
        if (!at || (a.paciente !== null && n(at['paciente_id']) !== a.paciente))
          throw recusa(
            'prontuario-fora-do-universo',
            'Há atendimento da amostra fora deste estabelecimento.',
          );
      }
      const id = await tx.incluir('sorteio_revisao_prontuario', {
        estabelecimento_id: est,
        comissao_hospitalar_id: s.comissao,
        competencia,
        universo_quantidade: s.universo,
        quantidade: s.amostra.length,
        semente: s.semente,
        hash_universo: s.resumoUniverso.toLowerCase(),
        sorteado_em: paraBanco(s.agora),
        sorteado_por_usuario_id: usuario,
        situacao: 'sorteado',
      });
      for (const a of s.amostra) {
        const at = atendimentos.get(a.reg)!;
        await tx.incluir('revisao_prontuario', {
          estabelecimento_id: est,
          comissao_hospitalar_id: s.comissao,
          sorteio_revisao_prontuario_id: id,
          paciente_id: n(at['paciente_id']),
          atendimento_id: a.reg,
          internacao_id: at['internacao'] === null ? null : n(at['internacao']),
          modelo_checklist_qualidade_versao_id: s.checklist,
          revisor_usuario_id: usuario,
          situacao: 'em_andamento',
        });
      }
      return { id };
    },
  };
}
