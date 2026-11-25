// Configuração do padrão TISS por fonte pagadora e numeração de guias no banco próprio (F3.1, 02-CAD linha 25):
// - configuração com vigência por estabelecimento e fonte pagadora (`configuracao_tiss_fonte_pagadora`): versão do
//   padrão, identificação do prestador, contratado, limites, ordenação e agrupamentos do lote, guia impressa e
//   serviços eletrônicos. Nova vigência que cruza a atual encerra a atual na véspera (o histórico fica); alterar
//   uma vigência é com versão (409);
// - faixas de números de guia (`faixa_numeracao_guia`) por fonte pagadora e tipo de guia: sem sobreposição, cabendo
//   no campo de 20 posições; encerrar a faixa grava a situação e o fim (nunca apaga);
// - consumo da faixa na emissão: `reservarNumeroGuia(tx, ...)` trava a faixa vigente, devolve o número formatado,
//   avança o próximo e marca "esgotada" no último; exportado para a emissão da guia chamar na mesma transação,
//   antes de incluir a guia_tiss (o número nasce com a guia: nada de número provisório). Quem chama é a geração do
//   lote (`api/tiss/numeracao-guia.ts`), que grava a guia emitida e o uso do número na faixa.
// A regra é a do domínio (@sgh/dominio-faturamento); aqui só leitura, conferência no banco e gravação pelo executor.
import { randomUUID } from 'node:crypto';
import {
  consumirFaixa,
  errosConfiguracaoTiss,
  errosFaixa,
  faixaNoFim,
  faixaParaEmitir,
  tipoFaixaDaGuia,
  vigenciasQueCruzam,
} from '@sgh/dominio-faturamento';
import { cnpjConfere } from '@sgh/dominio-organizacao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const TISS_CONFIGURACAO = Symbol('TISS_CONFIGURACAO');

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const data = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v).slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const idPos = z.number().int().positive();
const vespera = (d: string): string => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

const MENSAGENS: Record<string, [string, string]> = {
  'vigencia-invertida': ['O fim da vigência é anterior ao início.', 'vigenciaFim'],
  'registro-ans-invalido': ['O registro da operadora na agência tem 6 dígitos.', 'registroAns'],
  'codigo-prestador-obrigatorio': [
    'Identificação pelo código da operadora exige o código do prestador.',
    'codigoPrestadorOperadora',
  ],
  'codigo-prestador-invalido': [
    'O código do prestador tem até 20 letras, dígitos, ponto, barra ou hífen.',
    'codigoPrestadorOperadora',
  ],
  'cnpj-contratado-invalido': ['O CNPJ do contratado não confere.', 'cnpjContratado'],
  'contratado-incompleto': ['Informe o CNPJ e a razão social do contratado juntos.', 'razaoSocialContratado'],
  'limite-lote-invalido': ['O lote tem de 1 a 100 guias.', 'limiteGuiasLote'],
  'dias-retorno-invalido': ['O prazo de retorno é de 0 a 365 dias.', 'diasRetornoConsulta'],
  'reapresentacao-sem-faturamento-eletronico': [
    'Reapresentação eletrônica exige o faturamento eletrônico.',
    'reapresentacaoEletronica',
  ],
  'retorno-sem-faturamento-eletronico': [
    'Retorno eletrônico exige o faturamento eletrônico.',
    'retornoEletronico',
  ],
  'elegibilidade-eletronica-sem-exigencia': [
    'A consulta eletrônica de elegibilidade só vale quando a elegibilidade é exigida.',
    'elegibilidadeEletronica',
  ],
  'somente-arquivo-sem-faturamento-eletronico': [
    'Enviar só o arquivo exige o faturamento eletrônico.',
    'somenteArquivo',
  ],
  'verso-sem-guia-impressa': ['Sem guia impressa não há verso a imprimir.', 'imprimeVersoGuia'],
  'tipo-guia-invalido': ['Tipo de guia inválido.', 'tipoGuia'],
  'numero-inicial-invalido': ['O número inicial é um inteiro positivo.', 'numeroInicial'],
  'faixa-invertida': ['O número final é menor que o inicial.', 'numeroFinal'],
  'prefixo-invalido': ['O prefixo tem até 10 letras ou dígitos.', 'prefixo'],
  'tamanho-insuficiente': ['O tamanho fixo não comporta o número final.', 'tamanhoFixo'],
  'numero-longo': ['Prefixo e número passam das 20 posições da guia.', 'tamanhoFixo'],
  'faixa-sobreposta': ['A faixa cruza outra faixa deste tipo de guia.', 'numeroInicial'],
};
function recusarErros(erros: readonly string[]): void {
  if (!erros.length) return;
  throw recusa(erros[0]!, erros.map((e) => MENSAGENS[e]?.[0] ?? e).join(' '), {
    campos: [...new Set(erros.map((e) => MENSAGENS[e]?.[1] ?? e))],
  });
}
const naoAchado = (o: string) =>
  new ErroOperacao(404, `${o.toLowerCase()}-inexistente`, 'Não encontrado', `${o} não encontrado.`);
