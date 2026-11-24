// Porta do repasse médico sobre o banco do cliente (M33; F2.2), pelo @sgh/nucleo: leituras somente leitura; as
// operações de tela (lançar evento, emitir RPA, incluir regra aprovada e integrar itens) e as gravações diretas (versão
// de regra, apuração com a memória e a transição da apuração) numa operação do Executor (trilha, outbox e idempotência
// na mesma transação). Tabelas: regra_repasse (+ regra_repasse_item e regra_repasse_versao), evento_repasse,
// fonte_pagadora (cadastro da rede inteira), producao_repasse (com conta_hospitalar e conta_hospitalar_item),
// apuracao_repasse (+ apuracao_repasse_item), lancamento_repasse (com favorecido_repasse), rpa (+ rpa_lancamento) e os
// vínculos do usuário (usuario_profissional). Toda leitura filtra o estabelecimento da sessão e os excluídos.
// Melhoria: o prestador é o profissional (id), o evento e o convênio são ids do cadastro; o estado da apuração é o do
// modelo (apurada → em_auditoria → aprovada → liberada), com a trava otimista pela versão e o aprovador gravado.
// Melhoria: a proposta de regra nova nasce como regra inativa com a versão em rascunho; a aprovação exige outro usuário
// (restrição do banco: decidido_por ≠ proposto_por) e só a inclusão ativa a regra, com o item na vigência aprovada.
// Melhoria: o RPA grava a retenção por tributo (rpa_retencao) e recusa a conta que não fecha (bruto − retenções = líquido).
// Melhoria: a produção entrega o código de negócio do procedimento e as dimensões do atendimento (especialidade, local,
// unidade, centro de custo) e a cooperativa do profissional, para a regra casar pelas mesmas dimensões da proposta.
// Melhoria: evento, apuração e regra da entrada são conferidos no estabelecimento da sessão antes de gravar.
// Melhoria: o lançamento exige o favorecido vigente do profissional; o estorno não passa do valor do original e o
// lançamento só entra em um RPA (regra no servidor e restrição do banco).
// Pendências de modelo (pedidos do lote 03-04, saida/03-04.json): a memória de cálculo completa no item da apuração
// (dimensões, base, adicional e pendência; item sem profissional), o resumo da apuração (itens, pendentes e
// pendências) e quem conferiu, o título a pagar e as retenções do RPA ligadas ao contas a pagar, o valor recebido da
// produção. Até lá, essas partes respondem zero ou vazio. O adiantamento ao profissional é o saldo a compensar.
import { esquemaLancarEventoRepasse, type ItemProducao, type RegraRepasse } from '@sgh/contratos';
import { debitosNaApuracao, dividirRepasse, integraisDoDia, type TipoFavorecido } from '@sgh/dominio-repasse';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  codigoProcedimento,
  incluirEstornoRepasse,
  lerIntegraisBrutas,
  PREFIXO_INTEGRAL,
  regraDe,
  SQL_REGRAS,
} from '@sgh/persistencia';
import { z } from 'zod';
import { type ContextoPortaM18, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { civil, FUSO_PADRAO, relogioNoFuso } from '../exames/relogio.js';
import { ENTRADAS_OPERACAO_REPASSE } from './operacoes.js';
import { chaveDaGravacao } from './pedido.js';
import {
  type BasesIndicadoresRepassePorta,
  type ContextoRepasse,
  type FiltroRegrasPorta,
  type GravadorRepasse,
  type IntegraisParticular,
  METODOS_PORTA_REPASSE,
  type OpcaoPorta,
  type PortaRepasse,
} from './porta.js';
import {
  type ApuracaoRepasseRegistrada,
  type LancamentoRepasseRegistrado,
  limitesCompetencia,
  type MemoriaCalculoRegistrada,
  type PrestadorRepasse,
  type RpaDetalhe,
  type RpaRegistrado,
  type VersaoRegraRegistrada,
} from './tipos.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoRepasse = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const textoN = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');
const centavos = (v: number) => Math.round(v * 100);

function local(v: unknown, fuso: string): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const c = civil(d, fuso);
  return `${c.data}T${c.hora}`;
}

/** Estado da apuração na tela ↔ situação do modelo. */
const SITUACAO_DO_ESTADO: Readonly<Record<string, string>> = {
  aberta: 'apurada',
  conferida: 'em_auditoria',
  aprovada: 'aprovada',
  titulada: 'liberada',
};
const ESTADO_DA_SITUACAO: Readonly<Record<string, string>> = {
  em_apuracao: 'aberta',
  apurada: 'aberta',
  em_auditoria: 'conferida',
  aprovada: 'aprovada',
  liberada: 'titulada',
  paga: 'titulada',
  cancelada: 'cancelada',
};
const ESCOPO_DA_CONTA = { A: 'todas', E: 'externa', I: 'internacao' } as const;
/** Tabelas das gravações do repasse (operações de tela e gravações diretas). */
const TABELAS = [
  'regra_repasse',
  'regra_repasse_item',
  'regra_repasse_versao',
  'apuracao_repasse',
  'apuracao_repasse_item',
  'lancamento_repasse',
  'rpa',
  'rpa_lancamento',
  'rpa_retencao',
  'producao_repasse',
  'estorno_repasse',
  'sequencia_negocio',
] as const;

/** Número de negócio do estabelecimento (a numeração nasce na primeira vez, com o prefixo). */
async function numeroDe(tx: TxOperacao, tipo: string, prefixo: string, est: number, usuario: number) {
  await garantirSequencia(tx, { tipo, estabelecimento: est, prefixo }, { usuario, agora: new Date() });
  return tx.proximoNumero(tipo);
}

// O SQL das regras e a leitura das integrais moram em @sgh/persistencia (repasse-producao): a mesma leitura da
// apuração, do simulador e da sincronização da produção (API e worker).
export { codigoProcedimento, PREFIXO_INTEGRAL, regraDe, SQL_REGRAS };

/** ADR 0009: as regras integrais da consulta particular vigentes na data, conferidas pelo domínio. */
export async function lerIntegraisParticular(
  l: Leitor,
  est: number,
  data: string,
): Promise<IntegraisParticular> {
  return integraisDoDia(await lerIntegraisBrutas(l, est, data));
}

const SQL_APURACAO = `
  SELECT a.id, a.competencia, a.situacao, a.valor_faturado, a.valor_bruto, ui.login AS apurado_por,
         ua.login AS aprovado_por,
         (SELECT COUNT(*) FROM apuracao_repasse_item x WHERE x.apuracao_repasse_id = a.id AND x.excluido_em IS NULL) AS itens,
         (SELECT COUNT(*) FROM apuracao_repasse_item x
           WHERE x.apuracao_repasse_id = a.id AND x.excluido_em IS NULL AND x.valor_repasse > 0) AS com_repasse
    FROM apuracao_repasse a
    LEFT JOIN usuario ui ON ui.id = a.iniciada_por_usuario_id
    LEFT JOIN usuario ua ON ua.id = a.aprovada_por_usuario_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelada'`;

function apuracaoDe(r: Linha): ApuracaoRepasseRegistrada {
  return {
    id: n(r['id']),
    empresa: 1,
    competencia: (dataIso(r['competencia']) ?? '').slice(0, 7),
    estado: ESTADO_DA_SITUACAO[texto(r['situacao'])] ?? 'aberta',
    simulacao: false,
    itens: n(r['itens']),
    comRepasse: n(r['com_repasse']),
    pendentes: 0,
    pendencias: '{}',
    base: n(r['valor_faturado']),
    valor: n(r['valor_bruto']),
    apuradoPor: texto(r['apurado_por']),
    conferidoPor: null,
    aprovadoPor: textoN(r['aprovado_por']),
  };
}

const SQL_LANCAMENTOS = `
  SELECT l.id, l.tipo_favorecido, l.profissional_id, l.data_lancamento, l.evento_repasse_id, l.valor, l.tipo_lancamento,
         (SELECT rl.rpa_id FROM rpa_lancamento rl JOIN rpa x ON x.id = rl.rpa_id AND x.situacao <> 'cancelado'
           WHERE rl.lancamento_repasse_id = l.id AND rl.excluido_em IS NULL ORDER BY rl.id DESC LIMIT 1) AS em_rpa
    FROM lancamento_repasse l
   WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND l.situacao <> 'cancelado'`;

