// Cadastros › Estrutura e as consultas de Administração › Organização e parâmetros (M10, ficha seção 7):
//   GET  /api/cadastros/estrutura                      empresa, hospital (CNES) e unidades
//   GET  /api/cadastros/estrutura/leitos               blocos → acomodações → leitos (cadastro único)
//   GET  /api/cadastros/estrutura/leitos/conferencia   o cadastro × o registro de conferência (regra 13)
//   POST /api/cadastros/estrutura/leitos/:operacao     acomodação e leito pelas receitas (nunca o espelho), com a
//                                                      senha de novo (reautenticação; ficha seção 5, SBIS-07)
//   GET  /api/cadastros/estrutura/locais/complementos  guichês, horários e encaminhamentos (consulta)
//   GET  /api/administracao/alertas | notificacoes | empresa | backup
//   GET  /api/administracao/parametros-banco[/:chave]  os parâmetros gravados no banco (tipo e origem)
// A estrutura é pequena: cache em memória por um minuto (a gravação invalida), com a chave da rede e do
// estabelecimento (ADR 0011: uma rede nunca enxerga a estrutura de outra). Credencial nunca sai.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  type Alertas,
  type Backup,
  type ConferenciaLeitos,
  type DadosFiscais,
  type Estrutura,
  EVENTOS_AUDITAVEIS,
  type IndiceParametrosBanco,
  type Leitos,
  NOMES_OPERACOES_LEITOS,
  OPERACOES_LEITOS,
  type OperacaoLeito,
  PERMISSOES_M10_CODIGOS,
  type ServidorEmail,
  type TabelaParametrosBanco,
} from '@sgh/contratos';
import {
  arvoreDeLeitos,
  conferirLeitos,
  ehSentinela,
  leitoAtivo,
  opcoesSemSentinela,
} from '@sgh/dominio-organizacao';
import { chaveDoContexto, TABELAS_PARAMETROS_BANCO } from '@sgh/legado';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  analisar,
  contextoOperacao,
  ctxDe,
  problema,
  reautenticado,
  sessaoDe,
  semSegredos,
} from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';

const C = PERMISSOES_M10_CODIGOS;
const NUM = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const TXT = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trimEnd();
const versao = (valores: readonly unknown[]) => JSON.stringify(valores.map((v) => TXT(v)));

@Controller()
export class EstruturaController {
  private cache = new Map<string, { em: number; valor: unknown }>();