const recusaCampo = (codigo: string, msg: string, campo: string) => recusa(codigo, msg, { campos: [campo] });

// ── Configuração por fonte pagadora ──

const esquemaConfiguracao = z
  .object({
    id: idPos.nullable(),
    versao: idPos.nullable(),
    fontePagadora: idPos,
    versaoPadrao: idPos,
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable(),
    registroAns: z.string().nullable(),
    codigoPrestadorOperadora: z.string().trim().max(20).nullable(),
    identificacaoPrestador: z.enum(['cnpj', 'cpf', 'codigo_operadora']),
    cnpjContratado: z.string().nullable(),
    razaoSocialContratado: z.string().trim().max(150).nullable(),
    numeracaoGuia: z.enum(['prestador', 'operadora', 'sequencial_unico']),
    limiteGuiasLote: z.number().int().nullable(),
    ordenacaoGuias: z.enum(['numero', 'data', 'paciente', 'atendimento']),
    agrupaProcedimentoMaiorData: z.boolean(),
    agrupaItensIguais: z.boolean(),
    separaProfissionalPorGuia: z.boolean(),
    quebraResumoInternacao: z.enum(['nao_quebra', 'por_competencia', 'por_periodo', 'por_conta_parcial']),
    omiteGuiaSemValor: z.boolean(),
    somenteArquivo: z.boolean(),
    imprimeVersoGuia: z.boolean(),
    exigeCidAlta: z.boolean(),
    informaCid: z.boolean(),
    exigeElegibilidade: z.boolean(),
    elegibilidadeEletronica: z.boolean(),
    autorizacaoEletronica: z.boolean(),
    faturamentoEletronico: z.boolean(),
    retornoEletronico: z.boolean(),
    reapresentacaoEletronica: z.boolean(),
    consideraPagoItemSemRetorno: z.boolean(),
    diasRetornoConsulta: z.number().int().nullable(),
  })
  .strict();
export type EntradaConfiguracaoTiss = z.infer<typeof esquemaConfiguracao>;

