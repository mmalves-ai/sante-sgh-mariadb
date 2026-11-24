// Complemento Q1 da porta PRÓPRIA da gestão da qualidade (modulos-proprios-3, família qualidade-q1): o primeiro quarto
// (ordem alfabética) dos métodos que ainda falhavam fechados no banco próprio e que o modelo já cobre, com o mesmo
// contrato da porta de memória. Classes auxiliares: a porta própria completa delega a elas (a ligação é do integrador).
// - altasParaRevisao: as altas do período (`de` inclusivo, `ate` exclusivo, na hora civil do estabelecimento; o banco
//   guarda o instante em UTC) que formam o universo do sorteio da revisão de prontuários: a internação com alta
//   (situação `alta`), a clínica (especialidade da internação), o médico assistente (id do profissional, que
//   `loginsDosMedicos` liga ao login) e o nome dele. `reg` é o id da internação. Teto de linhas: o excedente marca
//   `cortada` (o sorteio recusa o universo cortado), nunca erro nem corte mudo.
// - cancelarSorteioRevisao: o sorteio passa a `cancelado` com o motivo (justificativa); recusa (409 de versão) se algum
//   prontuário do sorteio já foi revisado (revisão concluída ou avalizada). O instante e o autor do cancelamento são a
//   alteração da linha (o cancelado é terminal: nada o altera depois).
// - assinarAta: a assinatura (aprovação) da ata da reunião realizada, ainda não assinada, da comissão do
//   estabelecimento (colunas da migração 18_QUA/96_assinatura_ata_cancelamento_auditoria).
// - cancelarAuditoria: a auditoria interna passa a `cancelada` com o instante e o motivo (mesma migração); recusa
//   `com-dependentes` quando há não conformidade ligada a ela (o cancelamento deixaria órfãos).
// - Nos dois cancelamentos, a linha como estava vai a `anotacao.dados.versaoAnterior` (tabela, id, versão, ação, motivo
//   e dados), no mesmo formato que `versoes` lê da trilha (histórico só de acréscimo; nada é apagado).
import type { TxOperacao } from '@sgh/nucleo';
import { recusa } from '@sgh/nucleo';
import { civilDe, FUSO_PADRAO, instanteDe } from '../enfermagem/banco-apoio.js';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import {
  exigirUsuario,
  instante,
  type L,
  type Linha,
  lerNoEstabelecimento,
  n,
  nn,
  type NucleoQualidade,
  paraBanco,
  texto,
  textoN,
} from './apoio-propria.js';
import type { ContextoGestao, GravadorGestao, MudancaGestao, MudancaRevisao } from './porta-gestao.js';
import { type AcaoVersao, type AltaParaRevisao, recusaVersaoGestao, type TabelaCorrigivel } from './tipos.js';

/** Os métodos da porta da gestão que este complemento cobre (a ligação na porta completa é do integrador). */
export const METODOS_COMPLEMENTO_Q1 = [
  'altasParaRevisao',
  'assinarAta',
  'cancelarAuditoria',
  'cancelarSorteioRevisao',
] as const;

/** As tabelas que as gravações deste complemento tocam (somadas às da porta completa pelo integrador). */
export const TABELAS_COMPLEMENTO_Q1 = [
  'sorteio_revisao_prontuario',
  'reuniao_comissao',
  'auditoria_interna',
] as const;

/** Teto das altas do período (o excedente marca `cortada`). */
export const TETO_ALTAS_REVISAO = 5000;

const SQL_ALTAS = `
  SELECT i.id, i.paciente_id, i.data_hora_alta, em.descricao AS clinica, i.medico_assistente_profissional_id,
         COALESCE(pr.nome_exibicao, pf.nome) AS medico_nome
    FROM internacao i
    JOIN especialidade_medica em ON em.id = i.especialidade_medica_id
    LEFT JOIN profissional pr ON pr.id = i.medico_assistente_profissional_id
    LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
   WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao = 'alta'
     AND i.data_hora_alta >= ? AND i.data_hora_alta < ?
   ORDER BY i.data_hora_alta, i.id`;

/** O fuso do estabelecimento (o banco guarda o instante em UTC; os parâmetros e as saídas são a hora civil dele). */
async function fusoDoEstabelecimento(l: L, est: number): Promise<string> {
  const r = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return textoN(r?.['fuso_horario']) ?? FUSO_PADRAO;
}

/** A alta lida no vocabulário do contrato (a hora civil do estabelecimento). */
export function altaDaLinha(r: Linha, fuso: string): AltaParaRevisao {
  return {
    reg: n(r['id']),
    paciente: nn(r['paciente_id']),
    alta: civilDe(r['data_hora_alta'], fuso) ?? '',
    clinica: texto(r['clinica']),
    medicoRegistro: nn(r['medico_assistente_profissional_id']),
    medicoNome: textoN(r['medico_nome']),
  };
}

/** As leituras do quarto Q1 (a porta completa delega `altasParaRevisao`). */
export class LeiturasGestaoComplementoQ1 {
  constructor(private readonly nucleo: NucleoQualidade) {}

