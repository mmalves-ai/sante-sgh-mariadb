// Serviço dos treinamentos e da ciência de POP, fatia F6 (M52.6; ficha, seções 6 a 8, regra 20; RDC63-05, NR32-04): a
// situação dos colaboradores ativos nos cursos obrigatórios, o catálogo de cursos, as turmas com a lista de presença, as
// versões de POP com a adesão e a ciência do próprio colaborador. Toda gravação confere a chave `pessoas.treinamento`, a
// permissão e o estabelecimento da sessão e vai numa transação só SGH_ com a trilha. As regras ficam em
// @sgh/dominio-pessoas.
import {
  type AlterarCursoEntrada,
  type AlterarTurmaEntrada,
  type CorrigirParticipacaoEntrada,
  type RetirarInscricaoEntrada,
  type AlvoCursoEntrada,
  type AlvoCursoResposta,
  type ApoioTreinamento,
  type CancelarTurmaEntrada,
  type CategoriaCurso,
  CHAVE_PESSOAS_TREINAMENTO,
  type CienciaPopEntrada,
  type CursoDoColaborador,
  type CursoEntrada,
  type CursoResposta,
  type EncerrarTurmaEntrada,
  EVENTOS_AUDITAVEIS,
  type FichaTreinamento,
  type FiltroSituacaoTreinamentoEntrada,
  type FiltroTurmasEntrada,
  type InscricaoEntrada,
  type LinhaSituacaoTreinamento,
  type ListaCursos,
  type ListaPops,
  type ListaTurmas,
  type ModalidadeTurma,
  PARAMETRO_ALERTA_TREINAMENTO,
  type PainelTreinamento,
  type ParticipacaoEntrada,
  type ParticipanteResposta,
  type PendenciaCursoResposta,
  type PopDetalhe,
  type PopResposta,
  type ResultadoF6,
  type RevogarPopEntrada,
  type TurmaEntrada,
  type TurmaResposta,
  type TurmaResumo,
  type VersaoPopEntrada,
} from '@sgh/contratos';
import {
  ALERTA_TREINAMENTO_DIAS,
  adesaoPop,
  chaveFuncao,
  conferirCienciaPop,
  conferirCurso,
  conferirEncerramentoTurma,
  conferirParticipacao,
  conferirRevogacaoPop,
  conferirTurma,
  conferirVersaoPop,
  cursoAlcanca,
  pendenciasTreinamento,
  popAlcanca,
  popsPendentes,
  proximaVersaoPop,
  type RecusaSesmt,
  situacaoCurso,
  validadeAte,
  vigenteDoCodigo,
} from '@sgh/dominio-pessoas';
import type { CursoPesLido, PopPesLido, TurmaPesLida, VinculoAtivoTreinamento } from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { GravadorTreinamento, PortaTreinamento } from './porta-treinamento.js';

const E = EVENTOS_AUDITAVEIS;
export const PERMISSOES_TREINAMENTO = {
  ler: 'pessoas.treinamento.ler',
  registrar: 'pessoas.treinamento.registrar',
  ciencia: 'pessoas.pop.ciencia',
} as const;
const P = PERMISSOES_TREINAMENTO;

const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusar = (r: RecusaSesmt) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', r.mensagem, {
    codigo: r.codigo,
    ...(r.campo ? { campos: [r.campo] } : {}),
  });
const recusaRegra = (codigo: string, mensagem: string, campo: string | null = null) =>
  recusar({ codigo, mensagem, campo });

/** Sessão "como" (ADR 0021): a ciência do POP é ato pessoal (D-COMO-526). */
export const MOTIVO_SESSAO_COMO_POP =
  'Na sessão de suporte não se registra a ciência de POP: o colaborador entra com a própria conta.';
const emComo = (s: SessaoCadastro): boolean => !!s.req?.sghComo;

const minutosEmTexto = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
};
export { minutosEmTexto };

export class ServicoTreinamento {
  readonly apoio: ApoioGravacao<GravadorTreinamento>;

