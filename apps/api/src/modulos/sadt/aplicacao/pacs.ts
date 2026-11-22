// Serviço da lista de trabalho DICOM (M47, etapa 3; ficha, seções 4 a 8, regras 8, 9 e 11): monta a tela (os exames de
// imagem do dia com a modalidade, o item da MWL, a entrega e o status vigente), envia e reenvia pela fila de integração,
// recebe o status do PACS ou do simulador de forma idempotente e entrega ao prontuário e ao portal o link do
// visualizador. As gravações passam pelo apoio comum (a chave `imagem.worklist` e a trilha na mesma transação); a
// entrada do PACS, sem sessão, grava a trilha com o usuário do parceiro.
import {
  CHAVE_LIBERACAO_WORKLIST,
  definicaoParametro,
  type EstudoLido,
  type EstudosDoPaciente,
  EVENTOS_AUDITAVEIS,
  type FiltroWorklist,
  type ImagemDoLaudo,
  type ItemMwlLido,
  type ItemWorklist,
  PERMISSOES_PACS_CODIGOS as P,
  type RespostaStatusExame,
  type ResultadoWorklist,
  rotuloAto,
  type StatusEstudo,
  type StatusExameEntrada,
  type TelaWorklist,
  TETO_WORKLIST,
} from '@sgh/contratos';
import {
  accessionDoItem,
  chaveIdempotenciaMwl,
  chaveNaturalExame,
  chegouForaDeOrdem,
  lerModalidadePorSetor,
  linkDoVisualizador,
  modalidadeDoExame,
  situacaoDoExame,
  statusSimulado,
  statusVigente,
  uidDoEstudo,
} from '@sgh/dominio-sadt';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import { ATOS_IMAGEM } from '../pacs-porta-memoria.js';
import type {
  ContextoPacs,
  GravadorPacs,
  ItemMwlBanco,
  PortaPacs,
  StatusEstudoBanco,
} from '../pacs-porta.js';

const E = EVENTOS_AUDITAVEIS;

/** O que a gravação do status devolve (a linha e se repetida). */
export interface GravadoStatus {
  readonly estudo: StatusEstudoBanco;
  readonly repetida: boolean;
}
/** O alvo da trilha do status (sem dado pessoal: o ID do estudo, o número de acesso e o status). */
export interface AlvoStatus {
  readonly id: string;
  readonly chave: string;
  readonly operacao: string;
  readonly paciente: number | null;
}
/** Quem grava o status decide a trilha: a sessão interna (simulador da tela) ou o parceiro (entrada do PACS). */
export type GravarStatus = (
  alvo: (r: GravadoStatus) => AlvoStatus,
  fn: (g: GravadorPacs) => Promise<GravadoStatus>,
) => Promise<GravadoStatus>;
const RECURSO = 'sadt.pacs';
const PADRAO_MODALIDADES = '16:CR;24:US;25:CT;26:MR;27:US;42:OT';

/** O ambiente da API e o modo do PACS (fora de produção, só o simulador; regra 9). */
export function modoPacs(env: NodeJS.ProcessEnv = process.env): 'simulador' | 'pacs' | 'desligado' {
  const ambiente = env['AMBIENTE']?.trim() || 'dev';
  const modo = env['PACS_MODO']?.trim() ?? '';
  if (modo === 'desligado') return 'desligado';
  return ambiente === 'producao' ? 'pacs' : 'simulador';
}

const entregaDe = (i: ItemMwlBanco): ItemMwlLido['entrega'] =>
  (i.entrega?.situacao as ItemMwlLido['entrega'] | undefined) ?? 'sem-parceiro';

export function itemLido(i: ItemMwlBanco): ItemMwlLido {
  return {
    id: i.id,
    accession: i.accession,
    modalidade: i.modalidade,
    envios: i.envios,
    ultimoEnvioEm: i.ultimoEnvioEm,
    ultimoEnvioPor: i.ultimoEnvioPor,
    origem: i.origem,
    entrega: entregaDe(i),
    resposta: i.entrega?.resposta ?? null,
    tentativas: i.entrega?.tentativas ?? 0,
  };
}

export class ServicoPacs {
  readonly apoio: ApoioGravacao<GravadorPacs>;

