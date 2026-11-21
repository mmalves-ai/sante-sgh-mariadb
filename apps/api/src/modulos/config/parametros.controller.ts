// "Parâmetros hierárquicos por módulo" (M08; ficha, seção 7; regras 7, 8 e 10):
//   GET /api/administracao/parametros          painel: parâmetros do produto com "explicar valor" para a sessão
//   GET /api/administracao/parametros/:chave    um parâmetro, com a explicação e as versões
//   PUT /api/administracao/parametros/:chave    definir (versão nova; justificativa; crítico pede a senha)
//   POST /api/administracao/parametros/:chave/retirada   retirar a sobreposição do nível e do alvo (W0-09): a
//                                              vigente é fechada (quem, motivo) e o nível volta a herdar
// A gravação vai a parametro_valor e parametro_valor_historico pelo Executor (trilha na mesma transação); o cache é
// invalidado depois do commit.
// Melhoria: o painel não mostra mais os parâmetros do sistema de origem (a lista "legado" do contrato vai vazia).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import {
  definicaoParametro,
  esquemaDefinirParametro,
  esquemaRetirarParametro,
  EVENTOS_AUDITAVEIS,
  type PainelParametros,
  type ParametroNovoDescrito,
  PARAMETROS_NOVOS,
  type ValorParametro,
} from '@sgh/contratos';
import {
  ehRecusa,
  planejarDefinicao,
  planejarRetirada,
  resolverParametro,
  type SujeitoParametro,
} from '@sgh/dominio-config';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  TTL_CONFIG_NOVO_S,
} from './cache-config.js';
import {
  destinoNoContrato,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  type TrilhaConfig,
} from './configuracao-fonte.js';
import { falhaDaConfiguracao } from './falha-configuracao.js';

@Controller('administracao/parametros')
export class ParametrosController {
  constructor(
    @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao,
    @Inject(CACHE_CONFIG) private readonly cache: CacheConfig,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private sessao(req: RequisicaoAutorizada) {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const hospital = a.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
    const login = a.sessao.usuario.login ?? a.sessao.usuario.id;
    const sujeito: SujeitoParametro = {
      rede: a.sessao.rede ?? '',
      // Empresa da sessão: o M10 liga; até lá o nível empresa não se aplica à pessoa.
      empresa: null,
      estabelecimento: hospital,
      unidade:
        a.sessao.unidadeAtiva === null || a.sessao.unidadeAtiva === undefined
          ? null
          : String(a.sessao.unidadeAtiva),
      perfis: [
        ...(a.sessao.perfil?.perfil ? [a.sessao.perfil.perfil] : []),
        ...(a.sessao.perfil?.complementares ?? []),
      ],
      usuario: login,
    };
    return { a, hospital, rede: a.sessao.rede ?? '', login, sujeito };
  }

  private trilha(req: RequisicaoAutorizada, evento: string, operacao: string, alvo: string): TrilhaConfig {
    const { a, rede, hospital, login } = this.sessao(req);
    const chave = req.headers?.['idempotency-key'];
    return {
      rede,
      hospital,
      usuario: login,
      usuarioId: a.sessao.usuario.id,
      evento,
      recurso: 'config.parametro',
      operacao,
      chaveNaturalAlvo: alvo.slice(0, 120),
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'parametro').slice(0, 64),
      chaveIdempotencia: typeof chave === 'string' ? chave : null,
    };
  }

  private valores(rede: string, hospital: string): Promise<ValorParametro[]> {
    return this.cache.lerOuCarregar(
      this.cache.chave(rede, hospital, 'parametros-novos'),
      TTL_CONFIG_NOVO_S,
      () => this.fonte.valoresParametro(rede, hospital),
    );
  }

  private descrever(
    valores: readonly ValorParametro[],
    sujeito: SujeitoParametro,
    agora: Date,
  ): ParametroNovoDescrito[] {
    return PARAMETROS_NOVOS.map((def) => ({
      chave: def.chave,
      modulo: def.modulo,
      descricao: def.descricao,
      tipo: def.tipo,
      padrao: def.padrao,
      niveis: [...def.niveis],
      critico: def.critico,
      ...(def.opcoes ? { opcoes: [...def.opcoes] } : {}),
      ...(def.minimo !== undefined ? { minimo: def.minimo } : {}),
      ...(def.maximo !== undefined ? { maximo: def.maximo } : {}),
      dono: def.dono,
      explicacao: resolverParametro(def, valores, sujeito, agora),
    }));
  }

  @Get()
  @Permissao('config.parametro.ler')
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelParametros> {
    const { rede, hospital, sujeito } = this.sessao(req);
    const [valores, agora] = await Promise.all([
      this.valores(rede, hospital),
      this.fonte.relogio(rede, hospital),
    ]);
    return {
      estabelecimento: hospital,
      novos: this.descrever(valores, sujeito, agora),
      legado: [],
      resumoLegado: { interpretadas: 0, naoInterpretadas: 0, ocultas: 0 },
    };
  }