  constructor(
    readonly porta: PortaTreinamento,
    readonly pessoas: PortaPessoas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorTreinamento>(
      { chave: CHAVE_PESSOAS_TREINAMENTO, nome: 'os treinamentos', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio ───────────────────────────────────────────────────────────────────────────────────────────────────

  async alertaDias(s: SessaoCadastro): Promise<number> {
    const v = await this.apoio.parametro(s, PARAMETRO_ALERTA_TREINAMENTO).catch(() => 0);
    return v > 0 ? v : ALERTA_TREINAMENTO_DIAS;
  }

  private async nomesUnidades(s: SessaoCadastro): Promise<Map<number, string>> {
    return new Map((await this.pessoas.unidades(s.porta)).map((u) => [u.codigo, u.nome]));
  }

  async apoioTela(s: SessaoCadastro): Promise<ApoioTreinamento> {
    const [relogio, unidades, alertaDias, gravacao] = await Promise.all([
      this.porta.relogio(s.porta),
      this.pessoas.unidades(s.porta),
      this.alertaDias(s),
      this.apoio.gravacao(s, { registrar: P.registrar }),
    ]);
    const op = gravacao.operacoes['registrar'];
    return {
      hoje: relogio.hoje,
      gravacao: { ligada: gravacao.ligada, motivo: gravacao.motivo },
      acoes: { registrar: op?.pode ?? false, motivo: op && !op.pode ? (op.motivo ?? null) : null },
      unidades: unidades.map((u) => ({ codigo: u.codigo, rotulo: u.nome })),
      alertaDias,
    };
  }

  private exigirRegistrar(s: SessaoCadastro): void {
    if (!s.pode(P.registrar))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
  }

  // ── Cursos ──────────────────────────────────────────────────────────────────────────────────────────────────

  private alvosResposta(c: CursoPesLido, unidades: Map<number, string>): AlvoCursoResposta[] {
    return c.alvos.map((a) => ({
      tipo: a.tipo,
      valor: a.valor,
      rotulo: a.tipo === 'unidade' ? (unidades.get(Number(a.valor)) ?? `Unidade ${a.valor}`) : a.valor,
    }));
  }

  private cursoResposta(c: CursoPesLido, unidades: Map<number, string>): CursoResposta {
    return {
      id: c.id,
      codigo: c.codigo,
      titulo: c.titulo,
      conteudo: c.conteudo,
      categoria: c.categoria as CategoriaCurso,
      cargaMinimaMin: c.cargaMinimaMin,
      validadeMeses: c.validadeMeses,
      obrigatorio: c.obrigatorio,
      ativo: c.ativo,
      alvos: this.alvosResposta(c, unidades),
      versao: c.versao,
    };
  }

  async cursos(s: SessaoCadastro): Promise<ListaCursos> {
    const [cs, unidades] = await Promise.all([this.porta.cursos(s.porta), this.nomesUnidades(s)]);
    return { itens: cs.map((c) => this.cursoResposta(c, unidades)) };
  }

  /** Os alvos normalizados: a unidade pelo código (tem de existir); a função pela chave (sem acento, maiúsculas). */
  private async alvos(s: SessaoCadastro, xs: readonly AlvoCursoEntrada[]) {
    const unidades = await this.nomesUnidades(s);
    return xs.map((a) => {
      if (a.tipo === 'unidade') {
        const cod = Number(a.valor);
        if (!Number.isInteger(cod) || !unidades.has(cod))
          throw recusaRegra(
            'unidade-inexistente',
            `A unidade ${a.valor} não existe neste estabelecimento.`,
            'alvos',
          );
        return { tipo: 'unidade' as const, valor: String(cod) };
      }
      return { tipo: 'funcao' as const, valor: chaveFuncao(a.valor) };
    });
  }

  async incluirCurso(s: SessaoCadastro, e: CursoEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const alvos = await this.alvos(s, e.alvos);
    const r = conferirCurso({ ...e, alvos });
    if (r) throw recusar(r);
    const x = await this.apoio.sgh(
      s,
      E.pessoasCursoGravado.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      (y: { id: number }) => ({ tabela: 'SGH_PES_CURSO', id: String(y.id) }),
      async (g) => ({ id: await g.incluirCurso({ ...e, alvos, por: s.login }) }),
    );
    return { id: x.id, mensagem: 'Curso incluído no catálogo.' };
  }

  async alterarCurso(s: SessaoCadastro, e: AlterarCursoEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const alvos = await this.alvos(s, e.alvos);
    const r = conferirCurso({ ...e, alvos });
    if (r) throw recusar(r);
    await this.apoio.sgh(
      s,
      E.pessoasCursoGravado.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_CURSO', id: String(e.curso) },
      async (g) => {
        if (!(await g.curso(e.curso))) throw naoEncontrado('Curso');
        await g.alterarCurso({ ...e, id: e.curso, alvos, por: s.login });
      },
    );
    return { id: e.curso, mensagem: e.ativo ? 'Curso alterado.' : 'Curso inativado (o histórico continua).' };
  }

  // ── Turmas e lista de presença ──────────────────────────────────────────────────────────────────────────────

  private turmaResumo(t: TurmaPesLida, cursos: Map<number, CursoPesLido>): TurmaResumo {
    const c = cursos.get(t.curso);
    return {
      id: t.id,
      curso: t.curso,
      cursoCodigo: c?.codigo ?? '',
      cursoTitulo: c?.titulo ?? '',
      inicio: t.inicio,
      fim: t.fim,
      cargaMin: t.cargaMin,
      instrutor: t.instrutor,
      modalidade: t.modalidade as ModalidadeTurma,
      situacao: t.situacao,
      participantes: t.participantes,
      concluintes: t.concluintes,
    };
  }

  private async mapaCursos(s: SessaoCadastro): Promise<Map<number, CursoPesLido>> {
    return new Map((await this.porta.cursos(s.porta)).map((c) => [c.id, c]));
  }

  async turmas(s: SessaoCadastro, f: FiltroTurmasEntrada): Promise<ListaTurmas> {
    const [ts, cursos] = await Promise.all([
      this.porta.turmas(s.porta, {
        ...(f.situacao !== 'todas' ? { situacao: f.situacao } : {}),
        ...(f.curso ? { curso: f.curso } : {}),
        ...(f.de ? { de: f.de } : {}),
        ...(f.ate ? { ate: f.ate } : {}),
      }),
      this.mapaCursos(s),
    ]);
    const TETO = 500;
    return { itens: ts.slice(0, TETO).map((t) => this.turmaResumo(t, cursos)), limitado: ts.length > TETO };
  }

  private async turmaOu404(s: SessaoCadastro, id: number): Promise<TurmaPesLida> {
    const t = await this.porta.turma(s.porta, id);
    if (!t) throw naoEncontrado('Turma');
    return t;
  }

  async turma(s: SessaoCadastro, id: number): Promise<TurmaResposta> {
    const t = await this.turmaOu404(s, id);
    const [cursos, lista, unidades, gravacao] = await Promise.all([
      this.mapaCursos(s),
      this.porta.participantes(s.porta, id),
      this.nomesUnidades(s),
      this.apoio.gravacao(s, { registrar: P.registrar }),
    ]);
    const [vs, pop, corrTurma, corrLista] = await Promise.all([
      this.porta.vinculos(
        s.porta,
        lista.map((p) => p.vinculo),
      ),
      t.pop !== null ? this.porta.pop(s.porta, t.pop) : Promise.resolve(null),
      this.porta.correcoes(s.porta, 'SGH_PES_TREINAMENTO', [t.id]),
      this.porta.correcoes(
        s.porta,
        'SGH_PES_TREIN_PARTICIPANTE',
        lista.map((p) => p.id),
      ),
    ]);
    const nomes = new Map(vs.map((v) => [v.id, v]));
    const curso = cursos.get(t.curso);
    const pode = gravacao.operacoes['registrar']?.pode ?? false;
    const aberta = t.situacao === 'aberta';
    const participantes: ParticipanteResposta[] = lista
      .map((p) => {
        const v = nomes.get(p.vinculo);
        return {
          vinculo: p.vinculo,
          nome: v?.nome ?? `Vínculo ${p.vinculo}`,
          matricula: v?.matricula ?? null,
          unidadeNome:
            v?.unidade !== null && v?.unidade !== undefined ? (unidades.get(v.unidade) ?? null) : null,
          presenca: p.presenca,
          aproveitamento: p.aproveitamento,
          conclusao: p.conclusao,
          validoAte: p.validoAte,
          observacao: p.observacao,
          versao: p.versao,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const motivo = !gravacao.ligada
      ? gravacao.motivo
      : !pode
        ? (gravacao.operacoes['registrar']?.motivo ?? null)
        : !aberta
          ? t.situacao === 'encerrada'
            ? 'A turma está encerrada: a lista de presença não muda mais.'
            : 'A turma foi cancelada.'
          : null;
    return {
      ...this.turmaResumo(t, cursos),
      local: t.local,
      observacao: t.observacao,
      cursoConteudo: curso?.conteudo ?? '',
      validadeMeses: curso?.validadeMeses ?? 0,
      pop: pop ? { id: pop.id, codigo: pop.codigo, versao: pop.versao, titulo: pop.titulo } : null,
      motivoCancelamento: t.situacao === 'cancelada' ? t.motivo : null,
      versao: t.versao,
      lista: participantes,
      acoes: {
        inscrever: pode && aberta,
        registrar: pode && aberta,
        encerrar: pode && aberta && lista.length > 0,
        cancelar: pode && aberta,
        alterar: pode && aberta,
        retirar: pode && aberta,
        corrigir: pode && t.situacao !== 'cancelada',
        motivo,
      },
      correcoes: [...corrTurma, ...corrLista]
        .sort((a, b) => b.id - a.id)
        .map((c) => ({
          id: c.id,
          operacao: c.operacao,
          registro: c.registro,
          antes: c.antes,
          depois: c.depois,
          motivo: c.motivo,
          por: c.por,
          em: c.em,
        })),
    };
  }

  /**
   * W0-06: alteração da turma ABERTA com o motivo (o valor anterior vai à trilha da gestão de pessoas). A troca do POP
   * só sem conclusão registrada (a conclusão já deu a ciência da versão antiga); o novo início não passa de nenhuma
   * conclusão lançada.
   */
  async alterarTurma(s: SessaoCadastro, e: AlterarTurmaEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const { hoje } = await this.porta.relogio(s.porta);
    await this.apoio.sgh(
      s,
      E.pessoasTurmaAlterada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_TREINAMENTO', id: String(e.treinamento) },
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        if (t.situacao !== 'aberta')
          throw recusaRegra(
            'turma-encerrada',
            'Só a turma aberta se altera: a encerrada tem a lista fechada e a cancelada fica como está.',
            'treinamento',
          );
        const curso = await g.curso(t.curso);
        if (!curso) throw naoEncontrado('Curso');
        const r = conferirTurma(e, curso, hoje);
        if (r) throw recusar(r);
        if (e.pop !== t.pop) {
          if (t.concluintes > 0)
            throw recusaRegra(
              'pop-com-conclusao',
              'A turma já tem conclusões, que deram ciência da versão do POP atual: mantenha o POP ou abra outra turma.',
              'pop',
            );
          if (e.pop !== null) {
            const p = await g.pop(e.pop);
            if (!p) throw naoEncontrado('POP');
            if (p.situacao !== 'vigente')
              throw recusaRegra('versao-nao-vigente', 'A turma trabalha a versão vigente do POP.', 'pop');
          }
        }
        const ps = await g.participantes(t.id);
        if (ps.some((p) => p.conclusao !== null && (p.conclusao < e.inicio || p.conclusao > e.fim)))
          throw recusaRegra(
            'conclusao-fora-do-periodo',
            'Há conclusão lançada fora do novo período: corrija a presença antes.',
            'inicio',
          );
        const antes = {
          inicio: t.inicio,
          fim: t.fim,
          cargaMin: t.cargaMin,
          instrutor: t.instrutor,
          modalidade: t.modalidade,
          local: t.local,
          pop: t.pop,
          observacao: t.observacao,
        };
        const depois = {
          inicio: e.inicio,
          fim: e.fim,
          cargaMin: e.cargaMin,
          instrutor: e.instrutor.trim(),
          modalidade: e.modalidade,
          local: e.local,
          pop: e.pop,
          observacao: e.observacao,
        };
        await g.alterarTurma({ id: t.id, versao: e.versao, ...depois, por: s.login });
        await g.registrarCorrecao({
          tabela: 'SGH_PES_TREINAMENTO',
          registro: t.id,
          operacao: 'pessoas.turma.alterada',
          antes,
          depois,
          motivo: e.motivo.trim(),
          por: s.login,
        });
      },
    );
    return { id: e.treinamento, mensagem: 'Turma alterada: o valor anterior fica no histórico da turma.' };
  }

  /**
   * W0-06: retirada da inscrição feita por engano, só na turma aberta e sem presença lançada (D-CRUD-ORFAOS): com
   * presença ou ciência pela turma, 409 `inscricao-com-presenca`, que oferece a correção da presença. Sem vínculo, o
   * retrato da linha vai à SGH_HIST_EXCLUSAO antes do DELETE (D-CRUD-SNAP).
   */
  async retirarInscricao(s: SessaoCadastro, e: RetirarInscricaoEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    await this.apoio.sgh(
      s,
      E.pessoasInscricaoRetirada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_TREIN_PARTICIPANTE', id: String(e.treinamento) },
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        if (t.situacao !== 'aberta')
          throw recusaRegra(
            'turma-encerrada',
            'A turma não está aberta: a lista não muda mais. Corrija a presença, se for o caso.',
            'treinamento',
          );
        const p = (await g.participantes(t.id)).find((x) => x.vinculo === e.vinculo);
        if (!p) throw recusaRegra('nao-inscrito', 'O colaborador não está inscrito nesta turma.', 'vinculo');
        const recusaPresenca = () =>
          new ErroProblema(
            'recusa-de-negocio',
            409,
            'Inscrição com presença lançada',
            'A inscrição já tem presença lançada e não se retira: corrija a presença e o aproveitamento, com o motivo.',
            {
              codigo: 'inscricao-com-presenca',
              campos: ['presenca'],
              bloqueios: ['Presença lançada: 1'],
              avisos: ['Correção da presença'],
            },
          );
        if (p.presenca !== 'inscrito' || p.aproveitamento !== null) throw recusaPresenca();
        const ok = await g.retirarInscricao({
          id: p.id,
          versao: e.versao,
          motivo: e.motivo.trim(),
          por: s.login,
        });
        if (!ok) throw recusaPresenca();
      },
    );
    return { id: e.treinamento, mensagem: 'Inscrição retirada: o registro anterior fica guardado.' };
  }

  /**
   * W0-06: correção da presença e do aproveitamento já lançados, com o motivo, também na turma encerrada (a turma
   * cancelada não tem lista). O valor anterior vai à trilha. A ciência do POP já registrada pela conclusão não se
   * apaga (é só de inclusão): a correção que tira a conclusão fica registrada com ela.
   */
  async corrigirParticipacao(s: SessaoCadastro, e: CorrigirParticipacaoEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const { hoje } = await this.porta.relogio(s.porta);
    const [v] = await this.porta.vinculos(s.porta, [e.vinculo]);
    if (!v) throw naoEncontrado('Colaborador');
    const r = await this.apoio.sgh(
      s,
      E.pessoasParticipacaoCorrigida.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      (y: { id: number }) => ({ tabela: 'SGH_PES_TREIN_PARTICIPANTE', id: String(y.id) }),
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        if (t.situacao === 'cancelada')
          throw recusaRegra(
            'turma-cancelada',
            'A turma foi cancelada: não há lista a corrigir.',
            'treinamento',
          );
        const p = (await g.participantes(t.id)).find((x) => x.vinculo === e.vinculo);
        if (!p) throw recusaRegra('nao-inscrito', 'O colaborador não está inscrito nesta turma.', 'vinculo');
        if (p.presenca === 'inscrito' && p.aproveitamento === null)
          throw recusaRegra(
            'sem-presenca',
            'A presença ainda não foi lançada: registre a participação (não há o que corrigir).',
            'presenca',
          );
        // A regra da participação vale igual; a turma encerrada aceita a correção (só ela, com motivo).
        const recusa = conferirParticipacao(e, { ...t, situacao: 'aberta' }, v, hoje);
        if (recusa) throw recusar(recusa);
        const curso = await g.curso(t.curso);
        const conclui =
          e.presenca === 'presente' &&
          e.conclusao !== null &&
          (e.aproveitamento === 'aprovado' || e.aproveitamento === 'sem-avaliacao');
        const depois = {
          presenca: e.presenca,
          aproveitamento: e.aproveitamento,
          conclusao: e.conclusao,
          validoAte: conclui && e.conclusao ? validadeAte(e.conclusao, curso?.validadeMeses ?? 0) : null,
          observacao: e.observacao,
        };
        // O valor anterior é copiado antes da gravação (a releitura pode ser a mesma referência).
        const antes = {
          presenca: p.presenca,
          aproveitamento: p.aproveitamento,
          conclusao: p.conclusao,
          validoAte: p.validoAte,
          observacao: p.observacao,
        };
        await g.registrarParticipacao({ id: p.id, versao: e.versao, ...depois, por: s.login });
        await g.registrarCorrecao({
          tabela: 'SGH_PES_TREIN_PARTICIPANTE',
          registro: p.id,
          operacao: 'pessoas.participacao.corrigida',
          antes,
          depois,
          motivo: e.motivo.trim(),
          por: s.login,
        });
        return { id: p.id };
      },
    );
    return { id: r.id, mensagem: 'Participação corrigida: o valor anterior fica no histórico da turma.' };
  }

  async abrirTurma(s: SessaoCadastro, e: TurmaEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const { hoje } = await this.porta.relogio(s.porta);
    const x = await this.apoio.sgh(
      s,
      E.pessoasTurmaGravada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      (y: { id: number }) => ({ tabela: 'SGH_PES_TREINAMENTO', id: String(y.id) }),
      async (g) => {
        const curso = await g.curso(e.curso);
        if (!curso) throw naoEncontrado('Curso');
        const r = conferirTurma(e, curso, hoje);
        if (r) throw recusar(r);
        if (e.pop !== null) {
          const p = await g.pop(e.pop);
          if (!p) throw naoEncontrado('POP');
          if (p.situacao !== 'vigente')
            throw recusaRegra('versao-nao-vigente', 'A turma trabalha a versão vigente do POP.', 'pop');
        }
        const id = await g.incluirTurma({
          curso: e.curso,
          inicio: e.inicio,
          fim: e.fim,
          cargaMin: e.cargaMin,
          instrutor: e.instrutor,
          modalidade: e.modalidade,
          local: e.local,
          pop: e.pop,
          observacao: e.observacao,
          por: s.login,
        });
        return { id };
      },
    );
    return { id: x.id, mensagem: 'Turma aberta: inscreva os participantes.' };
  }

  async inscrever(s: SessaoCadastro, e: InscricaoEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const vs = await this.porta.vinculos(s.porta, e.vinculos);
    if (vs.length !== e.vinculos.length) throw naoEncontrado('Colaborador');
    await this.apoio.sgh(
      s,
      E.pessoasTurmaGravada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_TREIN_PARTICIPANTE', id: String(e.treinamento) },
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        if (t.situacao !== 'aberta')
          throw recusaRegra(
            'turma-encerrada',
            'A turma não está aberta: não recebe inscrição.',
            'treinamento',
          );
        for (const v of vs) {
          if (v.desligamento !== null && v.desligamento < t.inicio)
            throw recusaRegra(
              'colaborador-desligado',
              `${v.nome} foi desligado antes do início da turma.`,
              'vinculos',
            );
          await g.incluirParticipante({ treinamento: t.id, vinculo: v.id, por: s.login });
        }
      },
    );
    return {
      id: e.treinamento,
      mensagem:
        e.vinculos.length === 1 ? 'Colaborador inscrito.' : `${e.vinculos.length} colaboradores inscritos.`,
    };
  }

  async registrarParticipacao(s: SessaoCadastro, e: ParticipacaoEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const { hoje } = await this.porta.relogio(s.porta);
    const [v] = await this.porta.vinculos(s.porta, [e.vinculo]);
    if (!v) throw naoEncontrado('Colaborador');
    const r = await this.apoio.sgh(
      s,
      E.pessoasParticipacaoRegistrada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      (y: { id: number }) => ({ tabela: 'SGH_PES_TREIN_PARTICIPANTE', id: String(y.id) }),
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        const p = (await g.participantes(t.id)).find((x) => x.vinculo === e.vinculo);
        if (!p) throw recusaRegra('nao-inscrito', 'O colaborador não está inscrito nesta turma.', 'vinculo');
        const recusa = conferirParticipacao(e, t, v, hoje);
        if (recusa) throw recusar(recusa);
        const curso = await g.curso(t.curso);
        const conclui =
          e.presenca === 'presente' &&
          e.conclusao !== null &&
          (e.aproveitamento === 'aprovado' || e.aproveitamento === 'sem-avaliacao');
        await g.registrarParticipacao({
          id: p.id,
          versao: e.versao,
          presenca: e.presenca,
          aproveitamento: e.aproveitamento,
          conclusao: e.conclusao,
          validoAte: conclui && e.conclusao ? validadeAte(e.conclusao, curso?.validadeMeses ?? 0) : null,
          observacao: e.observacao,
          por: s.login,
        });
        // Regra 20: a conclusão da turma de um POP registra a ciência daquela versão (se ainda vigente e sem ciência).
        let ciencia = false;
        if (conclui && t.pop !== null) {
          const pop = await g.pop(t.pop);
          const ja = await g.ciencias({ vinculo: e.vinculo, pops: [t.pop] });
          if (pop && pop.situacao === 'vigente' && popAlcanca(pop, v.unidade) && ja.length === 0) {
            await g.incluirCiencia({ pop: t.pop, vinculo: e.vinculo, treinamento: t.id, por: s.login });
            ciencia = true;
          }
        }
        return { id: p.id, ciencia };
      },
    );
    return {
      id: r.id,
      mensagem: r.ciencia
        ? 'Participação registrada, com a ciência do POP da turma.'
        : 'Participação registrada.',
    };
  }

  async encerrarTurma(s: SessaoCadastro, e: EncerrarTurmaEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    await this.apoio.sgh(
      s,
      E.pessoasTurmaGravada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_TREINAMENTO', id: String(e.treinamento) },
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        const r = conferirEncerramentoTurma(t, await g.participantes(t.id));
        if (r) throw recusar(r);
        await g.situacaoTurma({
          id: t.id,
          versao: e.versao,
          situacao: 'encerrada',
          motivo: null,
          por: s.login,
        });
      },
    );
    return { id: e.treinamento, mensagem: 'Turma encerrada: a lista de presença não muda mais.' };
  }