  altasParaRevisao(
    c: ContextoGestao,
    de: string,
    ate: string,
  ): Promise<{ itens: AltaParaRevisao[]; cortada: boolean }> {
    return lerNoEstabelecimento(this.nucleo, c, async (l, est) => {
      const fuso = await fusoDoEstabelecimento(l, est);
      const ini = instanteDe(`${de.slice(0, 10)}T00:00:00`, fuso);
      const fim = instanteDe(`${ate.slice(0, 10)}T00:00:00`, fuso);
      const linhas = await l.consultar(`${SQL_ALTAS} LIMIT ${TETO_ALTAS_REVISAO + 1}`, [est, ini, fim], {
        teto: TETO_ALTAS_REVISAO + 1,
      });
      return {
        itens: linhas.slice(0, TETO_ALTAS_REVISAO).map((r) => altaDaLinha(r, fuso)),
        cortada: linhas.length > TETO_ALTAS_REVISAO,
      };
    });
  }
}

/** A linha como estava (datas no formato local), para a versão anterior na trilha. */
function retrato(r: Linha): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? instante(v) : v]));
}

/** Anota a versão anterior da linha na trilha da operação (o formato que `versoes` lê). */
function anotarVersao(
  anotacao: AnotacaoGravacao,
  tabela: TabelaCorrigivel,
  antes: Linha,
  acao: AcaoVersao,
  motivo: string,
): void {
  anotacao.motivo = motivo;
  anotacao.dados = {
    ...(anotacao.dados ?? {}),
    versaoAnterior: {
      tabela,
      id: n(antes['id']),
      versao: n(antes['versao']),
      acao,
      motivo,
      dados: retrato(antes),
    },
  };
}

type GravacoesQ1 = Pick<GravadorGestao, 'assinarAta' | 'cancelarAuditoria' | 'cancelarSorteioRevisao'>;

/**
 * As gravações do quarto Q1 dentro da transação da gestão (o integrador espalha o resultado no gravador da porta
 * completa e soma `TABELAS_COMPLEMENTO_Q1` às tabelas dela).
 */
export function gravacoesComplementoQ1(
  tx: TxOperacao,
  est: number,
  anotacao: AnotacaoGravacao = { motivo: null, dados: null },
): GravacoesQ1 {
  return {
    cancelarSorteioRevisao: async (m: MudancaRevisao) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT * FROM sorteio_revisao_prontuario WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [m.id, est],
        { teto: 1 },
      );
      if (!antes || n(antes['versao']) !== m.versao || texto(antes['situacao']) === 'cancelado')
        throw recusaVersaoGestao('O sorteio');
      const revisado = await tx.uma(
        `SELECT id FROM revisao_prontuario
          WHERE sorteio_revisao_prontuario_id = ? AND excluido_em IS NULL AND situacao IN ('concluida', 'avalizada')
          LIMIT 1`,
        [m.id],
      );
      if (revisado) throw recusaVersaoGestao('O sorteio');
      await exigirUsuario(tx, m.usuario);
      const versao = await tx.alterar('sorteio_revisao_prontuario', m.id, m.versao, {
        situacao: 'cancelado',
        justificativa: m.motivo,
      });
      anotarVersao(anotacao, 'sorteio_revisao_prontuario', antes, 'cancelamento', m.motivo);
      return { versao };
    },

    assinarAta: async (r: Omit<MudancaGestao, 'justificativa'>) => {
      const [atual] = await tx.consultarParaAtualizar<Linha>(
        `SELECT r.id, r.versao, r.situacao, r.ata_assinada_em
           FROM reuniao_comissao r
           JOIN comissao_hospitalar ch ON ch.id = r.comissao_hospitalar_id
          WHERE r.id = ? AND ch.estabelecimento_id = ? AND r.excluido_em IS NULL`,
        [r.id, est],
        { teto: 1 },
      );
      if (
        !atual ||
        n(atual['versao']) !== r.versao ||
        texto(atual['situacao']) !== 'realizada' ||
        atual['ata_assinada_em'] !== null
      )
        throw recusaVersaoGestao('A reunião');
      const usuario = await exigirUsuario(tx, r.usuario);
      const versao = await tx.alterar('reuniao_comissao', r.id, r.versao, {
        ata_assinada_em: paraBanco(r.agora),
        ata_assinada_por_usuario_id: usuario,
      });
      return { versao };
    },

    cancelarAuditoria: async (a: MudancaGestao) => {
      const [antes] = await tx.consultarParaAtualizar<Linha>(
        `SELECT * FROM auditoria_interna WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [a.id, est],
        { teto: 1 },
      );
      if (!antes || n(antes['versao']) !== a.versao || texto(antes['situacao']) === 'cancelada')
        throw recusaVersaoGestao('A auditoria');
      const dependente = await tx.uma(
        `SELECT id FROM nao_conformidade_qualidade
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND auditoria_interna_id = ? LIMIT 1`,
        [est, a.id],
      );
      if (dependente)
        throw recusa(
          'com-dependentes',
          'Há registros ativos que dependem deste: o cancelamento deixaria órfãos.',
        );
      await exigirUsuario(tx, a.usuario);
      const versao = await tx.alterar('auditoria_interna', a.id, a.versao, {
        situacao: 'cancelada',
        cancelada_em: paraBanco(a.agora),
        motivo_cancelamento: a.justificativa,
      });
      anotarVersao(anotacao, 'auditoria_interna', antes, 'cancelamento', a.justificativa);
      return { versao };
    },
  };
}
