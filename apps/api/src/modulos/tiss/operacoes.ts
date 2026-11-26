// Operações de gravação do pós-fechamento (M31) sobre o banco do cliente, pelo Executor do @sgh/nucleo: gerar o lote
// TISS, registrar ou limpar o protocolo e fechar a competência do convênio. Cada uma declara as tabelas que grava; a
// trilha, o outbox e a idempotência vão na mesma transação, e o registro alterado é travado e relido (trava otimista
// pela coluna `versao`). As regras ficam em regras-tiss.ts e no domínio do faturamento (puras).
// Melhoria: o número do lote vem da sequência de negócio do estabelecimento (garantida na primeira vez), não de um
// contador por convênio; o XML só é gravado depois de validado no XSD e guardado (disco local, somente leitura), com o arquivo
// registrado (hash SHA-256, tamanho, imutável) e ligado ao lote; a conta vai a "faturada" pela própria operação.
// Melhoria: o protocolo vira registro próprio (protocolo_recebimento, com a situação e quem registrou); limpar o
// protocolo cancela o registro anterior em vez de apagá-lo, e o histórico do lote sai desses registros; registrar de
// novo o mesmo número no mesmo lote reativa o registro cancelado (a trilha guarda a limpeza), e o número de outro lote
// do convênio recusa com mensagem de negócio.
// Melhoria: a guia sai do cadastro (guia montada, atendimento, autorização, inscrição do profissional no conselho):
// sem executante, caráter ou, no resumo de internação, tipo/regime/motivo de saída, o lote é recusado com o que falta;
// o CNES, o código do prestador e o registro ANS são obrigatórios; a guia confere itens e total com a conta.
// Melhoria: o fechamento da competência grava o retrato (contas e valor apresentado) em
// fechamento_competencia_fonte_pagadora, com quem fechou e quando.
// F3.7 (06-FAT linha 34): a baixa do retorno por item (registrarGlosa), o lote de recurso e o retorno do recurso
// gravam no banco pelas operações de operacoes-glosa.ts.
import {
  esquemaFecharCompetencia,
  esquemaReabrirCompetencia,
  esquemaGerarLote,
  esquemaRegistrarProtocolo,
  type ContaTiss,
  type FecharCompetenciaEntrada,
  type ReabrirCompetenciaEntrada,
  type GerarLoteEntrada,
  type MontadorLoteTiss,
  type RegistrarProtocoloEntrada,
} from '@sgh/contratos';
import {
  type CampoPadraoTiss,
  conferirFechamentoCompetencia,
  conferirEntregaNoCalendario,
  conferirRegistroProtocolo,
  faltasDoPrestador,
  normalizarProtocolo,
  VERSAO_TISS_VIGENTE,
  conferirReaberturaCompetencia,
  recusaCamposOperadoraInvalidos,
  recusaObrigatoriosPendentes,
  recusaObservacaoLonga,
  conferirReducaoComercialDaGuia,
  reducaoComercialDaGuia,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  garantirSequencia,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { civil } from '../exames/relogio.js';
import { versaoNumero } from '../faturamento/esquemas.js';
import { abatimentoComercialDaConta } from '../faturamento/regras-comerciais-propria.js';
import {
  carteiraDoSeguradoDaConta,
  obrigatoriosPendentesDaConta,
  observacaoDaGuiaPropria,
} from '../faturamento/conta-complementos-propria.js';
import {
  caraterTiss,
  codigosDaInternacao,
  indicadorAcidenteGuia,
  conferirContaParaLoteModelo,
  conferirGuiaComConta,
  diaDaCompetencia,
  type ExecutanteGuia,
  executanteDaGuia,
  recusaCadastroTiss,
  reusoDoProtocolo,
  tipoConsultaTiss,
  tipoFaturamentoTiss,
  unitarioDaGuia,
  grupoTissDoItem,
  naturezaDoItem,
  tabelaTissDoItem,
  TIPO_GUIA_NO_MODELO,
  type TipoGuiaLote,
} from './regras-tiss.js';
import { operacoesGlosaCom } from './operacoes-glosa.js';
// F3.7 (06-FAT linhas 29 a 31): regra de apresentação, valor padrão, credenciamento e fatura ao pagador no lote.
import { apresentarLote, gravarFaturaDoLote, protocolarFaturaDoLote } from './apresentacao-propria.js';
// F3.1 (02-CAD linha 25): o número da guia sai da faixa da operadora e a guia emitida fica gravada com o lote.
import { gravarGuiasDoLote, numerarGuiasDoLote, TABELAS_NUMERACAO_GUIA } from './numeracao-guia.js';

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '';
const horaIso = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(11, 19) : '00:00:00');

/** Operações do executor ainda sem gravação no banco (o modelo do pagamento por item está pedido). */
export const OPERACOES_TISS_PENDENTES: Readonly<Record<string, string>> = {};

function estabelecimentoDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return ctx.estabelecimento;
}

const conflito = () =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Registro alterado',
    'O registro mudou desde a leitura: releia e repita.',
  );

async function fusoDe(tx: TxOperacao, est: number): Promise<string> {
  const e = await tx.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return texto(e?.['fuso_horario']) || 'America/Sao_Paulo';
}

const SITUACOES_SEM_COBRANCA = "('sem_cobranca','transferido','estornado')";

/** Profissional pelo cadastro: a inscrição ativa no conselho (a principal primeiro), a UF e o CBO, e o nome. */
const SQL_PROFISSIONAL = `
  SELECT cc.codigo_tiss AS conselho, ic.numero_inscricao AS numero, COALESCE(uf.codigo_tiss, uf.codigo_ibge) AS uf,
         COALESCE(cbi.codigo_cbo, cbp.codigo_cbo, cba.codigo_cbo) AS cbo, pf.nome
    FROM profissional p
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    JOIN inscricao_conselho ic ON ic.profissional_id = p.id AND ic.excluido_em IS NULL
         AND ic.situacao IN ('ativa','provisoria')
    JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
    JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
    LEFT JOIN ocupacao_cbo cbi ON cbi.id = ic.ocupacao_cbo_id
    LEFT JOIN profissional_ocupacao po ON po.profissional_id = p.id AND po.principal AND po.ativo
         AND po.excluido_em IS NULL
    LEFT JOIN ocupacao_cbo cbp ON cbp.id = po.ocupacao_cbo_id
    LEFT JOIN ocupacao_cbo cba ON cba.id = ?
   WHERE p.id = ? AND p.excluido_em IS NULL
   ORDER BY ic.principal DESC, ic.sequencia`;