  async cancelarTurma(s: SessaoCadastro, e: CancelarTurmaEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    await this.apoio.sgh(
      s,
      E.pessoasTurmaGravada.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_TREINAMENTO', id: String(e.treinamento) },
      async (g) => {
        const t = await g.turma(e.treinamento);
        if (!t) throw naoEncontrado('Turma');
        if (t.situacao !== 'aberta')
          throw recusaRegra('turma-encerrada', 'A turma já está encerrada ou cancelada.', 'treinamento');
        if (t.concluintes > 0)
          throw recusaRegra(
            'turma-com-conclusao',
            'A turma já tem conclusões registradas: encerre em vez de cancelar.',
            'treinamento',
          );
        await g.situacaoTurma({
          id: t.id,
          versao: e.versao,
          situacao: 'cancelada',
          motivo: e.motivo,
          por: s.login,
        });
      },
    );
    return { id: e.treinamento, mensagem: 'Turma cancelada.' };
  }

  /** Os dados da lista de presença (o documento para assinatura), em ordem de nome. */
  async listaPresenca(s: SessaoCadastro, id: number) {
    const t = await this.turma(s, id);
    const { hoje } = await this.porta.relogio(s.porta);
    return { turma: t, hoje, hospital: s.hospital, carga: minutosEmTexto(t.cargaMin) };
  }

