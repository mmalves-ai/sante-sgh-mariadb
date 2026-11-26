// Tela "Usuários" (M10, ficha seção 7; cap-08 §8.9: um cadastro de usuário só, nos dois sistemas):
//   GET  /api/administracao/acesso/usuarios               lista paginada no servidor (teto 200)
//   GET  /api/administracao/acesso/usuarios/:login        ficha (escopos, papéis, flags, conexões, termo)
//   GET  /api/administracao/acesso/usuarios-opcoes        opções de escopo, grupos e setores
//   POST /api/administracao/acesso/usuarios               acesso.criarUsuario
//   POST /api/administracao/acesso/usuarios/:login/nome   acesso.alterarUsuario
//   POST /api/administracao/acesso/usuarios/:login/grupo  acesso.trocarGrupoUsuario (ADR 0022)
//   POST /api/administracao/acesso/usuarios/:login/bloqueio  acesso.bloquearUsuario | desbloquearUsuario
//   POST /api/administracao/acesso/usuarios/:login/escopos   acesso.conceder|retirar<Tipo>Usuario
//   POST /api/administracao/acesso/usuarios/:login/flags     acesso.alterarFlagsUsuario (W1-01: permissões complementares)
//   POST /api/administracao/acesso/usuarios/:login/setores   SGH_ACESSO_ESCOPO_SETOR
//   POST /api/administracao/acesso/usuarios/:login/senha-provisoria  acesso.redefinirSenha (W1-01: a senha provisória
//        volta só nesta resposta, sem cache; troca obrigatória no próximo acesso; as sessões do usuário caem)
// Toda gravação pede a senha (reautenticação; SBIS-07, regra 8) e a Idempotency-Key; ninguém altera, bloqueia ou
// muda o escopo de si mesmo; o Auditor só consulta (regra 7). O bloqueio derruba as sessões do usuário.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  cpfDaPlataforma,
  esquemaConsultaUsuarios,
  flagAceita,
  esquemaLogin,
  esquemaPedidoSetor,
  esquemaPedidoUsuario,
  EVENTOS_AUDITAVEIS,
  type FichaUsuario,
  type ListaUsuarios,
  NOMES_OPERACOES_USUARIOS,
  operacaoDeEscopo,
  OPERACOES_USUARIOS,
  type OpcoesEscopo,
  type PainelCpf,
  PERMISSOES_M10_CODIGOS,
  type ResultadoUsuario,
  TIPOS_ESCOPO,
} from '@sgh/contratos';
import { type AcaoGestao, conferirGestao, mensagemRecusaGestao, montarPainelCpf } from '@sgh/dominio-acesso';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import { SERVICO_SANEAMENTO } from '../acesso/saneamento/saneamento.controller.js';
import { ErroSaneamento, type ServicoSaneamento } from '../acesso/saneamento/servico.js';
import { ErroSessao, type ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { FONTE_GESTAO } from '../acesso/gestao-fonte.js';
import { exigirGestorRestante, type LeitorGestores } from '../acesso/ultimo-gestor.js';
import {
  analisar,
  contextoOperacao,
  ctxDe,
  problema,
  reautenticado,
  sessaoDe,
  semSegredos,
  trilhaDe,
} from './comum.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from '../recepcao/public-api.js';
import { criarContaComSenhaInicial } from './criacao-com-senha.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';
import { conferirLoginDePainel } from './login-painel.js';

const C = PERMISSOES_M10_CODIGOS;

const esquemaEscopo = z.object({
  tipo: z.enum(TIPOS_ESCOPO),
  acao: z.enum(['conceder', 'retirar']),
  valor: z.union([z.number().int(), z.string().min(1).max(10)]),
  // Sem a senha: 401 na reautenticação (regra 8), não 400.
  senha: z.string().max(200).optional(),
});
const esquemaBloqueio = z.object({ bloquear: z.boolean(), senha: z.string().max(200).optional() });
const esquemaSoSenha = z.object({ senha: z.string().max(200).optional() }).strict();

@Controller('administracao/acesso')
export class UsuariosController {
  constructor(
    @Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(PORTA_RECEPCAO) private readonly recepcao: PortaRecepcao | null = null,
    /** M59-F4: o limite de administradores (acesso.saneamento.administradoresMaximo) também vale nesta tela. */
    @Optional() @Inject(SERVICO_SANEAMENTO) private readonly saneamento: ServicoSaneamento | null = null,
    /** W1-01 (parte 3c): os gestores de acessos ativos, para a regra do último gestor. */
    @Optional() @Inject(FONTE_GESTAO) private readonly gestores: LeitorGestores | null = null,
  ) {}

  /**
   * M59-F4 (achado 1 da revisão do M59.4): ninguém entra no grupo de acesso total (criar, trocar de grupo ou
   * desbloquear quem está nele) acima do máximo de administradores do estabelecimento. `grupoNovo` null: desbloqueio.
   * Sem o serviço (testes sem o saneamento montado), a guarda não se aplica.
   */
  private async conferirLimiteAdministradores(
    req: RequisicaoAutorizada,
    login: string,
    grupoNovo: string | null,
  ): Promise<void> {
    if (!this.saneamento) return;
    const s = sessaoDe(req);
    await this.saneamento
      .conferirEntradaNoMaster({ rede: s.rede, hospital: s.hospital }, login, grupoNovo)
      .catch((e: unknown) => {
        if (e instanceof ErroSaneamento)
          throw new ErroProblema('recusa-de-negocio', e.status, 'Não foi possível concluir', e.detalhe, {
            codigo: e.codigo,
          });
        throw new ErroProblema(
          'indisponivel',
          503,
          'Não foi possível conferir o limite de administradores; tente de novo.',
        );
      });
  }

  /** M43 (regra 4): o login do grupo de painéis só é bloqueado depois da troca do aparelho (login-painel.ts). */
  private async conferirLoginDePainel(req: RequisicaoAutorizada, login: string): Promise<void> {
    const c = ctxDe(req, 'acesso-usuarios');
    const s = sessaoDe(req);
    // Sem convivência com sistema anterior (ADR 0003): não há registro de fim a consultar.
    const fontes = { recepcao: this.recepcao, raizFim: null };
    await conferirLoginDePainel(fontes, { rede: s.rede, hospital: s.hospital }, login, async () => {
      const f = await this.fonte.fichaUsuario(c, login, false);
      return f ? (f.grupo ?? null) : undefined;
    });
  }

  private login(bruto: string): string {
    const r = esquemaLogin.safeParse(bruto);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Login inválido');
    return r.data;
  }

  /** Segregação (regra 7) antes de abrir transação: a si mesmo e o Auditor que só consulta. */
  private segregacao(req: RequisicaoAutorizada, acao: AcaoGestao, alvo: string | null): void {
    const s = sessaoDe(req);
    const r = conferirGestao({ login: s.login, perfis: s.perfis }, acao, alvo);
    if (r)
      throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagemRecusaGestao(r, acao), {
        codigo: r,
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    operacao: string,
    entrada: unknown,
    senha: string | undefined,
  ): Promise<Record<string, unknown>> {
    const reaut = await reautenticado(this.servico, this.resolvedor, req, senha);
    return this.fonte
      .executar(operacao, entrada, contextoOperacao(req, 'acesso-usuarios', reaut))
      .catch((e: unknown) => problema(e));
  }

  @Get('usuarios')
  @Permissao(C.usuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.usuarioConsultado.codigo)
  async lista(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>): Promise<ListaUsuarios> {
    const f = analisar(esquemaConsultaUsuarios, q);
    const pagina = f.pagina ?? 1;
    const porPagina = f.porPagina ?? 50;
    const r = await this.fonte
      .listarUsuarios(ctxDe(req, 'acesso-usuarios'), {
        ...(f.busca ? { busca: f.busca } : {}),
        ...(f.grupo ? { grupo: f.grupo } : {}),
        situacao: f.situacao ?? 'todos',
        pagina,
        porPagina,
      })
      .catch((e: unknown) => problema(e));
    return semSegredos({ ...r, pagina, porPagina, destino: this.fonte.destino });
  }

  /**
   * W1-01 (parte 3c): identidade única. Contas pessoais ativas sem CPF e logins que repartem o mesmo CPF (sem o
   * número: a chave do grupo é um número de ordem). Corrigir é pela ficha (troca de CPF com justificativa) ou pelo
   * bloqueio do login a mais.
   */
  @Get('usuarios-cpf')
  @Permissao(C.usuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.usuarioConsultado.codigo)
  async painelCpf(@Req() req: RequisicaoAutorizada): Promise<PainelCpf> {
    const r = await this.fonte.painelCpf(ctxDe(req, 'acesso-usuarios')).catch((e: unknown) => problema(e));
    return semSegredos({ ...montarPainelCpf(r.semCpf, r.duplicadas), destino: this.fonte.destino });
  }

  @Get('usuarios-opcoes')
  @Permissao(C.usuarioLer)
  async opcoes(@Req() req: RequisicaoAutorizada): Promise<{
    escopos: OpcoesEscopo;
    grupos: { nome: string; ativo: boolean }[];
    setores: { valor: string; rotulo: string }[];
  }> {
    const c = ctxDe(req, 'acesso-usuarios');
    const [escopos, grupos, leitos] = await Promise.all([
      this.fonte.opcoesEscopo(c),
      this.fonte.grupos(c),
      this.fonte.leitos(c),
    ]).catch((e: unknown) => problema(e));
    return {
      escopos: escopos as OpcoesEscopo,
      grupos: grupos
        .map((g) => ({ nome: g.nome, ativo: g.ativo }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      setores: leitos.blocos.map((b) => ({ valor: b.bloco, rotulo: b.nome })),
    };
  }

  @Get('usuarios/:login')
  @Permissao(C.usuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.usuarioConsultado.codigo)
  // A ficha pode levar o CPF (plataforma): nada de cache no navegador nem em proxy.
  @Header('Cache-Control', 'no-store')
  async ficha(@Param('login') bruto: string, @Req() req: RequisicaoAutorizada): Promise<FichaUsuario> {
    const login = this.login(bruto);
    const s = sessaoDe(req);
    // Histórico de senha só para o Auditor (contagem e data; nunca o valor).
    const auditor = s.perfis.includes('auditor');
    // CPF só para a conta da PLATAFORMA (sessão "como" ou acesso total de ator plataforma; pedido do dono de
    // 17/11/2026). Gestor de acessos, suporte técnico e Auditor seguem com o "informado / não informado".
    const plataforma = req.sghComo?.atorTipo === 'plataforma';
    const c = ctxDe(req, 'acesso-usuarios');
    const f = await this.fonte
      .fichaUsuario(c, login, auditor, { cpf: plataforma })
      .catch((e: unknown) => problema(e));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    const cpf = plataforma ? cpfDaPlataforma(f.cpf) : null;
    // A trilha da consulta (@Auditar) passa a dizer QUAL usuário foi lido e se o CPF foi mostrado (sem o valor).
    req.sghAlvo = {
      tabelaAlvo: 'usuario',
      idAlvo: String(f.id),
      ...(cpf === null ? {} : { chaveNaturalAlvo: 'ficha;cpf:visto' }),
    };
    const setores = await this.fonte.setores(c, login).catch(() => []);
    // Sessões ativas no sistema novo (o que o bloqueio derruba): sem token, CSRF nem endereço.
    const sessoes = this.servico
      ? await this.servico.sessoesDoUsuario(s.rede, s.hospital, login).catch(() => [])
      : [];
    const escopos = Object.fromEntries(
      TIPOS_ESCOPO.map((t) => [t, [...(f.escopos[t] ?? [])]]),
    ) as FichaUsuario['escopos'];
    // A regra 10 confere a ficha SEM o CPF; o campo `cpf` entra depois, já conferido (11 dígitos ou null).
    const ficha = semSegredos({
      usuario: {
        login: f.login,
        id: f.id,
        nome: f.nome,
        grupo: f.grupo,
        ativo: f.ativo,
        bloqueado: f.bloqueado,
        cpfInformado: f.cpfInformado,
        senhaDefinida: f.senhaDefinida,
        versao: JSON.stringify(f.versao),
      },
      grupoAtivo: f.grupoAtivo,
      papeis: [...f.papeis],
      escopos,
      escoposConsulta: f.escoposConsulta,
      setores: [...setores],
      flags: f.flags.map((x) => ({
        coluna: x.coluna,
        letra: x.letra,
        ligado: x.letra === null ? null : x.letra === 'T' || x.letra === 'S',
        aConfirmar: true,
        // W1-01 (parte 3b): só a letra já vista na coluna (T para ligar, F para desligar).
        podeLigar: flagAceita(x.coluna, true),
        podeDesligar: flagAceita(x.coluna, false),
      })),
      conexoes: [...f.conexoes],
      sessoes,
      termo: f.termo,
      historicoSenha: f.historicoSenha,
      profissionalVinculado: f.profissionalVinculado,
      operacoes: NOMES_OPERACOES_USUARIOS.map((operacao) => {
        const r = this.fonte.receita(operacao, s.hospital);
        // W1-01: a redefinição depende da combinação do resumo confirmada pelo vetor capturado (dependência do dono).
        if (operacao === 'acesso.redefinirSenha' && r.ligada && !this.servico?.trocaSenhaDisponivel)
          return {
            operacao,
            rotulo: OPERACOES_USUARIOS[operacao],
            ligada: false,
            motivo:
              'A gravação da senha aguarda a confirmação do formato da senha deste estabelecimento (vetor de teste do administrador do sistema).',
          };
        return { operacao, rotulo: OPERACOES_USUARIOS[operacao], ligada: r.ligada, motivo: r.motivo };
      }),
      destino: this.fonte.destino,
    });
    return { ...ficha, usuario: { ...ficha.usuario, cpf } };
  }

  @Post('usuarios')
  @HttpCode(201)
  // A resposta leva a senha inicial: nada de cache no navegador nem em proxy.
  @Header('Cache-Control', 'no-store')
  @Permissao(C.usuarioCriar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<
    ResultadoUsuario & { senhaProvisoria?: string; trocaObrigatoria?: boolean; senhaPendente?: string }
  > {
    const p = analisar(esquemaPedidoUsuario, corpo);
    this.segregacao(req, 'criar-usuario', null);
    const e = (p.entrada ?? {}) as { login?: unknown; grupo?: unknown };
    if (typeof e.grupo === 'string' && typeof e.login === 'string')
      await this.conferirLimiteAdministradores(req, e.login, e.grupo);
    // O resumo da senha inicial só o servidor põe (a receita o aceita além do contrato público): de fora, recusa.
    if (p.entrada !== null && typeof p.entrada === 'object' && 'resumoSenhaInicial' in p.entrada)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Entrada inválida',
        'Campo não aceito: resumoSenhaInicial.',
      );
    // Um passo só e uma gravação só: a senha inicial (provisória, de troca obrigatória) é gerada e cifrada antes, e a
    // conta nasce com a credencial na mesma transação; a senha volta nesta resposta.
    const servico = this.servico;
    const login = typeof e.login === 'string' ? e.login.trim() : '';
    const s = sessaoDe(req);
    const reaut = await reautenticado(this.servico, this.resolvedor, req, p.senha);
    const c = contextoOperacao(req, 'acesso-usuarios', reaut);
    const origem = { correlacao: c.correlacao || 'acesso-usuarios', estacao: c.estacao || '' };
    const { conta: r, senhaInicial } = await criarContaComSenhaInicial(
      servico && servico.trocaSenhaDisponivel && login !== ''
        ? () => servico.senhaInicialDaConta(s.rede, s.hospital, login)
        : null,
      (resumo) =>
        this.fonte
          .executar(
            'acesso.criarUsuario',
            resumo === null ? p.entrada : { ...(p.entrada as object), resumoSenhaInicial: resumo },
            c,
          )
          .catch((x: unknown) => problema(x)),
      servico
        ? (conta, senha) =>
            typeof conta['idUsuario'] === 'number'
              ? servico.concluirSenhaInicial(
                  { rede: s.rede, estabelecimento: s.hospital, login: s.login, idUsuario: s.usuario },
                  login,
                  conta['idUsuario'],
                  senha,
                  origem,
                )
              : Promise.resolve(true)
        : undefined,
    );
    return {
      operacao: 'acesso.criarUsuario',
      destino: this.fonte.destino,
      ...(typeof r['idUsuario'] === 'number' ? { id: r['idUsuario'] } : {}),
      ...(senhaInicial.emitida
        ? {
            senhaProvisoria: senhaInicial.senha.senhaProvisoria,
            trocaObrigatoria: senhaInicial.senha.trocaObrigatoria,
          }
        : { senhaPendente: senhaInicial.motivo }),
    };
  }

  @Post('usuarios/:login/nome')
  @HttpCode(200)
  @Permissao(C.usuarioEditar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async nome(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaPedidoUsuario, corpo);
    this.segregacao(req, 'alterar-usuario', login);
    await this.gravar(req, 'acesso.alterarUsuario', { ...(p.entrada as object), login }, p.senha);
    return { operacao: 'acesso.alterarUsuario', destino: this.fonte.destino };
  }

  @Post('usuarios/:login/grupo')
  @HttpCode(200)
  @Permissao(C.usuarioEditar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async grupo(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaPedidoUsuario, corpo);
    this.segregacao(req, 'alterar-usuario', login);
    const grupoNovo = ((p.entrada ?? {}) as { grupo?: unknown }).grupo;
    if (typeof grupoNovo === 'string') {
      await this.conferirLimiteAdministradores(req, login, grupoNovo);
      const s = sessaoDe(req);
      await exigirGestorRestante(this.gestores, s.rede, s.hospital, {
        tipo: 'trocar-grupo',
        login,
        grupoNovo,
      });
    }
    await this.gravar(req, 'acesso.trocarGrupoUsuario', { ...(p.entrada as object), login }, p.senha);
    await this.servico?.servicoAutorizacao?.invalidar(sessaoDe(req).rede, sessaoDe(req).hospital, login);
    return { operacao: 'acesso.trocarGrupoUsuario', destino: this.fonte.destino };
  }

  @Post('usuarios/:login/bloqueio')
  @HttpCode(200)
  @Permissao(C.usuarioBloquear)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async bloqueio(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaBloqueio, corpo);
    this.segregacao(req, p.bloquear ? 'bloquear-usuario' : 'desbloquear-usuario', login);
    if (p.bloquear) {
      await this.conferirLoginDePainel(req, login);
      const s = sessaoDe(req);
      await exigirGestorRestante(this.gestores, s.rede, s.hospital, { tipo: 'bloquear', login });
    } else await this.conferirLimiteAdministradores(req, login, null);
    const operacao = p.bloquear ? 'acesso.bloquearUsuario' : 'acesso.desbloquearUsuario';
    await this.gravar(req, operacao, { login }, p.senha);
    // Depois do commit: as sessões do usuário no sistema novo caem (ficha, seção 5).
    const s = sessaoDe(req);
    if (p.bloquear) await this.servico?.revogarSessoesDoUsuario(s.rede, s.hospital, login);
    return { operacao, destino: this.fonte.destino, ...(p.bloquear ? { sessoesEncerradas: 1 } : {}) };
  }

  @Post('usuarios/:login/senha-provisoria')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Permissao(C.usuarioBloquear)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async redefinirSenha(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario & { senhaProvisoria: string; trocaObrigatoria: boolean }> {
    const login = this.login(bruto);
    const p = analisar(esquemaSoSenha, corpo);
    this.segregacao(req, 'redefinir-senha', login);
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'A redefinição de senha está indisponível; tente de novo.');
    const reaut = await reautenticado(this.servico, this.resolvedor, req, p.senha);
    const c = contextoOperacao(req, 'acesso-usuarios', reaut);
    const s = sessaoDe(req);
    const r = await this.servico
      .redefinirSenha(
        { rede: s.rede, estabelecimento: s.hospital, login: s.login },
        login,
        { correlacao: c.correlacao || 'acesso-usuarios', estacao: c.estacao || '' },
        reaut,
      )
      .catch((e: unknown) => {
        if (e instanceof ErroSessao)
          throw new ErroProblema(
            e.tipo === 'indisponivel' ? 'indisponivel' : 'recusa-de-negocio',
            e.tipo === 'indisponivel' ? 503 : 409,
            'Não foi possível redefinir a senha',
            e.detalhe,
            { codigo: e.tipo },
          );
        return problema(e);
      });
    return {
      operacao: 'acesso.redefinirSenha',
      destino: this.fonte.destino,
      senhaProvisoria: r.senhaProvisoria,
      trocaObrigatoria: r.trocaObrigatoria,
    };
  }

  @Post('usuarios/:login/escopos')
  @HttpCode(200)
  @Permissao(C.escopoEditar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async escopo(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaEscopo, corpo);
    this.segregacao(req, 'alterar-escopo', login);
    const operacao = operacaoDeEscopo(p.tipo, p.acao);
    await this.gravar(req, operacao, { login, valor: p.valor }, p.senha);
    await this.servico?.servicoAutorizacao?.invalidar(sessaoDe(req).rede, sessaoDe(req).hospital, login);
    return { operacao, destino: this.fonte.destino };
  }

  @Post('usuarios/:login/flags')
  @HttpCode(200)
  @Permissao(C.usuarioEditar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async flags(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaPedidoUsuario, corpo);
    this.segregacao(req, 'alterar-escopo', login);
    await this.gravar(req, 'acesso.alterarFlagsUsuario', { ...(p.entrada as object), login }, p.senha);
    await this.servico?.servicoAutorizacao?.invalidar(sessaoDe(req).rede, sessaoDe(req).hospital, login);
    return { operacao: 'acesso.alterarFlagsUsuario', destino: this.fonte.destino };
  }

  @Post('usuarios/:login/setores')
  @HttpCode(200)
  @Permissao(C.escopoEditar)
  @AuditadoNoHandler(
    'SGH_ACESSO_ESCOPO_SETOR e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)',
  )
  async setor(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaPedidoSetor, corpo);
    this.segregacao(req, 'alterar-escopo', login);
    await reautenticado(this.servico, this.resolvedor, req, p.senha);
    const c = ctxDe(req, 'acesso-usuarios');
    const f = await this.fonte.fichaUsuario(c, login, false).catch((e: unknown) => problema(e));
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Usuário não encontrado');
    const s = sessaoDe(req);
    await this.fonte
      .setor(
        c,
        { rede: s.rede, hospital: s.hospital, idUsuario: f.id, login, bloco: p.bloco, por: s.login },
        p.acao,
        trilhaDe(
          req,
          EVENTOS_AUDITAVEIS.escopoSetorAlterado.codigo,
          'acesso.escopoSetor',
          `acesso.${p.acao}Setor`,
        ),
      )
      .catch((e: unknown) => problema(e));
    return { operacao: `acesso.${p.acao}Setor`, destino: this.fonte.destino };
  }
}
