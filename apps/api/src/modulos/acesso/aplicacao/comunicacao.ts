// Comunicação interna do M27 (ficha, seções 4 a 8): a caixa de mensagens e os comunicados, a leitura e a ciência, o
// envio (destinos expandidos no envio, até 2.000 destinatários ativos), os comunicados com vigência (gestor), a central
// de avisos com o canal de tempo real, as mensagens do sistema anterior (consulta) e o dicionário pessoal.
//   - regra 7: o texto e o assunto não levam dado do paciente (o esquema e o servidor recusam CPF, cartão do SUS,
//     número de prontuário ou de atendimento); o paciente entra como o atendimento de contexto, que abre o prontuário
//     pela autorização normal; a trilha leva o evento, o remetente e a contagem, nunca o texto;
//   - regra 8: o aviso é gravado na transação da mensagem e o canal avisa DEPOIS do COMMIT (a gravação que falha não
//     avisa); o canal só diz "mudou" e o cliente relê o estado gravado, então a reconexão não perde aviso;
//   - mensagens com até 200 destinatários geram um aviso para cada um; os comunicados e as listas maiores aparecem só na
//     caixa (o selo da barra soma os avisos novos e as mensagens não lidas; D-AVISO-27).
import {
  type Aviso,
  type CaixaMensagens,
  type CentralAvisos,
  type ComunicadoDetalhe,
  type CorrigirComunicado,
  dadoPessoalNoTexto,
  type DicionarioPessoal,
  type EncerrarComunicado,
  type EnviarMensagem,
  EVENTOS_AUDITAVEIS,
  type MensagemAnterior,
  type MensagemRecebida,
  type NovoAviso,
  type PublicarComunicado,
  TETO_DESTINATARIOS,
  TETO_DICIONARIO,
  type VigenciaComunicado,
} from '@sgh/contratos';
import type { ContextoOperacao, LinhaTrilha } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoComunicacao, PortaComunicacao } from '../comunicacao-porta.js';

/** Quem é avisado a cada mudança (o canal de eventos da central; a chave é o estabelecimento e o login). */
export interface NotificadorAvisos {
  avisar(chave: string): number;
}

export const chaveDoCanal = (hospital: string, login: string) => `${hospital}|${login}`;

/** Mensagens com até este número de destinatários geram um aviso para cada um (D-AVISO-27). */
export const TETO_AVISOS_POR_MENSAGEM = 200;

export const OPERACOES_DICIONARIO = {
  incluir: 'acesso.incluirPalavraDicionario',
  excluir: 'acesso.excluirPalavraDicionario',
} as const;

/** O autor da ação, com a estação e a correlação da requisição (a trilha leva só identificadores). */
export interface AutorComunicacao {
  readonly login: string;
  readonly estacao: string;
  readonly correlacao: string;
}

function linha(
  c: ContextoComunicacao,
  a: AutorComunicacao,
  evento: string,
  operacao: string,
  alvo: { tabela: string; id: string | null; chave: string | null; atendimento?: number | null },
): LinhaTrilha {
  return {
    rede: c.rede,
    hospital: c.hospital,
    usuario: a.login,
    evento,
    recurso: evento.split('.').slice(0, 2).join('.'),
    operacao,
    tabelaAlvo: alvo.tabela,
    idAlvo: alvo.id,
    chaveNaturalAlvo: alvo.chave,
    resultado: 'sucesso',
    estacao: a.estacao.slice(0, 80),
    correlacao: a.correlacao.slice(0, 64),
    atendimento: alvo.atendimento ?? null,
  };
}

export class ServicoComunicacao {
  constructor(
    readonly porta: PortaComunicacao,
    private readonly notificador: NotificadorAvisos | null = null,
  ) {}

  private avisar(c: ContextoComunicacao, logins: readonly string[]): void {
    if (!this.notificador) return;
    for (const l of new Set(logins)) this.notificador.avisar(chaveDoCanal(c.hospital, l));
  }

  // ── Mensagens ─────────────────────────────────────────────────────────────────────────────────────────

