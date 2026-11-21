// W1-04 (mercado): termos de consentimento e LGPD do balcão. Gravação dos termos com a trilha
// na mesma transação; o hash da assinatura fica no registro, nunca na trilha.
//   GET  /api/recepcao/termos/modelos                         recepcao.senha.ler (versões, situação, assinaturas)
//   POST /api/recepcao/termos/modelos                         recepcao.termo.editar (versão 1)
//   POST /api/recepcao/termos/modelos/:codigo/versoes         recepcao.termo.editar (alterar = nova versão)
//   POST /api/recepcao/termos/modelos/:codigo/situacao        recepcao.termo.editar (inativar/reativar com motivo)
//   POST /api/recepcao/termos/modelos/:codigo/excluir         recepcao.termo.editar (só o nunca assinado)
//   GET  /api/recepcao/termos/paciente?prontuario&tipo        recepcao.senha.ler (assinaturas, faltando, bloqueio suave)
//   POST /api/recepcao/termos/assinaturas                     recepcao.termo.assinar (em tela ou aceite no portal)
//   POST /api/recepcao/termos/assinaturas/:id/revogar         recepcao.termo.assinar (fato novo com motivo)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  definicaoParametro,
  esquemaAssinarTermo,
  esquemaConsultaTermos,
  esquemaExcluirTermo,
  esquemaIncluirModeloTermo,
  esquemaNovaVersaoTermo,
  esquemaRevogarTermo,
  esquemaSituacaoTermo,
  EVENTOS_AUDITAVEIS,
  type ModeloTermo,
  termosFaltando,
  type TermosDoPaciente,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioRecepcao } from './apoio.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
import { corpo } from './recepcao.controller.js';

/** O código do termo na rota (o mesmo formato da inclusão). */
function codigoDaRota(v: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(v))
    throw new ErroProblema('nao-encontrado', 404, 'Termo não encontrado');
  return v;
}

const EV_MODELO = EVENTOS_AUDITAVEIS.recepcaoTermoModeloAlterado.codigo;
const ALVO_MODELO = (codigo: string) => ({ tabela: 'termo_consentimento_modelo', id: codigo });

@Controller('recepcao/termos')
export class TermosRecepcaoController {
  private readonly apoio: ApoioRecepcao;
  constructor(
    @Inject(PORTA_RECEPCAO) private readonly porta: PortaRecepcao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioRecepcao(porta, trilha, configuracao, cache);
  }

  /** recepcao.termos.exigir resolvido para a sessão (desligado se a configuração não responde). */
  private async exigir(s: SessaoCadastro): Promise<boolean> {
    const def = definicaoParametro('recepcao.termos.exigir');
    if (!def || !this.configuracao) return false;
    try {
      const valores = await this.configuracao.valoresParametro(s.rede, s.hospital);
      const v = valorTipado(
        def,
        resolverParametro(
          def,
          valores,
          {
            rede: s.rede,
            empresa: null,
            estabelecimento: s.hospital,
            unidade: null,
            perfis: [],
            usuario: s.login,
          },
          new Date(),
        ).valor,
      );
      return v === true;
    } catch {
      return false;
    }
  }

  @Get('modelos')
  @Permissao('recepcao.senha.ler')
  async modelos(@Req() req: RequisicaoAutorizada): Promise<ModeloTermo[]> {
    return this.porta.modelosTermo(sessaoDe(req).porta);
  }