  constructor(
    @Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private async emCache<T>(chave: string, ler: () => Promise<T>): Promise<T> {
    const x = this.cache.get(chave);
    if (x && Date.now() - x.em < 60_000) return x.valor as T;
    const valor = await ler();
    this.cache.set(chave, { em: Date.now(), valor });
    return valor;
  }

  @Get('cadastros/estrutura')
  @Permissao(C.estruturaLer)
  @Auditar(EVENTOS_AUDITAVEIS.estruturaConsultada.codigo)
  async estrutura(@Req() req: RequisicaoAutorizada): Promise<Estrutura> {
    const c = ctxDe(req, 'estrutura');
    const e = await this.emCache(chaveDoContexto(c, 'cache', 'estrutura'), () =>
      this.fonte.estrutura(c),
    ).catch((x: unknown) => problema(x));
    return semSegredos({
      empresa: e.empresa,
      hospital: e.hospital,
      unidades: e.unidades.map((u) => ({
        ...u,
        sentinela: ehSentinela({ codigo: u.codigo, descricao: u.nome }),
      })),
      destino: this.fonte.destino,
    });
  }

  @Get('cadastros/estrutura/leitos')
  @Permissao(C.leitoLer)
  @Auditar(EVENTOS_AUDITAVEIS.estruturaConsultada.codigo)
  async leitos(@Req() req: RequisicaoAutorizada): Promise<Leitos> {
    const c = ctxDe(req, 'estrutura-leitos');
    const l = await this.fonte.leitos(c).catch((x: unknown) => problema(x));
    const acs = l.acomodacoes.map((a) => ({
      bloco: TXT(a['BLOCO']),
      acomodacao: TXT(a['ACOMOD']),
      nome: TXT(a['NOME']),
      leitosPrevistos: NUM(a['LEITOS']),
      clinica: null,
      centroCusto: NUM(a['CDC']),
    }));
    const a = arvoreDeLeitos(
      l.blocos,
      acs,
      l.leitos.map((x) => ({
        id: x.id,
        bloco: x.bloco,
        acomodacao: x.acomodacao,
        leito: x.leito,
        ativo: leitoAtivo(x.status),
        ocupado: x.ocupado,
        ramal: x.ramal,
      })),
    );
    const bruto = new Map(l.acomodacoes.map((x) => [`${TXT(x['BLOCO'])}|${TXT(x['ACOMOD'])}`, x]));
    const leitoBruto = new Map(l.leitos.map((x) => [x.id, x]));
    return semSegredos({
      blocos: a.blocos.map((b) => ({
        bloco: b.bloco,
        nome: b.nome,
        andares: b.andares,
        ativos: b.ativos,
        ocupados: b.ocupados,
        acomodacoes: b.acomodacoes.map((ac) => {
          const r = bruto.get(`${ac.bloco}|${ac.acomodacao}`) ?? {};
          return {
            acomodacao: ac.acomodacao,
            nome: ac.nome,
            andar: NUM(r['ANDAR']),
            leitosPrevistos: ac.leitosPrevistos,
            sexo: TXT(r['SEXO']) || null,
            tipo: NUM(r['TIPO']),
            convenio: TXT(r['TCONV']) || null,
            centroCusto: ac.centroCusto,
            localConta: NUM(r['LCONS']),
            ativos: ac.ativos,
            ocupados: ac.ocupados,
            versao: versao(['NOME', 'ANDAR', 'LEITOS', 'SEXO', 'TIPO', 'TCONV'].map((k) => r[k])),
            leitos: ac.leitos.map((x) => {
              const lb = leitoBruto.get(x.id);
              return {
                id: x.id,
                leito: x.leito,
                ativo: x.ativo,
                ocupado: x.ocupado,
                ramal: x.ramal,
                andar: lb?.andar ?? null,
                versao: versao([lb?.status, lb?.ramal, lb?.andar, lb?.reg]),
              };
            }),
          };
        }),
      })),
      orfaos: a.orfaos.map((x) => ({ id: x.id, bloco: x.bloco, acomodacao: x.acomodacao, leito: x.leito })),
      totais: a.totais,
      opcoes: {
        tipos: opcoesSemSentinela(
          l.opcoes.tipos.map((o) => ({ ...o, codigo: o.valor, descricao: o.rotulo })),
        ).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
        centrosCusto: opcoesSemSentinela(
          l.opcoes.centrosCusto.map((o) => ({ ...o, codigo: o.valor, descricao: o.rotulo })),
        ).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
        locaisConta: opcoesSemSentinela(
          l.opcoes.locaisConta.map((o) => ({ ...o, codigo: o.valor, descricao: o.rotulo })),
        ).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
        tiposTiss: opcoesSemSentinela(
          l.opcoes.tiposTiss.map((o) => ({ ...o, codigo: o.valor, descricao: o.rotulo })),
        ).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
      },
      operacoes: NOMES_OPERACOES_LEITOS.map((operacao) => {
        const r = this.fonte.receita(operacao, c.hospital);
        return { operacao, rotulo: OPERACOES_LEITOS[operacao], ligada: r.ligada, motivo: r.motivo };
      }),
      destino: this.fonte.destino,
    });
  }

  @Get('cadastros/estrutura/leitos/conferencia')
  @Permissao(C.leitoLer)
  @Auditar(EVENTOS_AUDITAVEIS.estruturaConsultada.codigo)
  async conferencia(@Req() req: RequisicaoAutorizada): Promise<ConferenciaLeitos> {
    const c = ctxDe(req, 'estrutura-leitos');
    const inicio = performance.now();
    const [l, e] = await Promise.all([this.fonte.leitos(c), this.fonte.espelho(c)]).catch((x: unknown) =>
      problema(x),
    );
    const r = conferirLeitos(
      {
        acomodacoes: l.acomodacoes.map((a) => ({
          bloco: TXT(a['BLOCO']),
          acomodacao: TXT(a['ACOMOD']),
          nome: TXT(a['NOME']),
        })),
        leitos: l.leitos.map((x) => ({
          bloco: x.bloco,
          acomodacao: x.acomodacao,
          leito: x.leito,
          ativo: leitoAtivo(x.status),
          ramal: x.ramal,
        })),
      },
      e,
    );
    return {
      divergencias: [...r.divergencias],
      contagens: r.contagens,
      porTipo: r.porTipo,
      retratos: e.retratos,
      tempoMs: Math.round(performance.now() - inicio),
    };
  }

  @Post('cadastros/estrutura/leitos/:operacao')
  @HttpCode(200)
  @Permissao(C.leitoEditar)
  @AuditadoNoHandler('executor: SGH_TRILHA na mesma transação da receita (o espelho é dos gatilhos)')
  async gravarLeito(
    @Param('operacao') nome: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const operacao = `organizacao.${nome}` as OperacaoLeito;
    if (!(NOMES_OPERACOES_LEITOS as readonly string[]).includes(operacao))
      throw new ErroProblema('nao-encontrado', 404, 'Operação não encontrada');
    const p = analisar(
      // Sem a senha: 401 na reautenticação (regra 8), não 400.
      z.object({ entrada: z.unknown(), senha: z.string().max(200).optional() }).strict(),
      corpo,
    );
    const reaut = await reautenticado(this.servico, this.resolvedor, req, p.senha);
    const r = await this.fonte
      .executar(operacao, p.entrada, contextoOperacao(req, 'estrutura-leitos', reaut))
      .catch((x: unknown) => problema(x));
    this.cache.clear();
    return { operacao, destino: this.fonte.destino, ...(typeof r['id'] === 'number' ? { id: r['id'] } : {}) };
  }

  @Get('cadastros/estrutura/locais/complementos')
  @Permissao('organizacao.local.ler')
  async locais(@Req() req: RequisicaoAutorizada) {
    const c = ctxDe(req, 'estrutura-locais');
    return this.fonte.locaisComplementos(c).catch((x: unknown) => problema(x));
  }

  // ── Organização e parâmetros (consultas) ───────────────────────────────────────────────────────

  @Get('administracao/alertas')
  @Permissao(C.alertaLer)
  @Auditar(EVENTOS_AUDITAVEIS.configuracaoConsultada.codigo)
  async alertas(@Req() req: RequisicaoAutorizada): Promise<Alertas> {
    const a = await this.fonte.alertas(ctxDe(req, 'config')).catch((x: unknown) => problema(x));
    return { alertas: [...a], destino: this.fonte.destino };
  }

  @Get('administracao/notificacoes')
  @Permissao(C.emailLer)
  @Auditar(EVENTOS_AUDITAVEIS.configuracaoConsultada.codigo)
  async email(@Req() req: RequisicaoAutorizada): Promise<ServidorEmail> {
    const e = await this.fonte.email(ctxDe(req, 'config')).catch((x: unknown) => problema(x));
    // Regra 19: fora de produção, a saída de e-mail é a caixa de teste (nenhum endereço real ligado).
    const ambiente = (process.env['AMBIENTE'] ?? 'dev').trim();
    return semSegredos({
      servidores: e.servidores,
      modulos: e.modulos,
      saidaDeTeste: ambiente !== 'producao',
      destino: this.fonte.destino,
    });
  }

  @Get('administracao/empresa')
  @Permissao(C.empresaLer)
  @Auditar(EVENTOS_AUDITAVEIS.configuracaoConsultada.codigo)
  async empresa(@Req() req: RequisicaoAutorizada): Promise<DadosFiscais> {
    const f = await this.fonte.fiscais(ctxDe(req, 'config')).catch((x: unknown) => problema(x));
    return semSegredos({ empresa: f, destino: this.fonte.destino });
  }

  @Get('administracao/backup')
  @Permissao(C.backupLer)
  @Auditar(EVENTOS_AUDITAVEIS.configuracaoConsultada.codigo)
  async backup(@Req() req: RequisicaoAutorizada): Promise<Backup> {
    const b = await this.fonte.backup(ctxDe(req, 'config')).catch((x: unknown) => problema(x));
    return { ...b, destino: this.fonte.destino };
  }

  @Get('administracao/parametros-banco')
  @Permissao('config.parametro.ler')
  indice(): IndiceParametrosBanco {
    return {
      tabelas: TABELAS_PARAMETROS_BANCO.map((t) => ({
        chave: t.chave,
        rotulo: t.rotulo,
        modulo: t.modulo,
        porUsuario: t.colunaUsuario !== null,
        linhas: 0,
      })),
      destino: this.fonte.destino,
    };
  }

  @Get('administracao/parametros-banco/:chave')
  @Permissao('config.parametro.ler')
  @Auditar(EVENTOS_AUDITAVEIS.configuracaoConsultada.codigo)
  async parametros(
    @Param('chave') chave: string,
    @Req() req: RequisicaoAutorizada,
    @Query('login') login?: string,
  ): Promise<TabelaParametrosBanco> {
    const t = TABELAS_PARAMETROS_BANCO.find((x) => x.chave === chave);
    if (!t) throw new ErroProblema('nao-encontrado', 404, 'Tabela de parâmetros não encontrada');
    const quem = login && /^\S{1,31}$/.test(login) ? login : sessaoDe(req).login;
    const r = await this.fonte
      .parametrosBanco(ctxDe(req, 'config'), chave, quem)
      .catch((x: unknown) => problema(x));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Tabela de parâmetros não encontrada');
    // Os nomes das colunas ocultas aparecem (origem), nunca o valor (o SELECT não as lê).
    return {
      chave: t.chave,
      rotulo: t.rotulo,
      modulo: t.modulo,
      porUsuario: t.colunaUsuario !== null,
      linhas: r.linhas,
      parametros: r.parametros,
      criterio: r.criterio,
      registros: r.registros,
    };
  }
}
