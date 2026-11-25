// Rotas do cadastro editável dos padrões da prescrição (03-PEP L107): protocolos de prescrição, kits de medicamentos e
// de soluções e receitas padrão, cada um com os itens. Sem banco próprio, 503.
//   GET  pep/prescricao/padroes/protocolos   pep.protocoloPrescricao.ler
//   POST pep/prescricao/padroes/protocolos   inclui (pep.protocoloPrescricao.criar) ou altera com a versão lida
//                                            (pep.protocoloPrescricao.editar); o dono e a abrangência não mudam
//   GET  pep/prescricao/padroes/kits         pep.kitPrescricao.ler (ou o ler do kit de medicamento ou de solução, ou
//                                            quem prescreve, para escolher o kit no editor)
//   GET  pep/prescricao/padroes/kits/:id/aplicacao  o kit pronto para entrar na prescrição: pep.prescricao.criar
//   POST pep/prescricao/padroes/kits         criar (sem id) ou editar (com id) do kit de medicamento ou de solução;
//                                            na alteração vale o tipo GRAVADO, e o tipo não muda
//   GET  pep/prescricao/padroes/receitas     pep.receitaPadrao.ler ou pep.receita.emitir (vê as gerais, as das
//                                            especialidades e as pessoais do próprio profissional)
//   POST pep/prescricao/padroes/receitas     a pessoal: quem emite receita (pep.receita.emitir); a geral e a da
//                                            especialidade: também quem cuida dos protocolos (pep.protocoloPrescricao.editar)
// Cada gravação vai pelo executor do núcleo, com a trilha na mesma transação. Desativar é gravar com ativo = false.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CADASTRO_PROTOCOLOS_PRESCRICAO,
  type CadastroProtocolosPrescricaoPropria,
} from './prescricao-propria-protocolos.js';

const AUD = 'pep.protocolos pelo executor (trilha na mesma transação)';

function exigirAlguma(s: SessaoCadastro, permissoes: readonly string[]): void {
  if (!permissoes.some((p) => s.pode(p)))
    throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.');
}

/** O id do registro alterado (ausente: inclusão). */
function idDoCorpo(b: unknown): number | null {
  const v = (b as { id?: unknown } | null)?.id;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** Incluir pede o `.criar`; alterar (com id), o `.editar`. */
const acao = (b: unknown): 'criar' | 'editar' => (idDoCorpo(b) === null ? 'criar' : 'editar');

@Controller('pep/prescricao/padroes')
export class PrescricaoPadroesController {
  constructor(
    @Optional()
    @Inject(CADASTRO_PROTOCOLOS_PRESCRICAO)
    private readonly cadastro: CadastroProtocolosPrescricaoPropria | null = null,
  ) {}

  private banco(): CadastroProtocolosPrescricaoPropria {
    if (!this.cadastro)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os protocolos, kits e receitas padrão ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.cadastro;
  }

  private ctx(req: RequisicaoAutorizada, operacao: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, operacao, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }
  private leitura(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { hospital: s.hospital, login: s.login };
  }

  @Get('protocolos')
  @Permissao('pep.protocoloPrescricao.ler')
  async protocolos(@Req() req: RequisicaoAutorizada) {
    return { protocolos: await this.banco().protocolos(this.leitura(req)) };
  }

  @Post('protocolos')
  @HttpCode(200)
  @Permissao('pep.protocoloPrescricao.editar')
  @PermissaoOu('pep.protocoloPrescricao.criar')
  @AuditadoNoHandler(AUD)
  gravarProtocolo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    exigirAlguma(sessaoDe(req), [`pep.protocoloPrescricao.${acao(b)}`]);
    return this.banco().gravarProtocolo(this.ctx(req, 'pep.protocolos.protocolo'), b);
  }

  @Get('kits')
  @Permissao('pep.kitPrescricao.ler')
  @PermissaoOu('pep.kitMedicamento.ler', 'pep.kitSolucao.ler', 'pep.prescricao.criar')
  async kits(@Req() req: RequisicaoAutorizada) {
    return { kits: await this.banco().kits(this.leitura(req)) };
  }

  @Post('kits')
  @HttpCode(200)
  @Permissao('pep.kitMedicamento.editar')
  @PermissaoOu('pep.kitMedicamento.criar', 'pep.kitSolucao.editar', 'pep.kitSolucao.criar')
  @AuditadoNoHandler(AUD)
  async gravarKit(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    // O kit de solução é de quem cuida dos kits de solução; os outros, de quem cuida dos kits de medicamento. Na
    // alteração vale o tipo gravado (o adaptador recusa a troca de tipo).
    const id = idDoCorpo(b);
    const gravado = id === null ? null : await this.banco().tipoDoKit(this.leitura(req), id);
    const tipo = gravado ?? (b as { tipoKit?: unknown } | null)?.tipoKit;
    exigirAlguma(sessaoDe(req), [`pep.${tipo === 'solucao' ? 'kitSolucao' : 'kitMedicamento'}.${acao(b)}`]);
    return this.banco().gravarKit(this.ctx(req, 'pep.protocolos.kit'), b);
  }

  @Get('kits/:id/aplicacao')
  @Permissao('pep.prescricao.criar')
  async aplicacaoDoKit(@Param('id') i: string, @Req() req: RequisicaoAutorizada) {
    const id = Number(i);
    if (!Number.isInteger(id) || id <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Kit inválido', 'O identificador do kit é inválido.');
    return this.banco().kitParaAplicar(this.leitura(req), id);
  }

  @Get('receitas')
  @Permissao('pep.receitaPadrao.ler')
  @PermissaoOu('pep.receita.emitir')
  async receitas(@Req() req: RequisicaoAutorizada) {
    return { receitas: await this.banco().receitas(this.leitura(req)) };
  }

  @Post('receitas')
  @HttpCode(200)
  @Permissao('pep.receita.emitir')
  @AuditadoNoHandler(AUD)
  gravarReceita(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const abrangencia = (b as { abrangencia?: unknown } | null)?.abrangencia ?? 'profissional';
    if (abrangencia !== 'profissional') exigirAlguma(sessaoDe(req), ['pep.protocoloPrescricao.editar']);
    return this.banco().gravarReceita(this.ctx(req, 'pep.protocolos.receita'), b);
  }
}