/**
 * Guia TISS mais recente da conta para o tipo e a fonte pagadora da conta (quando o faturamento já a montou), com os
 * códigos da TISS. A guia de outra fonte pagadora (conta que trocou de convênio) não vale para esta apresentação.
 */
const SQL_GUIA_DA_CONTA = `
  SELECT g.id, g.numero_guia_prestador, g.numero_guia_operadora, g.atendimento_recem_nascido, g.senha,
         g.data_autorizacao, g.executante_profissional_id, g.solicitante_profissional_id, g.tipo_faturamento,
         ca.codigo_tiss AS carater, ti.codigo_termo AS tipo_internacao, ri.codigo_termo AS regime,
         me.codigo_termo AS motivo_saida, tc.codigo_termo AS tipo_consulta, ta.codigo_termo AS tipo_atendimento,
         ia.codigo_termo AS indicador_acidente
    FROM guia_tiss g
    LEFT JOIN carater_atendimento_tiss ca ON ca.id = g.carater_atendimento_tiss_id
    LEFT JOIN termo_terminologia ti ON ti.id = g.tipo_internacao_termo_terminologia_id
    LEFT JOIN termo_terminologia ri ON ri.id = g.regime_internacao_termo_terminologia_id
    LEFT JOIN termo_terminologia me ON me.id = g.motivo_encerramento_termo_terminologia_id
    LEFT JOIN termo_terminologia tc ON tc.id = g.tipo_consulta_termo_terminologia_id
    LEFT JOIN termo_terminologia ta ON ta.id = g.tipo_atendimento_termo_terminologia_id
    LEFT JOIN termo_terminologia ia ON ia.id = g.indicador_acidente_termo_terminologia_id
   WHERE g.conta_hospitalar_id = ? AND g.tipo_guia = ? AND g.fonte_pagadora_id = ? AND g.excluido_em IS NULL
     AND g.situacao <> 'cancelada'
   ORDER BY g.id DESC LIMIT 1`;

/** Tipo de guia do lote → tipo da guia TISS montada (guia_tiss.tipo_guia). */
const TIPO_GUIA_TISS: Readonly<Record<TipoGuiaLote, string>> = {
  1: 'consulta',
  2: 'sp_sadt',
  3: 'resumo_internacao',
  4: 'honorario',
};

/**
 * A assinatura do cadastro do profissional (02-CAD linha 16) que vale no dia do ato: ProfissionalComplementoProprio
 * .assinaturaNoDia, ligada pela porta. Sem ela (memória, testes de unidade), a guia não confere a assinatura.
 */
export type AssinaturaDoExecutante = (
  profissional: number,
  dia: string,
) => Promise<{ assinatura: { id: number } | null; rqes: readonly unknown[] }>;

/** O executante (ou, na SP/SADT, o solicitante): a equipe da guia montada; senão o cadastro dos candidatos, em ordem. */
async function executanteDaConta(
  tx: TxOperacao,
  guia: Linha | null,
  candidatos: readonly unknown[],
  atendimento: Linha | null,
): Promise<(ExecutanteGuia & { readonly id: number }) | null> {
  if (guia) {
    const equipe = await tx.consultar<Linha>(
      `SELECT cc.codigo_tiss AS conselho, gp.numero_conselho AS numero, COALESCE(uf.codigo_tiss, uf.codigo_ibge) AS uf,
              cbo.codigo_cbo AS cbo, pf.nome, gp.codigo_prestador_operadora AS codigo, gp.profissional_id AS pid
         FROM guia_tiss_profissional gp
         JOIN profissional p ON p.id = gp.profissional_id
         JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
         LEFT JOIN conselho_classe cc ON cc.id = gp.conselho_classe_id
         LEFT JOIN unidade_federativa uf ON uf.id = gp.conselho_unidade_federativa_id
         LEFT JOIN ocupacao_cbo cbo ON cbo.id = gp.ocupacao_cbo_id
        WHERE gp.guia_tiss_id = ? AND gp.excluido_em IS NULL
        ORDER BY gp.sequencia`,
      [guia['id']],
    );
    for (const r of equipe) {
      const e = executanteDaGuia({
        conselho: texto(r['conselho']),
        numero: texto(r['numero']),
        uf: texto(r['uf']),
        cbo: texto(r['cbo']),
        nome: texto(r['nome']),
        codigoOperadora: texto(r['codigo']),
      });
      if (e) return { ...e, id: n(r['pid']) };
    }
  }
  const vistos = new Set<number>();
  for (const c of candidatos) {
    const id = n(c);
    if (!(id > 0) || vistos.has(id)) continue;
    vistos.add(id);
    const cboAtendimento =
      atendimento && n(atendimento['profissional_id']) === id ? atendimento['ocupacao_cbo_id'] : null;
    const linhas = await tx.consultar<Linha>(SQL_PROFISSIONAL, [cboAtendimento ?? null, id]);
    for (const r of linhas) {
      const e = executanteDaGuia({
        conselho: texto(r['conselho']),
        numero: texto(r['numero']),
        uf: texto(r['uf']),
        cbo: texto(r['cbo']),
        nome: texto(r['nome']),
      });
      if (e) return { ...e, id };
    }
  }
  return null;
}

/**
 * A conta no formato do montador do lote, lida sob a transação: a guia montada (quando existe), o atendimento, a guia de
 * autorização e o cadastro do profissional. O que a guia exige e falta recusa com o que falta (nunca valor padrão); a
 * guia confere com a conta (itens e total). Avisos: o que a montagem preenche pela regra da TISS e deve ser conferido.
 */