const colunasConfiguracao = (e: EntradaConfiguracaoTiss) => ({
  versao_padrao_tiss_id: e.versaoPadrao,
  vigencia_fim: e.vigenciaFim,
  registro_ans: e.registroAns,
  codigo_prestador_operadora: e.codigoPrestadorOperadora,
  identificacao_prestador: e.identificacaoPrestador,
  cnpj_contratado: e.cnpjContratado,
  razao_social_contratado: e.razaoSocialContratado,
  numeracao_guia: e.numeracaoGuia,
  limite_guias_lote: e.limiteGuiasLote,
  ordenacao_guias: e.ordenacaoGuias,
  agrupa_procedimento_maior_data: e.agrupaProcedimentoMaiorData,
  agrupa_itens_iguais: e.agrupaItensIguais,
  separa_profissional_por_guia: e.separaProfissionalPorGuia,
  quebra_resumo_internacao: e.quebraResumoInternacao,
  omite_guia_sem_valor: e.omiteGuiaSemValor,
  somente_arquivo: e.somenteArquivo,
  imprime_verso_guia: e.imprimeVersoGuia,
  exige_cid_alta: e.exigeCidAlta,
  informa_cid: e.informaCid,
  exige_elegibilidade: e.exigeElegibilidade,
  elegibilidade_eletronica: e.elegibilidadeEletronica,
  autorizacao_eletronica: e.autorizacaoEletronica,
  faturamento_eletronico: e.faturamentoEletronico,
  retorno_eletronico: e.retornoEletronico,
  reapresentacao_eletronica: e.reapresentacaoEletronica,
  considera_pago_item_sem_retorno: e.consideraPagoItemSemRetorno,
  dias_retorno_consulta: e.diasRetornoConsulta,
});