function lancamentoDe(r: Linha): LancamentoRepasseRegistrado {
  return {
    id: n(r['id']),
    tipo: texto(r['tipo_favorecido']) === 'empresa' ? 'E' : 'M',
    prestador: n(r['profissional_id']),
    data: dataIso(r['data_lancamento']),
    evento: n(r['evento_repasse_id']),
    valor: n(r['valor']),
    origem: texto(r['tipo_lancamento']),
    emRpa: nn(r['em_rpa']),
    registro: nn(r['profissional_id']),
  };
}

const SQL_RPAS = `
  SELECT r.id, r.serie, r.numero, r.periodo_inicio, r.periodo_fim, r.emitido_em, r.profissional_id, r.situacao,
         r.valor_liquido,
         (SELECT COUNT(*) FROM rpa_lancamento rl WHERE rl.rpa_id = r.id AND rl.excluido_em IS NULL) AS lancamentos
    FROM rpa r
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

function rpaDe(r: Linha): RpaRegistrado {
  return {
    id: n(r['id']),
    serie: texto(r['serie']),
    numero: n(r['numero']),
    inicio: dataIso(r['periodo_inicio']),
    fim: dataIso(r['periodo_fim']),
    emissao: dataIso(r['emitido_em']),
    tipo: 'M',
    prestador: n(r['profissional_id']),
    situacao: texto(r['situacao']),
    lancamentos: n(r['lancamentos']),
  };
}

const SQL_VERSOES = `
  SELECT v.id, v.regra_repasse_id, v.operacao, v.situacao, v.dados, v.justificativa, v.ocorrido_em, v.decidido_em,
         v.justificativa_decisao, up.login AS autor, ud.login AS decidida_por
    FROM regra_repasse_versao v
    JOIN regra_repasse r ON r.id = v.regra_repasse_id
    LEFT JOIN usuario up ON up.id = v.proposto_por_usuario_id
    LEFT JOIN usuario ud ON ud.id = v.decidido_por_usuario_id
   WHERE r.estabelecimento_id = ?`;

function versaoDe(r: Linha, fuso: string): VersaoRegraRegistrada {
  const situacao = texto(r['situacao']);
  const dados = r['dados'];
  return {
    id: n(r['id']),
    estado: situacao,
    substitui: texto(r['operacao']) === 'inclusao' ? null : n(r['regra_repasse_id']),
    proposta: typeof dados === 'string' ? dados : JSON.stringify(dados ?? {}),
    justificativa: texto(r['justificativa']),
    simulada: situacao !== 'rascunho' && situacao !== 'recusada',
    autor: texto(r['autor']),
    propostaEm: local(r['ocorrido_em'], fuso),
    decididaPor: textoN(r['decidida_por']),
    decididaEm: local(r['decidido_em'], fuso),
    justificativaDecisao: textoN(r['justificativa_decisao']),
    regraIncluida: situacao === 'incluida' ? n(r['regra_repasse_id']) : null,
  };
}

async function fusoDe(l: Leitor, est: number): Promise<string> {
  const r = await l.uma<{ fuso_horario: string | null }>(
    'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
    [est],
  );
  return r?.fuso_horario || FUSO_PADRAO;
}

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'repasse').slice(0, 64),
  };
}

const exigirEstabelecimento = (est: number | null): number => {
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return est;
};
const exigirUsuario = (u: number | null): number => {
  if (u === null) throw recusa('sem-usuario', 'A gravação do repasse exige o usuário da sessão.');
  return u;
};

/** Relê a linha com trava e confere a versão de negócio esperada (situação). */
async function travar(
  tx: TxOperacao,
  tabela: 'apuracao_repasse' | 'regra_repasse_versao',
  id: number,
  est: number,
) {
  const sql =
    tabela === 'apuracao_repasse'
      ? 'SELECT id, versao, situacao FROM apuracao_repasse WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL'
      : `SELECT v.id, v.versao, v.situacao, v.regra_repasse_id, v.proposto_por_usuario_id, v.dados
           FROM regra_repasse_versao v JOIN regra_repasse r ON r.id = v.regra_repasse_id
          WHERE v.id = ? AND r.estabelecimento_id = ?`;
  const r = (await tx.consultarParaAtualizar(sql, [id, est]))[0];
  if (!r)
    throw recusa(
      'nao-encontrado',
      tabela === 'apuracao_repasse' ? 'Apuração não encontrada.' : 'Versão de regra não encontrada.',
    );
  return r;
}

function gravadorSobre(tx: TxOperacao, est: number, usuario: number): GravadorRepasse {
  return {
    async proporVersao(d) {
      let proposta: Record<string, unknown>;
      try {
        proposta = JSON.parse(d.proposta) as Record<string, unknown>;
      } catch {
        throw recusa('proposta-invalida', 'A proposta da regra não veio num formato válido.');
      }
      const vigencia = String(proposta['vigencia'] ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia))
        throw recusa('proposta-invalida', 'Informe a vigência da regra.');
      let regra = d.substitui;
      if (regra === null) {
        const evento = Number(proposta['evento']);
        if (!Number.isInteger(evento) || evento <= 0)
          throw recusa('proposta-invalida', 'Informe o evento da regra.');
        const numero = await numeroDe(tx, 'regra_repasse', 'RR-', est, usuario);
        // A regra nova nasce inativa: só a inclusão da versão aprovada a ativa.
        regra = await tx.incluir('regra_repasse', {
          estabelecimento_id: est,
          codigo: numero.formatado,
          descricao: `Regra proposta ${numero.formatado}`,
          beneficiario: proposta['beneficiario'] === 'P' ? 'prestador' : 'profissional',
          evento_repasse_id: evento,
          vigencia_inicio: vigencia,
          ativo: false,
        });
      } else {
        const r = await tx.uma('SELECT id FROM regra_repasse WHERE id = ? AND estabelecimento_id = ?', [
          regra,
          est,
        ]);
        if (!r) throw recusa('regra-inexistente', 'A regra substituída não existe neste estabelecimento.');
      }
      const ultima = await tx.uma(
        'SELECT COALESCE(MAX(numero_versao), 0) AS n FROM regra_repasse_versao WHERE regra_repasse_id = ?',
        [regra],
      );
      const id = await tx.incluir('regra_repasse_versao', {
        regra_repasse_id: regra,
        operacao: d.substitui === null ? 'inclusao' : 'alteracao',
        dados: d.proposta,
        ocorrido_em: new Date(),
        usuario_id: usuario,
        numero_versao: n(ultima?.['n']) + 1,
        situacao: 'rascunho',
        vigencia_inicio: vigencia,
        justificativa: d.justificativa.slice(0, 500),
        proposto_por_usuario_id: usuario,
      });
      return { versao: id };
    },
    async marcarSimulada(d) {
      const v = await travar(tx, 'regra_repasse_versao', d.versao, est);
      if (texto(v['situacao']) === 'rascunho')
        await tx.alterar('regra_repasse_versao', d.versao, n(v['versao']), { situacao: 'simulada' });
      return { versao: d.versao };
    },
    async decidirVersao(d) {
      const v = await travar(tx, 'regra_repasse_versao', d.versao, est);
      if (!['rascunho', 'simulada'].includes(texto(v['situacao'])))
        throw recusa('versao-decidida', 'A versão da regra já foi decidida.');
      if (n(v['proposto_por_usuario_id']) === usuario)
        throw recusa('segregacao', 'Quem propôs a regra não pode decidir a mesma versão.');
      await tx.alterar('regra_repasse_versao', d.versao, n(v['versao']), {
        situacao: d.para,
        decidido_por_usuario_id: usuario,
        decidido_em: new Date(),
        justificativa_decisao: d.justificativa.slice(0, 500),
      });
      return { versao: d.versao, estado: d.para };
    },
    async gravarApuracao(d) {
      const competencia = `${d.competencia}-01`;
      const anterior = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao FROM apuracao_repasse
          WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
          ORDER BY id DESC LIMIT 1`,
        [est, competencia],
      );
      const a = anterior[0];
      if (a && !['em_apuracao', 'apurada'].includes(texto(a['situacao'])))
        throw recusa(
          'periodo-ja-apurado',
          'A apuração do período já foi conferida: a correção entra no período seguinte.',
        );
      let id: number;
      const agora = new Date();
      // Débitos do período (estorno de repasse depois da apuração, producao-conta.ts): os pendentes até esta
      // competência (inclusive o de um período já conferido sem recálculo, que não se perde) e os já aplicados a esta
      // apuração (no recálculo). Cada um abate o bruto do seu profissional (debitosNaApuracao, no domínio); o que não
      // cabe vira saldo devedor, levado ao período seguinte como débito novo ligado ao de origem.
      const debitos = await tx.consultarParaAtualizar(
        `SELECT e.id, e.versao, e.valor, e.situacao, e.producao_repasse_id, e.conta_hospitalar_id, e.glosa_item_id,
                e.motivo, p.profissional_id
           FROM estorno_repasse e JOIN producao_repasse p ON p.id = e.producao_repasse_id
          WHERE e.estabelecimento_id = ? AND e.excluido_em IS NULL
            AND ((e.situacao = 'pendente' AND e.competencia <= ?) OR (e.situacao = 'aplicado' AND e.apuracao_repasse_id = ?))
          ORDER BY e.id`,
        [est, competencia, a ? n(a['id']) : 0],
        { teto: 20000 },
      );
      // No recálculo, o saldo devedor levado adiante pelo cálculo anterior é refeito: o pendente é cancelado (fica no
      // histórico); o já descontado noutra apuração não se refaz aqui.
      const aplicados = debitos.filter((x) => texto(x['situacao']) === 'aplicado').map((x) => n(x['id']));
      if (aplicados.length > 0) {
        const levados = await tx.consultarParaAtualizar(
          `SELECT id, versao, situacao FROM estorno_repasse
            WHERE origem_estorno_repasse_id IN (${aplicados.map(() => '?').join(', ')}) AND excluido_em IS NULL
              AND situacao <> 'cancelado'`,
          aplicados,
          { teto: 20000 },
        );
        if (levados.some((x) => texto(x['situacao']) === 'aplicado'))
          throw recusa(
            'saldo-devedor-ja-descontado',
            'O saldo devedor deste período já foi descontado numa apuração seguinte: o recálculo mudaria o que ela já descontou.',
          );
        for (const x of levados)
          await tx.alterar('estorno_repasse', n(x['id']), n(x['versao']), { situacao: 'cancelado' });
      }
      const bruto = new Map<number, number>();
      for (const m of d.memorias)
        if (m.prestador !== null && !m.pendencia)
          bruto.set(m.prestador, (bruto.get(m.prestador) ?? 0) + Math.round(m.valor * 100));
      const plano = debitosNaApuracao(
        bruto,
        debitos.map((x) => ({
          id: n(x['id']),
          profissional: n(x['profissional_id']),
          valorCentavos: Math.round(n(x['valor']) * 100),
        })),
      );
      const descontoCentavos = plano.reduce((t, x) => t + x.descontadoCentavos, 0);
      const valores = {
        valor_faturado: d.totais.base,
        valor_bruto: d.totais.valor,
        valor_descontos: descontoCentavos / 100,
        valor_liquido: (Math.round(d.totais.valor * 100) - descontoCentavos) / 100,
        situacao: 'apurada',
        concluida_em: agora,
      };
      if (a) {
        id = n(a['id']);
        await tx.executar(
          'UPDATE apuracao_repasse_item SET excluido_em = ?, excluido_por = ? WHERE apuracao_repasse_id = ? AND excluido_em IS NULL',
          [new Date(), usuario, id],
        );
        // O recálculo é uma nova apuração: quem recalculou passa a ser quem apurou (segregação na aprovação).
        await tx.alterar('apuracao_repasse', id, n(a['versao']), {
          ...valores,
          iniciada_em: agora,
          iniciada_por_usuario_id: usuario,
        });
      } else {
        const numero = await numeroDe(tx, 'apuracao_repasse', 'AR-', est, usuario);
        id = await tx.incluir('apuracao_repasse', {
          estabelecimento_id: est,
          numero: numero.formatado,
          competencia,
          tipo_apuracao: 'producao',
          iniciada_em: agora,
          iniciada_por_usuario_id: usuario,
          ...valores,
        });
      }
      const seqAnterior = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM apuracao_repasse_item WHERE apuracao_repasse_id = ?',
        [id],
      );
      let seq = n(seqAnterior?.['s']);
      for (const m of d.memorias) {
        // O item sem profissional (pendência) aguarda o modelo (pedido do lote): fica só no resumo.
        if (m.prestador === null) continue;
        seq += 1;
        await tx.incluir('apuracao_repasse_item', {
          apuracao_repasse_id: id,
          sequencia: seq,
          profissional_id: m.prestador,
          producao_repasse_id: m.item,
          regra_repasse_id: m.regra ? await regraDoItem(tx, m.regra, est) : null,
          competencia_producao: competencia,
          valor_faturado: m.baseValor,
          percentual_repasse: m.percentual || null,
          valor_repasse: m.valor,
        });
      }
      const seguinte = competenciaSeguinte(d.competencia);
      for (const x of debitos) {
        if (texto(x['situacao']) === 'pendente')
          await tx.alterar('estorno_repasse', n(x['id']), n(x['versao']), {
            situacao: 'aplicado',
            apuracao_repasse_id: id,
            aplicado_em: agora,
          });
        const saldo = plano.find((p) => p.id === n(x['id']))?.saldoCentavos ?? 0;
        if (saldo > 0)
          await incluirEstornoRepasse(tx, est, usuario, {
            producao: n(x['producao_repasse_id']),
            conta: nn(x['conta_hospitalar_id']),
            glosaItem: nn(x['glosa_item_id']),
            motivo: texto(x['motivo']),
            valor: saldo / 100,
            competencia: seguinte,
            justificativa: `Saldo devedor do repasse que não coube no bruto do profissional na apuração de ${d.competencia}.`,
            origem: n(x['id']),
          });
      }
      return { apuracao: id, recalculada: Boolean(a) };
    },
    async transicionarApuracao(d) {
      const a = await travar(tx, 'apuracao_repasse', d.apuracao, est);
      const de = SITUACAO_DO_ESTADO[d.de];
      const para = SITUACAO_DO_ESTADO[d.para];
      if (!para) throw recusa('transicao-recusada', 'Estado da apuração desconhecido.');
      if (de && texto(a['situacao']) !== de && !(d.de === 'aberta' && texto(a['situacao']) === 'em_apuracao'))
        throw recusa('conflito-estado', 'A apuração mudou de estado: atualize a tela.');
      await tx.alterar('apuracao_repasse', d.apuracao, n(a['versao']), {
        situacao: para,
        ...(para === 'aprovada' ? { aprovada_em: new Date(), aprovada_por_usuario_id: usuario } : {}),
      });
      return { apuracao: d.apuracao, estado: d.para };
    },
  };
}