  // ── Situação dos colaboradores (painel) e a ficha ───────────────────────────────────────────────────────────

  async painel(s: SessaoCadastro, f: FiltroSituacaoTreinamentoEntrada): Promise<PainelTreinamento> {
    const [{ hoje }, alerta, unidades, cursos, ativos0, popsV] = await Promise.all([
      this.porta.relogio(s.porta),
      this.alertaDias(s),
      this.nomesUnidades(s),
      this.porta.cursos(s.porta),
      this.porta.ativos(s.porta, f.unidade ?? null),
      this.porta.pops(s.porta, { vigentes: true }),
    ]);
    const TETO = 5000;
    const limitado = ativos0.length > TETO;
    const termo = f.termo?.trim().toUpperCase() ?? '';
    const ativos = ativos0
      .slice(0, TETO)
      .filter((v) => !termo || v.nome.toUpperCase().includes(termo) || (v.matricula ?? '').includes(termo));
    const [conclusoes, ciencias] = await Promise.all([
      this.porta.conclusoes(s.porta, null),
      this.porta.ciencias(s.porta, { pops: popsV.map((p) => p.id) }),
    ]);
    const porVinculo = new Map<number, typeof conclusoes>();
    for (const c of conclusoes) porVinculo.set(c.vinculo, [...(porVinculo.get(c.vinculo) ?? []), c]);
    const cientes = new Map<number, Set<number>>();
    for (const c of ciencias) cientes.set(c.vinculo, (cientes.get(c.vinculo) ?? new Set()).add(c.pop));
    const porId = new Map(cursos.map((c) => [c.id, c]));
    const cont = { colaboradores: 0, emDia: 0, aVencer: 0, vencidos: 0, pendentes: 0 };
    const itens: LinhaSituacaoTreinamento[] = [];
    for (const v of ativos) {
      const col = { ...v, desligamento: null };
      const pend = pendenciasTreinamento(cursos, porVinculo.get(v.id) ?? [], col, hoje, alerta)
        .filter((p) => !f.curso || p.curso === f.curso)
        .map((p) => this.pendenciaResposta(p, porId));
      const popsPend = popsPendentes(popsV, v.unidade, cientes.get(v.id) ?? new Set()).length;
      cont.colaboradores++;
      if (pend.length === 0) cont.emDia++;
      if (pend.some((p) => p.situacao === 'aVencer')) cont.aVencer++;
      if (pend.some((p) => p.situacao === 'vencido')) cont.vencidos++;
      if (pend.some((p) => p.situacao === 'pendente')) cont.pendentes++;
      const passa =
        f.situacao === 'todas' ||
        (f.situacao === 'comPendencia'
          ? pend.length > 0 || popsPend > 0
          : f.situacao === 'valido'
            ? pend.length === 0
            : pend.some((p) => p.situacao === f.situacao));
      if (!passa) continue;
      itens.push({
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
        funcao: v.funcao ?? v.cargo,
        pendencias: pend,
        popsPendentes: popsPend,
      });
    }
    return { hoje, itens, contagem: cont, limitado };
  }

