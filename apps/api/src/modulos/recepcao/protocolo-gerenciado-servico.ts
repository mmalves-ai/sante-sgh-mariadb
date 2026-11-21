// Serviço dos protocolos gerenciados no PA (M44, etapa 3; ficha, seções 4, 5, 7 e 8, regra 8): monta o relógio (os
// protocolos abertos dos atendimentos do PA com cada meta e o prazo, os encerrados do dia, as sugestões da classificação
// e a adesão com numerador e denominador), o chip do quadro do PA e decide no servidor o que a tela só mostra: quem
// inclui e registra (enfermeiro ou médico com conselho ativo), a versão vigente vista, os critérios da definição, a meta
// cumprida ou perdida (o motivo obrigatório), a hora real, o encerramento. O motor é @sgh/dominio-recepcao.
import { createHash } from 'node:crypto';
import {
  type ConteudoGerenciado,
  esquemaConteudoGerenciado,
  type EncerrarProtocoloGerenciadoEntrada,
  type GerenciadoComConteudo,
  type IniciarProtocoloGerenciadoEntrada,
  type ProtocoloDoPaciente,
  type ProtocoloNoQuadro,
  type RegistrarMetaProtocoloEntrada,
  type RelogioProtocolos,
  TETO_PROTOCOLOS_DO_PERIODO,
  type TipoProtocoloGerenciado,
  type VersaoGerenciadoResumo,
} from '@sgh/contratos';
import {
  adesaoDasMetas,
  comSegundos,
  conteudoCanonico,
  decidirRegistroMeta,
  type EventoDoProtocolo,
  nomeDoTipo,
  origemDaInclusao,
  problemaDoEncerramento,
  problemasDaDefinicao,
  recusaDoGerenciado,
  relogioDoProtocolo,
  sugestoesDaClassificacao,
} from '@sgh/dominio-recepcao';
import type { AtendimentoPa, ProtocoloPaciente, VersaoGerenciado } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type {
  ContextoClassificacao,
  GravadorClassificacao,
  PortaClassificacao,
} from './classificacao-porta.js';
import { atorDoVinculo, encerradoNoPa, type FonteAtendimentosPa } from './classificacao-servico.js';

const MENSAGENS_RECUSA: Readonly<Record<string, string>> = {
  'sem-vinculo-assistencial':
    'Seu usuário não tem ocupação assistencial ativa no cadastro de profissionais: o relógio fica em consulta.',
  'categoria-nao-inclui': 'A inclusão e o registro das metas são do enfermeiro ou do médico.',
  'conselho-inativo': 'O conselho profissional não está ativo no cadastro de profissionais.',
};

const recusa = (status: number, codigo: string, titulo: string, detalhe: string, campos?: string[]) =>
  new ErroProblema(status === 409 ? 'recusa-de-negocio' : 'entrada-invalida', status, titulo, detalhe, {
    codigo,
    ...(campos ? { campos } : {}),
  });

const diaSeguinte = (dia: string) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const diasAntes = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export function impressaoGerenciado(c: ConteudoGerenciado): string {
  return createHash('sha256')
    .update(conteudoCanonico(c as never))
    .digest('hex');
}

const eventosDe = (p: ProtocoloPaciente): EventoDoProtocolo[] =>
  p.eventos.map((e) => ({
    tipo: e.tipo,
    codigo: e.codigo,
    situacao: e.situacao,
    quando: e.quando,
    motivo: e.motivo,
    por: e.por,
    em: e.em,
  }));

export interface SessaoGerenciado {
  readonly c: ContextoClassificacao;
  readonly login: string;
  pode(permissao: string): boolean;
}

export class ServicoProtocoloGerenciado {
  constructor(
    private readonly porta: PortaClassificacao,
    private readonly atendimentos: FonteAtendimentosPa,
  ) {}