/** A competência (AAAA-MM) seguinte. */
function competenciaSeguinte(c: string): string {
  const [ano, mes] = c.split('-').map(Number) as [number, number];
  return mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

/** A regra (pai) do item de regra aplicado, só do estabelecimento da sessão. */
async function regraDoItem(tx: TxOperacao, item: number, est: number): Promise<number> {
  const r = await tx.uma(
    `SELECT i.regra_repasse_id FROM regra_repasse_item i JOIN regra_repasse r ON r.id = i.regra_repasse_id
      WHERE i.id = ? AND r.estabelecimento_id = ? AND i.excluido_em IS NULL`,
    [item, est],
  );
  if (!r) throw recusa('regra-inexistente', 'A regra aplicada não existe neste estabelecimento.');
  return n(r['regra_repasse_id']);
}

/** O evento de repasse ativo do estabelecimento (o id vem da entrada). */
async function exigirEvento(tx: TxOperacao, evento: number, est: number): Promise<number> {
  const r = await tx.uma(
    'SELECT id FROM evento_repasse WHERE id = ? AND estabelecimento_id = ? AND ativo = TRUE',
    [evento, est],
  );
  if (!r)
    throw recusa(
      'evento-inexistente',
      'O evento de repasse não existe ou não está ativo neste estabelecimento.',
    );
  return evento;
}

/** As retenções do RPA por tributo (sigla do cadastro de tributos), com a base e o valor de cada uma. */
const TRIBUTOS_RPA = [
  { codigo: 'INSS', base: 'baseInss', valor: 'inss' },
  { codigo: 'IRRF', base: 'baseIrrf', valor: 'irrf' },
  { codigo: 'ISS', base: 'bruto', valor: 'iss' },
] as const;

/** As operações de tela pelo executor (entrada pelo Zod do contrato). */
async function aplicarOperacao(
  tx: TxOperacao,
  op: string,
  e: Record<string, unknown>,
  ctx: ContextoOperacao,
) {
  const est = exigirEstabelecimento(ctx.estabelecimento);
  const usuario = exigirUsuario(ctx.usuario);
  switch (op) {
    case 'repasse.lancarEvento': {
      const prestador = n(e['prestador']);
      await exigirEvento(tx, n(e['evento']), est);
      if (e['apuracao'] !== null && e['apuracao'] !== undefined) {
        const ap = await tx.uma(
          'SELECT id FROM apuracao_repasse WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [n(e['apuracao']), est],
        );
        if (!ap) throw recusa('apuracao-inexistente', 'A apuração não existe neste estabelecimento.');
      }
      const tipoMedico = e['tipo'] === 'M';
      // F3.7-11 (06-FAT linha 46): o valor se divide pelos favorecidos vigentes na data (dividirRepasse, do domínio);
      // o estorno fica com o favorecido do lançamento original.
      const favs = await tx.consultar(
        `SELECT id, fonte_pagadora_id, tipo_favorecido, percentual, vigencia_inicio, vigencia_fim, conta_bancaria_credor_id
           FROM favorecido_repasse WHERE estabelecimento_id = ? AND profissional_id = ? AND ativo = TRUE
            AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
        [est, prestador, e['data'], e['data']],
      );
      const dia = String(e['data']);
      const divisao = dividirRepasse(
        centavos(n(e['valor'])),
        favs.map((f) => ({
          id: n(f['id']),
          fontePagadora: f['fonte_pagadora_id'] === null ? null : n(f['fonte_pagadora_id']),
          tipo: String(f['tipo_favorecido']) as TipoFavorecido,
          percentual: n(f['percentual']),
          inicio: dia,
          fim: null,
          contaBancaria: f['conta_bancaria_credor_id'] === null ? null : n(f['conta_bancaria_credor_id']),
        })),
        null,
        dia,
      );
      if (!divisao.ok) throw recusa(divisao.codigo, divisao.mensagem);
      const valor = n(e['valor']);
      if (e['origem'] === 'estorno') {
        const o = await tx.consultarParaAtualizar(
          `SELECT id, valor, profissional_id,
                  (SELECT COALESCE(SUM(-x.valor), 0) FROM lancamento_repasse x
                    WHERE x.estornado_lancamento_repasse_id = l.id AND x.excluido_em IS NULL AND x.situacao <> 'cancelado') AS estornado
             FROM lancamento_repasse l WHERE l.id = ? AND l.estabelecimento_id = ? AND l.excluido_em IS NULL`,
          [e['estornaDe'], est],
        );
        const orig = o[0];
        if (!orig || n(orig['profissional_id']) !== prestador)
          throw recusa('original-inexistente', 'O lançamento original não é deste profissional.');
        if (centavos(n(orig['estornado']) - valor) > centavos(n(orig['valor'])))
          throw recusa('estorno-excede', 'O estorno passa do valor do lançamento original.');
      }
      const linha = (favorecido: number, tipoFav: TipoFavorecido, v: number, pct: number | null) =>
        tx.incluir('lancamento_repasse', {
          estabelecimento_id: est,
          favorecido_repasse_id: favorecido,
          tipo_favorecido:
            tipoFav === 'pessoa_juridica' || tipoFav === 'cooperativa'
              ? 'empresa'
              : tipoMedico
                ? 'medico'
                : 'empresa',
          profissional_id: prestador,
          evento_repasse_id: n(e['evento']),
          tipo_lancamento: e['origem'],
          apuracao_repasse_id: e['apuracao'] ?? null,
          estornado_lancamento_repasse_id: e['origem'] === 'estorno' ? e['estornaDe'] : null,
          competencia: `${String(e['competencia'])}-01`,
          data_lancamento: e['data'],
          data_previsao_pagamento: e['previsao'] ?? null,
          valor: v,
          percentual: pct,
          referente: textoN(e['referente']),
          justificativa: textoN(e['justificativa']),
        });
      if (e['origem'] === 'estorno') {
        const o = await tx.uma(
          `SELECT l.favorecido_repasse_id AS f, l.percentual AS p, fr.tipo_favorecido AS t
             FROM lancamento_repasse l JOIN favorecido_repasse fr ON fr.id = l.favorecido_repasse_id WHERE l.id = ?`,
          [e['estornaDe']],
        );
        const pct = o?.['p'] === null || o?.['p'] === undefined ? null : n(o['p']);
        return { lancamento: await linha(n(o?.['f']), String(o?.['t']) as TipoFavorecido, valor, pct) };
      }
      const ids: number[] = [];
      for (const p of divisao.partes)
        if (p.centavos !== 0) ids.push(await linha(p.favorecido, p.tipo, p.centavos / 100, p.percentual));
      return { lancamento: ids[0]!, lancamentos: ids };
    }
    case 'repasse.emitirRpa': {
      const ids = (e['lancamentos'] as number[]).map(Number);
      const ls = await tx.consultarParaAtualizar(
        `SELECT l.id, l.valor, l.profissional_id,
                EXISTS (SELECT 1 FROM rpa_lancamento rl JOIN rpa x ON x.id = rl.rpa_id AND x.situacao <> 'cancelado'
                         WHERE rl.lancamento_repasse_id = l.id AND rl.excluido_em IS NULL) AS em_rpa
           FROM lancamento_repasse l
          WHERE l.estabelecimento_id = ? AND l.excluido_em IS NULL AND l.situacao <> 'cancelado' AND l.id IN (${marcas(ids)})`,
        [est, ...ids],
      );
      if (ls.length !== ids.length || ls.some((l) => n(l['profissional_id']) !== n(e['prestador'])))
        throw recusa('lancamento-inexistente', 'Algum lançamento não existe ou não é deste profissional.');
      if (ls.some((l) => Boolean(Number(l['em_rpa']))))
        throw recusa('ja-em-rpa', 'Algum lançamento já está em outro RPA.');
      const r = e['retencoes'] as Record<string, number>;
      const soma = ls.reduce((s, l) => s + centavos(n(l['valor'])), 0);
      if (soma !== centavos(n(r['bruto'])))
        throw recusa('bruto-divergente', 'O bruto não é a soma dos lançamentos.');
      const retido = centavos(n(r['inss'])) + centavos(n(r['irrf'])) + centavos(n(r['iss']));
      if (centavos(n(r['bruto'])) - retido !== centavos(n(r['liquido'])))
        throw recusa('retencoes-divergentes', 'O líquido não é o bruto menos o INSS, o IRRF e o ISS.');
      const tributos = new Map<string, number>();
      for (const t of await tx.consultar(
        "SELECT id, codigo FROM tributo WHERE codigo IN ('INSS', 'IRRF', 'ISS') AND ativo = TRUE",
        [],
      ))
        tributos.set(texto(t['codigo']), n(t['id']));
      const faltam = TRIBUTOS_RPA.filter((t) => n(r[t.valor]) > 0 && !tributos.has(t.codigo)).map(
        (t) => t.codigo,
      );
      if (faltam.length)
        throw recusa(
          'tributo-sem-cadastro',
          `Cadastre o tributo ${faltam.join(', ')} para emitir o RPA com a retenção.`,
        );
      const lim = limitesCompetencia(String(e['competencia']));
      const numero = await numeroDe(tx, 'rpa', '', est, usuario);
      const id = await tx.incluir('rpa', {
        estabelecimento_id: est,
        serie: 'RPA',
        numero: numero.valor,
        profissional_id: n(e['prestador']),
        periodo_inicio: lim.inicio,
        periodo_fim: lim.fim,
        competencia: lim.inicio,
        emitido_em: e['emissao'],
        valor_bruto: n(r['bruto']),
        valor_retencoes: n(r['inss']) + n(r['irrf']) + n(r['iss']),
        valor_liquido: n(r['liquido']),
        situacao: 'emitido',
      });
      for (const l of ids) await tx.incluir('rpa_lancamento', { rpa_id: id, lancamento_repasse_id: l });
      let seqRetencao = 0;
      for (const t of TRIBUTOS_RPA) {
        const valor = n(r[t.valor]);
        const base = n(r[t.base]);
        // A base sem valor retido (ex.: IRRF isento na faixa) também é registrada, quando o tributo está cadastrado.
        if ((valor <= 0 && base <= 0) || !tributos.has(t.codigo)) continue;
        seqRetencao += 1;
        await tx.incluir('rpa_retencao', {
          rpa_id: id,
          sequencia: seqRetencao,
          tributo_id: tributos.get(t.codigo),
          base_calculo: base,
          aliquota: base > 0 ? Math.min(100, Math.round((valor / base) * 1_000_000) / 10_000) : 0,
          valor,
        });
      }
      return { rpa: id, numero: numero.valor, titulo: 0 };
    }
    case 'repasse.incluirRegra': {
      const v = await travar(tx, 'regra_repasse_versao', n(e['versao']), est);
      if (texto(v['situacao']) !== 'aprovada')
        throw recusa('versao-nao-aprovada', 'Só a versão aprovada é incluída.');
      // A regra de um profissional (a dimensão mais forte): o prestador é o profissional (id). Os dois informados
      // têm de ser o mesmo, e o profissional tem de existir; sem nenhum, a regra vale para todos.
      const prof = n(e['profissional']) > 0 ? n(e['profissional']) : null;
      const prest = n(e['prestador']) > 0 ? n(e['prestador']) : null;
      if (prof !== null && prest !== null && prof !== prest)
        throw recusa('profissional-divergente', 'O prestador e o profissional da regra não são o mesmo.');
      const profissionalId = prof ?? prest;
      if (profissionalId !== null) {
        const pr = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
          profissionalId,
        ]);
        if (!pr) throw recusa('profissional-inexistente', 'O profissional da regra não existe.');
      }
      await exigirEvento(tx, n(e['evento']), est);
      const regra = n(v['regra_repasse_id']);
      const rr = (
        await tx.consultarParaAtualizar(
          'SELECT id, versao FROM regra_repasse WHERE id = ? AND estabelecimento_id = ?',
          [regra, est],
        )
      )[0];
      if (!rr) throw recusa('nao-encontrado', 'Regra não encontrada neste estabelecimento.');
      await tx.alterar('regra_repasse', regra, n(rr['versao']), {
        ativo: true,
        vigencia_inicio: e['vigencia'],
        evento_repasse_id: n(e['evento']),
        beneficiario: e['beneficiario'] === 'P' ? 'prestador' : 'profissional',
      });
      const seq = await tx.uma(
        'SELECT COALESCE(MAX(sequencia), 0) AS s FROM regra_repasse_item WHERE regra_repasse_id = ?',
        [regra],
      );
      const zeroNulo = (x: unknown) => (n(x) > 0 ? n(x) : null);
      const item = await tx.incluir('regra_repasse_item', {
        regra_repasse_id: regra,
        profissional_id: profissionalId,
        sequencia: n(seq?.['s']) + 1,
        fonte_pagadora_id: zeroNulo(e['convenio']),
        codigo_procedimento_inicial:
          n(e['procedimentoInicial']) > 0 ? String(e['procedimentoInicial']) : null,
        codigo_procedimento_final: n(e['procedimentoFinal']) > 0 ? String(e['procedimentoFinal']) : null,
        especialidade_medica_id: zeroNulo(e['especialidade']),
        funcao_equipe_cobranca_id: zeroNulo(e['ato']),
        grupo_ato_id: zeroNulo(e['grupoAto']),
        unidade_assistencial_id: zeroNulo(e['unidade']),
        tipo_lancamento_id: zeroNulo(e['tipoLancamento']),
        evento_repasse_id: n(e['evento']),
        escopo_conta: ESCOPO_DA_CONTA[e['tipoConta'] as 'A' | 'E' | 'I'],
        percentual: n(e['percentual']),
        valor_fixo: n(e['valorFixo']),
        percentual_feriado: n(e['percentualFeriado']),
        percentual_fim_semana: n(e['percentualFimDeSemana']),
      });
      await tx.alterar('regra_repasse_versao', n(v['id']), n(v['versao']), { situacao: 'incluida' });
      return { regra: item };
    }
    case 'repasse.integrarItens': {
      const a = await travar(tx, 'apuracao_repasse', n(e['apuracao']), est);
      if (texto(a['situacao']) !== 'aprovada')
        throw recusa('apuracao-nao-aprovada', 'Só a apuração aprovada é integrada.');
      let itens = 0;
      for (const l of e['lancamentos'] as { itens: { item: number; percentual: number; valor: number }[] }[])
        for (const i of l.itens) {
          const p = (
            await tx.consultarParaAtualizar(
              'SELECT id, versao FROM producao_repasse WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
              [i.item, est],
            )
          )[0];
          if (!p) throw recusa('item-inexistente', 'Item da produção não encontrado.');
          await tx.alterar('producao_repasse', i.item, n(p['versao']), {
            situacao: 'apurado',
            apuracao_repasse_id: n(e['apuracao']),
            percentual: i.percentual,
            valor_repasse: i.valor,
          });
          itens += 1;
        }
      return { itens };
    }
    default:
      throw recusa('operacao-desconhecida', `Operação ${op} não existe no repasse.`);
  }
}

// ── Gravador do lançamento do repasse sobre a transação de outra operação (escala: plantão realizado) ─────────────

/** Tabelas que o gravador do lançamento grava (quem compõe o gravador na própria operação as declara). */
export const TABELAS_EVENTO_REPASSE: readonly string[] = ['lancamento_repasse'];

/** A entrada do lançamento composto: a de repasse.lancarEvento, sem a origem (sempre `plantao`) e sem o estorno. */
export type EntradaEventoRepasseComposto = Omit<
  z.input<typeof esquemaLancarEventoRepasse>,
  'origem' | 'estornaDe'
>;

/** O estorno composto: o lançamento original e a data, a competência e a justificativa do lançamento negativo. */
export interface EntradaEstornoRepasseComposto {
  readonly lancamento: number;
  /** Data do lançamento negativo (AAAA-MM-DD) e a competência (AAAA-MM) em que ele entra. */
  readonly data: string;
  readonly competencia: string;
  readonly justificativa: string;
  /** Valor positivo a estornar; sem ele, o saldo ainda não estornado do original. */
  readonly valor?: number;
}

const esquemaEstornoComposto = z
  .object({
    lancamento: z.number().int().positive(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    justificativa: z.string().trim().min(10).max(400),
    valor: z.number().positive().max(99_999_999).optional(),
  })
  .strict();

/** Gravador do lançamento do repasse sobre a transação de outra operação do Executor (escala → repasse). */
export interface GravadorEventoRepasse {
  /**
   * Inclui o lançamento de origem `plantao` com as mesmas validações e recusas de repasse.lancarEvento (evento ativo,
   * favorecido vigente), no estabelecimento e com o usuário do contexto da transação.
   */
  incluir(entrada: EntradaEventoRepasseComposto): Promise<{ lancamento: number }>;
  /** Lança o estorno (valor negativo ligado ao original), recusando o que passa do valor do original. */
  estornar(entrada: EntradaEstornoRepasseComposto): Promise<{ lancamento: number }>;
}

export function gravadorEventoRepasse(tx: TxOperacao): GravadorEventoRepasse {
  return {
    async incluir(entrada) {
      const analise = esquemaLancarEventoRepasse.safeParse({ ...entrada, origem: 'plantao' });
      if (!analise.success)
        throw recusa(
          'lancamento-invalido',
          'O lançamento composto do repasse não passou na validação do contrato.',
        );
      const r = await aplicarOperacao(
        tx,
        'repasse.lancarEvento',
        analise.data as Record<string, unknown>,
        tx.contexto,
      );
      return { lancamento: n((r as Record<string, unknown>)['lancamento']) };
    },
    async estornar(entrada) {
      const analise = esquemaEstornoComposto.safeParse(entrada);
      if (!analise.success)
        throw recusa('estorno-invalido', 'O estorno composto do repasse não passou na validação.');
      const e = analise.data;
      const est = exigirEstabelecimento(tx.contexto.estabelecimento);
      const orig = await tx.uma(
        `SELECT l.id, l.valor, l.profissional_id, l.evento_repasse_id, l.tipo_favorecido, l.referente,
                (SELECT COALESCE(SUM(-x.valor), 0) FROM lancamento_repasse x
                  WHERE x.estornado_lancamento_repasse_id = l.id AND x.excluido_em IS NULL AND x.situacao <> 'cancelado') AS estornado
           FROM lancamento_repasse l
          WHERE l.id = ? AND l.estabelecimento_id = ? AND l.excluido_em IS NULL AND l.tipo_lancamento <> 'estorno'`,
        [e.lancamento, est],
      );
      if (!orig)
        throw recusa('original-inexistente', 'O lançamento original não existe neste estabelecimento.');
      const saldo = centavos(n(orig['valor'])) - centavos(n(orig['estornado']));
      const valor = e.valor ?? saldo / 100;
      if (valor <= 0) throw recusa('estorno-excede', 'O lançamento original já foi todo estornado.');
      const r = await aplicarOperacao(
        tx,
        'repasse.lancarEvento',
        {
          origem: 'estorno',
          estornaDe: e.lancamento,
          prestador: n(orig['profissional_id']),
          evento: n(orig['evento_repasse_id']),
          tipo: orig['tipo_favorecido'] === 'medico' ? 'M' : 'E',
          competencia: e.competencia,
          data: e.data,
          previsao: null,
          apuracao: null,
          valor: -valor,
          referente: textoN(orig['referente']),
          justificativa: e.justificativa,
        },
        tx.contexto,
      );
      return { lancamento: n((r as Record<string, unknown>)['lancamento']) };
    },
  };
}

export class PortaRepassePropria implements PortaRepasse {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoRepasse,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoRepasse, fn: (l: Leitor, est: number, fuso: string) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), async (l) => fn(l, est, await fusoDe(l, est)));
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoRepasse, op: string) {
    return op in ENTRADAS_OPERACAO_REPASSE
      ? { pode: true, codigo: null, motivo: null }
      : { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida no repasse.' };
  }

  async executar(c: ContextoRepasse, op: string, entrada: unknown, octx: ContextoOperacao) {
    const esquema = ENTRADAS_OPERACAO_REPASSE[op];
    if (!esquema) throw recusa('operacao-desconhecida', `Operação ${op} não existe no repasse.`);
    const def = definirOperacao({
      // Nome da operação no núcleo (minúsculas e hífen): repasse.lancarEvento → repasse.lancar-evento.
      nome: op.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      tabelas: TABELAS,
      entrada: esquema as z.ZodType<Record<string, unknown>>,
      critica: op === 'repasse.emitirRpa',
      gravar: async (tx, e, ctx) => (await aplicarOperacao(tx, op, e, ctx)) as ResultadoOperacao,
      alvo: (_e, r) => ({
        tabela:
          op === 'repasse.lancarEvento'
            ? 'lancamento_repasse'
            : op === 'repasse.emitirRpa'
              ? 'rpa'
              : op === 'repasse.incluirRegra'
                ? 'regra_repasse_item'
                : 'apuracao_repasse',
        id: nn(Object.values(r)[0]),
      }),
    });
    const r = await this.executor.executar(def, c.cliente, entrada, { ...contextoDe(c), ...octx });
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorRepasse) => Promise<T>,
  ): Promise<T> {
    const est = exigirEstabelecimento(c.estabelecimento);
    const usuario = exigirUsuario(c.usuario);
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: 'repasse.gravacao-direta',
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        saida = { valor: await fn(gravadorSobre(tx, est, usuario)) };
        return { valor: JSON.stringify(saida.valor ?? null) } as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'apuracao_repasse', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = chaveDaGravacao('repasse', c);
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...contextoDe(c), chaveIdempotencia: chave },
    );
    if (r.repetida) return JSON.parse(String(r.resultado['valor'] ?? 'null')) as T;
    if (!saida) throw new Error('Gravação do repasse sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────

  hoje(c: ContextoRepasse): Promise<string> {
    return this.ler(c, async (_l, _e, fuso) => relogioNoFuso(fuso).hoje);
  }

  opcoes(c: ContextoRepasse): Promise<{ eventos: OpcaoPorta[]; convenios: OpcaoPorta[] }> {
    return this.ler(c, async (l, est) => {
      const [ev, cv] = await Promise.all([
        l.consultar(
          'SELECT id, nome FROM evento_repasse WHERE estabelecimento_id = ? AND ativo = TRUE ORDER BY nome, id',
          [est],
          {
            teto: 500,
          },
        ),
        // O convênio (fonte pagadora) é cadastro da rede inteira.
        l.consultar(
          "SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome, id",
          [],
          {
            teto: 2000,
          },
        ),
      ]);
      const op = (r: Linha) => ({ codigo: n(r['id']), rotulo: texto(r['nome']) });
      return { eventos: ev.map(op), convenios: cv.map(op) };
    });
  }

  regras(c: ContextoRepasse, f: FiltroRegrasPorta): Promise<RegraRepasse[]> {
    const teto = Math.min(f.teto ?? 500, 5000);
    return this.ler(c, async (l, est) => {
      const params: unknown[] = [est, f.data, f.data, f.convenio, f.depoisDe];
      let sql = `${SQL_REGRAS} AND i.id > ?`;
      if (f.procedimento) {
        sql += ` AND (i.codigo_procedimento_inicial IS NULL OR (CAST(i.codigo_procedimento_inicial AS UNSIGNED) <= ?
                  AND CAST(COALESCE(i.codigo_procedimento_final, i.codigo_procedimento_inicial) AS UNSIGNED) >= ?))`;
        params.push(f.procedimento, f.procedimento);
      }
      return (await l.consultar(`${sql} ORDER BY i.id LIMIT ${teto}`, params, { teto })).map(regraDe);
    });
  }

  // A regra integral da consulta particular (código INTEGRAL-PART-*) sai daqui: ela não tem as dimensões de item e grupo
  // no RegraRepasse e valeria para todo item do particular. O motor a recebe por integraisParticular (OpcoesCalculo).
  todasRegras(c: ContextoRepasse, f: { convenio: number; data: string }): Promise<RegraRepasse[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_REGRAS} AND r.codigo NOT LIKE ? ORDER BY i.id`,
          [est, f.data, f.data, f.convenio, PREFIXO_INTEGRAL],
          {
            teto: 20000,
          },
        )
      ).map(regraDe),
    );
  }

  integraisParticular(c: ContextoRepasse, data: string): Promise<IntegraisParticular> {
    return this.ler(c, (l, est) => lerIntegraisParticular(l, est, data));
  }

  // Enquanto a memória não guarda o item de regra aplicado (pedido do lote), um item conta como usado quando a sua regra
  // (pai) foi usada: o lado conservador (a regra usada não se altera, ganha nova versão).
  regrasUsadas(c: ContextoRepasse, ids: readonly number[]): Promise<Set<number>> {
    if (ids.length === 0) return Promise.resolve(new Set());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT DISTINCT ri.id FROM regra_repasse_item ri
           JOIN regra_repasse r ON r.id = ri.regra_repasse_id AND r.estabelecimento_id = ?
           JOIN apuracao_repasse_item ai ON ai.regra_repasse_id = ri.regra_repasse_id AND ai.excluido_em IS NULL
          WHERE ri.id IN (${marcas(ids)})`,
        [est, ...ids],
        { teto: ids.length },
      );
      return new Set(rs.map((r) => n(r['id'])));
    });
  }

  versoes(c: ContextoRepasse): Promise<VersaoRegraRegistrada[]> {
    return this.ler(c, async (l, est, fuso) =>
      (await l.consultar(`${SQL_VERSOES} ORDER BY v.id DESC`, [est], { teto: 500 })).map((r) =>
        versaoDe(r, fuso),
      ),
    );
  }

  versao(c: ContextoRepasse, id: number): Promise<VersaoRegraRegistrada | null> {
    return this.ler(c, async (l, est, fuso) => {
      const r = (await l.consultar(`${SQL_VERSOES} AND v.id = ?`, [est, id], { teto: 1 }))[0];
      return r ? versaoDe(r, fuso) : null;
    });
  }

  producao(
    c: ContextoRepasse,
    competencia: string,
    depoisDe: number,
  ): Promise<{ itens: ItemProducao[]; ultimo: number | null }> {
    const TETO = 2000;
    return this.ler(c, async (l, est, fuso) => {
      const rs = await l.consultar(
        `SELECT p.id, chi.realizado_em, ch.fonte_pagadora_id, ifa.codigo AS procedimento, ifa.grupo_ato_id, p.funcao_equipe_cobranca_id,
                p.tipo_lancamento_id, ch.natureza, p.profissional_id, p.valor_base, at.especialidade_medica_id,
                at.local_atendimento_id, at.unidade_assistencial_id, COALESCE(chi.centro_custo_id, at.centro_custo_id) AS centro,
                pr.cooperativa_medica_id
           FROM producao_repasse p
           JOIN conta_hospitalar ch ON ch.id = p.conta_hospitalar_id
           JOIN conta_hospitalar_item chi ON chi.id = p.conta_hospitalar_item_id
           JOIN item_faturavel ifa ON ifa.id = chi.item_faturavel_id
           JOIN atendimento at ON at.id = ch.atendimento_id
           LEFT JOIN profissional pr ON pr.id = p.profissional_id
          WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.situacao NOT IN ('cancelado', 'estornado')
            AND ch.competencia = ? AND p.id > ?
          ORDER BY p.id LIMIT ${TETO + 1}`,
        [est, `${competencia}-01`, depoisDe],
        { teto: TETO + 1 },
      );
      const itens = rs.slice(0, TETO).map((r): ItemProducao => {
        const quando = local(r['realizado_em'], fuso) ?? '';
        return {
          id: n(r['id']),
          data: quando.slice(0, 10),
          hora: quando.slice(11, 16),
          convenio: n(r['fonte_pagadora_id']),
          procedimento: codigoProcedimento(r['procedimento']),
          especialidade: nn(r['especialidade_medica_id']),
          ato: nn(r['funcao_equipe_cobranca_id']),
          grupoAto: nn(r['grupo_ato_id']),
          local: nn(r['local_atendimento_id']),
          unidade: nn(r['unidade_assistencial_id']),
          centroCusto: nn(r['centro']),
          cooperativa: nn(r['cooperativa_medica_id']),
          tipoLancamento: nn(r['tipo_lancamento_id']),
          tipoConta: texto(r['natureza']) === 'internacao' ? 'I' : 'E',
          executante: nn(r['profissional_id']),
          cobrado: n(r['valor_base']),
          pago: 0,
          recursoDeferido: 0,
          conciliado: false,
        };
      });
      return { itens, ultimo: rs.length > TETO ? itens[itens.length - 1]!.id : null };
    });
  }

  jaIntegrados(c: ContextoRepasse, itens: readonly number[]): Promise<Set<number>> {
    if (itens.length === 0) return Promise.resolve(new Set());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT id FROM producao_repasse WHERE estabelecimento_id = ? AND excluido_em IS NULL
            AND situacao IN ('apurado', 'pago') AND id IN (${marcas(itens)})`,
        [est, ...itens],
        { teto: itens.length },
      );
      return new Set(rs.map((r) => n(r['id'])));
    });
  }

  estadoPeriodo(
    c: ContextoRepasse,
    _empresa: number,
    competencia: string,
  ): Promise<{ lancamentos: number; daApuracao: number }> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COUNT(*) AS q, SUM(tipo_lancamento = 'apuracao') AS a FROM lancamento_repasse
          WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [est, `${competencia}-01`],
      );
      return { lancamentos: n(r?.['q']), daApuracao: n(r?.['a']) };
    });
  }

  apuracaoDoPeriodo(
    c: ContextoRepasse,
    _empresa: number,
    competencia: string,
  ): Promise<ApuracaoRepasseRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = (
        await l.consultar(
          `${SQL_APURACAO} AND a.competencia = ? ORDER BY a.id DESC`,
          [est, `${competencia}-01`],
          { teto: 1 },
        )
      )[0];
      return r ? apuracaoDe(r) : null;
    });
  }

  apuracao(c: ContextoRepasse, id: number): Promise<ApuracaoRepasseRegistrada | null> {
    return this.ler(c, async (l, est) => {
      const r = (await l.consultar(`${SQL_APURACAO} AND a.id = ?`, [est, id], { teto: 1 }))[0];
      return r ? apuracaoDe(r) : null;
    });
  }

  memorias(
    c: ContextoRepasse,
    apuracao: number,
    prestador: number | null,
  ): Promise<MemoriaCalculoRegistrada[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT x.producao_repasse_id, x.profissional_id, x.valor_faturado, x.percentual_repasse, x.valor_repasse
             FROM apuracao_repasse_item x
             JOIN apuracao_repasse a ON a.id = x.apuracao_repasse_id AND a.estabelecimento_id = ?
            WHERE x.apuracao_repasse_id = ? AND x.excluido_em IS NULL${prestador === null ? '' : ' AND x.profissional_id = ?'}
            ORDER BY x.sequencia`,
          prestador === null ? [est, apuracao] : [est, apuracao, prestador],
          { teto: 50000 },
        )
      ).map((r) => ({
        item: n(r['producao_repasse_id']),
        prestador: nn(r['profissional_id']),
        // O item de regra aplicado aguarda a coluna (pedido do lote): nunca se adivinha qual item da regra casou.
        regra: null,
        dimensoes: '',
        ignoradas: '',
        base: null,
        baseValor: n(r['valor_faturado']),
        percentual: n(r['percentual_repasse']),
        valorFixo: 0,
        valorSemAdicional: n(r['valor_repasse']),
        adicional: null,
        valor: n(r['valor_repasse']),
        pendencia: null,
      })),
    );
  }

  lancamentos(
    c: ContextoRepasse,
    f: { empresa: number; competencia: string; prestador?: number },
  ): Promise<LancamentoRepasseRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_LANCAMENTOS} AND l.competencia = ?${f.prestador ? ' AND l.profissional_id = ?' : ''} ORDER BY l.data_lancamento, l.id`,
          f.prestador ? [est, `${f.competencia}-01`, f.prestador] : [est, `${f.competencia}-01`],
          { teto: 20000 },
        )
      ).map(lancamentoDe),
    );
  }

  estornos(c: ContextoRepasse, lancamentos: readonly number[]): Promise<Map<number, number>> {
    if (lancamentos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT id AS e, estornado_lancamento_repasse_id AS o FROM lancamento_repasse
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND estornado_lancamento_repasse_id IS NOT NULL
            AND id IN (${marcas(lancamentos)})`,
        [est, ...lancamentos],
        { teto: lancamentos.length },
      );
      // O contrato: o id do estorno → o id do lançamento original.
      return new Map(rs.map((r) => [n(r['e']), n(r['o'])]));
    });
  }

  rpas(c: ContextoRepasse, f: { empresa: number; competencia: string }): Promise<RpaRegistrado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_RPAS} AND r.competencia = ? ORDER BY r.numero`,
          [est, `${f.competencia}-01`],
          { teto: 5000 },
        )
      ).map(rpaDe),
    );
  }

  rpaDetalhe(c: ContextoRepasse, id: number): Promise<RpaDetalhe | null> {
    return this.ler(c, async (l, est) => {
      const r = (await l.consultar(`${SQL_RPAS} AND r.id = ?`, [est, id], { teto: 1 }))[0];
      if (!r) return null;
      const [ls, ct, rt] = await Promise.all([
        l.consultar(
          `SELECT lr.id, lr.data_lancamento, lr.evento_repasse_id, lr.valor FROM rpa_lancamento rl
             JOIN lancamento_repasse lr ON lr.id = rl.lancamento_repasse_id
            WHERE rl.rpa_id = ? AND rl.excluido_em IS NULL ORDER BY lr.id`,
          [id],
          { teto: 500 },
        ),
        l.uma(
          `SELECT pf.nome, pf.cpf FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
          [n(r['profissional_id'])],
        ),
        l.consultar(
          `SELECT t.codigo, x.base_calculo, x.valor FROM rpa_retencao x JOIN tributo t ON t.id = x.tributo_id
            WHERE x.rpa_id = ? AND x.excluido_em IS NULL`,
          [id],
          { teto: 20 },
        ),
      ]);
      const ret = new Map(
        rt.map((x) => [texto(x['codigo']), { base: n(x['base_calculo']), valor: n(x['valor']) }]),
      );
      const bruto = ls.reduce((s, x) => s + n(x['valor']), 0);
      const cpf = texto(ct?.['cpf']);
      return {
        rpa: rpaDe(r),
        lancamentos: ls.map((x) => ({
          id: n(x['id']),
          data: dataIso(x['data_lancamento']),
          evento: n(x['evento_repasse_id']),
          valor: n(x['valor']),
        })),
        // As retenções gravadas por tributo (rpa_retencao); o título a pagar aguarda o modelo (pedido do lote).
        retencoes: {
          bruto,
          baseInss: ret.get('INSS')?.base ?? 0,
          inss: ret.get('INSS')?.valor ?? 0,
          baseIrrf: ret.get('IRRF')?.base ?? 0,
          irrf: ret.get('IRRF')?.valor ?? 0,
          iss: ret.get('ISS')?.valor ?? 0,
          liquido: n(r['valor_liquido']),
        },
        titulo: null,
        contribuinte: ct
          ? { nome: texto(ct['nome']), conselho: '', documento: cpf ? `***.***.***-${cpf.slice(-2)}` : '' }
          : null,
      };
    });
  }

  buscarPrestadores(c: ContextoRepasse, termo: string): Promise<PrestadorRepasse[]> {
    // O profissional é cadastro da rede inteira; a busca é por nome (prefixo do termo).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT p.id, pf.nome FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND p.situacao = 'ativo' AND pf.nome LIKE ? ORDER BY pf.nome, p.id LIMIT 30`,
          [`${termo.replace(/[%_\\]/g, '')}%`],
          { teto: 30 },
        )
      ).map((r) => ({ prestador: n(r['id']), registro: n(r['id']), nome: texto(r['nome']), conselho: '' })),
    );
  }

  jaEmRpa(c: ContextoRepasse, lancamentos: readonly number[]): Promise<Set<number>> {
    if (lancamentos.length === 0) return Promise.resolve(new Set());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT rl.lancamento_repasse_id AS id FROM rpa_lancamento rl
           JOIN rpa r ON r.id = rl.rpa_id AND r.estabelecimento_id = ? AND r.situacao <> 'cancelado'
          WHERE rl.excluido_em IS NULL AND rl.lancamento_repasse_id IN (${marcas(lancamentos)})`,
        [est, ...lancamentos],
        { teto: lancamentos.length },
      );
      return new Set(rs.map((r) => n(r['id'])));
    });
  }

  prestadoresDoUsuario(c: ContextoRepasse, login: string): Promise<number[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT DISTINCT up.profissional_id FROM usuario u
             JOIN usuario_profissional up ON up.usuario_id = u.id AND up.excluido_em IS NULL
            WHERE u.login = ? AND u.excluido_em IS NULL`,
          [login],
          { teto: 20 },
        )
      ).map((r) => n(r['profissional_id'])),
    );
  }

  debitosDaApuracao(c: ContextoRepasse, apuracao: number): Promise<Map<number, number>> {
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        // O descontado é o débito aplicado menos o saldo devedor levado ao período seguinte (gravarApuracao).
        `SELECT p.profissional_id,
                SUM(e.valor - COALESCE((SELECT SUM(s.valor) FROM estorno_repasse s
                                          WHERE s.origem_estorno_repasse_id = e.id AND s.excluido_em IS NULL
                                            AND s.situacao <> 'cancelado'), 0)) AS v
           FROM estorno_repasse e JOIN producao_repasse p ON p.id = e.producao_repasse_id
          WHERE e.estabelecimento_id = ? AND e.apuracao_repasse_id = ? AND e.situacao = 'aplicado'
            AND e.excluido_em IS NULL
          GROUP BY p.profissional_id`,
        [est, apuracao],
        { teto: 20000 },
      );
      return new Map(rs.map((r) => [n(r['profissional_id']), n(r['v'])]));
    });
  }

  registroDoPrestador(c: ContextoRepasse, prestador: number): Promise<number | null> {
    return this.ler(c, async (l) => {
      const r = await l.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [prestador]);
      return nn(r?.['id']);
    });
  }

  lancamentosDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    desde: string,
    ate?: string | null,
  ): Promise<LancamentoRepasseRegistrado[]> {
    if (prestadores.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_LANCAMENTOS} AND l.profissional_id IN (${marcas(prestadores)}) AND l.data_lancamento >= ?${ate ? ' AND l.data_lancamento <= ?' : ''}
            ORDER BY l.data_lancamento, l.id`,
          ate ? [est, ...prestadores, desde, ate] : [est, ...prestadores, desde],
          { teto: 20000 },
        )
      ).map(lancamentoDe),
    );
  }

  rpasDosPrestadores(
    c: ContextoRepasse,
    prestadores: readonly number[],
    desde: string,
    ate?: string | null,
  ): Promise<(RpaRegistrado & { valor: number; titulo: number | null })[]> {
    if (prestadores.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `${SQL_RPAS} AND r.profissional_id IN (${marcas(prestadores)}) AND r.emitido_em >= ?${ate ? ' AND r.emitido_em <= ?' : ''}
            ORDER BY r.emitido_em, r.id`,
          ate ? [est, ...prestadores, desde, ate] : [est, ...prestadores, desde],
          { teto: 5000 },
        )
      ).map((r) => ({ ...rpaDe(r), valor: n(r['valor_liquido']), titulo: null })),
    );
  }

  /**
   * O saldo a compensar ATUAL (não o da competência consultada: o saldo não guarda histórico) dos adiantamentos ao
   * profissional e aos fornecedores que recebem por ele (F3.7, 06-FAT linha 46): o fornecedor do prestador terceiro
   * ligado ao profissional e o fornecedor da empresa do médico que é favorecida dele; a cooperativa, de muitos médicos,
   * fica fora. Contam os aprovados, pagos ou compensados em parte; o cancelado, o compensado e o excluído não.
   */
  adiantamentos(c: ContextoRepasse, prestadores: readonly number[]): Promise<number> {
    if (prestadores.length === 0) return Promise.resolve(0);
    const m = marcas(prestadores);
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT COALESCE(SUM(a.saldo_compensar), 0) AS saldo FROM adiantamento a
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao IN ('aprovado', 'pago', 'compensado_parcial')
            AND ((a.tipo_credor = 'profissional' AND a.profissional_id IN (${m}))
              OR (a.tipo_credor = 'fornecedor' AND a.empresa_fornecedora_id IN (
                    SELECT pt.empresa_fornecedora_id FROM prestador_terceiro pt
                     WHERE pt.estabelecimento_id = ? AND pt.excluido_em IS NULL AND pt.profissional_id IN (${m})
                       AND pt.empresa_fornecedora_id IS NOT NULL
                    UNION
                    SELECT ef.id FROM favorecido_repasse fr JOIN empresa_fornecedora ef
                        ON ef.pessoa_juridica_id = fr.favorecido_pessoa_juridica_id AND ef.excluido_em IS NULL
                     WHERE fr.estabelecimento_id = ? AND fr.ativo AND fr.tipo_favorecido = 'pessoa_juridica'
                       AND fr.profissional_id IN (${m}))))`,
        [est, ...prestadores, est, ...prestadores, est, ...prestadores],
      );
      return n(r?.['saldo']);
    });
  }

  basesIndicadores(c: ContextoRepasse, de: string, ate: string): Promise<BasesIndicadoresRepassePorta> {
    return this.ler(c, async (l, est) => {
      const [lr, ap, rp] = await Promise.all([
        l.uma(
          `SELECT COALESCE(SUM(CASE WHEN valor > 0 THEN valor END), 0) AS repasse,
                  SUM(tipo_lancamento = 'estorno') AS estornos,
                  COALESCE(SUM(CASE WHEN tipo_lancamento = 'estorno' THEN -valor END), 0) AS valor_estornos
             FROM lancamento_repasse
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND data_lancamento BETWEEN ? AND ?`,
          [est, de, ate],
        ),
        l.uma(
          `SELECT COALESCE(SUM(a.valor_faturado), 0) AS honorarios,
                  (SELECT COUNT(*) FROM apuracao_repasse_item x JOIN apuracao_repasse y ON y.id = x.apuracao_repasse_id
                    WHERE y.estabelecimento_id = ? AND y.competencia BETWEEN ? AND ? AND x.excluido_em IS NULL) AS linhas
             FROM apuracao_repasse a
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelada' AND a.competencia BETWEEN ? AND ?`,
          [est, de, ate, est, de, ate],
        ),
        l.uma(
          `SELECT COUNT(*) AS rpas, SUM(situacao = 'pago') AS pagos FROM rpa
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND emitido_em BETWEEN ? AND ?`,
          [est, de, ate],
        ),
      ]);
      return {
        repasse: n(lr?.['repasse']),
        honorarios: n(ap?.['honorarios']),
        linhas: n(ap?.['linhas']),
        estornos: n(lr?.['estornos']),
        valorEstornos: n(lr?.['valor_estornos']),
        rpas: n(rp?.['rpas']),
        rpasPagos: n(rp?.['pagos']),
        diasAtePagamento: 0, // a data do pagamento do RPA aguarda o modelo (pedido do lote)
      };
    });
  }
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaRepasseIndisponivel(): PortaRepasse {
  return portaIndisponivel<PortaRepasse>(METODOS_PORTA_REPASSE);
}
