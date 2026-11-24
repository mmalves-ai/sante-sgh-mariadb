// Telas de pacientes do M11 (ficha, seção 7) — `Cadastros > Pacientes (cadastro único)`:
//   GET  /api/cadastros/pacientes?termo&tipo&inativos     busca única (mascarada em lista; registro de acesso)
//   GET  /api/cadastros/pacientes/candidatos?cpf          "procurar antes de criar" (nome mascarado, nascimento)
//   GET  /api/cadastros/pacientes/:id                     ficha (registro de acesso; documentos e sensíveis por perfil)
//   POST /api/cadastros/pacientes                         cadastrar (executor: cadastro.cadastrarPaciente)
//   PUT  /api/cadastros/pacientes/:id                     alterar (executor: cadastro.alterarPaciente; colisão 409)
//   GET  /api/cadastros/pacientes/:id/historico           linha do tempo e unificações (efetivadas e desfeitas)
//   GET|POST /api/cadastros/pacientes/:id/consentimentos  consentimentos (consentimento_titular)
//   GET  /api/cadastros/pacientes/duplicidades[/:id]      fila e comparação lado a lado (registro de acesso)
//   GET  /api/cadastros/pacientes/gravacao                cadastrar grava agora? (passo 0 do executor; motivo)
//   GET  /api/cadastros/pacientes/cep/:cep                endereço pelo CEP (cadastro de CEPs do estabelecimento)
//   POST /api/cadastros/pacientes/duplicidades/atualizar  pares novos pela regra do escore
//   POST /api/cadastros/pacientes/duplicidades/:id/decisao  "É outra pessoa" (só suspeita_duplicidade)
//   POST /api/cadastros/pacientes/duplicidades/:id/unificar  M57.2: "Unificar" (executor: cadastro.unificarPaciente;
//                                                           crítica, com a senha; só a permissão cadastro.paciente.unificar)
//   POST /api/cadastros/pacientes/unificacoes/:id/desfazer   F3.1: desfazer a unificação, com motivo e senha
// A busca e a abertura da ficha são eventos de acesso (cap-06a §6.1; cap-08 §8.12): "sem trilha, sem dado".
// As gravações no banco próprio passam pelo executor, com a trilha na mesma transação. Com a porta em memória
// (sessão sintética), o registrador da API registra.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type CandidatosCpf,
  type Consentimentos,
  esquemaAlterarPaciente,
  esquemaCadastrarPaciente,
  esquemaConsultaBuscaPaciente,
  esquemaDecisaoDuplicidade,
  esquemaPedidoUnificacao,
  esquemaPedidoDesfazerUnificacao,
  type EnderecoCep,
  esquemaPedidoConsentimento,
  EVENTOS_AUDITAVEIS,
  type FichaPaciente,
  type GravacaoCadastro,
  type FilaDuplicidades,
  type HistoricoCadastro,
  type ParDuplicidade,
  type ResultadoBuscaPaciente,
  SITUACOES_DUPLICIDADE,
} from '@sgh/contratos';
import { cpfValido, permissoesDaFicha, somenteDigitos } from '@sgh/dominio-cadastro';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  contextoOperacao,
  idDaRota,
  linhaTrilha,
  pagina,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from './comum.js';
import { FICHA_COMPLEMENTAR, type FichaComplementarPropria } from './ficha-complementar-proprio.js';
import { PORTA_CADASTRO, type PortaCadastro } from './porta.js';
import {
  atualizarFila,
  buscarPacientes,
  candidatosDoCpf,
  montarFicha,
  montarFila,
  montarHistorico,
  montarPares,
} from './servico.js';

const POR_PAGINA_HISTORICO = 100;
const POR_PAGINA_FILA = 25;
const OPERACAO_UNIFICAR = 'cadastro.unificarPaciente';
/**
 * Sessão "como" (suporte, ADR 0021): a unificação e o desfazer são recusados (falha fechada). Não é por gatilho (não há)
 * nem por falta de desfazer (existe, F3.1): a fusão de prontuários é decisão clínico-administrativa do hospital, com
 * senha de quem decide e responsável nominal na unificação; o operador do suporte não é esse responsável.
 */