  @Post('modelos')
  @HttpCode(201)
  @Permissao('recepcao.termo.editar')
  @AuditadoNoHandler('termo de consentimento com a trilha na mesma transação')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaIncluirModeloTermo, b);
    const id = await this.apoio.gravar(s, EV_MODELO, 'recepcao.termo', ALVO_MODELO(e.codigo), (g) =>
      g.incluirModeloTermo({ ...e, usuario: s.login }),
    );
    return { ok: true as const, id, versao: 1, mensagem: 'Termo incluído (versão 1).' };
  }

  @Post('modelos/:codigo/versoes')
  @HttpCode(201)
  @Permissao('recepcao.termo.editar')
  @AuditadoNoHandler('termo de consentimento com a trilha na mesma transação')
  async novaVersao(@Param('codigo') c: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const codigo = codigoDaRota(c);
    const e = corpo(esquemaNovaVersaoTermo, b);
    const r = await this.apoio.gravar(s, EV_MODELO, 'recepcao.termo', ALVO_MODELO(codigo), (g) =>
      g.novaVersaoModeloTermo({ ...e, codigo, usuario: s.login }),
    );
    return { ok: true as const, ...r, mensagem: `Versão ${r.versao} gravada; a anterior fica no histórico.` };
  }

  @Post('modelos/:codigo/situacao')
  @HttpCode(200)
  @Permissao('recepcao.termo.editar')
  @AuditadoNoHandler('termo de consentimento com a trilha na mesma transação')
  async situacao(@Param('codigo') c: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const codigo = codigoDaRota(c);
    const e = corpo(esquemaSituacaoTermo, b);
    await this.apoio.gravar(s, EV_MODELO, 'recepcao.termo', ALVO_MODELO(codigo), (g) =>
      g.situacaoModeloTermo({ ...e, codigo, usuario: s.login }),
    );
    return { ok: true as const, mensagem: e.ativo ? 'Termo reativado.' : 'Termo inativado.' };
  }

  @Post('modelos/:codigo/excluir')
  @HttpCode(200)
  @Permissao('recepcao.termo.editar')
  @AuditadoNoHandler('exclusão do modelo de termo com a trilha junto')
  async excluir(@Param('codigo') c: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const codigo = codigoDaRota(c);
    const e = corpo(esquemaExcluirTermo, b);
    await this.apoio.gravar(s, EV_MODELO, 'recepcao.termo', ALVO_MODELO(codigo), (g) =>
      g.excluirModeloTermo({ codigo, motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true as const, mensagem: 'Termo excluído.' };
  }

  @Get('paciente')
  @Permissao('recepcao.senha.ler')
  async doPaciente(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, unknown>,
  ): Promise<TermosDoPaciente> {
    const s = sessaoDe(req);
    const f = corpo(esquemaConsultaTermos, q);
    const [modelos, assinaturas, exigir, signatarios] = await Promise.all([
      this.porta.modelosTermo(s.porta),
      this.porta.termosDoPaciente(s.porta, f.prontuario),
      this.exigir(s),
      this.porta.signatariosTermo(s.porta),
    ]);
    const faltando = f.tipo ? termosFaltando(modelos, assinaturas, f.tipo) : [];
    return {
      prontuario: f.prontuario,
      signatarios,
      assinaturas,
      faltando,
      exigir,
      bloqueioSuave: exigir && faltando.length > 0,
    };
  }

  @Post('assinaturas')
  @HttpCode(201)
  @Permissao('recepcao.termo.assinar')
  @AuditadoNoHandler('termo de consentimento com a trilha na mesma transação')
  async assinar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAssinarTermo, b);
    const r = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoTermoAssinado.codigo,
      'recepcao.termo',
      (x: { id: number }) => ({ tabela: 'termo_consentimento_recepcao', id: String(x.id) }),
      (g) => g.assinarTermo({ ...e, usuario: s.login }),
    );
    return { ok: true as const, ...r, mensagem: 'Termo assinado e guardado no prontuário.' };
  }

  @Post('assinaturas/:id/revogar')
  @HttpCode(200)
  @Permissao('recepcao.termo.assinar')
  @AuditadoNoHandler('termo de consentimento com a trilha na mesma transação')
  async revogar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const assinatura = idDaRota(id);
    const e = corpo(esquemaRevogarTermo, b);
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.recepcaoTermoRevogado.codigo,
      'recepcao.termo',
      { tabela: 'termo_consentimento_recepcao', id: String(assinatura) },
      (g) => g.revogarTermo({ assinatura, motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true as const, mensagem: 'Termo revogado; a assinatura continua visível no histórico.' };
  }
}