  private pendenciaResposta(
    p: {
      curso: number;
      situacao: PendenciaCursoResposta['situacao'];
      validoAte: string | null;
      dias: number | null;
    },
    cursos: Map<number, CursoPesLido>,
  ): PendenciaCursoResposta {
    const c = cursos.get(p.curso);
    return {
      curso: p.curso,
      codigo: c?.codigo ?? '',
      titulo: c?.titulo ?? '',
      situacao: p.situacao,
      validoAte: p.validoAte,
      dias: p.dias,
    };
  }

  /** As pendências de treinamento e os POPs pendentes de um vínculo (a ficha e o "Meu espaço"). */
  async pendenciasDoVinculo(
    s: SessaoCadastro,
    v: Pick<VinculoAtivoTreinamento, 'id' | 'unidade' | 'funcao' | 'cargo' | 'admissao'> & {
      desligamento: string | null;
    },
  ): Promise<{ cursos: PendenciaCursoResposta[]; pops: PopPesLido[] }> {
    const [{ hoje }, alerta, cursos, conclusoes, vigentes, ciencias] = await Promise.all([
      this.porta.relogio(s.porta),
      this.alertaDias(s),
      this.porta.cursos(s.porta),
      this.porta.conclusoes(s.porta, [v.id]),
      this.porta.pops(s.porta, { vigentes: true }),
      this.porta.ciencias(s.porta, { vinculo: v.id }),
    ]);
    const porId = new Map(cursos.map((c) => [c.id, c]));
    return {
      cursos: pendenciasTreinamento(cursos, conclusoes, v, hoje, alerta).map((p) =>
        this.pendenciaResposta(p, porId),
      ),
      pops: popsPendentes(vigentes, v.unidade, new Set(ciencias.map((c) => c.pop))),
    };
  }