  /** As versões publicadas, cada uma com o conteúdo conferido pelo esquema e pela impressão. */
  async versoes(c: ContextoClassificacao): Promise<{ v: VersaoGerenciado; conteudo: ConteudoGerenciado }[]> {
    const vs = await this.porta.versoesGerenciadas(c);
    const r: { v: VersaoGerenciado; conteudo: ConteudoGerenciado }[] = [];
    for (const v of vs) {
      const conteudo = esquemaConteudoGerenciado.safeParse(v.conteudo);
      if (!conteudo.success || impressaoGerenciado(conteudo.data) !== v.impressao) continue;
      r.push({ v, conteudo: conteudo.data });
    }
    return r;
  }

  /** A vigente de cada tipo (a de maior versão). */
  vigentesDe(vs: readonly { v: VersaoGerenciado; conteudo: ConteudoGerenciado }[]) {
    const m = new Map<string, { v: VersaoGerenciado; conteudo: ConteudoGerenciado }>();
    for (const x of vs) if (!m.has(x.v.tipo) || m.get(x.v.tipo)!.v.versao < x.v.versao) m.set(x.v.tipo, x);
    return m;
  }

  resumo(v: VersaoGerenciado, vigente: boolean): VersaoGerenciadoResumo {
    return {
      id: v.id,
      tipo: v.tipo as TipoProtocoloGerenciado,
      versao: v.versao,
      nome: v.nome,
      autor: v.autor,
      aprovador: v.aprovador,
      publicadoEm: v.publicadoEm,
      impressao: v.impressao,
      vigente,
    };
  }

  async definicoes(c: ContextoClassificacao): Promise<GerenciadoComConteudo[]> {
    const vs = await this.versoes(c);
    const vig = this.vigentesDe(vs);
    return vs.map((x) => ({
      versao: this.resumo(x.v, vig.get(x.v.tipo)?.v.id === x.v.id),
      conteudo: x.conteudo,
      notas: x.v.notas,
    }));
  }

  /** O protocolo do paciente pronto para a tela (o relógio pelo motor). */
  doPaciente(
    p: ProtocoloPaciente,
    conteudo: ConteudoGerenciado | undefined,
    versao: number,
    at: { paciente: string; senha: string | null } | undefined,
    agora: string,
  ): ProtocoloDoPaciente | null {
    if (!conteudo) return null;
    const r = relogioDoProtocolo({
      conteudo,
      chegadaEm: p.chegadaEm,
      incluidoEm: p.incluidoEm,
      eventos: eventosDe(p),
      agora,
    });
    return {
      id: p.id,
      reg: p.reg,
      paciente: at?.paciente ?? `Atendimento ${p.reg}`,
      senha: at?.senha ?? null,
      tipo: p.tipo as TipoProtocoloGerenciado,
      nomeTipo: nomeDoTipo(p.tipo),
      versao,
      origem: p.origem,
      sugeridoPor: p.sugeridoPor,
      criterios: p.criterios,
      chegadaEm: p.chegadaEm,
      incluidoEm: p.incluidoEm,
      incluidoPor: p.incluidoPor,
      minutosDesdeInclusao: r.minutosDesdeInclusao,
      metas: r.metas.map((m) => ({ ...m })),
      proxima: r.proxima,
      atrasadas: r.atrasadas,
      encerrado: r.encerrado
        ? {
            desfecho: r.encerrado.situacao as NonNullable<ProtocoloDoPaciente['encerrado']>['desfecho'],
            em: r.encerrado.em,
            por: r.encerrado.por,
            motivo: r.encerrado.motivo,
          }
        : null,
    };
  }

  /** Quem pode incluir e registrar (permissão + categoria e conselho relidos do vínculo). */
  async acoes(s: SessaoGerenciado): Promise<RelogioProtocolos['acoes']> {
    const podeIniciar = s.pode('recepcao.protocoloPaciente.iniciar');
    const podeRegistrar = s.pode('recepcao.protocoloPaciente.registrar');
    if (!podeIniciar && !podeRegistrar)
      return { iniciar: false, registrar: false, motivo: 'Seu perfil só consulta o relógio dos protocolos.' };
    const v = await this.porta.vinculo(s.c, s.login).catch(() => null);
    const motivo = recusaDoGerenciado(atorDoVinculo(v));
    if (motivo) return { iniciar: false, registrar: false, motivo: MENSAGENS_RECUSA[motivo] ?? motivo };
    return { iniciar: podeIniciar, registrar: podeRegistrar, motivo: null };
  }