  async caixa(c: ContextoComunicacao, login: string): Promise<CaixaMensagens> {
    const [recebidas, enviadas] = await Promise.all([
      this.porta.recebidas(c, login),
      this.porta.enviadas(c, login),
    ]);
    return {
      recebidas: recebidas as MensagemRecebida[],
      enviadas,
      naoLidas: recebidas.filter((m) => m.lidaEm === null).length,
      cienciasPendentes: recebidas.filter((m) => m.cienciaObrigatoria && m.cienciaEm === null).length,
      teto: 100,
    };
  }

  /** Abre a mensagem: a primeira abertura marca a leitura (transação SGH_ com a trilha) e a central relê. */
  async abrir(c: ContextoComunicacao, a: AutorComunicacao, id: number): Promise<MensagemRecebida> {
    const m = await this.porta.recebida(c, a.login, id);
    if (!m) throw new ErroProblema('nao-encontrado', 404, 'Mensagem não encontrada');
    if (m.lidaEm === null) {
      await this.porta.gravarSgh(
        c,
        linha(c, a, EVENTOS_AUDITAVEIS.mensagemLida.codigo, 'acesso.lerMensagem', {
          tabela: 'SGH_ADM_MENSAGEM_DEST',
          id: String(id),
          chave: null,
        }),
        (g) => g.marcarLida({ login: a.login, id }),
      );
      this.avisar(c, [a.login]);
      return (await this.porta.recebida(c, a.login, id)) ?? m;
    }
    return m;
  }

  async ciencia(c: ContextoComunicacao, a: AutorComunicacao, id: number): Promise<MensagemRecebida> {
    const m = await this.porta.recebida(c, a.login, id);
    if (!m) throw new ErroProblema('nao-encontrado', 404, 'Mensagem não encontrada');
    await this.porta.gravarSgh(
      c,
      linha(c, a, EVENTOS_AUDITAVEIS.mensagemCiencia.codigo, 'acesso.darCiencia', {
        tabela: 'SGH_ADM_MENSAGEM_DEST',
        id: String(id),
        chave: null,
      }),
      async (g) => {
        const mudou = await g.registrarCiencia({ login: a.login, id });
        // O aviso da mensagem (se houver) fica resolvido com a ciência.
        const avisos = await this.porta.avisos(c, a.login);
        for (const x of avisos)
          if (x.link === `/mensagens?id=${id}` && x.estado !== 'resolvido')
            await g.mudarEstadoAviso({ login: a.login, id: x.id, estado: 'resolvido' });
        return mudou;
      },
    );
    this.avisar(c, [a.login]);
    return (await this.porta.recebida(c, a.login, id)) ?? m;
  }