  async ficha(s: SessaoCadastro, vinculo: number): Promise<FichaTreinamento> {
    const [v] = await this.porta.vinculos(s.porta, [vinculo]);
    if (!v) throw naoEncontrado('Colaborador');
    const [{ hoje }, alerta, unidades, cursos, conclusoes, participacoes, vigentes, ciencias] =
      await Promise.all([
        this.porta.relogio(s.porta),
        this.alertaDias(s),
        this.nomesUnidades(s),
        this.porta.cursos(s.porta),
        this.porta.conclusoes(s.porta, [vinculo]),
        this.porta.participacoes(s.porta, vinculo),
        this.porta.pops(s.porta, { vigentes: true }),
        this.porta.ciencias(s.porta, { vinculo }),
      ]);
    const porId = new Map(cursos.map((c) => [c.id, c]));
    const feitos = new Set(conclusoes.map((c) => c.curso));
    const listaCursos: CursoDoColaborador[] = cursos
      .filter((c) => (c.ativo && c.obrigatorio && cursoAlcanca(c, v)) || feitos.has(c.id))
      .map((c) => {
        const x = situacaoCurso(
          conclusoes.filter((k) => k.curso === c.id),
          hoje,
          alerta,
        );
        return {
          curso: c.id,
          codigo: c.codigo,
          titulo: c.titulo,
          obrigatorio: c.obrigatorio && cursoAlcanca(c, v),
          situacao: x.situacao,
          ultimaConclusao: x.ultimaConclusao,
          validoAte: x.validoAte,
        };
      });
    const cienciaDe = new Map(ciencias.map((c) => [c.pop, c]));
    return {
      colaborador: {
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
        funcao: v.funcao,
        cargo: v.cargo,
      },
      cursos: listaCursos,
      participacoes: participacoes.map((p) => ({
        treinamento: p.treinamento,
        cursoTitulo: porId.get(p.curso)?.titulo ?? '',
        inicio: p.inicio,
        fim: p.fim,
        cargaMin: p.cargaMin,
        instrutor: p.instrutor,
        presenca: p.presenca,
        aproveitamento: p.aproveitamento,
        conclusao: p.conclusao,
        validoAte: p.validoAte,
      })),
      pops: vigentes
        .filter((p) => popAlcanca(p, v.unidade))
        .map((p) => ({
          id: p.id,
          codigo: p.codigo,
          versao: p.versao,
          titulo: p.titulo,
          vigencia: p.vigencia,
          ciente: cienciaDe.get(p.id)?.registradoEm ?? null,
          origemCiencia: cienciaDe.get(p.id)?.origem ?? null,
        })),
    };
  }