  private async exigirAtor(s: SessaoGerenciado) {
    const v = await this.porta.vinculo(s.c, s.login).catch(() => null);
    const ator = atorDoVinculo(v);
    const motivo = recusaDoGerenciado(ator);
    if (motivo || !v)
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', MENSAGENS_RECUSA[motivo ?? ''] ?? '', {
        codigo: motivo ?? 'sem-vinculo-assistencial',
      });
    return { ator, vinculo: v.vinculo };
  }

  async relogio(
    s: SessaoGerenciado,
    liberacao: { ligada: boolean; motivo: string | null },
  ): Promise<RelogioProtocolos> {
    const { agora, hoje } = await this.porta.relogio(s.c);
    const { itens } = await this.atendimentos.paAbertos(s.c, { hoje });
    const abertos = itens.filter((a) => !encerradoNoPa(a));
    const porCab = new Map(itens.map((a) => [a.cabecalho, a]));
    const vs = await this.versoes(s.c);
    const vig = this.vigentesDe(vs);
    const porId = new Map(vs.map((x) => [x.v.id, x]));
    const inicioPeriodo = `${diasAntes(hoje, 30)}T00:00:00`;
    const [protos, classes, lidosDoPeriodo] = await Promise.all([
      this.porta.protocolosDosAtendimentos(
        s.c,
        itens.map((a) => a.cabecalho),
      ),
      this.porta.classificacoes(
        s.c,
        abertos.map((a) => a.cabecalho),
      ),
      this.porta.protocolosDoPeriodo(s.c, inicioPeriodo, `${diaSeguinte(hoje)}T00:00:00`),
    ]);
    // A leitura devolve uma inclusão a mais que o teto quando o período passou dele: a adesão é calculada sobre as
    // mais recentes, e a resposta diz desde quando (nunca um corte calado).
    const truncado = lidosDoPeriodo.length > TETO_PROTOCOLOS_DO_PERIODO;
    const periodo = truncado ? lidosDoPeriodo.slice(0, TETO_PROTOCOLOS_DO_PERIODO) : lidosDoPeriodo;
    const desde = truncado
      ? periodo.reduce((m, p) => (p.incluidoEm < m ? p.incluidoEm : m), periodo[0]!.incluidoEm)
      : inicioPeriodo;
    const montar = (p: ProtocoloPaciente) => {
      const d = porId.get(p.gerenciado);
      return this.doPaciente(p, d?.conteudo, d?.v.versao ?? 0, porCab.get(p.cabecalho), agora);
    };
    const todos = protos.map(montar).filter((x): x is ProtocoloDoPaciente => x !== null);
    const ativos = todos
      .filter((p) => p.encerrado === null)
      .sort((a, b) => (a.proxima?.minutosRestantes ?? 1e9) - (b.proxima?.minutosRestantes ?? 1e9));
    const encerradosHoje = periodo
      .map(montar)
      .filter((p): p is ProtocoloDoPaciente => p !== null && p.encerrado !== null && p.encerrado.em >= hoje)
      .slice(0, 50);
    // Sugestões: a classificação vigente de cada aberto com discriminador que sugere protocolo publicado.
    const sugestoes: RelogioProtocolos['sugestoes'] = [];
    const versoesClass = new Map<
      number,
      { codigo: string; titulo: string; sugereProtocolo: string | null }[]
    >();
    for (const a of abertos) {
      const ls = classes.filter((l) => l.cabecalho === a.cabecalho);
      const v = ls[ls.length - 1];
      if (!v) continue;
      if (!versoesClass.has(v.versaoProtocolo))
        versoesClass.set(v.versaoProtocolo, await this.discriminadoresDaVersao(s.c, v.versaoProtocolo));
      const ja = new Set(protos.filter((p) => p.cabecalho === a.cabecalho).map((p) => p.tipo));
      for (const sg of sugestoesDaClassificacao(
        v.discriminadores,
        versoesClass.get(v.versaoProtocolo) ?? [],
        ja,
        new Set(vig.keys()),
      ))
        sugestoes.push({
          reg: a.reg,
          paciente: a.paciente,
          senha: a.senha,
          tipo: sg.tipo,
          nomeTipo: nomeDoTipo(sg.tipo),
          discriminador: sg.discriminador,
          tituloDiscriminador: sg.titulo,
          classificadoEm: v.em,
        });
    }
    const adesao = adesaoDasMetas(
      periodo
        .map((p) => ({ p, d: porId.get(p.gerenciado) }))
        .filter((x) => x.d)
        .map((x) => ({ tipo: x.p.tipo, conteudo: x.d!.conteudo, eventos: eventosDe(x.p) })),
    );
    return {
      ativos,
      encerradosHoje,
      sugestoes,
      atendimentos: abertos.map((a) => ({
        reg: a.reg,
        paciente: a.paciente,
        senha: a.senha,
        chegada: a.chegada,
      })),
      vigentes: [...vig.values()].map((x) => ({
        versao: this.resumo(x.v, true),
        conteudo: x.conteudo,
        notas: x.v.notas,
      })),
      adesao,
      adesaoPeriodo: { desde, inclusoes: periodo.length, truncado },
      acoes: await this.acoes(s),
      liberada: liberacao.ligada,
      motivoLiberacao: liberacao.motivo,
      lidoEm: agora,
    };
  }

  /** O chip do quadro do PA: os protocolos abertos de cada atendimento com a próxima meta. */
  async noQuadro(
    c: ContextoClassificacao,
    itens: readonly Pick<AtendimentoPa, 'cabecalho' | 'reg'>[],
  ): Promise<Map<number, ProtocoloNoQuadro[]>> {
    const r = new Map<number, ProtocoloNoQuadro[]>();
    if (itens.length === 0) return r;
    const [{ agora }, protos, vs] = await Promise.all([
      this.porta.relogio(c),
      this.porta.protocolosDosAtendimentos(
        c,
        itens.map((a) => a.cabecalho),
      ),
      this.versoes(c),
    ]);
    const porId = new Map(vs.map((x) => [x.v.id, x]));
    const regDe = new Map(itens.map((a) => [a.cabecalho, a.reg]));
    for (const p of protos) {
      const d = porId.get(p.gerenciado);
      const reg = regDe.get(p.cabecalho);
      if (!d || reg === undefined) continue;
      const x = relogioDoProtocolo({
        conteudo: d.conteudo,
        chegadaEm: p.chegadaEm,
        incluidoEm: p.incluidoEm,
        eventos: eventosDe(p),
        agora,
      });
      if (x.encerrado) continue;
      r.set(reg, [
        ...(r.get(reg) ?? []),
        {
          tipo: p.tipo as TipoProtocoloGerenciado,
          nomeTipo: nomeDoTipo(p.tipo),
          proxima: x.proxima,
          atrasadas: x.atrasadas,
        },
      ]);
    }
    return r;
  }

  // ── Gravações (as regras no servidor; a gravação pelo `gravar` do controller, com a trilha) ──

  async prepararPublicacao(
    s: SessaoGerenciado,
    e: { autor: string; conteudo: ConteudoGerenciado; notas: string },
  ) {
    const p = problemasDaDefinicao(e.conteudo, { autor: e.autor, aprovador: s.login });
    if (p.length > 0)
      throw recusa(422, p[0]!.codigo, 'Versão não publicada', p.map((x) => x.mensagem).join(' '));
    return {
      tipo: e.conteudo.tipo,
      nome: e.conteudo.nome,
      conteudo: e.conteudo,
      impressao: impressaoGerenciado(e.conteudo),
      notas: e.notas,
      autor: e.autor,
      aprovador: s.login,
    };
  }

  async prepararInclusao(s: SessaoGerenciado, e: IniciarProtocoloGerenciadoEntrada) {
    const { ator, vinculo } = await this.exigirAtor(s);
    const { hoje } = await this.porta.relogio(s.c);
    const a = (await this.atendimentos.paAbertos(s.c, { hoje })).itens.find((x) => x.reg === e.atendimento);
    if (!a || encerradoNoPa(a))
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento do PA não está aberto.',
      );
    const pac = await this.atendimentos.pacienteDoAtendimento(s.c, a.reg);
    if (!pac)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Paciente não encontrado',
        'O atendimento não tem paciente.',
      );
    const vig = this.vigentesDe(await this.versoes(s.c)).get(e.tipo);
    if (!vig)
      throw recusa(
        409,
        'sem-definicao',
        'Protocolo sem definição',
        'Este protocolo ainda não tem versão publicada.',
      );
    if (vig.v.id !== e.versao)
      throw recusa(
        409,
        'versao-desatualizada',
        'Versão mudou',
        'Outra versão deste protocolo foi publicada depois que você abriu. Abra de novo.',
      );
    const fora = e.criterios.filter((k) => !vig.conteudo.criterios.some((c) => c.codigo === k));
    if (fora.length > 0)
      throw recusa(
        422,
        'criterio-desconhecido',
        'Critério',
        `Critério fora da definição: ${fora.join(', ')}.`,
        ['criterios'],
      );
    if (e.sugeridoPor) await this.conferirSugestao(s, a.cabecalho, e.sugeridoPor, e.tipo);
    return {
      pac,
      linha: {
        cabecalho: a.cabecalho,
        reg: a.reg,
        paciente: pac.id,
        tipo: e.tipo,
        gerenciado: vig.v.id,
        origem: origemDaInclusao(ator.categoria, e.sugeridoPor),
        sugeridoPor: e.sugeridoPor,
        criterios: e.criterios,
        chegadaEm: comSegundos(a.chegada || `${hoje}T00:00:00`),
        autor: s.login,
        vinculo,
      },
    };
  }

  /** Os discriminadores da versão do protocolo de classificação (com o protocolo gerenciado que cada um sugere). */
  private async discriminadoresDaVersao(
    c: SessaoGerenciado['c'],
    versao: number,
  ): Promise<{ codigo: string; titulo: string; sugereProtocolo: string | null }[]> {
    const pv = await this.porta.versao(c, versao).catch(() => null);
    const ds = (pv?.conteudo as { discriminadores?: unknown } | undefined)?.discriminadores;
    return Array.isArray(ds)
      ? (ds as { codigo: string; titulo: string; sugereProtocolo?: string | null }[]).map((d) => ({
          codigo: d.codigo,
          titulo: d.titulo,
          sugereProtocolo: d.sugereProtocolo ?? null,
        }))
      : [];
  }

  /**
   * Revisão do M44.3: a origem `sugerido` só vale quando a classificação vigente do atendimento tem o discriminador
   * informado e ele sugere, na versão do protocolo de classificação usada, o protocolo pedido. A inclusão é só de
   * inclusão (não se corrige depois): o servidor confere, nunca confia no que veio da tela.
   */
  private async conferirSugestao(
    s: SessaoGerenciado,
    cabecalho: string,
    sugeridoPor: string,
    tipo: string,
  ): Promise<void> {
    const ls = await this.porta.classificacoes(s.c, [cabecalho]);
    const v = ls.filter((l) => l.cabecalho === cabecalho).at(-1);
    const ds = v ? await this.discriminadoresDaVersao(s.c, v.versaoProtocolo) : [];
    const confere =
      !!v &&
      v.discriminadores.includes(sugeridoPor) &&
      ds.some((d) => d.codigo === sugeridoPor && d.sugereProtocolo === tipo);
    if (!confere)
      throw recusa(
        422,
        'sugestao-invalida',
        'Sugestão',
        'A classificação vigente deste atendimento não sugere este protocolo por esse discriminador.',
        ['sugeridoPor'],
      );
  }

  /** O protocolo do paciente para registrar: existe, está aberto e tem a definição. */
  private async aberto(s: SessaoGerenciado, id: number) {
    const p = await this.porta.protocoloDoPaciente(s.c, id);
    if (!p)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Protocolo não encontrado',
        'O protocolo do paciente não existe.',
      );
    const d = (await this.versoes(s.c)).find((x) => x.v.id === p.gerenciado);
    if (!d)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Definição não encontrada',
        'A versão do protocolo não existe.',
      );
    if (p.eventos.some((x) => x.tipo === 'encerramento'))
      throw recusa(
        409,
        'protocolo-encerrado',
        'Protocolo encerrado',
        'O protocolo deste paciente já foi encerrado.',
      );
    return { p, d };
  }

  async prepararMeta(s: SessaoGerenciado, id: number, e: RegistrarMetaProtocoloEntrada) {
    await this.exigirAtor(s);
    const { p, d } = await this.aberto(s, id);
    const { agora } = await this.porta.relogio(s.c);
    const meta = e.tipo === 'meta' ? (d.conteudo.metas.find((m) => m.codigo === e.item) ?? null) : null;
    if (e.tipo === 'meta' && !meta)
      throw recusa(422, 'meta-desconhecida', 'Meta', 'A meta não existe nesta versão do protocolo.', [
        'item',
      ]);
    if (e.tipo === 'checklist' && !d.conteudo.checklist.some((x) => x.codigo === e.item))
      throw recusa(422, 'item-desconhecido', 'Checklist', 'O item não existe nesta versão do protocolo.', [
        'item',
      ]);
    const r = decidirRegistroMeta({
      meta,
      feita: e.feita,
      quando: e.quando,
      motivo: e.motivo,
      chegadaEm: p.chegadaEm,
      incluidoEm: p.incluidoEm,
      agora,
    });
    if (!r.ok) throw recusa(422, r.codigo, 'Meta não registrada', r.mensagem, [r.campo]);
    return {
      p,
      situacao: r.situacao,
      linha: {
        protocoloPaciente: p.id,
        tipoEvento: e.tipo,
        codigo: e.item,
        situacao: r.situacao,
        ocorridoEm: e.feita ? comSegundos(e.quando!) : null,
        prazoEm: r.prazoEm,
        motivo: r.situacao === 'perdida' || !e.feita ? (e.motivo ?? null) : null,
        por: s.login,
      },
    };
  }

  async prepararEncerramento(s: SessaoGerenciado, id: number, e: EncerrarProtocoloGerenciadoEntrada) {
    await this.exigirAtor(s);
    const { p, d } = await this.aberto(s, id);
    const semRegistro = d.conteudo.metas.filter(
      (m) => !p.eventos.some((x) => x.tipo === 'meta' && x.codigo === m.codigo),
    ).length;
    const problema = problemaDoEncerramento(e.desfecho, e.motivo, semRegistro);
    if (problema) throw recusa(422, 'motivo-obrigatorio', 'Protocolo não encerrado', problema, ['motivo']);
    return {
      p,
      linha: {
        protocoloPaciente: p.id,
        tipoEvento: 'encerramento' as const,
        codigo: 'encerramento',
        situacao: e.desfecho,
        ocorridoEm: null,
        prazoEm: null,
        motivo: e.motivo ?? null,
        por: s.login,
      },
    };
  }
}

export type GravadorGerenciado = Pick<
  GravadorClassificacao,
  'publicarGerenciado' | 'incluirProtocolo' | 'registrarEventoProtocolo'
>;