const MOTIVO_UNIFICACAO_COMO =
  'Numa sessão de suporte, a unificação e o desfazer não são feitos: a decisão e a senha são do gestor de cadastro do hospital, na própria conta.';

@Controller('cadastros/pacientes')
export class PacientesController {
  constructor(
    @Inject(PORTA_CADASTRO) private readonly porta: PortaCadastro,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    /** F3.1: regras de campo do cadastro (só no banco do cliente; sem ele, a regra não é conferida). */
    @Optional() @Inject(FICHA_COMPLEMENTAR) private readonly ficha: FichaComplementarPropria | null = null,
  ) {}

  /**
   * "Unificar" pode agora? Só a permissão `cadastro.paciente.unificar` do cargo (F3.1: tudo ligado para todos, sem chave
   * de liberação) e o passo 0 do executor; senão, o motivo (a fila mostra o botão desabilitado com ele).
   */
  private async unificacao(s: SessaoCadastro): Promise<FilaDuplicidades['unificacao']> {
    const estado = this.porta.estado(OPERACAO_UNIFICAR, s.hospital) ?? 'especificada';
    if (!s.pode('cadastro.paciente.unificar'))
      return { estado, disponivel: false, motivo: 'Seu perfil não permite unificar prontuários.' };
    if (s.req.sghComo !== undefined) return { estado, disponivel: false, motivo: MOTIVO_UNIFICACAO_COMO };
    const g = await this.porta.podeGravar(s.porta, OPERACAO_UNIFICAR, s.login).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    return g.pode
      ? { estado, disponivel: true, motivo: 'Unificação liberada neste estabelecimento.' }
      : {
          estado,
          disponivel: false,
          motivo: g.motivo ?? 'A unificação não grava agora neste estabelecimento.',
        };
  }