  // ── POP versionado ──────────────────────────────────────────────────────────────────────────────────────────

  private popResposta(
    p: PopPesLido,
    unidades: Map<number, string>,
    adesao: PopResposta['adesao'],
  ): PopResposta {
    return {
      id: p.id,
      codigo: p.codigo,
      versao: p.versao,
      titulo: p.titulo,
      unidade: p.unidade,
      unidadeNome: p.unidade !== null ? (unidades.get(p.unidade) ?? null) : null,
      vigencia: p.vigencia,
      situacao: p.situacao,
      resumo: p.resumo,
      referencia: p.referencia,
      alteracoes: p.alteracoes,
      motivo: p.motivo,
      publicadoPor: p.publicadoPor,
      publicadoEm: p.publicadoEm,
      adesao,
    };
  }

  /** Os POPs vigentes com a adesão (ciências dos ativos alcançados ÷ alcançados). */
  async pops(s: SessaoCadastro): Promise<ListaPops> {
    const [vigentes, unidades, ativos] = await Promise.all([
      this.porta.pops(s.porta, { vigentes: true }),
      this.nomesUnidades(s),
      this.porta.ativos(s.porta, null),
    ]);
    const ciencias = await this.porta.ciencias(s.porta, { pops: vigentes.map((p) => p.id) });
    const ativosIds = new Set(ativos.map((v) => v.id));
    return {
      itens: vigentes.map((p) => {
        const alcancados = ativos.filter((v) => popAlcanca(p, v.unidade));
        const alc = new Set(alcancados.map((v) => v.id));
        const cientes = ciencias.filter(
          (c) => c.pop === p.id && ativosIds.has(c.vinculo) && alc.has(c.vinculo),
        ).length;
        return this.popResposta(p, unidades, adesaoPop(alcancados.length, cientes));
      }),
    };
  }