async function contaTiss(
  tx: TxOperacao,
  ct: Linha,
  tipoGuia: TipoGuiaLote,
  est: number,
  assinaturaNoDia: AssinaturaDoExecutante | null = null,
): Promise<{ conta: ContaTiss; avisos: string[]; informados: Set<CampoPadraoTiss> }> {
  const rotulo = texto(ct['numero']) || String(n(ct['id']));
  const itens = await tx.consultar<Linha>(
    `SELECT ci.sequencia, ci.realizado_em, ci.quantidade, ci.valor_unitario, ci.valor_total, f.codigo, f.descricao,
            f.tipo_item
       FROM conta_hospitalar_item ci JOIN item_faturavel f ON f.id = ci.item_faturavel_id
      WHERE ci.conta_hospitalar_id = ? AND ci.excluido_em IS NULL AND ci.situacao NOT IN ${SITUACOES_SEM_COBRANCA}
      ORDER BY ci.sequencia`,
    [n(ct['id'])],
  );
  const soma = await tx.uma<Linha>(
    `SELECT COUNT(*) AS q FROM conta_hospitalar_item
      WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND situacao NOT IN ${SITUACOES_SEM_COBRANCA}`,
    [n(ct['id'])],
  );
  const at = await tx.uma<Linha>(
    `SELECT a.recem_nascido, a.retorno, a.profissional_id, a.solicitante_profissional_id, a.ocupacao_cbo_id,
            ca.codigo_tiss AS carater, ra.codigo_tiss AS regime, me.codigo_tiss AS motivo_saida,
            cl.codigo_tiss_tipo_internacao AS tipo_internacao, ia.codigo_termo AS indicador_acidente
       FROM atendimento a
       JOIN carater_atendimento_tiss ca ON ca.id = a.carater_atendimento_tiss_id
       LEFT JOIN regime_atendimento ra ON ra.id = a.regime_atendimento_id
       LEFT JOIN motivo_encerramento_atendimento me ON me.id = a.motivo_encerramento_atendimento_id
       LEFT JOIN clinica_assistencial cl ON cl.id = a.clinica_assistencial_id
       LEFT JOIN termo_terminologia ia ON ia.id = a.indicador_acidente_termo_terminologia_id
      WHERE a.id = ? AND a.excluido_em IS NULL`,
    [ct['atendimento_id']],
  );
  const guia = await tx.uma<Linha>(SQL_GUIA_DA_CONTA, [
    n(ct['id']),
    TIPO_GUIA_TISS[tipoGuia],
    n(ct['fonte_pagadora_id']),
  ]);
  const autorizacao = ct['guia_fonte_pagadora_id']
    ? await tx.uma<Linha>(
        'SELECT numero_guia_operadora, data_autorizacao, senha FROM guia_fonte_pagadora WHERE id = ? AND excluido_em IS NULL',
        [ct['guia_fonte_pagadora_id']],
      )
    : null;
  // Os campos adicionais da operadora informados na guia vão à observação da guia TISS (06-FAT linha 10).
  const obs = guia?.['id'] ? await observacaoDaGuiaPropria(tx, est, n(guia['id'])) : null;
  // Valor gravado que deixou de valer (opção inativada, combinação com o pai, caractere fora do ISO-8859-1): recusa
  // com a guia e o campo, em vez de sumir do arquivo ou quebrar a montagem do XML.
  const invalidos = obs ? recusaCamposOperadoraInvalidos(rotulo, obs.numero, obs.erros) : null;
  if (invalidos) throw recusa(invalidos.codigo, invalidos.mensagem);
  if (obs?.excede && obs.texto) {
    const r = recusaObservacaoLonga(rotulo, obs.numero, obs.texto.length);
    throw recusa(r.codigo, r.mensagem);
  }
  // A carteira do segurado gravada na conta (06-FAT linha 12) vale sobre a da cobertura do paciente.
  const seguradoConta = await carteiraDoSeguradoDaConta(tx, n(ct['id']));
  const carteira = seguradoConta
    ? { numero_carteira: seguradoConta }
    : ct['cobertura_paciente_id']
      ? await tx.uma<Linha>('SELECT numero_carteira FROM cobertura_paciente WHERE id = ?', [
          ct['cobertura_paciente_id'],
        ])
      : null;

  const faltas: string[] = [];
  const executante = await executanteDaConta(
    tx,
    guia,
    [
      ...(tipoGuia === 2 ? [guia?.['solicitante_profissional_id'], at?.['solicitante_profissional_id']] : []),
      guia?.['executante_profissional_id'],
      ...(
        await tx.consultar<Linha>(
          `SELECT executante_profissional_id AS id, COUNT(*) AS q FROM conta_hospitalar_item
            WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND situacao NOT IN ${SITUACOES_SEM_COBRANCA}
              AND executante_profissional_id IS NOT NULL
            GROUP BY executante_profissional_id ORDER BY q DESC, id LIMIT 5`,
          [n(ct['id'])],
        )
      ).map((r) => r['id']),
      at?.['profissional_id'],
    ],
    at,
  );
  // O resumo de internação não leva o profissional no cabeçalho (só consulta, SP/SADT e honorário o exigem).
  if (!executante && tipoGuia !== 3)
    faltas.push(
      tipoGuia === 2
        ? 'o profissional solicitante com conselho, número, UF e CBO'
        : 'o profissional executante com conselho, número, UF e CBO',
    );
  const carater = caraterTiss(texto(guia?.['carater']) || texto(at?.['carater']));
  if (!carater) faltas.push('o caráter do atendimento no padrão TISS (1 eletivo ou 2 urgência)');
  const tipoFaturamento = tipoFaturamentoTiss(
    texto(guia?.['tipo_faturamento']) || texto(ct['tipo_cobranca']),
  );
  if (!tipoFaturamento) faltas.push('o tipo de faturamento da conta');
  const internacao = codigosDaInternacao({
    tipo: texto(guia?.['tipo_internacao']) || texto(at?.['tipo_internacao']) || null,
    regime: texto(guia?.['regime']) || texto(at?.['regime']) || null,
    motivo: texto(guia?.['motivo_saida']) || texto(at?.['motivo_saida']) || null,
  });
  // Só o resumo de internação leva o tipo, o regime e o motivo de saída: nas outras guias eles não vão ao XML.
  if (tipoGuia === 3 && !internacao.ok) faltas.push(...internacao.faltas);
  if (faltas.length) {
    const r = recusaCadastroTiss(rotulo, faltas);
    throw recusa(r.codigo, r.mensagem);
  }

  const itensGuia = itens.map((i, k) => {
    const quantidade = n(i['quantidade']);
    return {
      sequencial: k + 1,
      tipo: grupoTissDoItem(texto(i['tipo_item'])),
      natureza: naturezaDoItem(texto(i['tipo_item'])),
      data: dataIso(i['realizado_em']),
      codigo: texto(i['codigo']).slice(0, 10),
      codigoTabela: tabelaTissDoItem(texto(i['tipo_item'])),
      descricao: texto(i['descricao']).slice(0, 150),
      quantidade,
      valorUnitario: unitarioDaGuia(quantidade, n(i['valor_unitario']), n(i['valor_total'])),
    };
  });
  // 06-FAT linha 19: o desconto por volume e a franquia aplicados saem do total da conta e vão à guia pelo fator de
  // redução dos itens; a conferência compara os itens com o total antes desse abatimento.
  // O fator vai item a item (reducaoComercialDaGuia) para o total da guia fechar no centavo com o valor_total da conta;
  // se o fator de duas casas do padrão não fecha (guia de um item só, por exemplo), a conta é recusada, nunca cobrada
  // diferente da conta.
  const bruto = itensGuia.reduce((t, i) => t + Math.round(i.quantidade * i.valorUnitario * 100), 0) / 100;
  const comercial = await abatimentoComercialDaConta(tx, n(ct['id']), bruto);
  const divergente = conferirGuiaComConta({
    conta: rotulo,
    itens: itensGuia,
    esperados: n(soma?.['q']),
    totalConta: Math.round((n(ct['valor_total']) + comercial.abatimento) * 100) / 100,
  });
  if (divergente) throw recusa(divergente.codigo, divergente.mensagem);
  // O alvo é o próprio valor_total (a folga da conferência acima cobre só o arredondamento das linhas).
  const abatimentoGuia =
    comercial.abatimento > 0 ? Math.max(0, Math.round((bruto - n(ct['valor_total'])) * 100) / 100) : 0;
  const reducao = reducaoComercialDaGuia(itensGuia, abatimentoGuia);
  const fechamento = conferirReducaoComercialDaGuia(
    rotulo,
    reducao,
    n(ct['valor_total']),
    comercial.abatimento,
  );
  if (fechamento) throw recusa(fechamento.codigo, fechamento.mensagem);
  const itensReduzidos = itensGuia.map((i, k) => {
    const f = reducao.fatores[k] ?? 1;
    return f === 1 ? i : { ...i, reducaoAcrescimo: f };
  });

  const avisos: string[] = [];
  const guiaSolicitacao = (
    texto(guia?.['numero_guia_operadora']) || texto(autorizacao?.['numero_guia_operadora'])
  ).slice(0, 20);
  const dataAutorizacao = dataIso(guia?.['data_autorizacao'] ?? autorizacao?.['data_autorizacao'] ?? null);
  if ((tipoGuia === 3 || tipoGuia === 4) && !guiaSolicitacao)
    avisos.push(
      `a conta ${rotulo} não tem o número da guia de autorização na operadora (vai o número da guia do prestador)`,
    );
  if (tipoGuia === 3 && !dataAutorizacao)
    avisos.push(`a conta ${rotulo} não tem a data da autorização (vai a data de início do atendimento)`);
  // A guia que leva o profissional confere a assinatura do cadastro vigente na data do ato (início da conta).
  const diaDoAto = dataIso(ct['inicio_em'] ?? null);
  if (executante && executante.id > 0 && tipoGuia !== 3 && assinaturaNoDia && diaDoAto) {
    const doCadastro = await assinaturaNoDia(executante.id, diaDoAto);
    if (!doCadastro.assinatura)
      avisos.push(
        `o profissional ${executante.nome} da conta ${rotulo} não tem assinatura cadastrada vigente em ${diaDoAto}`,
      );
  }
  const inicio = ct['inicio_em'];
  const fim = ct['fim_em'] ?? ct['inicio_em'];
  const recemNascido = guia
    ? Boolean(n(guia['atendimento_recem_nascido']))
    : Boolean(n(at?.['recem_nascido']));
  // Os campos que vieram do cadastro: o valor padrão da fonte pagadora só os substitui com `sobrepoe` (linha 30).
  const informados = new Set<CampoPadraoTiss>(['caraterAtendimento', 'tipoFaturamento']);
  if (texto(guia?.['tipo_atendimento'])) informados.add('tipoAtendimento');
  if (texto(guia?.['tipo_consulta'])) informados.add('tipoConsulta');
  if (internacao.ok)
    for (const c of ['tipoInternacao', 'regimeInternacao', 'motivoEncerramento'] as const) informados.add(c);
  return {
    avisos,
    informados,
    conta: {
      conta: n(ct['id']),
      tipoGuia,
      numeroGuia: (texto(guia?.['numero_guia_prestador']) || texto(ct['numero'])).slice(0, 20),
      carteira: texto(carteira?.['numero_carteira']),
      atendimentoRN: recemNascido,
      inicio: { data: dataIso(inicio), hora: horaIso(inicio) },
      fim: { data: dataIso(fim), hora: horaIso(fim) },
      caraterAtendimento: carater!,
      tipoConsulta: tipoConsultaTiss(texto(guia?.['tipo_consulta']), Boolean(n(at?.['retorno']))),
      tipoAtendimento:
        texto(guia?.['tipo_atendimento']) || (ct['natureza'] === 'pronto_atendimento' ? '11' : '23'),
      senha: (
        texto(guia?.['senha']) ||
        texto(ct['senha_autorizacao']) ||
        texto(autorizacao?.['senha'])
      ).slice(0, 20),
      guiaSolicitacao,
      dataAutorizacao,
      tipoFaturamento: tipoFaturamento!,
      // Fora do resumo de internação estes três não vão ao XML (a montagem não os lê); quando lidos, seguem o cadastro.
      tipoInternacao: internacao.ok ? internacao.tipoInternacao : '1',
      regimeInternacao: internacao.ok ? internacao.regimeInternacao : '1',
      motivoEncerramento: internacao.ok ? internacao.motivoEncerramento : '',
      // 04-INT linha 67: o acidente da admissão (ou registrado depois) vai ao resumo de internação.
      indicadorAcidente: indicadorAcidenteGuia(
        texto(guia?.['indicador_acidente']),
        texto(at?.['indicador_acidente']),
      ),
      // Sem executante só no resumo de internação, que não o leva ao XML: vazio, nunca um profissional padrão.
      profissional: executante?.profissional ?? { conselho: '', numeroConselho: '', uf: '', cbos: '' },
      profissionalNome: executante?.nome ?? '',
      profissionalCodigo: executante?.codigo ?? '',
      executantePadrao: false,
      ...(obs?.texto ? { observacao: obs.texto } : {}),
      itens: itensReduzidos,
    },
  };
}