  constructor(
    readonly porta: PortaPacs,
    trilha: RegistradorTrilha,
    private readonly configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.apoio = new ApoioGravacao<GravadorPacs>(
      { chave: CHAVE_LIBERACAO_WORKLIST, nome: 'a lista de trabalho DICOM', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private async parametros(s: SessaoCadastro) {
    const r = await this.apoio.resolvedorParametros(s);
    return {
      porSetor: lerModalidadePorSetor(String(r('pacs.modalidadePorSetor', null) ?? PADRAO_MODALIDADES)),
      url: String(r('pacs.visualizadorUrl', null) ?? ''),
      visualizador: String(r('pacs.visualizador', null) ?? 'OVIYAM'),
      janela: Number(r('pacs.janelaDias', null) ?? 2) || 2,
    };
  }

  private estudoLido(ms: readonly StatusEstudoBanco[], url: string, accession: string): EstudoLido | null {
    const v = statusVigente(ms);
    if (!v) return null;
    const uid = [...ms].reverse().find((m) => m.uidEstudo)?.uidEstudo ?? v.uidEstudo;
    return {
      status: v.status,
      uidEstudo: uid,
      ocorridoEm: v.ocorridoEm,
      recebidoEm: v.recebidoEm,
      link: v.status === 'concluido' ? linkDoVisualizador(url, uid, accession) : null,
      mensagens: ms.length,
    };
  }

  private async destino(c: ContextoPacs): Promise<TelaWorklist['destino']> {
    const modo = modoPacs(this.env);
    if (modo === 'desligado')
      return { modo, parceiro: null, motivo: 'O envio ao PACS está desligado neste ambiente.' };
    const p = await this.porta.parceiroDaWorklist(c).catch(() => null);
    if (!p)
      return {
        modo: 'desligado',
        parceiro: null,
        motivo:
          'Nenhuma integração ativa recebe a lista de trabalho: cadastre o PACS (fora de produção, o simulador) em Integrações › Parceiros, com o evento da lista de trabalho DICOM.',
      };
    return { modo, parceiro: p.nome, motivo: null };
  }

  async tela(s: SessaoCadastro, f: FiltroWorklist): Promise<TelaWorklist> {
    const c = s.porta;
    const [{ hoje, agora }, prm, liberacao, destino] = await Promise.all([
      this.porta.relogio(c),
      this.parametros(s),
      this.apoio.liberacao(s),
      this.destino(c),
    ]);
    const data = f.data ?? hoje;
    // O termo: o número de acesso (o que a modalidade e o PACS mostram) acha o item; senão, o paciente (nome,
    // prontuário ou registro) vai à consulta, com o setor.
    const termo = (f.termo ?? '').trim().toUpperCase();
    const porAcesso = /^[A-Z][A-Z0-9]{0,2}\d{6,}$/.test(termo)
      ? await this.porta.item(c, { accession: termo })
      : undefined;
    const [{ itens: lidos, cortada }, modalidades, visualizadores] = await Promise.all([
      porAcesso === null
        ? Promise.resolve({ itens: [], cortada: false })
        : this.porta.examesDoDia(c, data, {
            ato: f.setor,
            termo: porAcesso ? undefined : termo || undefined,
          }),
      this.porta.modalidades(c),
      this.porta.visualizadores(c),
    ]);
    const exames = porAcesso ? lidos.filter((x) => x.id === porAcesso.exame) : lidos;
    const doSetor = exames.filter((x) => (f.setor ? x.ato === f.setor : true)).slice(0, TETO_WORKLIST);
    const ids = doSetor.map((x) => x.id);
    const [cadastro, itens, status] = await Promise.all([
      this.porta.modalidadeDoCadastro(c, ids),
      this.porta.itens(c, ids),
      this.porta.status(c, ids),
    ]);
    const porExame = new Map(itens.map((i) => [i.exame, i]));
    const linhas: ItemWorklist[] = doSetor.map((x) => {
      const i = porExame.get(x.id) ?? null;
      const mod = i
        ? { id: i.idModalidade, sigla: i.modalidade }
        : modalidadeDoExame(
            { ato: x.ato, modalidadeCadastro: cadastro.get(x.id) ?? null },
            prm.porSetor,
            modalidades,
          );
      const estudo = i
        ? this.estudoLido(
            status.filter((m) => m.exame === x.id),
            prm.url,
            i.accession,
          )
        : null;
      return {
        exame: x.id,
        ato: x.ato,
        setor: rotuloAto(x.ato),
        nomeExame: x.exame.nome,
        paciente: { id: x.paciente.id ?? x.paciente.prontuario, nome: x.paciente.nome },
        data: x.pedidoEm ?? x.chave.data,
        urgente: x.urgente,
        modalidade: mod,
        situacao: situacaoDoExame({
          temModalidade: mod !== null,
          entrega: i ? entregaDe(i) : null,
          status: estudo?.status ?? null,
        }),
        mwl: i ? itemLido(i) : null,
        estudo,
      };
    });
    const filtradas = f.situacao ? linhas.filter((l) => l.situacao === f.situacao) : linhas;
    const contagens: Record<string, number> = {};
    for (const l of linhas) contagens[l.situacao] = (contagens[l.situacao] ?? 0) + 1;
    const podeReenviar = s.pode(P.reenviar);
    const vale = liberacao.ligada && destino.modo !== 'desligado';
    const nomeVisualizador =
      visualizadores.find((v) => v.nome.toUpperCase() === prm.visualizador.toUpperCase())?.nome ??
      prm.visualizador;
    s.req.sghAlvo = {
      tabelaAlvo: 'item_lista_trabalho_imagem',
      chaveNaturalAlvo: `parte:worklist;n:${filtradas.length}`,
    };
    return {
      data,
      setores: ATOS_IMAGEM.map((a) => ({
        ato: a,
        rotulo: rotuloAto(a),
        modalidade: prm.porSetor.get(a) ?? null,
      })),
      itens: filtradas,
      cortada: cortada || exames.length > TETO_WORKLIST,
      contagens,
      liberacao,
      destino,
      visualizador: { nome: nomeVisualizador, configurado: /\{(estudo|acesso)\}/.test(prm.url) },
      acoes: {
        enviar: podeReenviar && vale,
        reenviar: podeReenviar && vale,
        simular: podeReenviar && liberacao.ligada && destino.modo === 'simulador',
        motivo: !podeReenviar
          ? 'Seu perfil só consulta a lista de trabalho.'
          : !liberacao.ligada
            ? liberacao.motivo
            : destino.motivo,
      },
      lidoEm: agora,
    };
  }

  /** O destino vale para gravar (a chave já é conferida pelo apoio). */
  private async exigirDestino(c: ContextoPacs): Promise<void> {
    const d = await this.destino(c);
    if (d.modo === 'desligado')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sem destino para a lista de trabalho',
        d.motivo ?? '',
        {
          codigo: 'pacs-sem-destino',
        },
      );
  }

  /**
   * sadt.enviarWorklist: cada exame numa transação própria (um que falhe não segura os outros). Recusa por exame: sem
   * modalidade DICOM, fora do setor de imagem, suspenso ou já na lista (o reenvio é outra ação).
   */
  async enviar(
    s: SessaoCadastro,
    exames: readonly number[],
    origem: 'manual' | 'automatico' = 'manual',
  ): Promise<ResultadoWorklist> {
    await this.apoio.exigirLiberacao(s);
    await this.exigirDestino(s.porta);
    const c = s.porta;
    const prm = await this.parametros(s);
    const [lidos, modalidades, cadastro, ja] = await Promise.all([
      this.porta.examesPorId(c, exames),
      this.porta.modalidades(c),
      this.porta.modalidadeDoCadastro(c, exames),
      this.porta.itens(c, exames),
    ]);
    const comItem = new Set(ja.map((i) => i.exame));
    const porId = new Map(lidos.map((x) => [x.id, x]));
    const ignorados: { exame: number; motivo: string }[] = [];
    let enviados = 0;
    for (const id of [...new Set(exames)]) {
      const x = porId.get(id);
      if (!x || !ATOS_IMAGEM.includes(x.ato)) {
        ignorados.push({ exame: id, motivo: 'Não é um exame de imagem lançado neste estabelecimento.' });
        continue;
      }
      if (x.estado === 'suspenso') {
        ignorados.push({ exame: id, motivo: 'Exame suspenso no prontuário.' });
        continue;
      }
      if (comItem.has(id)) {
        ignorados.push({ exame: id, motivo: 'Já está na lista de trabalho (use o reenvio).' });
        continue;
      }
      const mod = modalidadeDoExame(
        { ato: x.ato, modalidadeCadastro: cadastro.get(id) ?? null },
        prm.porSetor,
        modalidades,
      );
      if (!mod) {
        ignorados.push({ exame: id, motivo: 'O setor do exame não tem modalidade DICOM.' });
        continue;
      }
      try {
        await this.apoio.sgh(
          s,
          E.mwlEnviada.codigo,
          RECURSO,
          (r: { id: number; accession: string }) => ({
            tabela: 'item_lista_trabalho_imagem',
            id: String(r.id),
            paciente: x.paciente.id,
            chave: `${r.accession}:${mod.sigla}:1`,
          }),
          (g) =>
            g.registrarItem({
              exame: id,
              paciente: x.paciente.id,
              chaveNatural: chaveNaturalExame(x.chave),
              ato: x.ato,
              modalidade: mod,
              accession: (n) => accessionDoItem(c.hospital, n),
              chaveIdempotencia: chaveIdempotenciaMwl(c.hospital, id),
              origem,
              por: s.login,
            }),
        );
        enviados++;
      } catch (e) {
        if (e instanceof ErroProblema && e.extras.codigo === 'ja-na-worklist') {
          ignorados.push({ exame: id, motivo: 'Já está na lista de trabalho (use o reenvio).' });
          continue;
        }
        throw e;
      }
    }
    return {
      ok: true,
      enviados,
      ignorados,
      mensagem:
        enviados === 0
          ? 'Nenhum exame enviado à lista de trabalho.'
          : `${enviados} exame(s) enviado(s) à lista de trabalho pela fila de integração.`,
    };
  }

  /** O reenvio do item com o mesmo número de acesso (o PACS atualiza, não duplica). */
  async reenviar(s: SessaoCadastro, id: number, envios: number | null): Promise<ResultadoWorklist> {
    await this.apoio.exigirLiberacao(s);
    await this.exigirDestino(s.porta);
    const i = await this.porta.item(s.porta, { id });
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Item não encontrado',
        'O item da lista de trabalho não existe.',
      );
    // O exame suspenso depois de virar item não volta à modalidade como procedimento agendado.
    const [x] = await this.porta.examesPorId(s.porta, [i.exame]);
    if (x?.estado === 'suspenso')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Exame suspenso',
        'O exame foi suspenso no prontuário: o item não se reenvia à lista de trabalho.',
        { codigo: 'exame-suspenso' },
      );
    await this.apoio.sgh(
      s,
      E.mwlEnviada.codigo,
      RECURSO,
      (r: { id: number; envios: number }) => ({
        tabela: 'item_lista_trabalho_imagem',
        id: String(r.id),
        paciente: i.paciente,
        chave: `${i.accession}:${i.modalidade}:${r.envios}`,
      }),
      (g) =>
        g.reenviar({
          id: i.id,
          envios: envios ?? i.envios,
          exame: i.exame,
          accession: i.accession,
          modalidade: i.modalidade,
          por: s.login,
        }),
    );
    return {
      ok: true,
      enviados: 1,
      ignorados: [],
      mensagem: `Item ${i.accession} reenviado com o mesmo número de acesso.`,
    };
  }