  /** As versões de um código e, da vigente, os ativos alcançados ainda sem ciência. */
  async popDetalhe(s: SessaoCadastro, codigo: string): Promise<PopDetalhe> {
    const [versoes, unidades] = await Promise.all([
      this.porta.pops(s.porta, { codigo }),
      this.nomesUnidades(s),
    ]);
    if (versoes.length === 0) throw naoEncontrado('POP');
    const vigente = vigenteDoCodigo(versoes);
    let pendentes: PopDetalhe['pendentes'] = [];
    let limitado = false;
    if (vigente) {
      const [ativos, ciencias] = await Promise.all([
        this.porta.ativos(s.porta, vigente.unidade),
        this.porta.ciencias(s.porta, { pops: [vigente.id] }),
      ]);
      const ja = new Set(ciencias.map((c) => c.vinculo));
      const todos = ativos.filter((v) => popAlcanca(vigente, v.unidade) && !ja.has(v.id));
      limitado = todos.length > 500;
      pendentes = todos.slice(0, 500).map((v) => ({
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
      }));
    }
    return { versoes: versoes.map((p) => this.popResposta(p, unidades, null)), pendentes, limitado };
  }

  async publicarPop(s: SessaoCadastro, e: VersaoPopEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    const [{ hoje }, unidades] = await Promise.all([this.porta.relogio(s.porta), this.nomesUnidades(s)]);
    if (e.unidade !== null && !unidades.has(e.unidade))
      throw recusaRegra('unidade-inexistente', 'A unidade não existe neste estabelecimento.', 'unidade');
    const x = await this.apoio.sgh(
      s,
      E.pessoasPopPublicado.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      (y: { id: number }) => ({ tabela: 'SGH_PES_POP', id: String(y.id) }),
      async (g) => {
        const versoes = await g.versoesPop(e.codigo);
        const r = conferirVersaoPop(e, versoes, hoje);
        if (r) throw recusar(r);
        const atual = vigenteDoCodigo(versoes);
        if (atual) await g.situacaoPop({ id: atual.id, situacao: 'substituido', motivo: null, por: s.login });
        const versao = proximaVersaoPop(versoes);
        const id = await g.incluirPop({
          codigo: e.codigo,
          versao,
          titulo: e.titulo,
          unidade: e.unidade,
          vigencia: e.vigencia,
          resumo: e.resumo,
          referencia: e.referencia,
          alteracoes: versao > 1 ? e.alteracoes : null,
          por: s.login,
        });
        return { id, versao };
      },
    );
    return {
      id: x.id,
      mensagem:
        x.versao === 1
          ? 'POP publicado (versão 1): os colaboradores alcançados passam a ter a ciência pendente.'
          : `Versão ${x.versao} publicada: a anterior foi substituída e a ciência é pedida de novo.`,
    };
  }

  async revogarPop(s: SessaoCadastro, e: RevogarPopEntrada): Promise<ResultadoF6> {
    this.exigirRegistrar(s);
    await this.apoio.sgh(
      s,
      E.pessoasPopPublicado.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      { tabela: 'SGH_PES_POP', id: String(e.pop) },
      async (g) => {
        const p = await g.pop(e.pop);
        if (!p) throw naoEncontrado('POP');
        const r = conferirRevogacaoPop(p);
        if (r) throw recusar(r);
        await g.situacaoPop({ id: p.id, situacao: 'revogado', motivo: e.motivo, por: s.login });
      },
    );
    return { id: e.pop, mensagem: 'POP revogado: ninguém mais precisa dar ciência dele.' };
  }

  // ── Ciência do próprio colaborador ──────────────────────────────────────────────────────────────────────────

  /** A ciência na versão vigente, só do próprio vínculo (o vínculo vem do login; D-COMO-526: nunca na sessão "como"). */
  async ciencia(
    s: SessaoCadastro,
    e: CienciaPopEntrada,
    vinculosDoLogin: readonly number[],
  ): Promise<ResultadoF6> {
    if (emComo(s))
      throw new ErroProblema('recusa-de-negocio', 403, 'Ação pessoal', MOTIVO_SESSAO_COMO_POP, {
        codigo: 'sessao-como',
      });
    const pedido = e.vinculo;
    const vinculos = await this.porta.vinculos(s.porta, vinculosDoLogin);
    const proprios = pedido !== null ? vinculos.filter((v) => v.id === pedido) : vinculos;
    const r = await this.apoio.sgh(
      s,
      E.pessoasPopCiencia.codigo,
      CHAVE_PESSOAS_TREINAMENTO,
      (y: { id: number }) => ({ tabela: 'SGH_PES_POP_CIENCIA', id: String(y.id) }),
      async (g) => {
        const pop = await g.pop(e.pop);
        if (!pop) throw naoEncontrado('POP');
        const v =
          proprios.find((x) => x.desligamento === null && popAlcanca(pop, x.unidade)) ?? proprios[0] ?? null;
        const ja = v ? await g.ciencias({ vinculo: v.id, pops: [pop.id] }) : [];
        const recusa = conferirCienciaPop(pop, {
          proprio: v !== null,
          jaCiente: ja.length > 0,
          unidadeDoColaborador: v?.unidade ?? null,
          desligado: v?.desligamento !== null && v?.desligamento !== undefined,
        });
        if (recusa) throw recusar(recusa);
        return {
          id: await g.incluirCiencia({ pop: pop.id, vinculo: v!.id, treinamento: null, por: s.login }),
        };
      },
    );
    return { id: r.id, mensagem: 'Ciência registrada.' };
  }
}