const opGravarConfiguracao = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.tiss.gravar-configuracao',
    tabelas: ['configuracao_tiss_fonte_pagadora'],
    entrada: esquemaConfiguracao,
    async gravar(tx, e, ctx) {
      const est = ctx.estabelecimento;
      recusarErros(errosConfiguracaoTiss(e, cnpjConfere));
      if (!(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora])))
        throw naoAchado('Fonte pagadora');
      const v = await tx.uma('SELECT id FROM versao_padrao_tiss WHERE id = ? AND ativo', [e.versaoPadrao]);
      if (!v)
        throw recusaCampo(
          'versao-padrao-inexistente',
          'Versão do padrão não encontrada ou inativa.',
          'versaoPadrao',
        );
      const atuais = await tx.consultarParaAtualizar(
        `SELECT id, vigencia_inicio, vigencia_fim, versao FROM configuracao_tiss_fonte_pagadora
          WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND ativo`,
        [est, e.fontePagadora],
      );
      const lidas = atuais.map((a) => ({
        id: Number(a['id']),
        inicio: data(a['vigencia_inicio'])!,
        fim: data(a['vigencia_fim']),
        versao: Number(a['versao']),
      }));
      if (e.id !== null) {
        const minha = lidas.find((x) => x.id === e.id);
        if (!minha) throw naoAchado('Configuração');
        if (minha.inicio !== e.vigenciaInicio)
          throw recusaCampo(
            'inicio-imutavel',
            'O início da vigência não muda: crie uma nova vigência a partir da data.',
            'vigenciaInicio',
          );
        if (vigenciasQueCruzam(lidas, { id: e.id, inicio: e.vigenciaInicio, fim: e.vigenciaFim }).length)
          throw recusaCampo('vigencia-sobreposta', 'O novo fim cruza outra vigência.', 'vigenciaFim');
        await tx.alterar('configuracao_tiss_fonte_pagadora', e.id, e.versao ?? 0, colunasConfiguracao(e));
        return { id: e.id };
      }
      // Nova vigência: a aberta que começou antes é encerrada na véspera; outra que cruze é recusada.
      for (const c of vigenciasQueCruzam(lidas, { inicio: e.vigenciaInicio, fim: e.vigenciaFim })) {
        const x = lidas.find((l) => l.id === c.id)!;
        if (x.inicio < e.vigenciaInicio && x.fim === null)
          await tx.alterar('configuracao_tiss_fonte_pagadora', x.id, x.versao, {
            vigencia_fim: vespera(e.vigenciaInicio),
          });
        else
          throw recusaCampo(
            'vigencia-sobreposta',
            'Já existe configuração desta fonte pagadora neste período.',
            'vigenciaInicio',
          );
      }
      const id = await tx.incluir('configuracao_tiss_fonte_pagadora', {
        estabelecimento_id: est,
        fonte_pagadora_id: e.fontePagadora,
        vigencia_inicio: e.vigenciaInicio,
        ativo: true,
        ...colunasConfiguracao(e),
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'configuracao_tiss_fonte_pagadora', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ── Faixa de numeração ──

const esquemaFaixa = z
  .object({
    fontePagadora: idPos,
    tipoGuia: z.string().max(30),
    formaGeracao: z.enum(['faixa_operadora', 'sequencial_hospital']),
    prefixo: z.string().trim().nullable(),
    tamanhoFixo: z.number().int().nullable(),
    numeroInicial: z.number().int(),
    numeroFinal: z.number().int(),
    vigenciaInicio: dia,
    vigenciaFim: dia.nullable(),
  })
  .strict();
export type EntradaFaixa = z.infer<typeof esquemaFaixa>;

const opIncluirFaixa = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.tiss.incluir-faixa',
    tabelas: ['faixa_numeracao_guia'],
    entrada: esquemaFaixa,
    acao: 'inclusao',
    async gravar(tx, e, ctx) {
      if (!(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora])))
        throw naoAchado('Fonte pagadora');
      const existentes = await tx.consultarParaAtualizar(
        `SELECT id, numero_inicial, numero_final, proximo_numero, situacao FROM faixa_numeracao_guia
          WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND tipo_guia = ?`,
        [ctx.estabelecimento, e.fontePagadora, e.tipoGuia],
      );
      recusarErros(
        errosFaixa(
          e,
          existentes.map((x) => ({
            id: Number(x['id']),
            numeroInicial: Number(x['numero_inicial']),
            numeroFinal: Number(x['numero_final']),
            proximoNumero: Number(x['proximo_numero']),
            situacao: String(x['situacao']),
          })),
        ),
      );
      const id = await tx.incluir('faixa_numeracao_guia', {
        estabelecimento_id: ctx.estabelecimento,
        fonte_pagadora_id: e.fontePagadora,
        tipo_guia: e.tipoGuia,
        forma_geracao: e.formaGeracao,
        prefixo: e.prefixo,
        tamanho_fixo: e.tamanhoFixo,
        numero_inicial: e.numeroInicial,
        numero_final: e.numeroFinal,
        proximo_numero: e.numeroInicial,
        vigencia_inicio: e.vigenciaInicio,
        vigencia_fim: e.vigenciaFim,
        situacao: 'ativa',
      });
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'faixa_numeracao_guia', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaEncerrarFaixa = z
  .object({ id: idPos, versao: idPos, motivo: z.string().trim().min(10).max(200) })
  .strict();

const opEncerrarFaixa = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.tiss.encerrar-faixa',
    tabelas: ['faixa_numeracao_guia'],
    entrada: esquemaEncerrarFaixa,
    acao: 'alteracao',
    async gravar(tx, e, ctx) {
      const x = await tx.uma(
        'SELECT id, situacao, vigencia_inicio FROM faixa_numeracao_guia WHERE id = ? AND estabelecimento_id = ?',
        [e.id, ctx.estabelecimento],
      );
      if (!x) throw naoAchado('Faixa');
      if (String(x['situacao']) === 'encerrada')
        throw recusaCampo('faixa-encerrada', 'A faixa já está encerrada.', 'situacao');
      const hoje = data((await tx.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d', []))?.d)!;
      const inicio = data(x['vigencia_inicio'])!;
      await tx.alterar('faixa_numeracao_guia', e.id, e.versao, {
        situacao: 'encerrada',
        vigencia_fim: hoje < inicio ? inicio : hoje,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'faixa_numeracao_guia', id: e.id }),
    trilha: (e) => ({ dados: t.dadosDepois ?? null, motivo: e.motivo }),
  });

export interface NumeroReservado {
  readonly numero: string;
  /** O número consumido, sem prefixo nem zeros (a sequência dentro da faixa). */
  readonly sequencia: number;
  readonly faixa: number;
  readonly esgotada: boolean;
  readonly restantes: number;
  readonly noFim: boolean;
}

/**
 * Consome o próximo número da faixa vigente do tipo de guia (trava a faixa; a operação que chama declara
 * `faixa_numeracao_guia` nas tabelas). Sem faixa disponível: recusa com o aviso de pedir nova faixa à operadora.
 */
export async function reservarNumeroGuia(
  tx: TxOperacao,
  estabelecimento: number,
  fontePagadora: number,
  tipoGuia: string,
  dia?: string,
): Promise<NumeroReservado> {
  const hoje = dia ?? data((await tx.uma<{ d: unknown }>('SELECT CURRENT_DATE AS d', []))?.d)!;
  const linhas = await tx.consultarParaAtualizar(
    `SELECT id, prefixo, tamanho_fixo, numero_inicial, numero_final, proximo_numero, vigencia_inicio, vigencia_fim,
            situacao, versao
       FROM faixa_numeracao_guia
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND tipo_guia = ? AND situacao = 'ativa'`,
    [estabelecimento, fontePagadora, tipoFaixaDaGuia(tipoGuia)],
  );
  const faixas = linhas.map((r) => ({
    id: Number(r['id']),
    prefixo: texto(r['prefixo']),
    tamanhoFixo: num(r['tamanho_fixo']),
    numeroInicial: Number(r['numero_inicial']),
    numeroFinal: Number(r['numero_final']),
    proximoNumero: Number(r['proximo_numero']),
    vigenciaInicio: data(r['vigencia_inicio'])!,
    vigenciaFim: data(r['vigencia_fim']),
    situacao: String(r['situacao']),
    versao: Number(r['versao']),
  }));
  const f = faixaParaEmitir(faixas, hoje);
  if (!f)
    throw recusa(
      'sem-faixa-de-guia',
      'Não há faixa de números vigente para este tipo de guia: cadastre a nova faixa recebida da operadora.',
      { campos: ['tipoGuia'] },
    );
  const versao = faixas.find((x) => x.id === f.id)!.versao;
  const inicial = faixas.find((x) => x.id === f.id)!.numeroInicial;
  const c = consumirFaixa(f);
  await tx.alterar('faixa_numeracao_guia', f.id, versao, {
    proximo_numero: c.proximo,
    ...(c.esgotada ? { situacao: 'esgotada' } : {}),
  });
  return {
    numero: c.numero,
    sequencia: f.proximoNumero,
    faixa: f.id,
    esgotada: c.esgotada,
    restantes: c.restantes,
    noFim: faixaNoFim({ numeroInicial: inicial, numeroFinal: f.numeroFinal, proximoNumero: c.proximo }),
  };
}

export class TissConfiguracaoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private lerSo<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || 'cadastro' }, fn);
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.lerSo(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
  ): Promise<Record<string, unknown>> {
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: await this.estabelecimento(c),
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'cadastro',
      chaveIdempotencia: `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return x.resultado as Record<string, unknown>;
  }

  /** A visão por fonte pagadora: as vigências da configuração e as faixas com o consumo, mais as opções. */
  async painel(c: ContextoPorta, fontePagadora: number | null) {
    const est = await this.estabelecimento(c);
    return this.lerSo(c, async (l) => {
      const fontes = (
        await l.consultar(
          'SELECT id, codigo, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome',
          [],
        )
      ).map((r) => ({ id: Number(r['id']), nome: `${String(r['codigo'])} — ${String(r['nome'])}` }));
      const versoes = (
        await l.consultar(
          `SELECT id, codigo_tiss, descricao FROM versao_padrao_tiss WHERE ativo ORDER BY vigencia_inicio DESC`,
          [],
        )
      ).map((r) => ({
        id: Number(r['id']),
        nome: `${String(r['codigo_tiss'])} — ${String(r['descricao'])}`,
      }));
      if (fontePagadora === null) return { fontes, versoes, configuracoes: [], faixas: [] };
      const cfg = await l.consultar(
        `SELECT * FROM configuracao_tiss_fonte_pagadora WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND ativo
          ORDER BY vigencia_inicio DESC`,
        [est, fontePagadora],
      );
      const faixas = await l.consultar(
        `SELECT * FROM faixa_numeracao_guia WHERE estabelecimento_id = ? AND fonte_pagadora_id = ?
          ORDER BY tipo_guia, vigencia_inicio DESC, numero_inicial`,
        [est, fontePagadora],
      );
      return {
        fontes,
        versoes,
        configuracoes: cfg.map((r) => ({
          id: Number(r['id']),
          versao: Number(r['versao']),
          fontePagadora,
          versaoPadrao: Number(r['versao_padrao_tiss_id']),
          vigenciaInicio: data(r['vigencia_inicio']),
          vigenciaFim: data(r['vigencia_fim']),
          registroAns: texto(r['registro_ans']),
          codigoPrestadorOperadora: texto(r['codigo_prestador_operadora']),
          identificacaoPrestador: String(r['identificacao_prestador']),
          cnpjContratado: texto(r['cnpj_contratado']),
          razaoSocialContratado: texto(r['razao_social_contratado']),
          numeracaoGuia: String(r['numeracao_guia']),
          limiteGuiasLote: num(r['limite_guias_lote']),
          ordenacaoGuias: String(r['ordenacao_guias']),
          agrupaProcedimentoMaiorData: bool(r['agrupa_procedimento_maior_data']),
          agrupaItensIguais: bool(r['agrupa_itens_iguais']),
          separaProfissionalPorGuia: bool(r['separa_profissional_por_guia']),
          quebraResumoInternacao: String(r['quebra_resumo_internacao']),
          omiteGuiaSemValor: bool(r['omite_guia_sem_valor']),
          somenteArquivo: bool(r['somente_arquivo']),
          imprimeVersoGuia: bool(r['imprime_verso_guia']),
          exigeCidAlta: bool(r['exige_cid_alta']),
          informaCid: bool(r['informa_cid']),
          exigeElegibilidade: bool(r['exige_elegibilidade']),
          elegibilidadeEletronica: bool(r['elegibilidade_eletronica']),
          autorizacaoEletronica: bool(r['autorizacao_eletronica']),
          faturamentoEletronico: bool(r['faturamento_eletronico']),
          retornoEletronico: bool(r['retorno_eletronico']),
          reapresentacaoEletronica: bool(r['reapresentacao_eletronica']),
          consideraPagoItemSemRetorno: bool(r['considera_pago_item_sem_retorno']),
          diasRetornoConsulta: num(r['dias_retorno_consulta']),
        })),
        faixas: faixas.map((r) => {
          const ini = Number(r['numero_inicial']);
          const fim = Number(r['numero_final']);
          const prox = Number(r['proximo_numero']);
          return {
            id: Number(r['id']),
            versao: Number(r['versao']),
            tipoGuia: String(r['tipo_guia']),
            formaGeracao: String(r['forma_geracao']),
            prefixo: texto(r['prefixo']),
            tamanhoFixo: num(r['tamanho_fixo']),
            numeroInicial: ini,
            numeroFinal: fim,
            proximoNumero: prox,
            usados: prox - ini,
            restantes: Math.max(0, fim - prox + 1),
            noFim:
              String(r['situacao']) === 'ativa' &&
              faixaNoFim({ numeroInicial: ini, numeroFinal: fim, proximoNumero: prox }),
            vigenciaInicio: data(r['vigencia_inicio']),
            vigenciaFim: data(r['vigencia_fim']),
            situacao: String(r['situacao']),
          };
        }),
      };
    });
  }

  async gravarConfiguracao(c: ContextoPorta, e: EntradaConfiguracaoTiss, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opGravarConfiguracao(t), e, t))['id']);
  }
  async incluirFaixa(c: ContextoPorta, e: EntradaFaixa, t: RegistroTrilhaTela) {
    return Number((await this.executar(c, opIncluirFaixa(t), e, t))['id']);
  }
  async encerrarFaixa(
    c: ContextoPorta,
    e: { id: number; versao: number; motivo: string },
    t: RegistroTrilhaTela,
  ) {
    return Number((await this.executar(c, opEncerrarFaixa(t), e, t))['id']);
  }
}
