// Aplicação do pós-fechamento (M31): as gravações das telas (pelo executor, com a trilha na mesma transação, ou
// gravações diretas no banco do estabelecimento com a trilha_auditoria junto, sobre a entidade do modelo), o escopo por convênio conferido no servidor em toda leitura e gravação (como no
// M30), o envio do lote (fora de produção, ao simulador de operadora; em produção, só com as credenciais da operadora no
// cofre), a importação do demonstrativo (XML guardado no disco local, somente leitura), a decisão da glosa (o prazo por operadora)
// e o painel de glosas em cache de horas.
import {
  type DecidirGlosaEntrada,
  type EditarEndpointTissEntrada,
  EVENTOS_AUDITAVEIS,
  type FecharCompetenciaEntrada,
  type ReabrirCompetenciaEntrada,
  type GerarLoteEntrada,
  type ImportarDemonstrativoEntrada,
  type PainelGlosa,
  type RegistrarGlosaEntrada,
  type RegistrarProtocoloEntrada,
  type RegistrarRecursoEntrada,
  type RegistrarRetornoRecursoEntrada,
  type ResultadoTiss,
} from '@sgh/contratos';
import {
  conferirEscopoConvenio,
  destinoEnvio,
  ErroDemonstrativo,
  filtroConvenios,
  lerDemonstrativoXml,
  prazoRecurso,
  sha256Hex,
} from '@sgh/dominio-faturamento';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { escopoConvenios } from '../faturamento/servico.js';
import type { ApoiosTiss, FuncionalidadeTiss } from './apoios.js';
import { type ArmazemXmlTiss, ErroSobrescritaXml } from './armazem-xml.js';
import type { ContextoTiss, GravadorSghTiss, PortaTiss } from './porta.js';
import { simularOperadora } from './simulador.js';

const ctx = (s: SessaoCadastro): ContextoTiss => s.porta;
const E = EVENTOS_AUDITAVEIS;

const MENSAGENS: Readonly<Record<string, string>> = {
  'faturamento.gerarLote': 'Lote montado e validado na TISS 04.03.00.',
  'faturamento.registrarProtocolo': 'Protocolo registrado: o lote está congelado.',
  'faturamento.registrarGlosa': 'Retorno baixado.',
  'faturamento.registrarRecurso': 'Recurso registrado.',
  'faturamento.registrarRetornoRecurso': 'Desfecho do recurso registrado.',
  'faturamento.fecharCompetencia': 'Competência fechada.',
  'faturamento.reabrirCompetencia': 'Competência reaberta.',
};

export const resultadoTiss = (
  mensagem: string,
  repetida: boolean,
  ids: Record<string, unknown>,
  avisos: string[] = [],
): ResultadoTiss => ({
  mensagem,
  repetida,
  ids: Object.fromEntries(
    Object.entries(ids).filter(
      (e): e is [string, number | string] => typeof e[1] === 'number' || typeof e[1] === 'string',
    ),
  ),
  avisos,
});

const foraDoEscopo = (mensagem: string, codigo: string) =>
  new ErroProblema('sem-permissao', 403, 'Fora do escopo', mensagem, { codigo });

export class ServicoTiss {
  constructor(
    private readonly porta: PortaTiss,
    readonly apoios: ApoiosTiss,
    private readonly ambiente: string,
    private readonly armazem: ArmazemXmlTiss,
  ) {}

  /** Os convênios a filtrar nas listas (null: sem restrição). */
  convenios(s: SessaoCadastro, pedido: number | null = null): readonly number[] | null {
    return filtroConvenios(escopoConvenios(s), pedido);
  }

  exigirEscopoConvenio(s: SessaoCadastro, convenio: number): void {
    const r = conferirEscopoConvenio(escopoConvenios(s), convenio);
    if (r) throw foraDoEscopo(r.mensagem, r.codigo);
  }

  async exigirEscopoLote(s: SessaoCadastro, lote: number): Promise<number> {
    const conv = await this.porta.convenioDoLote(ctx(s), lote);
    if (conv === null) throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    this.exigirEscopoConvenio(s, conv);
    return conv;
  }

  async exigirEscopoConta(s: SessaoCadastro, conta: number): Promise<number> {
    const conv = await this.porta.convenioDaConta(ctx(s), conta);
    if (conv === null) throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    this.exigirEscopoConvenio(s, conv);
    return conv;
  }

  async exigirEscopoItem(s: SessaoCadastro, item: number): Promise<{ conta: number; convenio: number }> {
    const x = await this.porta.contaDoItem(ctx(s), item);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    this.exigirEscopoConvenio(s, x.convenio);
    return x;
  }

