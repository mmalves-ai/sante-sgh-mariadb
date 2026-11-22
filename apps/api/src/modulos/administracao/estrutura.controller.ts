// Cadastros › Estrutura e as consultas de Administração › Organização e parâmetros (M10, ficha seção 7):
//   GET  /api/cadastros/estrutura                      empresa, hospital (CNES) e unidades
//   GET  /api/cadastros/estrutura/leitos               blocos → acomodações → leitos (cadastro único)
//   POST /api/cadastros/estrutura/leitos/:operacao     acomodação e leito pelas operações da gestão, com a
//                                                      senha de novo (reautenticação; ficha seção 5, SBIS-07)
//   GET  /api/cadastros/estrutura/locais/complementos  guichês, horários e encaminhamentos (consulta)
//   GET  /api/administracao/alertas | notificacoes | empresa | backup
// Melhoria (ADR 0003): a conferência com o espelho do sistema de origem e o visor cru das tabelas de parâmetros de
// origem saíram; os parâmetros são os da configuração do produto (módulo config).
// A estrutura é pequena: cache em memória por um minuto (a gravação invalida), com a chave da rede e do
// estabelecimento (ADR 0011: uma rede nunca enxerga a estrutura de outra). Credencial nunca sai.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  type Alertas,
  type Backup,
  type DadosFiscais,
  type Estrutura,
  EVENTOS_AUDITAVEIS,
  type Leitos,
  NOMES_OPERACOES_LEITOS,
  OPERACOES_LEITOS,
  type OperacaoLeito,
  PERMISSOES_M10_CODIGOS,
  type ServidorEmail,
} from '@sgh/contratos';
import { arvoreDeLeitos, ehSentinela, opcoesSemSentinela } from '@sgh/dominio-organizacao';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { analisar, contextoOperacao, ctxDe, problema, reautenticado, semSegredos } from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';

const C = PERMISSOES_M10_CODIGOS;

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
    const e = await this.emCache(`${c.rede}|${c.hospital}|estrutura`, () => this.fonte.estrutura(c)).catch(
      (x: unknown) => problema(x),
    );
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
      bloco: a.bloco,
      acomodacao: a.acomodacao,
      nome: a.nome,
      leitosPrevistos: a.leitosPrevistos,
      clinica: null,
      centroCusto: a.centroCusto,
    }));
    const a = arvoreDeLeitos(
      l.blocos,
      acs,
      l.leitos.map((x) => ({
        id: x.id,
        bloco: x.bloco,
        acomodacao: x.acomodacao,
        leito: x.leito,
        ativo: x.ativo,
        ocupado: x.ocupado,
        ramal: x.ramal,
      })),
    );
    const daAcomodacao = new Map(l.acomodacoes.map((x) => [`${x.bloco}|${x.acomodacao}`, x]));
    const doLeito = new Map(l.leitos.map((x) => [x.id, x]));
    return semSegredos({
      blocos: a.blocos.map((b) => ({
        bloco: b.bloco,
        nome: b.nome,
        andares: b.andares,
        ativos: b.ativos,
        ocupados: b.ocupados,
        acomodacoes: b.acomodacoes.map((ac) => {
          const r = daAcomodacao.get(`${ac.bloco}|${ac.acomodacao}`);
          return {
            acomodacao: ac.acomodacao,
            nome: ac.nome,
            andar: r?.andar ?? null,
            leitosPrevistos: ac.leitosPrevistos,
            sexo: r?.sexo ?? null,
            tipo: r?.tipo ?? null,
            convenio: r?.convenio ?? null,
            centroCusto: ac.centroCusto,
            localConta: r?.localConta ?? null,
            ativos: ac.ativos,
            ocupados: ac.ocupados,
            versao: String(r?.versao ?? 0),
            leitos: ac.leitos.map((x) => {
              const lb = doLeito.get(x.id);
              return {
                id: x.id,
                leito: x.leito,
                ativo: x.ativo,
                ocupado: x.ocupado,
                ramal: x.ramal,
                andar: lb?.andar ?? null,
                versao: String(lb?.versao ?? 0),
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

  @Post('cadastros/estrutura/leitos/:operacao')
  @HttpCode(200)
  @Permissao(C.leitoEditar)
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
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
}