/** Gera o lote TISS: confere cada conta sob a trava, monta e valida o XML, guarda, e grava o lote e as contas. */
function gerarLote(montador: MontadorLoteTiss | null, assinaturaNoDia: AssinaturaDoExecutante | null = null) {
  return definirOperacao<GerarLoteEntrada, ResultadoOperacao>({
    nome: 'faturamento.gerar-lote',
    tabelas: [
      'lote_tiss',
      'lote_tiss_conta',
      'conta_hospitalar',
      'arquivo',
      'sequencia_negocio',
      'fatura_fonte_pagadora',
      'fatura_fonte_pagadora_conta',
      ...TABELAS_NUMERACAO_GUIA,
    ],
    entrada: esquemaGerarLote,
    async gravar(tx, e, ctx) {
      const est = estabelecimentoDe(ctx);
      if (!montador)
        throw new ErroOperacao(
          503,
          'guarda-xml-indisponivel',
          'Guarda do XML indisponível',
          'A guarda do XML TISS não está configurada: nenhum lote foi gerado.',
        );
      const tipoGuia = e.tipoGuia as TipoGuiaLote;
      const contas: Linha[] = [];
      for (const it of e.contas) {
        const [ct] = await tx.consultarParaAtualizar<Linha>(
          `SELECT id, versao, numero, fonte_pagadora_id, natureza, situacao, competencia, inicio_em, fim_em,
                  senha_autorizacao, cobertura_paciente_id, valor_total, atendimento_id, guia_fonte_pagadora_id,
                  tipo_cobranca, tipo_conta_id, plano_fonte_pagadora_id
             FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [it.id, est],
        );
        if (!ct) throw recusa('conta-inexistente', `A conta ${it.id} não existe neste estabelecimento.`);
        if (versaoNumero(it.versao) !== n(ct['versao'])) throw conflito();
        const emLote = await tx.uma<Linha>(
          `SELECT COUNT(*) AS q FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
            WHERE ltc.conta_hospitalar_id = ? AND ltc.excluido_em IS NULL AND lt.excluido_em IS NULL
              AND lt.situacao <> 'cancelado'`,
          [it.id],
        );
        const fechada = await tx.uma<Linha>(
          `SELECT id FROM fechamento_competencia_fonte_pagadora
            WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND situacao = 'fechada'
              AND excluido_em IS NULL`,
          [est, ct['fonte_pagadora_id'], dataIso(ct['competencia'])],
        );
        const r = conferirContaParaLoteModelo(
          {
            id: it.id,
            convenio: n(ct['fonte_pagadora_id']),
            natureza: texto(ct['natureza']),
            situacao: texto(ct['situacao']),
            emLote: n(emLote?.['q']) > 0,
            competenciaFechada: fechada !== null,
          },
          e,
        );
        if (r) throw recusa(r.codigo, r.mensagem);
        // Campo obrigatório da operadora sem valor na guia (06-FAT linha 10): a conta não vai ao lote.
        const pend = recusaObrigatoriosPendentes(
          texto(ct['numero']) || String(it.id),
          await obrigatoriosPendentesDaConta(tx, est, it.id, TIPO_GUIA_TISS[tipoGuia]),
        );
        if (pend) throw recusa(pend.codigo, pend.mensagem);
        contas.push(ct);
      }
      const cfg = await tx.uma<Linha>(
        `SELECT c.registro_ans, c.codigo_prestador_operadora, c.versao_padrao_tiss_id, f.registro_ans AS registro_fonte
           FROM fonte_pagadora f
           LEFT JOIN configuracao_tiss_fonte_pagadora c ON c.fonte_pagadora_id = f.id AND c.estabelecimento_id = ?
                 AND c.ativo = TRUE AND c.vigencia_inicio <= CURRENT_DATE
                 AND (c.vigencia_fim IS NULL OR c.vigencia_fim >= CURRENT_DATE)
          WHERE f.id = ? AND f.excluido_em IS NULL
          ORDER BY c.vigencia_inicio DESC LIMIT 1`,
        [est, e.convenio],
      );
      if (!cfg) throw recusa('convenio-inexistente', 'O convênio não existe.');
      const versao =
        cfg['versao_padrao_tiss_id'] ??
        (
          await tx.uma<Linha>(
            'SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = ? AND ativo = TRUE LIMIT 1',
            [VERSAO_TISS_VIGENTE],
          )
        )?.['id'];
      if (!versao)
        throw recusa(
          'versao-tiss-ausente',
          `A versão ${VERSAO_TISS_VIGENTE} do padrão TISS não está no catálogo do estabelecimento.`,
        );
      const estab = await tx.uma<Linha>(
        'SELECT codigo_cnes, razao_social, nome_fantasia FROM estabelecimento WHERE id = ?',
        [est],
      );
      const montadas: ContaTiss[] = [];
      const avisos: string[] = [];
      const lidas = [];
      for (const ct of contas) {
        const g = await contaTiss(tx, ct, tipoGuia, est, assinaturaNoDia);
        lidas.push({ linha: ct, conta: g.conta, informados: g.informados });
        avisos.push(...g.avisos);
      }
      const hoje = civil(new Date(), await fusoDe(tx, est)).data;
      const ap = await apresentarLote(tx, est, e.convenio, tipoGuia, lidas, hoje);
      // Só a guia que vai ao arquivo consome número da faixa da operadora (a omitida não gasta número).
      const numerado = await numerarGuiasDoLote(
        tx,
        est,
        e.convenio,
        TIPO_GUIA_TISS[tipoGuia],
        ap.montadas,
        hoje,
      );
      montadas.push(...numerado.montadas);
      avisos.push(...ap.avisos, ...numerado.avisos);
      const prestador = {
        registroAns: texto(ap.registroAns ?? cfg['registro_ans'] ?? cfg['registro_fonte']).replace(/\D/g, ''),
        codigoPrestador: texto(ap.codigoPrestador ?? cfg['codigo_prestador_operadora']).trim(),
        cnes: texto(estab?.['codigo_cnes']).trim(),
        nome: texto(estab?.['nome_fantasia'] ?? estab?.['razao_social']).slice(0, 70),
        // Contratado por CNPJ ou CPF quando a regra de apresentação da fonte pede (06-FAT linha 30).
        ...(ap.identificacao ? { identificacao: ap.identificacao } : {}),
      };
      const faltasCadastro = faltasDoPrestador(prestador);
      if (faltasCadastro.length)
        throw recusa(
          'cadastro-tiss-incompleto',
          `O lote não pode ser montado: falta ${faltasCadastro.join(', ')} no cadastro TISS do convênio ou do estabelecimento.`,
        );
      await garantirSequencia(
        tx,
        { tipo: 'lote_tiss', estabelecimento: est, inicio: 1 },
        { usuario: ctx.usuario, agora: new Date() },
      );
      const numero = await tx.proximoNumero('lote_tiss');
      const numeroLote = String(numero.valor).padStart(12, '0');
      const m = await montador({
        hospital: String(est),
        lote: 0,
        convenio: e.convenio,
        numeroLote,
        sequencial: numeroLote,
        prestador,
        contas: montadas,
        agora: new Date(),
      });
      if (!m.valido)
        throw recusa(
          'xsd-invalido',
          `O XML do lote não passou no XSD da TISS ${VERSAO_TISS_VIGENTE}: ${m.explicacao.slice(0, 3).join(' ')}`,
        );
      const arquivo = await tx.incluir('arquivo', {
        estabelecimento_id: est,
        entidade: 'lote_tiss',
        finalidade: 'xml_lote_tiss',
        nome_original: `lote-${numeroLote}.xml`,
        tipo_mime: 'application/xml',
        tamanho_bytes: m.bytes,
        hash_sha256: m.hashArquivo,
        chave_armazenamento: m.chaveObjeto,
        imutavel: true,
      });
      const lote = await tx.incluir('lote_tiss', {
        estabelecimento_id: est,
        fonte_pagadora_id: e.convenio,
        numero_lote: numeroLote,
        sequencial: numeroLote,
        tipo_envio: 'normal',
        tipo_guia: TIPO_GUIA_NO_MODELO[tipoGuia],
        versao_padrao_tiss_id: versao,
        gerado_em: new Date(),
        quantidade_guias: m.guias,
        valor_total: m.valor,
        hash_epilogo: m.hashEpilogo,
        hash_arquivo: m.hashArquivo,
        tamanho_bytes: m.bytes,
        arquivo_id: arquivo,
        situacao: 'gerado',
      });
      await tx.alterar('arquivo', arquivo, 1, { entidade_id: lote });
      // Só as contas que foram ao arquivo entram no lote e na fatura, com o valor da guia apresentada (depois da
      // regra); a conta omitida (guia zerada que a fonte não recebe) fica como estava, na fila do faturamento.
      const enviadas = contas.filter((ct) => ap.valores.has(n(ct['id'])));
      for (const ct of enviadas) {
        await tx.incluir('lote_tiss_conta', {
          lote_tiss_id: lote,
          conta_hospitalar_id: ct['id'],
          valor: ap.valores.get(n(ct['id'])),
        });
        await tx.alterar('conta_hospitalar', n(ct['id']), n(ct['versao']), { situacao: 'faturada' });
      }
      await gravarGuiasDoLote(tx, {
        estabelecimento: est,
        fonte: e.convenio,
        tipoGuia: TIPO_GUIA_TISS[tipoGuia],
        lote,
        hoje,
        agora: new Date(),
        usuario: ctx.usuario ?? null,
        numerado,
        valores: ap.valores,
      });
      const fatura = await gravarFaturaDoLote(tx, est, {
        fonte: e.convenio,
        lote,
        contas: enviadas.map((ct) => ({
          id: n(ct['id']),
          valor: ap.valores.get(n(ct['id'])) ?? 0,
          competencia: dataIso(ct['competencia']),
        })),
        valor: m.valor,
        usuario: ctx.usuario ?? null,
        agora: new Date(),
        hoje,
      });
      return {
        lote,
        fatura: fatura.fatura,
        numeroFatura: fatura.numero,
        convenio: e.convenio,
        numeroLote,
        sequencial: numeroLote,
        contas: enviadas.length,
        contasForaDoArquivo: ap.omitidas.length,
        valor: m.valor,
        alertas: avisos.length ? `Confira antes do envio: ${avisos.join('; ')}.` : '',
      };
    },
    alvo: (_e, r) => ({ tabela: 'lote_tiss', id: n(r['lote']) }),
  });
}

/** Registra ou limpa o protocolo devolvido pela operadora (o lote protocolado fica congelado). */
const registrarProtocolo = definirOperacao<RegistrarProtocoloEntrada, ResultadoOperacao>({
  nome: 'faturamento.registrar-protocolo',
  tabelas: ['lote_tiss', 'protocolo_recebimento', 'fatura_fonte_pagadora'],
  entrada: esquemaRegistrarProtocolo,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [l] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, fonte_pagadora_id, numero_protocolo, protocolo_recebimento_id, quantidade_guias, valor_total
         FROM lote_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [e.lote, est],
    );
    if (!l) throw recusa('lote-inexistente', 'O lote não existe.');
    const np = normalizarProtocolo(e.protocolo);
    if (!np.ok) throw recusa(np.recusa.codigo, np.recusa.mensagem, { campos: ['protocolo'] });
    const anterior = texto(l['numero_protocolo']);
    const r = conferirRegistroProtocolo(anterior, e.acao, np.protocolo);
    if (r) throw recusa(r.codigo, r.mensagem);
    if (e.acao === 'registrar') {
      // A situação vem do banco (situacao_protocolo_recebimento, só as ativas); sem situação, recebido.
      const situacao =
        e.situacao === null
          ? 'recebido'
          : texto(
              (
                await tx.uma<Linha>(
                  'SELECT codigo FROM situacao_protocolo_recebimento WHERE numero_tiss = ? AND ativo',
                  [e.situacao],
                )
              )?.['codigo'],
            ) || null;
      if (!situacao)
        throw recusa('situacao-inexistente', 'A situação do protocolo não existe.', { campos: ['situacao'] });
      // O calendário de entrega da fonte pagadora (06-FAT linha 31): a competência com janela restritiva só
      // recebe a fatura dentro dela; a regra é do domínio (conferirEntregaNoCalendario).
      const dataEntrega = e.data ?? civil(new Date(), await fusoDe(tx, est)).data;
      const competencias = (
        await tx.consultar<Linha>(
          `SELECT DISTINCT ch.competencia FROM lote_tiss_conta ltc
             JOIN conta_hospitalar ch ON ch.id = ltc.conta_hospitalar_id
            WHERE ltc.lote_tiss_id = ? AND ltc.excluido_em IS NULL AND ch.competencia IS NOT NULL`,
          [e.lote],
        )
      ).map((r) => dataIso(r['competencia']));
      if (competencias.length > 0) {
        const marcas = competencias.map(() => '?').join(', ');
        const janelas = (
          await tx.consultar<Linha>(
            `SELECT competencia, entrega_inicio, entrega_fim, restritivo FROM calendario_entrega_fatura
              WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND ativo
                AND competencia IN (${marcas})`,
            [est, l['fonte_pagadora_id'], ...competencias],
          )
        ).map((r) => ({
          competencia: dataIso(r['competencia']),
          entregaInicio: dataIso(r['entrega_inicio']),
          entregaFim: dataIso(r['entrega_fim']),
          pagamentoPrevisto: null,
          prazoPagamentoDias: null,
          restritivo: Boolean(Number(r['restritivo'])),
        }));
        const fora = conferirEntregaNoCalendario(janelas, competencias, dataEntrega);
        if (fora) throw recusa(fora.codigo, fora.mensagem, { campos: [...(fora.campos ?? [])] });
      }
      // O número é único por convênio (também o cancelado): o registro cancelado deste lote é reativado.
      const [existente] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, lote_tiss_id, situacao, excluido_em FROM protocolo_recebimento
          WHERE fonte_pagadora_id = ? AND numero_protocolo = ?`,
        [l['fonte_pagadora_id'], np.protocolo],
      );
      const reuso = reusoDoProtocolo(
        existente
          ? {
              lote: n(existente['lote_tiss_id']),
              situacao: texto(existente['situacao']),
              excluido: existente['excluido_em'] !== null && existente['excluido_em'] !== undefined,
            }
          : null,
        e.lote,
        np.protocolo,
      );
      if (typeof reuso !== 'string')
        throw recusa(reuso.codigo, reuso.mensagem, { campos: [...(reuso.campos ?? [])] });
      const dados = {
        recebido_em: e.data ? new Date(`${e.data}T12:00:00Z`) : new Date(),
        situacao,
        // O recibo do comprovante de entrega (06-FAT linha 31): vazio fica sem recibo, nunca texto inventado.
        recibo: e.recibo.trim() || null,
        valor_protocolo: n(l['valor_total']),
        quantidade_guias: n(l['quantidade_guias']),
      };
      const protocolo =
        reuso === 'reativar'
          ? (await tx.alterar('protocolo_recebimento', n(existente!['id']), n(existente!['versao']), {
              ...dados,
              tratado_em: null,
            }),
            n(existente!['id']))
          : await tx.incluir('protocolo_recebimento', {
              estabelecimento_id: est,
              lote_tiss_id: e.lote,
              fonte_pagadora_id: l['fonte_pagadora_id'],
              numero_protocolo: np.protocolo,
              ...dados,
            });
      await tx.alterar('lote_tiss', e.lote, n(l['versao']), {
        numero_protocolo: np.protocolo,
        protocolo_recebimento_id: protocolo,
        situacao: 'protocolado',
        protocolado_em: new Date(),
      });
      await protocolarFaturaDoLote(tx, e.lote, np.protocolo, dataEntrega);
    } else {
      if (l['protocolo_recebimento_id']) {
        const p = await tx.uma<Linha>('SELECT versao FROM protocolo_recebimento WHERE id = ?', [
          l['protocolo_recebimento_id'],
        ]);
        if (p)
          await tx.alterar('protocolo_recebimento', n(l['protocolo_recebimento_id']), n(p['versao']), {
            situacao: 'cancelado',
            tratado_em: new Date(),
          });
      }
      await tx.alterar('lote_tiss', e.lote, n(l['versao']), {
        numero_protocolo: null,
        protocolo_recebimento_id: null,
        situacao: 'gerado',
        protocolado_em: null,
      });
      await protocolarFaturaDoLote(tx, e.lote, null, null);
    }
    return {
      lote: e.lote,
      protocolo: e.acao === 'registrar' ? np.protocolo : '',
      anterior,
      limpou: np.limpou ? 1 : 0,
    };
  },
  alvo: (e) => ({ tabela: 'lote_tiss', id: e.lote }),
  // O recibo vai também à trilha (o registro do protocolo guarda o recibo vigente).
  trilha: (e) => ({ dados: { recibo: e.recibo, data: e.data, situacao: e.situacao } }),
});

/** Fecha a competência do convênio com o retrato das contas (quantidade e valor apresentado). */
const fecharCompetencia = definirOperacao<FecharCompetenciaEntrada, ResultadoOperacao>({
  nome: 'faturamento.fechar-competencia',
  tabelas: ['fechamento_competencia_fonte_pagadora', 'ciclo_competencia_fonte_pagadora'],
  entrada: esquemaFecharCompetencia,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const fonte = await tx.uma<Linha>('SELECT id FROM fonte_pagadora WHERE id = ? AND excluido_em IS NULL', [
      e.convenio,
    ]);
    if (!fonte) throw recusa('convenio-inexistente', 'O convênio não existe.');
    const competencia = diaDaCompetencia(e.ano, e.mes);
    const [atual] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao FROM fechamento_competencia_fonte_pagadora
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND excluido_em IS NULL`,
      [est, e.convenio, competencia],
    );
    const hoje = civil(new Date(), await fusoDe(tx, est)).data;
    const r = conferirFechamentoCompetencia({
      jaFechada: atual?.['situacao'] === 'fechada',
      ano: e.ano,
      mes: e.mes,
      hoje,
    });
    if (r) throw recusa(r.codigo, r.mensagem);
    const soma = await tx.uma<Linha>(
      `SELECT COUNT(*) AS contas, COALESCE(SUM(valor_total), 0) AS valor FROM conta_hospitalar
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND excluido_em IS NULL
          AND situacao <> 'cancelada'`,
      [est, e.convenio, competencia],
    );
    const agora = new Date();
    const valores = {
      situacao: 'fechada',
      fechado_em: agora,
      fechado_por_usuario_id: ctx.usuario,
      quantidade_contas: n(soma?.['contas']),
      valor_apresentado: n(soma?.['valor']),
      valor_total: n(soma?.['valor']),
    };
    // Fechar de novo depois de reabrir: a linha guarda só o estado atual (a reabertura anterior sai dela e fica no
    // ciclo, como o retrato de cada fechamento).
    const id = atual
      ? (await tx.alterar('fechamento_competencia_fonte_pagadora', n(atual['id']), n(atual['versao']), {
          ...valores,
          reaberto_em: null,
          reaberto_por_usuario_id: null,
          motivo_reabertura: null,
        }),
        n(atual['id']))
      : await tx.incluir('fechamento_competencia_fonte_pagadora', {
          estabelecimento_id: est,
          fonte_pagadora_id: e.convenio,
          competencia,
          data_abertura: competencia,
          ...valores,
        });
    await tx.incluir('ciclo_competencia_fonte_pagadora', {
      estabelecimento_id: est,
      fechamento_competencia_fonte_pagadora_id: id,
      tipo: 'fechamento',
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      quantidade_contas: valores.quantidade_contas,
      valor_apresentado: valores.valor_apresentado,
    });
    return { convenio: e.convenio, ano: e.ano, mes: e.mes, fechamento: id };
  },
  alvo: (_e, r) => ({ tabela: 'fechamento_competencia_fonte_pagadora', id: n(r['fechamento']) }),
});

/**
 * Reabre a competência fechada do convênio (com motivo): a linha do fechamento passa a `reaberta` com quando, quem e
 * o motivo, e o ciclo ganha a linha da reabertura (o retrato de cada fechamento fica no seu ciclo). Conta da
 * competência já em lote exige a confirmação do impacto (regra do domínio). A alçada é a permissão
 * `faturamento.competencia.reabrir`, conferida pelo executor antes da gravação.
 */
const reabrirCompetencia = definirOperacao<ReabrirCompetenciaEntrada, ResultadoOperacao>({
  nome: 'faturamento.reabrir-competencia',
  tabelas: ['fechamento_competencia_fonte_pagadora', 'ciclo_competencia_fonte_pagadora'],
  entrada: esquemaReabrirCompetencia,
  async gravar(tx, e, ctx) {
    const est = estabelecimentoDe(ctx);
    const [atual] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao FROM fechamento_competencia_fonte_pagadora
        WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND excluido_em IS NULL`,
      [est, e.convenio, diaDaCompetencia(e.ano, e.mes)],
    );
    const apresentadas = await tx.uma<Linha>(
      `SELECT COUNT(*) AS contas, COALESCE(SUM(ch.valor_total), 0) AS valor FROM conta_hospitalar ch
        WHERE ch.estabelecimento_id = ? AND ch.fonte_pagadora_id = ? AND ch.competencia = ?
          AND ch.excluido_em IS NULL AND ch.situacao <> 'cancelada'
          AND EXISTS (SELECT 1 FROM lote_tiss_conta ltc JOIN lote_tiss lt ON lt.id = ltc.lote_tiss_id
                       WHERE ltc.conta_hospitalar_id = ch.id AND ltc.excluido_em IS NULL
                         AND lt.excluido_em IS NULL AND lt.situacao <> 'cancelado')`,
      [est, e.convenio, diaDaCompetencia(e.ano, e.mes)],
    );
    const impacto = {
      contasApresentadas: n(apresentadas?.['contas']),
      valorApresentado: n(apresentadas?.['valor']),
    };
    const r = conferirReaberturaCompetencia({
      fechada: atual?.['situacao'] === 'fechada',
      motivo: e.motivo,
      impacto,
      confirmarImpacto: e.confirmarImpacto,
    });
    if (r) throw recusa(r.codigo, r.mensagem);
    const agora = new Date();
    const motivo = e.motivo.trim().slice(0, 250);
    await tx.alterar('fechamento_competencia_fonte_pagadora', n(atual!['id']), n(atual!['versao']), {
      situacao: 'reaberta',
      reaberto_em: agora,
      reaberto_por_usuario_id: ctx.usuario,
      motivo_reabertura: motivo,
    });
    await tx.incluir('ciclo_competencia_fonte_pagadora', {
      estabelecimento_id: est,
      fechamento_competencia_fonte_pagadora_id: n(atual!['id']),
      tipo: 'reabertura',
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
      contas_em_lote: impacto.contasApresentadas,
      valor_em_lote: impacto.valorApresentado,
      impacto_confirmado: impacto.contasApresentadas > 0,
      motivo,
    });
    return { convenio: e.convenio, ano: e.ano, mes: e.mes, fechamento: n(atual!['id']) };
  },
  alvo: (_e, r) => ({ tabela: 'fechamento_competencia_fonte_pagadora', id: n(r['fechamento']) }),
  trilha: (e) => ({ dados: { motivo: e.motivo, confirmarImpacto: e.confirmarImpacto } }),
});

/** Nome da operação na trilha do núcleo (minúsculas com hífen): 'faturamento.gerarLote' → 'faturamento.gerar-lote'. */
export const nomeNaTrilha = (op: string): string => op.replace(/([A-Z])/g, '-$1').toLowerCase();

/** As operações do executor pelo nome (o montador do lote guarda o XML; sem ele, gerar o lote recusa). */
export function operacoesTiss(
  montador: MontadorLoteTiss | null,
  assinaturaNoDia: AssinaturaDoExecutante | null = null,
): Readonly<Record<string, Operacao<never, ResultadoOperacao>>> {
  return {
    'faturamento.gerarLote': gerarLote(montador, assinaturaNoDia) as unknown as Operacao<
      never,
      ResultadoOperacao
    >,
    'faturamento.registrarProtocolo': registrarProtocolo as unknown as Operacao<never, ResultadoOperacao>,
    'faturamento.fecharCompetencia': fecharCompetencia as unknown as Operacao<never, ResultadoOperacao>,
    'faturamento.reabrirCompetencia': reabrirCompetencia as unknown as Operacao<never, ResultadoOperacao>,
    ...(operacoesGlosaCom(montador) as unknown as Record<string, Operacao<never, ResultadoOperacao>>),
  };
}