  @Get(':chave')
  @Permissao('config.parametro.ler')
  async um(@Param('chave') chave: string, @Req() req: RequisicaoAutorizada) {
    const def = definicaoParametro(chave);
    if (!def) throw new ErroProblema('nao-encontrado', 404, 'Parâmetro não registrado');
    const { rede, hospital, sujeito } = this.sessao(req);
    const valores = await this.fonte.valoresParametro(rede, hospital);
    const agora = await this.fonte.relogio(rede, hospital);
    const [d] = this.descrever(valores, sujeito, agora).filter((p) => p.chave === chave);
    return { parametro: d, versoes: valores.filter((v) => v.chave === chave).slice(0, 50) };
  }

  @Put(':chave')
  @Permissao('config.parametro.editar')
  @AuditadoNoHandler('parametro_valor e trilha na mesma transação do Executor (definirParametro)')
  async definir(@Param('chave') chave: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const def = definicaoParametro(chave);
    if (!def) throw new ErroProblema('nao-encontrado', 404, 'Parâmetro não registrado');
    const p = esquemaDefinirParametro.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe o nível, o alvo, o valor e a justificativa (10 caracteres ou mais).',
      );
    const { rede, hospital, login } = this.sessao(req);
    if (def.critico) await reautenticar(this.servico, this.resolvedor, req, p.data.senha);
    const existentes = await this.fonte.valoresParametro(rede, hospital);
    const agora = await this.fonte.relogio(rede, hospital);
    const plano = planejarDefinicao(def, p.data, existentes, login, agora);
    if (ehRecusa(plano))
      throw new ErroProblema(
        plano.status === 404
          ? 'nao-encontrado'
          : plano.status === 422
            ? 'entrada-invalida'
            : 'recusa-de-negocio',
        plano.status,
        'Parâmetro não definido',
        plano.mensagem,
        { codigo: plano.codigo },
      );
    const ok = await this.fonte
      .definirParametro(
        {
          rede,
          hospital,
          fechar: plano.fechar,
          nova: plano.nova,
          // Alvo de unidade já conferido como código (planejarDefinicao: 422 alvo-invalido).
          ...(p.data.nivel === 'unidade' ? { unidade: Number(p.data.alvo) } : {}),
          ...(p.data.nivel === 'perfil' ? { perfil: p.data.alvo } : {}),
          reautenticado: def.critico === true,
        },
        this.trilha(
          req,
          EVENTOS_AUDITAVEIS.parametroDefinido.codigo,
          'config.definirParametro',
          `${chave}:${p.data.nivel}:${p.data.alvo}`,
        ),
      )
      .catch((e: unknown) => {
        // Definição concorrente no mesmo nível e alvo (estado relido com trava ou índice único): 409.
        throw falhaDaConfiguracao(
          e,
          'config.definirParametro',
          'A definição não foi gravada (nem registrada). Tente de novo.',
        );
      });
    const atraso = await this.cache.invalidar(rede, hospital, ['parametros-novos'], Date.now());
    return { id: ok.id, destino: destinoNoContrato(this.fonte.destino), atrasoInvalidacaoMs: atraso, avisos: plano.avisos };
  }

  @Post(':chave/retirada')
  @HttpCode(200)
  @Permissao('config.parametro.editar')
  @AuditadoNoHandler('parametro_valor e trilha na mesma transação do Executor (retirarParametro)')
  async retirar(@Param('chave') chave: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const def = definicaoParametro(chave);
    if (!def) throw new ErroProblema('nao-encontrado', 404, 'Parâmetro não registrado');
    const p = esquemaRetirarParametro.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe o nível, o alvo e a justificativa (10 caracteres ou mais).',
      );
    const { rede, hospital, login, sujeito } = this.sessao(req);
    if (def.critico) await reautenticar(this.servico, this.resolvedor, req, p.data.senha);
    const existentes = await this.fonte.valoresParametro(rede, hospital);
    const plano = planejarRetirada(def, p.data, existentes);
    if ('codigo' in plano)
      throw new ErroProblema(
        plano.status === 404
          ? 'nao-encontrado'
          : plano.status === 422
            ? 'entrada-invalida'
            : 'recusa-de-negocio',
        plano.status,
        'Sobreposição não retirada',
        plano.mensagem,
        { codigo: plano.codigo },
      );
    await this.fonte
      .retirarParametro(
        {
          rede,
          hospital,
          chave,
          nivel: p.data.nivel,
          alvo: p.data.alvo,
          fechar: plano.fechar,
          motivo: p.data.justificativa,
          por: login,
        },
        this.trilha(
          req,
          EVENTOS_AUDITAVEIS.parametroRetirado.codigo,
          'config.retirarParametro',
          `${chave}:${p.data.nivel}:${p.data.alvo}`,
        ),
      )
      .catch((e: unknown) => {
        throw falhaDaConfiguracao(
          e,
          'config.retirarParametro',
          'A sobreposição não foi retirada (nem registrada). Tente de novo.',
        );
      });
    const atraso = await this.cache.invalidar(rede, hospital, ['parametros-novos'], Date.now());
    // O valor que passa a valer para a sessão (herdado), já sem a sobreposição.
    const valores = await this.fonte.valoresParametro(rede, hospital);
    const agora = await this.fonte.relogio(rede, hospital);
    const [d] = this.descrever(valores, sujeito, agora).filter((x) => x.chave === chave);
    return {
      fechadas: plano.fechar,
      valorAnterior: plano.valorAnterior,
      parametro: d,
      destino: destinoNoContrato(this.fonte.destino),
      atrasoInvalidacaoMs: atraso,
    };
  }
}
