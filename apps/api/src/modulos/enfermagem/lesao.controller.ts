// W0-03, mercado M4 (critério 12): feridas e lesão por pressão (LPP).
//   GET  /api/enfermagem/lesoes/unidade?unidade          os internados da unidade com as lesões deles (leitura auditada)
//   GET  /api/enfermagem/lesoes/indicadores?de&ate       a incidência de LPP (por 1.000 pacientes-dia e por pacientes
//                                                        internados), com o numerador e o denominador (para o W0-04)
//   GET  /api/enfermagem/lesoes/:id                      uma lesão com as versões, os curativos e as fotos
//   POST /api/enfermagem/lesoes                          a lesão nova (a ficha em rascunho ou finalizada)
//   POST /api/enfermagem/lesoes/:id/versoes              a versão seguinte (só do autor; a da finalizada é a correção
//                                                        finalizada com a justificativa)
//   POST /api/enfermagem/lesoes/:id/curativos            o curativo (a evolução)
//   POST /api/enfermagem/lesoes/curativos/:id/corrigir   a correção do curativo pelo autor (com a justificativa)
//   POST /api/enfermagem/lesoes/:id/fotos                a foto: o anexo de imagem já gravado no prontuário
//   POST /api/enfermagem/lesoes/:id/encerrar             o encerramento do acompanhamento (desfecho e hora)
//   POST /api/enfermagem/lesoes/:id/inativar             a lesão lançada errada (só do autor; motivo e senha)
//   POST /api/enfermagem/lesoes/curativos/:id/inativar   o curativo lançado errado (só do autor; motivo e senha)
//   POST /api/enfermagem/lesoes/fotos/:id/inativar       a foto vinculada errada (só de quem vinculou; motivo e senha)
// Só do novo (SGH_), com a trilha_auditoria na mesma transação; nenhuma rota de exclusão física (registro clínico). A
// liberação é a dos escores de risco (`enfermagem.escores`). Permissões reusadas (nenhuma nova): ler, a dos escores;
// registrar, a de registrar escore (a enfermagem) ou a do prescritor.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaCorrigirCurativo,
  esquemaCurativo,
  esquemaEncerrarLesao,
  esquemaFotoLesao,
  esquemaInativarLesao,
  esquemaRegistroLesao,
  esquemaVersaoLesao,
  EVENTOS_AUDITAVEIS,
  type IncidenciaLpp,
  type LesaoLida,
  PERMISSOES_ESCORES as PE,
  ROTULOS_DESFECHO_LESAO,
} from '@sgh/contratos';
import { conferirCurativo, conferirLesao, conferirVersaoLesao, somarMinutos } from '@sgh/dominio-enfermagem';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoioEscores } from './escores.controller.js';
import { PORTA_ESCORES, type PortaEscores } from './escores-porta.js';
import { colunasDaFicha, incidenciaDoPeriodo, lesaoParaTela } from './lesao-servico.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { unidadesUti } from './trr-servico.js';

const PERMISSAO_PRESCREVER = 'pep.prescricao.criar';
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const T = {
  lesao: 'lesao_pele_paciente',
  versao: 'lesao_pele_avaliacao',
  curativo: 'lesao_pele_avaliacao',
  foto: 'lesao_pele_avaliacao',
  evento: 'lesao_pele_paciente',
} as const;