  /** Com a porta em memória, a trilha da gravação é a do registrador da API (no núcleo, vai na transação). */
  private async trilhaMemoria(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    idAlvo: string,
  ): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      // ADR 0021: na sessão "como", SGH-WEB:SUPORTE (nunca o IP de quem entrou); fora dela, o prefixo da estação.
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, `cadastro-${idAlvo}`).slice(0, 64),
      recurso,
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo,
    });
  }

  @Get()
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.buscado')
  async buscar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBuscaPaciente> {
    const s = sessaoDe(req);
    const c = esquemaConsultaBuscaPaciente.safeParse(q);
    if (!c.success)
      throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida', 'Informe o termo da busca.');
    const r = await buscarPacientes(this.porta, s.porta, c.data).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    // Na trilha, só o tipo e a quantidade (nunca o termo: pode ser nome ou documento).
    req.sghAlvo = { tabelaAlvo: 'paciente', chaveNaturalAlvo: `busca:${r.tipo};n:${r.itens.length}` };
    return r;
  }

  @Get('candidatos')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.buscado')
  async candidatos(
    @Query('cpf') cpf: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CandidatosCpf> {
    const s = sessaoDe(req);
    const d = somenteDigitos(cpf ?? '');
    if (!cpfValido(d))
      throw new ErroProblema('entrada-invalida', 400, 'CPF inválido', 'Confira os dígitos do CPF.', {
        codigo: 'cpf-invalido',
        campos: ['cpf'],
      });
    const r = await candidatosDoCpf(this.porta, s.porta, Number(d));
    req.sghAlvo = {
      tabelaAlvo: 'paciente',
      chaveNaturalAlvo: `busca:cpf-candidatos;n:${r.candidatos.length}`,
    };
    return r;
  }

  @Get('duplicidades')
  @Permissao('cadastro.duplicidade.ler')
  @Auditar('cadastro.duplicidade.listada')
  async fila(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FilaDuplicidades> {
    const s = sessaoDe(req);
    const situacao = (SITUACOES_DUPLICIDADE as readonly string[]).includes(q['situacao'] ?? '')
      ? (q['situacao'] as FilaDuplicidades['itens'][number]['situacao'])
      : 'aberto';
    const pg = pagina(q['pagina']);
    const f = { ...(await montarFila(this.porta, s.porta, situacao, pg, POR_PAGINA_FILA)) };
    f.unificacao = await this.unificacao(s);
    // A fila mostra os dois lados de cada par (nome, nascimento, mãe): é evento de acesso. Na trilha, só a
    // situação, a página e a quantidade (nenhum dado de paciente).
    req.sghAlvo = {
      tabelaAlvo: 'suspeita_duplicidade',
      chaveNaturalAlvo: `fila:${situacao};p:${pg};n:${f.itens.length}`,
    };
    return f;
  }

  /** "Cadastrar paciente" grava agora para este login? (passo 0 do executor; a busca esconde e mostra o motivo.) */
  @Get('gravacao')
  @Permissao('cadastro.paciente.ler')
  async gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoCadastro> {
    const s = sessaoDe(req);
    if (!s.pode('cadastro.paciente.criar'))
      return { cadastrar: { pode: false, motivo: 'Seu perfil não permite cadastrar paciente.' } };
    const r = await this.porta
      .podeGravar(s.porta, 'cadastro.cadastrarPaciente', s.login)
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    return { cadastrar: { pode: r.pode, motivo: r.pode ? null : r.motivo } };
  }

  /** Endereço pelo CEP (a ficha completa logradouro e bairro e mostra cidade e UF antes de salvar). */
  @Get('cep/:cep')
  @Permissao('cadastro.paciente.ler')
  async cep(@Param('cep') cep: string, @Req() req: RequisicaoAutorizada): Promise<EnderecoCep> {
    const s = sessaoDe(req);
    const d = somenteDigitos(cep);
    if (d.length !== 8)
      throw new ErroProblema('entrada-invalida', 400, 'CEP inválido', 'O CEP tem 8 dígitos.', {
        campos: ['cep'],
      });
    const r = await this.porta.lerCep(s.porta, d).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (!r)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'CEP não encontrado',
        'CEP não encontrado no cadastro de CEPs. Confira o CEP.',
        { campos: ['cep'] },
      );
    return r;
  }

  @Get('duplicidades/:id')
  @Permissao('cadastro.duplicidade.ler')
  @Auditar('cadastro.paciente.lido')
  async par(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ParDuplicidade> {
    const s = sessaoDe(req);
    const p = await this.porta.lerPar(s.porta, idDaRota(id));
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado');
    const [um] = await montarPares(this.porta, s.porta, [p]);
    if (!um) throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado');
    req.sghAlvo = {
      tabelaAlvo: 'suspeita_duplicidade',
      idAlvo: String(p.id),
      chaveNaturalAlvo: `par:${p.a}:${p.b}`,
    };
    return um;
  }

  @Post('duplicidades/atualizar')
  @HttpCode(200)
  @Permissao('cadastro.duplicidade.decidir')
  @AuditadoNoHandler('trilha na mesma transação da fila (memória: registrador da API)')
  async atualizar(@Req() req: RequisicaoAutorizada): Promise<{ novos: number; total: number }> {
    const s = sessaoDe(req);
    const ev = EVENTOS_AUDITAVEIS.duplicidadeFilaAtualizada.codigo;
    const trilha = linhaTrilha(s, ev, 'cadastro.duplicidade', 'cadastro.atualizarFila', {
      tabela: 'suspeita_duplicidade',
    });
    const r = await atualizarFila(this.porta, s.porta, trilha).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    await this.trilhaMemoria(s, ev, 'cadastro.duplicidade', String(r.novos));
    return r;
  }

  @Post('duplicidades/:id/decisao')
  @HttpCode(200)
  @Permissao('cadastro.duplicidade.decidir')
  @AuditadoNoHandler('trilha na mesma transação da decisão (memória: registrador da API)')
  async decidir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; situacao: 'outra_pessoa' }> {
    const s = sessaoDe(req);
    const d = esquemaDecisaoDuplicidade.safeParse(corpo);
    if (!d.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escreva a justificativa (5 a 200 letras).',
        {
          campos: ['justificativa'],
        },
      );
    const n = idDaRota(id);
    const ev = EVENTOS_AUDITAVEIS.duplicidadeDecidida.codigo;
    await this.porta
      .decidirOutraPessoa(
        s.porta,
        n,
        s.login,
        d.data.justificativa,
        linhaTrilha(s, ev, 'cadastro.duplicidade', 'cadastro.decidirDuplicidade', {
          tabela: 'suspeita_duplicidade',
        }),
      )
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    await this.trilhaMemoria(s, ev, 'cadastro.duplicidade', String(n));
    return { id: n, situacao: 'outra_pessoa' };
  }

  /**
   * M57.2: unifica o par da fila (o lado `fica` é o prontuário que fica; o outro é absorvido). Operação crítica: a senha
   * é conferida de novo (sessão real); na sessão sintética sem cookie, a memória dispensa. A fila registra a unificação
   * na mesma transação da receita.
   */
  @Post('duplicidades/:id/unificar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.unificar')
  @AuditadoNoHandler(
    'executor: trilha na mesma transação da receita, com a fila de duplicidades (memória: registrador da API)',
  )
  async unificar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ idAbsorvido: number; idSobrevivente: number }> {
    const s = sessaoDe(req);
    if (req.sghComo !== undefined)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Unificação numa sessão de suporte',
        MOTIVO_UNIFICACAO_COMO,
        {
          codigo: 'como-sem-correcao',
        },
      );
    const d = esquemaPedidoUnificacao.safeParse(corpo);
    if (!d.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha o prontuário que fica e escreva a justificativa (5 a 200 letras).',
        { campos: [...new Set(d.error.issues.map((i) => i.path.join('.') || 'fica'))] },
      );
    const u = await this.unificacao(s);
    if (!u.disponivel)
      throw new ErroProblema('recurso-desligado', 403, 'Unificação desligada', u.motivo, {
        codigo: 'recurso-desligado',
      });
    const n = idDaRota(id);
    const par = await this.porta.lerPar(s.porta, n);
    if (!par) throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado');
    if (par.situacao !== 'aberto')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Par já decidido',
        'O par já foi decidido por outra pessoa. Releia a fila.',
        { codigo: 'par-decidido' },
      );
    const [fica, absorvido] = d.data.fica === 'a' ? [par.a, par.b] : [par.b, par.a];
    const reautenticadoEm =
      this.porta.destino === 'memoria' && !req.sgh?.real
        ? Date.now()
        : await reautenticar(this.sessoes, this.resolvedorObrigatorio(), req, d.data.senha);
    const ctx = { ...contextoOperacao(s, 'cadastro-unificacao'), reautenticadoEm };
    const r = await this.porta
      .unificar(
        s.porta,
        { idAbsorvido: absorvido, idSobrevivente: fica, par: n, justificativa: d.data.justificativa },
        ctx,
      )
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
    await this.trilhaMemoria(
      s,
      EVENTOS_AUDITAVEIS.pacienteUnificado.codigo,
      'cadastro.paciente',
      `${absorvido}>${fica}`,
    );
    return r.resultado;
  }

  /**
   * F3.1 (02-CAD linha 7): desfaz uma unificação registrada. Mesma permissão e mesma confirmação de senha da
   * unificação; o motivo fica na própria unificação (revertida), e nada se apaga.
   */
  @Post('unificacoes/:id/desfazer')
  @HttpCode(200)
  @Permissao('cadastro.paciente.unificar')
  @AuditadoNoHandler('executor: trilha na mesma transação da receita (memória: registrador da API)')
  async desfazerUnificacao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ idAbsorvido: number; idSobrevivente: number }> {
    const s = sessaoDe(req);
    if (req.sghComo !== undefined)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Desfazer numa sessão de suporte',
        MOTIVO_UNIFICACAO_COMO,
        {
          codigo: 'como-sem-correcao',
        },
      );
    const d = esquemaPedidoDesfazerUnificacao.safeParse(corpo);
    if (!d.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escreva o motivo de desfazer a unificação (5 a 400 letras).',
        { campos: [...new Set(d.error.issues.map((i) => i.path.join('.') || 'motivo'))] },
      );
    const n = idDaRota(id);
    const reautenticadoEm =
      this.porta.destino === 'memoria' && !req.sgh?.real
        ? Date.now()
        : await reautenticar(this.sessoes, this.resolvedorObrigatorio(), req, d.data.senha);
    const ctx = { ...contextoOperacao(s, 'cadastro-unificacao-desfeita'), reautenticadoEm };
    const r = await this.porta
      .desfazerUnificacao(s.porta, { idUnificacao: n, motivo: d.data.motivo }, ctx)
      .catch((x: unknown) => {
        throw problemaDoCadastro(x);
      });
    await this.trilhaMemoria(
      s,
      EVENTOS_AUDITAVEIS.pacienteUnificacaoDesfeita.codigo,
      'cadastro.paciente',
      String(n),
    );
    return r.resultado;
  }

  private resolvedorObrigatorio(): ResolvedorSessao {
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário e confirme a senha.',
      );
    return this.resolvedor;
  }

  @Get(':id')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaPaciente> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const f = await montarFicha(this.porta, s.porta, n, permissoesDaFicha(s.pode), s.login);
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    req.sghAlvo = { paciente: n, tabelaAlvo: 'paciente', idAlvo: String(n) };
    return f;
  }

  @Post()
  @HttpCode(201)
  @Permissao('cadastro.paciente.criar')
  @AuditadoNoHandler(
    'executor: trilha de auditoria na mesma transação da receita (memória: registrador da API)',
  )
  async cadastrar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ idPaciente: number; prontuario: number }> {
    const s = sessaoDe(req);
    const e = esquemaCadastrarPaciente.safeParse(corpo);
    if (!e.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(e.error.issues.map((i) => i.path.join('.')))],
      });
    const ctx = contextoOperacao(s, 'cadastro-paciente');
    await this.ficha?.conferirCampos(s.porta, e.data, 'cadastro').catch((x: unknown) => {
      throw problemaDoCadastro(x);
    });
    const r = await this.porta.cadastrar(s.porta, e.data, ctx).catch((x: unknown) => {
      throw problemaDoCadastro(x);
    });
    await this.trilhaMemoria(
      s,
      EVENTOS_AUDITAVEIS.pacienteGravadoMemoria.codigo,
      'cadastro.paciente',
      String(r.resultado.idPaciente),
    );
    return r.resultado;
  }

  @Put(':id')
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler(
    'executor: trilha de auditoria na mesma transação da receita (memória: registrador da API)',
  )
  async alterar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ idPaciente: number }> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const bruto =
      corpo && typeof corpo === 'object' ? { ...(corpo as Record<string, unknown>), idPaciente: n } : corpo;
    const e = esquemaAlterarPaciente.safeParse(bruto);
    if (!e.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(e.error.issues.map((i) => i.path.slice(-1).join('.') || 'alteracoes'))],
      });
    const ctx = contextoOperacao(s, 'cadastro-alteracao');
    await this.ficha?.conferirCampos(s.porta, e.data.alteracoes, 'alteracao').catch((x: unknown) => {
      throw problemaDoCadastro(x);
    });
    const r = await this.porta.alterar(s.porta, e.data, ctx).catch((x: unknown) => {
      throw problemaDoCadastro(x);
    });
    await this.trilhaMemoria(
      s,
      EVENTOS_AUDITAVEIS.pacienteGravadoMemoria.codigo,
      'cadastro.paciente',
      String(n),
    );
    return r.resultado;
  }

  @Get(':id/historico')
  @Permissao('cadastro.historico.ler')
  @Auditar('cadastro.historico.lido')
  async historico(
    @Param('id') id: string,
    @Query('pagina') p: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<HistoricoCadastro> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const perm = permissoesDaFicha(s.pode);
    const h = await montarHistorico(this.porta, s.porta, n, pagina(p), POR_PAGINA_HISTORICO, perm);
    if (!h) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    req.sghAlvo = { paciente: n, tabelaAlvo: 'paciente_versao', idAlvo: String(n) };
    return h;
  }

  @Get(':id/consentimentos')
  @Permissao('cadastro.consentimento.ler')
  async consentimentos(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<Consentimentos> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const [p] = await this.porta.lerPacientes(s.porta, [n]);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    const opcoes = await this.porta.opcoesConsentimento(s.porta);
    const rot = (lista: readonly { codigo: number; rotulo: string }[], c: number) =>
      lista.find((x) => x.codigo === c) ?? { codigo: c, rotulo: String(c) };
    const itens = await this.porta.consentimentos(s.porta, n);
    return {
      itens: itens.map((x) => ({
        id: x.id,
        finalidade: x.finalidade,
        versao: x.versao,
        situacao: rot(opcoes.situacoes, x.situacao),
        signatario: rot(opcoes.signatarios, x.signatario),
        registradoEm: x.registradoEm,
        registradoPor: x.registradoPor,
        revogadoEm: x.revogadoEm,
        motivoRevogacao: x.revogacao === null ? null : rot(opcoes.revogacoes, x.revogacao),
      })),
      opcoes: {
        situacoes: [...opcoes.situacoes],
        signatarios: [...opcoes.signatarios],
        revogacoes: [...opcoes.revogacoes],
      },
    };
  }

  @Post(':id/consentimentos')
  @HttpCode(200)
  @Permissao('cadastro.consentimento.registrar')
  @AuditadoNoHandler('trilha na mesma transação do consentimento (memória: registrador da API)')
  async registrarConsentimento(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const ped = esquemaPedidoConsentimento.safeParse(corpo);
    if (!ped.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.');
    const [p] = await this.porta.lerPacientes(s.porta, [n]);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    const ev = EVENTOS_AUDITAVEIS.consentimentoRegistrado.codigo;
    const trilha = linhaTrilha(s, ev, 'cadastro.consentimento', 'cadastro.registrarConsentimento', {
      tabela: 'consentimento_titular',
      paciente: n,
      chave: ped.data.acao === 'registrar' ? `${ped.data.finalidade}:${ped.data.versao}` : 'revogacao',
    });
    try {
      if (ped.data.acao === 'registrar') {
        const novo = await this.porta.registrarConsentimento(
          s.porta,
          {
            idPaciente: n,
            pront: p.prontuario,
            finalidade: ped.data.finalidade,
            versao: ped.data.versao,
            situacao: ped.data.situacao,
            signatario: ped.data.signatario,
            usuario: s.login,
          },
          trilha,
        );
        await this.trilhaMemoria(s, ev, 'cadastro.consentimento', String(novo));
        return { id: novo };
      }
      await this.porta.revogarConsentimento(
        s.porta,
        { idPaciente: n, id: ped.data.id, motivo: ped.data.motivo, usuario: s.login },
        trilha,
      );
      await this.trilhaMemoria(s, ev, 'cadastro.consentimento', String(ped.data.id));
      return { id: ped.data.id };
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }
}