  async parametroTexto(s: SessaoCadastro, chave: string): Promise<string> {
    const v = await this.apoios.apoios.conciliacao.parametroValor(s, chave);
    return typeof v === 'string' ? v : '';
  }

  async parametro(s: SessaoCadastro, chave: string, padrao: number): Promise<number> {
    return (await this.apoios.apoios.conciliacao.parametro(s, chave)) || padrao;
  }

  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    mensagem = MENSAGENS[op] ?? 'Gravado.',
  ): Promise<ResultadoTiss> {
    const r = await this.apoios.daOperacao(op).executar(s, op, entrada, mensagem);
    const alertas =
      typeof r.resultado['alertas'] === 'string' && r.resultado['alertas'] ? [r.resultado['alertas']] : [];
    return resultadoTiss(r.mensagem, r.repetida, r.resultado, alertas);
  }

  async gerarLote(s: SessaoCadastro, e: GerarLoteEntrada): Promise<ResultadoTiss> {
    this.exigirEscopoConvenio(s, e.convenio);
    const r = await this.executar(s, 'faturamento.gerarLote', e);
    return {
      ...r,
      mensagem: `Lote ${String(r.ids['numeroLote'] ?? '')} montado com ${String(r.ids['contas'] ?? '')} conta(s), validado na TISS 04.03.00 e guardado.`,
    };
  }

  async registrarProtocolo(s: SessaoCadastro, e: RegistrarProtocoloEntrada): Promise<ResultadoTiss> {
    await this.exigirEscopoLote(s, e.lote);
    const r = await this.executar(
      s,
      'faturamento.registrarProtocolo',
      e,
      e.acao === 'limpar' ? 'Protocolo limpo: o lote voltou a poder ser recomposto.' : undefined,
    );
    return r.ids['limpou'] === 1 || r.ids['limpou'] === 'true'
      ? { ...r, avisos: [...r.avisos, 'Foram removidas quebras de linha ou tabulações do número informado.'] }
      : r;
  }

  private async escopoDosItens(s: SessaoCadastro, itens: readonly { item: number }[]): Promise<void> {
    const vistos = new Set<number>();
    for (const i of itens) {
      if (vistos.has(i.item)) continue;
      vistos.add(i.item);
      await this.exigirEscopoItem(s, i.item);
    }
  }

  async registrarGlosa(s: SessaoCadastro, e: RegistrarGlosaEntrada): Promise<ResultadoTiss> {
    await this.escopoDosItens(s, e.itens);
    return this.executar(
      s,
      'faturamento.registrarGlosa',
      { ...e, prazoParametro: await this.parametroTexto(s, 'faturamento.recursoPrazoPorOperadora') },
      e.itens.length > 1 ? `${e.itens.length} itens baixados.` : 'Retorno do item baixado.',
    );
  }

  async registrarRecurso(s: SessaoCadastro, e: RegistrarRecursoEntrada): Promise<ResultadoTiss> {
    await this.escopoDosItens(s, e.itens);
    return this.executar(s, 'faturamento.registrarRecurso', {
      ...e,
      prazoParametro: await this.parametroTexto(s, 'faturamento.recursoPrazoPorOperadora'),
    });
  }

  async registrarRetorno(s: SessaoCadastro, e: RegistrarRetornoRecursoEntrada): Promise<ResultadoTiss> {
    await this.escopoDosItens(s, e.itens);
    return this.executar(s, 'faturamento.registrarRetornoRecurso', e);
  }

  async fecharCompetencia(s: SessaoCadastro, e: FecharCompetenciaEntrada): Promise<ResultadoTiss> {
    this.exigirEscopoConvenio(s, e.convenio);
    return this.executar(
      s,
      'faturamento.fecharCompetencia',
      e,
      `Competência ${String(e.mes).padStart(2, '0')}/${e.ano} fechada.`,
    );
  }

  /** Reabre a competência fechada (supervisor, com motivo): a conta da competência volta a receber lançamento e lote. */
  async reabrirCompetencia(s: SessaoCadastro, e: ReabrirCompetenciaEntrada): Promise<ResultadoTiss> {
    this.exigirEscopoConvenio(s, e.convenio);
    return this.executar(
      s,
      'faturamento.reabrirCompetencia',
      e,
      `Competência ${String(e.mes).padStart(2, '0')}/${e.ano} reaberta.`,
    );
  }

  /** Gravação direta pela funcionalidade, com a trilha sobre a entidade do modelo. */
  sgh<T>(
    s: SessaoCadastro,
    f: FuncionalidadeTiss,
    evento: string,
    alvo: (r: NoInfer<T>) => { tabela: string; id: string; chave?: string },
    fn: (g: GravadorSghTiss) => Promise<T>,
  ): Promise<T> {
    return this.apoios.apoios[f].sgh(s, evento, this.apoios.apoios[f].cfg.chave, alvo, fn);
  }

  /**
   * Envio do lote (regra 13): fora de produção, ao simulador de operadora (o XML guardado é conferido como a operadora
   * conferiria e volta um protocolo sintético para o registro assistido); em produção, o envio real só depois das
   * credenciais e do certificado da operadora no cofre (ficha, seção 2: só em produção) e da liberação.
   */
  async enviarLote(
    s: SessaoCadastro,
    lote: number,
  ): Promise<
    ResultadoTiss & { resposta: { protocolo: string | null; recibo: string | null; situacao: number | null } }
  > {
    const convenio = await this.exigirEscopoLote(s, lote);
    await this.apoios.apoios.lote.exigirLiberacao(s);
    const xml = await this.porta.xmlDoLote(ctx(s), lote);
    if (!xml)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Lote sem XML do novo',
        'Este lote foi montado no outro sistema: o envio pelo novo é só do lote montado aqui (TISS 04.03.00).',
        { codigo: 'lote-sem-xml' },
      );
    if (destinoEnvio(this.ambiente) === 'operadora')
      throw new ErroProblema(
        'indisponivel',
        503,
        'Envio à operadora indisponível',
        'O envio real à operadora depende das credenciais e do certificado dela no cofre e da liberação do dono: até lá, envie o arquivo pelo portal da operadora e registre o protocolo.',
        { codigo: 'envio-indisponivel' },
      );
    const bytes = await this.armazem.ler(xml.chave);
    if (!bytes)
      throw new ErroProblema(
        'indisponivel',
        503,
        'XML indisponível',
        'O XML guardado do lote não foi encontrado.',
      );
    const hashRequisicao = await sha256Hex(bytes);
    const resp = await simularOperadora(lote, bytes);
    const hashResposta = await sha256Hex(new TextEncoder().encode(JSON.stringify(resp)));
    await this.sgh(
      s,
      'lote',
      E.faturamentoLoteEnviado.codigo,
      () => ({ tabela: 'lote_tiss', id: String(lote) }),
      async (g: GravadorSghTiss) => {
        await g.registrarMensagem({
          usuario: s.login,
          lote,
          conta: null,
          convenio,
          transacao: 'ENVIO_LOTE_GUIAS',
          direcao: 'envio',
          destino: 'simulador',
          hashRequisicao,
          hashResposta: null,
          tentativa: 1,
          situacao: 'enviada',
          protocolo: null,
        });
        return g.registrarMensagem({
          usuario: s.login,
          lote,
          conta: null,
          convenio,
          transacao: 'PROTOCOLO_RECEBIMENTO',
          direcao: 'resposta',
          destino: 'simulador',
          hashRequisicao,
          hashResposta,
          tentativa: 1,
          situacao: resp.aceito ? 'aceita' : 'recusada',
          protocolo: resp.protocolo,
        });
      },
    );
    return {
      ...resultadoTiss(
        resp.aceito
          ? `Lote enviado ao simulador de operadora (fora de produção): protocolo ${resp.protocolo}. Registre o protocolo para congelar o lote.`
          : 'O simulador de operadora recusou o lote.',
        false,
        { lote },
        resp.erros.slice(0, 3) as string[],
      ),
      resposta: { protocolo: resp.protocolo, recibo: resp.recibo, situacao: resp.situacao },
    };
  }

  /** Demonstrativo: o XML (guardado no disco local, somente leitura, idempotente pelo SHA-256) ou a digitação assistida. */
  async importarDemonstrativo(s: SessaoCadastro, e: ImportarDemonstrativoEntrada): Promise<ResultadoTiss> {
    await this.exigirEscopoLote(s, e.lote);
    await this.apoios.apoios.conciliacao.exigirLiberacao(s);
    let itens = e.itens;
    let numero = e.numero;
    let dataEmissao = e.dataEmissao;
    let hashArquivo: string | null = null;
    let chaveObjeto: string | null = null;
    if (e.xml) {
      try {
        const d = lerDemonstrativoXml(e.xml);
        itens = [...d.itens];
        numero = d.numero;
        dataEmissao = d.dataEmissao;
      } catch (x) {
        if (x instanceof ErroDemonstrativo)
          throw new ErroProblema('entrada-invalida', 400, 'Demonstrativo inválido', x.message, {
            campos: ['xml'],
          });
        throw x;
      }
      const bytes = new TextEncoder().encode(e.xml);
      hashArquivo = await sha256Hex(bytes);
      chaveObjeto = `${s.hospital}/tiss/demonstrativos/${e.lote}-${hashArquivo.slice(0, 16)}.xml`;
      try {
        await this.armazem.guardar(chaveObjeto, bytes);
      } catch (x) {
        // O mesmo arquivo já guardado (reimportação): a chave é a mesma e a importação é idempotente.
        if (!(x instanceof ErroSobrescritaXml) && !/imutável/.test(String(x))) throw x;
      }
    }
    if (itens.length === 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Demonstrativo sem itens',
        'Informe o XML ou os itens.',
        {
          campos: ['itens'],
        },
      );
    const r = await this.sgh(
      s,
      'conciliacao',
      E.faturamentoDemonstrativoImportado.codigo,
      (x) => ({ tabela: 'demonstrativo_analise_conta', id: String(x.id) }),
      (g: GravadorSghTiss) =>
        g.importarDemonstrativo({
          usuario: s.login,
          lote: e.lote,
          tipo: e.tipo,
          origem: e.xml ? 'xml' : 'digitacao',
          numero,
          dataEmissao,
          itens,
          hashArquivo,
          chaveObjeto,
        }),
    );
    return resultadoTiss(
      r.repetido
        ? 'Este demonstrativo já foi importado: nada foi duplicado.'
        : `Demonstrativo importado: ${r.casados} item(ns) casado(s) com a conta, ${r.semCasamento} sem casamento.`,
      r.repetido,
      { demonstrativo: r.id, casados: r.casados, semCasamento: r.semCasamento },
      r.semCasamento > 0
        ? ['Há itens do demonstrativo que não casaram com nenhum item do lote: confira à mão.']
        : [],
    );
  }

  async decidirGlosa(s: SessaoCadastro, e: DecidirGlosaEntrada): Promise<ResultadoTiss> {
    const x = await this.exigirEscopoItem(s, e.item);
    const itens = await this.porta.itensDaConta(ctx(s), x.conta, '');
    const it = itens.find((i) => i.item === e.item);
    const prazo = prazoRecurso(
      await this.parametroTexto(s, 'faturamento.recursoPrazoPorOperadora'),
      x.convenio,
      it?.dataPagamento ?? null,
    );
    const r = await this.sgh(
      s,
      'conciliacao',
      E.faturamentoGlosaDecidida.codigo,
      (d) => ({ tabela: 'glosa_item', id: String(d.id) }),
      (g: GravadorSghTiss) => g.decidirGlosa({ ...e, usuario: s.login, prazo: prazo.prazo }),
    );
    return resultadoTiss(
      r.estado === 'aceita' ? 'Glosa aceita.' : 'Glosa marcada para recurso.',
      false,
      { decisao: r.id, conta: r.conta },
      prazo.alerta && r.estado === 'recorrida' ? [`Prazo do recurso: ${prazo.alerta}.`] : [],
    );
  }

  async editarEndpoint(s: SessaoCadastro, e: EditarEndpointTissEntrada): Promise<ResultadoTiss> {
    const r = await this.sgh(
      s,
      'integracaoTiss',
      E.integracaoEndpointTissEditado.codigo,
      (x) => ({ tabela: 'endpoint_tiss_fonte_pagadora', id: String(x.id) }),
      (g: GravadorSghTiss) => g.editarEndpoint({ ...e, usuario: s.login }),
    );
    return resultadoTiss('Endpoint da operadora gravado (a credencial fica no cofre).', false, {
      endpoint: r.id,
    });
  }

  /** Painel de glosas (só agregados), em cache de horas (a competência fechada não muda no dia). */
  async painel(s: SessaoCadastro, de: string, ate: string): Promise<PainelGlosa> {
    const convenios = this.convenios(s);
    const cache = this.apoios.cache;
    const carregar = () => this.porta.painel(ctx(s), { de, ate, convenios });
    if (!cache || this.porta.destino === 'memoria') return carregar();
    const horas = await this.parametro(s, 'faturamento.painelGlosaCacheHoras', 6);
    let carregou = false;
    const r = await cache.lerOuCarregar(
      cache.chave(s.rede, s.hospital, 'painel-glosa', `${de}:${ate}:${(convenios ?? ['*']).join('-')}`),
      horas * 3_600,
      async () => {
        carregou = true;
        return carregar();
      },
    );
    return { ...r, emCache: !carregou };
  }
}