function unidadeDe(v: string | undefined): string {
  const u = (v ?? '').trim();
  if (!UNIDADE.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
  return u;
}
const invalida = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('entrada-invalida', 422, 'Registro incompleto', detalhe, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

@Controller('enfermagem/lesoes')
export class LesaoController {
  private readonly a: ApoioEscores;

  constructor(
    @Inject(PORTA_ESCORES) porta: PortaEscores,
    @Inject(PORTA_ENFERMAGEM) enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.a = new ApoioEscores(porta, enfermagem, trilha, configuracao, cache);
  }

  private podeAgir(s: SessaoCadastro): boolean {
    return s.pode(PE.escoreRegistrar) || s.pode(PERMISSAO_PRESCREVER);
  }

  private recurso(s: SessaoCadastro): string {
    return s.pode(PE.escoreRegistrar) ? PE.escoreRegistrar : PERMISSAO_PRESCREVER;
  }

  private exigirAgir(s: SessaoCadastro): void {
    if (!this.podeAgir(s))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'O registro de feridas é da enfermagem que registra os escores ou de quem prescreve.',
        { codigo: 'sem-permissao-lesao' },
      );
  }

  private async senha(req: RequisicaoAutorizada, senha: string): Promise<void> {
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  private async agora(s: SessaoCadastro): Promise<string> {
    return (await this.a.enfermagem.relogio(s.porta)).slice(0, 16);
  }

  /** A lesão para a tela (404 se não existe). */
  private async lesao(s: SessaoCadastro, id: number): Promise<LesaoLida> {
    const [l] = await this.a.porta.lesoes(s.porta, { id });
    const t = l ? lesaoParaTela(l) : null;
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Lesão não encontrada', 'A lesão não existe.');
    return t;
  }

  /** A entrada da internação em curso do atendimento (a janela de 24 horas do "presente na admissão"). */
  private async admissao(s: SessaoCadastro, atendimento: number): Promise<string | null> {
    const i = await this.a.enfermagem.internado(s.porta, atendimento);
    if (!i) return null;
    const [x] = await this.a.porta.internacoes(s.porta, [i.numero]);
    return x?.entrada ? x.entrada.slice(0, 16) : null;
  }

  @Get('unidade')
  @Permissao(PE.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemLesaoLida.codigo)
  async unidade(@Query('unidade') u: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const unidade = unidadeDe(u);
    const [agora, internados, l] = await Promise.all([
      this.agora(s),
      this.a.enfermagem.internados(s.porta, unidade),
      this.a.apoio.liberacao(s),
    ]);
    const lidas = internados.length
      ? await this.a.porta.lesoes(s.porta, { atendimentos: internados.map((i) => i.atendimento) })
      : [];
    const lesoes = lidas.flatMap((x) => {
      const t = lesaoParaTela(x);
      return t ? [t] : [];
    });
    req.sghAlvo = { tabelaAlvo: T.lesao, chaveNaturalAlvo: `unidade:${unidade};lesoes:${lesoes.length}` };
    return {
      unidade,
      agora,
      pacientes: internados.map((i) => ({
        paciente: i.paciente,
        atendimento: i.atendimento,
        leito: i.leito,
        nome: i.nome,
      })),
      lesoes,
      gravacao: { ligada: l.ligada, motivo: l.motivo, agir: l.ligada && this.podeAgir(s), login: s.login },
    };
  }

  @Get('indicadores')
  @Permissao(PE.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemLesaoLida.codigo)
  async indicadores(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IncidenciaLpp> {
    const s = sessaoDe(req);
    if (!de || !ate || !DATA.test(de) || !DATA.test(ate) || de > ate)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'Informe o período (de e até).');
    if (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`) > 366 * 86_400_000)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O período vai até um ano.');
    const fim = somarMinutos(`${ate}T00:00`, 24 * 60);
    const [lidas, censo, internados] = await Promise.all([
      this.a.porta.lesoes(s.porta, { desde: `${de}T00:00`, ate: fim }),
      this.a.porta.censo(s.porta, de, ate),
      this.a.porta.pacientesInternados(s.porta, de, ate),
    ]);
    req.sghAlvo = { tabelaAlvo: T.lesao, chaveNaturalAlvo: `incidencia:${de};${ate}` };
    const lesoes = lidas.flatMap((x) => {
      const t = lesaoParaTela(x);
      return t ? [t] : [];
    });
    const pacientesDia = censo.porSetor.reduce((a, x) => a + x.pacientesDia, 0);
    return incidenciaDoPeriodo(lesoes, pacientesDia, internados, de, ate);
  }

  @Get(':id')
  @Permissao(PE.escoreLer)
  @Auditar(EVENTOS_AUDITAVEIS.enfermagemLesaoLida.codigo)
  async uma(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<LesaoLida> {
    const s = sessaoDe(req);
    const l = await this.lesao(s, idDaRota(id));
    req.sghAlvo = { paciente: l.paciente, tabelaAlvo: T.lesao, chaveNaturalAlvo: `lesao:${l.id}` };
    return l;
  }

  @Post()
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a lesão em lesao_pele_paciente e a versão 1 em lesao_pele_avaliacao com a trilha_auditoria na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const e = corpo(esquemaRegistroLesao, b);
    const i = await this.a.internado(s, e.atendimento, e.paciente);
    const [agora, admissao, uti] = await Promise.all([
      this.agora(s),
      this.admissao(s, i.atendimento),
      this.a.apoio.parametroValor(s, 'enfermagem.trr.unidadesUti', null).then(unidadesUti),
    ]);
    const p = conferirLesao(e.dados, e.finalizar, agora, admissao);
    if (p) throw invalida(p.codigo, p.mensagem, ['dados']);
    const situacao = e.finalizar ? 'finalizada' : 'rascunho';
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoRegistrada.codigo,
      this.recurso(s),
      (x: { id: number }) => ({
        tabela: T.lesao,
        id: String(x.id),
        paciente: i.paciente,
        chave: `v1;${situacao};${e.dados.tipo}`,
      }),
      (g) =>
        g.registrarLesao({
          paciente: i.paciente,
          atendimento: i.atendimento,
          unidade: i.unidade || null,
          uti: uti.has((i.unidade ?? '').toUpperCase()),
          situacao,
          colunas: colunasDaFicha(e.dados),
          dados: JSON.stringify(e.dados),
          autor: s.login,
        }),
    );
    return {
      ok: true as const,
      id: r.id,
      versao: 1,
      mensagem: e.finalizar
        ? 'Lesão registrada e ficha finalizada: só você corrige, com a justificativa.'
        : 'Rascunho da ficha da lesão gravado: só você continua e finaliza.',
    };
  }

  @Post(':id/versoes')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('a versão seguinte em lesao_pele_avaliacao com a trilha_auditoria na mesma transação')
  async versao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const e = corpo(esquemaVersaoLesao, b);
    const atual = await this.lesao(s, idDaRota(id));
    const v = conferirVersaoLesao(
      {
        autor: atual.autor,
        situacao: atual.situacao,
        inativada: atual.inativacao !== null,
        encerrada: atual.encerramento !== null,
      },
      s.login,
      e,
    );
    if (v) throw new ErroProblema('recusa-de-negocio', 409, 'Não gravado', v.mensagem, { codigo: v.codigo });
    if (e.dados.tipo !== atual.dados.tipo && atual.situacao === 'finalizada' && atual.curativos.length > 0)
      throw invalida(
        'tipo-com-curativos',
        'A lesão já tem curativos: o tipo não muda na correção (inative e registre de novo).',
        ['dados'],
      );
    const [agora, admissao] = await Promise.all([this.agora(s), this.admissao(s, atual.atendimento)]);
    const p = conferirLesao(e.dados, e.finalizar, agora, admissao);
    if (p) throw invalida(p.codigo, p.mensagem, ['dados']);
    // A versão vigente lida é a anterior (a chave única de ID_ANTERIOR recusa a corrida).
    const [lida] = await this.a.porta.lesoes(s.porta, { id: atual.id });
    const anterior = lida?.versoes[0]?.id ?? 0;
    const situacao = e.finalizar ? 'finalizada' : 'rascunho';
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoRegistrada.codigo,
      this.recurso(s),
      (x: { id: number; versao: number }) => ({
        tabela: T.versao,
        id: String(x.id),
        paciente: atual.paciente,
        chave: `v${x.versao};${situacao}`,
      }),
      (g) =>
        g.versaoLesao({
          lesao: atual.id,
          anterior,
          situacao,
          colunas: colunasDaFicha(e.dados),
          dados: JSON.stringify(e.dados),
          motivo: e.motivo ?? null,
          autor: s.login,
        }),
    );
    return {
      ok: true as const,
      id: atual.id,
      versao: r.versao,
      mensagem:
        atual.situacao === 'finalizada'
          ? `Ficha corrigida (versão ${r.versao}); a anterior fica inativa e legível.`
          : e.finalizar
            ? `Ficha finalizada (versão ${r.versao}): só você corrige, com a justificativa.`
            : `Rascunho gravado (versão ${r.versao}).`,
    };
  }

  @Post(':id/curativos')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('o curativo em lesao_pele_avaliacao com a trilha_auditoria na mesma transação')
  async curativo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const e = corpo(esquemaCurativo, b);
    const l = await this.lesao(s, idDaRota(id));
    const p = conferirCurativo(e, l.dados.tipo, l.dados.identificadaEm, await this.agora(s));
    if (p) throw invalida(p.codigo, p.mensagem, ['dados']);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoCurativo.codigo,
      this.recurso(s),
      (x: { id: number }) => ({
        tabela: T.curativo,
        id: String(x.id),
        paciente: l.paciente,
        chave: `lesao:${l.id}`,
      }),
      (g) =>
        g.curativoLesao({
          lesao: l.id,
          realizadoEm: e.realizadoEm,
          estagio: e.estagio,
          dados: JSON.stringify(e),
          autor: s.login,
        }),
    );
    return { ok: true as const, id: r.id, mensagem: 'Curativo registrado.' };
  }

  @Post('curativos/:id/corrigir')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a correção do curativo em lesao_pele_avaliacao com a trilha_auditoria na mesma transação',
  )
  async corrigirCurativo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const anterior = idDaRota(id);
    const e = corpo(esquemaCorrigirCurativo, b);
    // A lesão do curativo: a gravação confere; aqui só para conferir o curativo contra a ficha.
    const [lida] = await this.a.porta.lesoes(s.porta, { id: await this.lesaoDoCurativo(s, anterior) });
    const l = lida ? lesaoParaTela(lida) : null;
    if (!l)
      throw new ErroProblema('nao-encontrado', 404, 'Curativo não encontrado', 'O curativo não existe.');
    const p = conferirCurativo(e.dados, l.dados.tipo, l.dados.identificadaEm, await this.agora(s));
    if (p) throw invalida(p.codigo, p.mensagem, ['dados']);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoCurativo.codigo,
      this.recurso(s),
      (x: { id: number }) => ({
        tabela: T.curativo,
        id: String(x.id),
        paciente: l.paciente,
        chave: `corrige:${anterior}`,
      }),
      (g) =>
        g.corrigirCurativoLesao({
          anterior,
          realizadoEm: e.dados.realizadoEm,
          estagio: e.dados.estagio,
          dados: JSON.stringify(e.dados),
          motivo: e.motivo,
          autor: s.login,
        }),
    );
    return {
      ok: true as const,
      id: r.id,
      mensagem: 'Curativo corrigido; o registro anterior fica inativo e legível.',
    };
  }

  /** A lesão de um curativo (pelas lesões dos atendimentos não dá: o curativo vem pela rota). */
  private async lesaoDoCurativo(s: SessaoCadastro, curativo: number): Promise<number> {
    const id = await this.a.porta.lesaoDoCurativo(s.porta, curativo);
    if (id === null)
      throw new ErroProblema('nao-encontrado', 404, 'Curativo não encontrado', 'O curativo não existe.');
    return id;
  }

  @Post(':id/fotos')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a foto (referência ao anexo) em lesao_pele_avaliacao com a trilha_auditoria na mesma transação',
  )
  async foto(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const e = corpo(esquemaFotoLesao, b);
    const l = await this.lesao(s, idDaRota(id));
    if (e.tiradaEm > (await this.agora(s)))
      throw invalida('foto-no-futuro', 'A hora da foto é do futuro.', ['tiradaEm']);
    const r = await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoFoto.codigo,
      this.recurso(s),
      (x: { id: number }) => ({
        tabela: T.foto,
        id: String(x.id),
        paciente: l.paciente,
        chave: `anexo:${e.anexo}`,
      }),
      (g) =>
        g.fotoLesao({
          lesao: l.id,
          curativo: e.curativo ?? null,
          anexo: e.anexo,
          tiradaEm: e.tiradaEm,
          usuario: s.login,
        }),
    );
    return {
      ok: true as const,
      id: r.id,
      mensagem: 'Foto vinculada à lesão (o arquivo fica no prontuário).',
    };
  }

  @Post(':id/encerrar')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler('o encerramento em lesao_pele_paciente com a trilha_auditoria na mesma transação')
  async encerrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const e = corpo(esquemaEncerrarLesao, b);
    const l = await this.lesao(s, idDaRota(id));
    if (e.em > (await this.agora(s)))
      throw invalida('encerramento-no-futuro', 'A hora do encerramento é do futuro.', ['em']);
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoEncerrada.codigo,
      this.recurso(s),
      (x: { id: number }) => ({
        tabela: T.evento,
        id: String(x.id),
        paciente: l.paciente,
        chave: `encerramento:${l.id}`,
      }),
      (g) =>
        g.encerrarLesao({
          lesao: l.id,
          desfecho: e.desfecho,
          em: e.em,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    return {
      ok: true as const,
      id: l.id,
      mensagem: `Acompanhamento encerrado: ${ROTULOS_DESFECHO_LESAO[e.desfecho].toLowerCase()}.`,
    };
  }

  private async inativar(
    req: RequisicaoAutorizada,
    origem: 'lesao' | 'curativo' | 'foto',
    id: string,
    b: unknown,
  ) {
    const s = sessaoDe(req);
    this.exigirAgir(s);
    const registro = idDaRota(id);
    const e = corpo(esquemaInativarLesao, b);
    await this.senha(req, e.senha);
    const tabela = origem === 'lesao' ? T.lesao : origem === 'curativo' ? T.curativo : T.foto;
    await this.a.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.enfermagemLesaoInativada.codigo,
      this.recurso(s),
      (x: { id: number; paciente: number }) => ({
        tabela,
        id: String(registro),
        paciente: x.paciente,
        chave: `inativacao:${origem}`,
      }),
      (g) => g.inativarLesao({ origem, id: registro, motivo: e.motivo, usuario: s.login }),
    );
    return {
      ok: true as const,
      mensagem:
        origem === 'lesao'
          ? 'Lesão inativada: continua visível, tachada, com o motivo, e sai da incidência.'
          : origem === 'curativo'
            ? 'Curativo inativado: continua visível, tachado, com o motivo.'
            : 'Foto desvinculada: continua visível, tachada, com o motivo (o anexo segue no prontuário).',
    };
  }

  @Post(':id/inativar')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a inativação em lesao_pele_paciente (com a senha) e a trilha_auditoria na mesma transação',
  )
  inativarLesao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.inativar(req, 'lesao', id, b);
  }

  @Post('curativos/:id/inativar')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a inativação em lesao_pele_paciente (com a senha) e a trilha_auditoria na mesma transação',
  )
  inativarCurativo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.inativar(req, 'curativo', id, b);
  }

  @Post('fotos/:id/inativar')
  @HttpCode(201)
  @Permissao(PE.escoreLer)
  @AuditadoNoHandler(
    'a inativação em lesao_pele_paciente (com a senha) e a trilha_auditoria na mesma transação',
  )
  inativarFoto(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.inativar(req, 'foto', id, b);
  }
}