  /**
   * sadt.receberStatusExame: o status de um item pelo número de acesso (idempotente pela chave da mensagem). `gravar`
   * decide a trilha: a sessão interna (o simulador da tela) ou o parceiro (a entrada do PACS).
   */
  async receberStatus(
    c: ContextoPacs,
    e: StatusExameEntrada,
    origem: 'pacs' | 'simulador',
    por: string,
    gravar: GravarStatus,
    visualizador: number | null,
  ): Promise<RespostaStatusExame> {
    const i = await this.porta.item(c, { accession: e.accession });
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Número de acesso desconhecido',
        'Nenhum item da lista de trabalho tem este número de acesso.',
        { codigo: 'accession-desconhecido' },
      );
    const anteriores = await this.porta.status(c, [i.exame]);
    const anterior = statusVigente(anteriores);
    const r = await gravar(
      (x) => ({
        id: String(x.estudo.id),
        chave: `${i.accession}:${e.status}`.slice(0, 60),
        operacao: x.repetida ? 'repetida' : e.status,
        paciente: i.paciente,
      }),
      (g) =>
        g.registrarStatus({
          mwl: i.id,
          exame: i.exame,
          accession: i.accession,
          status: e.status,
          uidEstudo: e.uidEstudo,
          uidMpps: e.uidMpps,
          ocorridoEm: e.ocorridoEm,
          visualizador,
          chaveMensagem: e.mensagem,
          origem,
          por,
        }),
    );
    const todos = r.repetida ? anteriores : [...anteriores, r.estudo];
    return {
      id: r.estudo.id,
      repetida: r.repetida,
      vigente: (statusVigente(todos)?.status ?? e.status) as StatusEstudo,
      foraDeOrdem: !r.repetida && chegouForaDeOrdem(anterior, e),
    };
  }

  async idVisualizador(s: SessaoCadastro): Promise<number | null> {
    const prm = await this.parametros(s);
    const vs = await this.porta.visualizadores(s.porta);
    return vs.find((v) => v.nome.toUpperCase() === prm.visualizador.toUpperCase())?.id ?? null;
  }

  /** O simulador de modalidade (fora de produção): o status que a modalidade mandaria, pelo mesmo caminho da entrada. */
  async simular(s: SessaoCadastro, id: number, status: StatusEstudo): Promise<RespostaStatusExame> {
    if (modoPacs(this.env) !== 'simulador')
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Simulador fora de uso',
        'O simulador só existe fora de produção.',
        {
          codigo: 'simulador-fora-de-uso',
        },
      );
    await this.apoio.exigirLiberacao(s);
    const i = await this.porta.item(s.porta, { id });
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Item não encontrado',
        'O item da lista de trabalho não existe.',
      );
    const { agora } = await this.porta.relogio(s.porta);
    const msg = statusSimulado({
      accession: i.accession,
      uidEstudo: uidDoEstudo(s.hospital, i.accession),
      status,
      envio: i.envios,
      ocorridoEm: agora,
    });
    const visualizador = await this.idVisualizador(s);
    return this.receberStatus(
      s.porta,
      msg,
      'simulador',
      s.login,
      (alvo, fn) =>
        this.apoio.sgh(
          s,
          E.estudoStatusRecebido.codigo,
          RECURSO,
          (r: GravadoStatus) => {
            const a = alvo(r);
            return { tabela: 'integracao_mensagem', id: a.id, paciente: a.paciente, chave: a.chave };
          },
          fn,
        ),
      visualizador,
    );
  }

  /** Os estudos do paciente para o prontuário (o link só com o estudo concluído e o visualizador configurado). */
  async estudosDoPaciente(s: SessaoCadastro, paciente: number): Promise<EstudosDoPaciente> {
    const c = s.porta;
    const prm = await this.parametros(s);
    const itens = await this.porta.itensDoPaciente(c, paciente);
    const exames = itens.map((i) => i.exame);
    const [lidos, status] = await Promise.all([
      this.porta.examesPorId(c, exames),
      this.porta.status(c, exames),
    ]);
    const porId = new Map(lidos.map((x) => [x.id, x]));
    return {
      estudos: itens.map((i) => {
        const x = porId.get(i.exame);
        const est = this.estudoLido(
          status.filter((m) => m.exame === i.exame),
          prm.url,
          i.accession,
        );
        return {
          exame: i.exame,
          nomeExame: x?.exame.nome ?? 'Exame de imagem',
          setor: rotuloAto(i.ato),
          data: x?.pedidoEm ?? x?.chave.data ?? i.criadoEm,
          accession: i.accession,
          modalidade: i.modalidade,
          status: est?.status ?? null,
          link: est?.link ?? null,
        };
      }),
      visualizador: { nome: prm.visualizador, configurado: /\{(estudo|acesso)\}/.test(prm.url) },
    };
  }

  /**
   * A imagem do laudo aberto no portal (o laudo liberado já foi conferido por quem chama: o portal só abre a liberação
   * vigente). Os parâmetros do estabelecimento sem sessão (o portal tem identidade própria); falha de leitura: sem link.
   */
  async imagemDoLaudo(c: ContextoPacs, exame: number): Promise<ImagemDoLaudo | null> {
    try {
      const [i] = await this.porta.itens(c, [exame]);
      if (!i) return null;
      const valores = this.configuracao ? await this.configuracao.valoresParametro(c.rede, c.hospital) : [];
      const ler = (chave: string) => {
        const def = definicaoParametro(chave);
        if (!def) return '';
        const v = valorTipado(
          def,
          resolverParametro(
            def,
            valores,
            {
              rede: c.rede,
              empresa: null,
              estabelecimento: c.hospital,
              unidade: null,
              perfis: [],
              usuario: '',
            },
            new Date(),
          ).valor,
        );
        return String(v ?? '');
      };
      const est = this.estudoLido(
        await this.porta.status(c, [exame]),
        ler('pacs.visualizadorUrl'),
        i.accession,
      );
      return est?.link ? { link: est.link, visualizador: ler('pacs.visualizador') || 'OVIYAM' } : null;
    } catch {
      return null;
    }
  }
}