  private recusarDadoPessoal(assunto: string, texto: string): void {
    const m = dadoPessoalNoTexto(assunto) ?? dadoPessoalNoTexto(texto);
    if (m)
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Mensagem com dado do paciente',
        `O texto parece ter ${m}. Não escreva dado do paciente na mensagem: use o campo "Paciente (contexto)".`,
        { codigo: 'dado-do-paciente', campos: ['texto'] },
      );
  }

  private async destinatarios(c: ContextoComunicacao, destinos: EnviarMensagem['destinos']) {
    const r = await this.porta.destinatarios(c, destinos, TETO_DESTINATARIOS);
    if (r.passou)
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Destinatários demais',
        `A mensagem passa de ${TETO_DESTINATARIOS} destinatários: escolha grupos, setores ou unidades menores.`,
        { codigo: 'destinatarios-demais', campos: ['destinos'] },
      );
    if (r.desconhecidos.length > 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Destino sem usuário ativo',
        `Nenhum usuário ativo em: ${r.desconhecidos.join(', ')}.`,
        { codigo: 'destino-sem-usuario', campos: ['destinos'] },
      );
    return r.destinatarios;
  }

  /**
   * O atendimento de contexto (revisão do M27, regra 7): só quem pode abrir o prontuário põe um paciente como contexto,
   * e o atendimento tem de existir neste estabelecimento; senão a mensagem é recusada antes de gravar (o número não
   * vira um meio de descobrir de quem é cada atendimento).
   */
  private async conferirContexto(
    c: ContextoComunicacao,
    atendimento: number,
    acesso: { readonly podeLerProntuario: boolean },
  ): Promise<void> {
    if (!acesso.podeLerProntuario)
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Paciente (contexto) não permitido',
        'Você não tem acesso ao prontuário: envie a mensagem sem o paciente de contexto.',
        { codigo: 'contexto-sem-acesso', campos: ['contextoAtendimento'] },
      );
    if (!(await this.porta.atendimentoDoContexto(c, atendimento)))
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Atendimento não encontrado',
        'O número do atendimento não existe neste estabelecimento: confira o número.',
        { codigo: 'contexto-invalido', campos: ['contextoAtendimento'] },
      );
  }

  async enviar(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    e: EnviarMensagem,
    idempotencia: string,
    acesso: { readonly podeLerProntuario: boolean } = { podeLerProntuario: false },
  ): Promise<{ id: number; destinatarios: number; repetida: boolean }> {
    this.recusarDadoPessoal(e.assunto, e.texto);
    if (e.contextoAtendimento !== null) await this.conferirContexto(c, e.contextoAtendimento, acesso);
    const dest = await this.destinatarios(c, e.destinos);
    const resumo = e.destinos.map((d) => `${d.tipo} ${d.valor}`).join('; ');
    const r = await this.porta.gravarSgh(
      c,
      (x: { id: number }) =>
        linha(c, a, EVENTOS_AUDITAVEIS.mensagemEnviada.codigo, 'acesso.enviarMensagem', {
          tabela: 'SGH_ADM_MENSAGEM',
          id: String(x.id),
          chave: `destinatarios:${dest.length};ciencia:${e.cienciaObrigatoria ? 'T' : 'F'}`,
          atendimento: e.contextoAtendimento,
        }),
      async (g) => {
        const m = await g.gravarMensagem({
          tipo: 'mensagem',
          remetente: a.login,
          assunto: e.assunto,
          texto: e.texto,
          cienciaObrigatoria: e.cienciaObrigatoria,
          atendimento: e.contextoAtendimento,
          vigenciaInicio: null,
          vigenciaFim: null,
          destinos: resumo,
          idempotencia,
          destinatarios: dest,
        });
        if (!m.repetida && dest.length <= TETO_AVISOS_POR_MENSAGEM)
          for (const d of dest)
            await g.gravarAviso({
              login: d.login,
              tipo: e.cienciaObrigatoria ? 'ciencia-pendente' : 'mensagem',
              gravidade: e.cienciaObrigatoria ? 'atencao' : 'informacao',
              modulo: 'acesso',
              evento: EVENTOS_AUDITAVEIS.mensagemEnviada.codigo,
              titulo: e.cienciaObrigatoria
                ? `Mensagem de ${a.login} pede a sua ciência`
                : `Nova mensagem de ${a.login}`,
              link: `/mensagens?id=${m.id}`,
              objetoTabela: 'SGH_ADM_MENSAGEM',
              objetoChave: String(m.id),
            });
        return m;
      },
    );
    // Depois do COMMIT (gravarSgh resolvido): o canal avisa; o cliente relê.
    if (!r.repetida)
      this.avisar(
        c,
        dest.map((d) => d.login),
      );
    return { id: r.id, destinatarios: dest.length, repetida: r.repetida };
  }

  async publicar(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    e: PublicarComunicado,
    idempotencia: string,
  ): Promise<{ id: number; destinatarios: number; repetida: boolean }> {
    this.recusarDadoPessoal(e.assunto, e.texto);
    const dest = await this.destinatarios(c, e.destinos);
    const r = await this.porta.gravarSgh(
      c,
      (x: { id: number }) =>
        linha(c, a, EVENTOS_AUDITAVEIS.comunicadoPublicado.codigo, 'acesso.publicarComunicado', {
          tabela: 'SGH_ADM_MENSAGEM',
          id: String(x.id),
          chave: `destinatarios:${dest.length};ciencia:${e.cienciaObrigatoria ? 'T' : 'F'}`,
        }),
      (g) =>
        g.gravarMensagem({
          tipo: 'comunicado',
          remetente: a.login,
          assunto: e.assunto,
          texto: e.texto,
          cienciaObrigatoria: e.cienciaObrigatoria,
          atendimento: null,
          vigenciaInicio: e.vigenciaInicio,
          vigenciaFim: e.vigenciaFim,
          destinos: e.destinos.map((d) => `${d.tipo} ${d.valor}`).join('; '),
          idempotencia,
          destinatarios: dest,
        }),
    );
    if (!r.repetida)
      this.avisar(
        c,
        dest.map((d) => d.login),
      );
    return { id: r.id, destinatarios: dest.length, repetida: r.repetida };
  }

  // ── W0-09: o ciclo de vida do comunicado ──────────────────────────────────────────────────────────────

  /** O comunicado por inteiro (texto, vigência, ciências e eventos); 404 se não existe neste estabelecimento. */
  async comunicado(c: ContextoComunicacao, id: number): Promise<ComunicadoDetalhe> {
    const m = await this.porta.comunicado(c, id);
    if (!m) throw new ErroProblema('nao-encontrado', 404, 'Comunicado não encontrado');
    const lido = m.destinatarios.some((d) => d.lidaEm !== null || d.cienciaEm !== null);
    return { ...m, podeCorrigir: m.encerradoEm === null && !lido };
  }

  private async mudarComunicado(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    id: number,
    ev: { evento: string; operacao: string; chave: string },
    fn: (g: Parameters<Parameters<PortaComunicacao['gravarSgh']>[2]>[0]) => Promise<void>,
  ): Promise<ComunicadoDetalhe> {
    const antes = await this.comunicado(c, id);
    await this.porta.gravarSgh(
      c,
      linha(c, a, ev.evento, ev.operacao, { tabela: 'SGH_ADM_MENSAGEM', id: String(id), chave: ev.chave }),
      fn,
    );
    // Os destinatários releem a caixa (o encerrado some de quem não leu; o corrigido aparece com o texto novo).
    this.avisar(
      c,
      antes.destinatarios.map((d) => d.login),
    );
    return this.comunicado(c, id);
  }

  /** Corrige o texto que ninguém leu ainda; lido ou com ciência: 409 (encerre e publique outro). */
  async corrigirComunicado(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    id: number,
    e: CorrigirComunicado,
  ): Promise<ComunicadoDetalhe> {
    this.recusarDadoPessoal(e.assunto, e.texto);
    return this.mudarComunicado(
      c,
      a,
      id,
      {
        evento: EVENTOS_AUDITAVEIS.comunicadoCorrigido.codigo,
        operacao: 'acesso.corrigirComunicado',
        chave: 'correcao',
      },
      (g) => g.corrigirComunicado({ id, assunto: e.assunto, texto: e.texto, motivo: e.motivo, por: a.login }),
    );
  }

  /** Encurta a vigência (nunca estende), com motivo. */
  async encurtarVigencia(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    id: number,
    e: VigenciaComunicado,
  ): Promise<ComunicadoDetalhe> {
    return this.mudarComunicado(
      c,
      a,
      id,
      {
        evento: EVENTOS_AUDITAVEIS.comunicadoVigenciaEncurtada.codigo,
        operacao: 'acesso.encurtarVigenciaComunicado',
        chave: `vigenciaFim:${e.vigenciaFim.slice(0, 16)}`,
      },
      (g) => g.encurtarVigencia({ id, vigenciaFim: e.vigenciaFim, motivo: e.motivo, por: a.login }),
    );
  }

  /** Encerra com motivo: sai do ar; o comunicado e as ciências continuam visíveis. */
  async encerrarComunicado(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    id: number,
    e: EncerrarComunicado,
  ): Promise<ComunicadoDetalhe> {
    return this.mudarComunicado(
      c,
      a,
      id,
      {
        evento: EVENTOS_AUDITAVEIS.comunicadoEncerrado.codigo,
        operacao: 'acesso.encerrarComunicado',
        chave: 'encerramento',
      },
      (g) => g.encerrarComunicado({ id, motivo: e.motivo, por: a.login }),
    );
  }

  async anteriores(c: ContextoComunicacao, login: string): Promise<MensagemAnterior[]> {
    return this.porta.anteriores(c, login);
  }

  // ── Central de avisos ─────────────────────────────────────────────────────────────────────────────────

  async avisos(c: ContextoComunicacao, login: string, versao: number): Promise<CentralAvisos> {
    const lidos = await this.porta.avisos(c, login);
    const avisos: Aviso[] = lidos.map((x) => ({
      id: x.id,
      tipo: x.tipo,
      gravidade: x.gravidade,
      modulo: x.modulo,
      titulo: x.titulo,
      link: x.link,
      estado: x.estado,
      criadoEm: x.criadoEm,
    }));
    return { avisos, novos: avisos.filter((x) => x.estado === 'novo').length, versao };
  }

  async mudarAviso(
    c: ContextoComunicacao,
    a: AutorComunicacao,
    id: number,
    estado: 'lido' | 'resolvido',
  ): Promise<boolean> {
    const mudou = await this.porta.gravarSgh(
      c,
      linha(c, a, EVENTOS_AUDITAVEIS.avisoResolvido.codigo, `acesso.marcarAviso:${estado}`, {
        tabela: 'SGH_ADM_AVISO',
        id: String(id),
        chave: `estado:${estado}`,
      }),
      (g) => g.mudarEstadoAviso({ login: a.login, id, estado }),
    );
    if (mudou) this.avisar(c, [a.login]);
    return mudou;
  }

  /**
   * Um módulo avisa um usuário (público: `CentralAvisos.emitir`): o aviso é gravado (sem repetir o mesmo evento e objeto)
   * e o canal avisa depois do COMMIT. Só a gravidade "grave" interrompe a tela (regra 6).
   */
  async emitir(c: ContextoComunicacao, a: AutorComunicacao, novo: NovoAviso): Promise<number | null> {
    const id = await this.porta.gravarSgh(
      c,
      (x: number | null) =>
        linha(c, a, EVENTOS_AUDITAVEIS.avisoEmitido.codigo, 'acesso.emitirAviso', {
          tabela: 'SGH_ADM_AVISO',
          id: x === null ? null : String(x),
          chave: `${novo.modulo}:${novo.evento}`.slice(0, 80),
        }),
      (g) => g.gravarAviso(novo),
    );
    if (id !== null) this.avisar(c, [novo.login]);
    return id;
  }

  // ── Dicionário pessoal ───────────────────────────────────────────────────────────────────────────────

  async dicionario(c: ContextoComunicacao, login: string): Promise<DicionarioPessoal> {
    const [palavras, inc, exc] = await Promise.all([
      this.porta.dicionario(c, login),
      this.porta.podeGravar(c, OPERACOES_DICIONARIO.incluir, login),
      this.porta.podeGravar(c, OPERACOES_DICIONARIO.excluir, login),
    ]);
    return {
      palavras,
      teto: TETO_DICIONARIO,
      gravacao: { incluir: inc.pode ? null : inc.motivo, excluir: exc.pode ? null : exc.motivo },
    };
  }

  async gravarPalavra(
    c: ContextoComunicacao,
    acao: 'incluir' | 'excluir',
    palavra: string,
    octx: ContextoOperacao,
  ): Promise<{ repetida: boolean }> {
    const op = OPERACOES_DICIONARIO[acao];
    const l = await this.porta.podeGravar(c, op, octx.usuarioLegado);
    if (!l.pode)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Gravação desligada',
        l.motivo ?? 'A gravação do dicionário está desligada neste estabelecimento.',
        { codigo: l.codigo ?? 'operacao-desligada' },
      );
    const r = await this.porta.executar(c, op, { palavra }, octx);
    return { repetida: r.repetida };
  }
}
