// Rotas da nota clínica em quatro partes codificada (03-PEP L98):
//   GET  /api/pep/nota-soap/paciente/:paciente          atendimentos (com a configuração aplicável) e notas do paciente
//   GET  /api/pep/nota-soap/termos?sistema=&busca=       CID-10 ou CIAP-2 pelo código ou pela descrição
//   GET  /api/pep/nota-soap/correspondencia/:ciap        CID-10 correspondentes ao código da CIAP-2
//   POST /api/pep/nota-soap                              nota nova em rascunho
//   POST /api/pep/nota-soap/alterar                      alterar o rascunho (só o autor)
//   POST /api/pep/nota-soap/assinar                      assinar (partes obrigatórias e CID-10 da avaliação)
//   POST /api/pep/nota-soap/sem-efeito                   tornar sem efeito (justificativa quando assinada)
//   GET  /api/pep/nota-soap/configuracoes                configurações por estabelecimento e especialidade
//   GET  /api/pep/nota-soap/configuracoes/opcoes         estabelecimentos e especialidades ativos (combos)
//   POST /api/pep/nota-soap/configuracoes                incluir ou alterar uma configuração
// Ler: pep.prontuario.ler; escrever e assinar: pep.evolucao.criar; sem efeito: pep.evolucao.suspender; configurar:
// pep.admin.ler / pep.admin.editar. Como as vizinhas do prontuário, a visão por paciente e as gravações conferem o
// vínculo assistencial (AcessoPacientePep) e a leitura vai à trilha. Gravação pelo executor (trilha na mesma
// transação, Idempotency-Key). Sem banco próprio, 503.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import {
  esquemaAlterarNotaSoap,
  esquemaAssinarNotaSoap,
  esquemaNotaSoap,
  esquemaSemEfeitoNotaSoap,
  type NotaSoapPropria,
  type NotasDoPaciente,
} from './nota-soap-propria.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

export const NOTA_SOAP = Symbol('NOTA_SOAP');
const LER = 'pep.prontuario.ler';
const ESCREVER = 'pep.evolucao.criar';
const SEM_EFEITO = 'pep.evolucao.suspender';
const esquemaBusca = z.object({ sistema: z.enum(['cid10', 'ciap2']), busca: z.string().max(60).default('') });

@Controller('pep/nota-soap')
export class NotaSoapController {
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(NOTA_SOAP) private readonly notas: NotaSoapPropria | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private banco(): NotaSoapPropria {
    if (!this.notas)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A nota clínica fica no banco do estabelecimento, que não está configurado.',
      );
    return this.notas;
  }

  private async paciente(s: SessaoCadastro, paciente: number, permissao: string, leitura: boolean) {
    if (!(await this.banco().pacienteExiste(paciente)))
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prontuario');
    if (leitura) {
      const chave = chaveSessaoPep(s);
      const motivo = this.estado.motivo(chave, paciente) ?? 'assistencia';
      if (!this.estado.motivo(chave, paciente)) this.estado.registrarMotivo(chave, paciente, motivo);
      await this.acesso.registrarLeitura(s, paciente, 'lista', motivo, 'pep.prontuario');
    }
  }

  private async gravar<T>(
    req: RequisicaoAutorizada,
    alvo: { atendimento: number } | { nota: number },
    permissao: string,
    fn: (ctx: Parameters<NotaSoapPropria['criarNota']>[0]) => Promise<T>,
  ): Promise<T> {
    const s = sessaoDe(req);
    const paciente = await this.banco().pacienteDe(alvo);
    if (paciente === null)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'atendimento' in alvo ? 'Atendimento não encontrado' : 'Nota não encontrada',
      );
    await this.paciente(s, paciente, permissao, false);
    const g = contextoGravacao(s, 'pep.notaSoap', true);
    return fn({
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    });
  }

  @Get('paciente/:paciente')
  @Permissao(LER)
  async doPaciente(
    @Param('paciente', ParseIntPipe) paciente: number,
    @Req() req: RequisicaoAutorizada,
  ): Promise<NotasDoPaciente> {
    const s = sessaoDe(req);
    await this.paciente(s, paciente, LER, true);
    return this.banco().doPaciente({ hospital: s.hospital, login: s.login }, paciente);
  }

  @Get('termos')
  @Permissao(LER)
  termos(@Query() q: unknown) {
    const b = corpo(esquemaBusca, q);
    return this.banco().termos(b.sistema, b.busca);
  }

  @Get('correspondencia/:ciap')
  @Permissao(LER)
  correspondencia(@Param('ciap', ParseIntPipe) ciap: number) {
    return this.banco().correspondencia(ciap);
  }

  @Post()
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.nota_soap.criar pelo executor (trilha na mesma transação)')
  async criar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaNotaSoap, b);
    const r = await this.gravar(req, { atendimento: e.atendimento }, ESCREVER, (c) =>
      this.banco().criarNota(c, e),
    );
    return { ok: true, ...r, mensagem: 'Nota guardada em rascunho.' };
  }

  @Post('alterar')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.nota_soap.alterar pelo executor (trilha na mesma transação)')
  async alterar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAlterarNotaSoap, b);
    const r = await this.gravar(req, { nota: e.nota }, ESCREVER, (c) => this.banco().alterarNota(c, e));
    return { ok: true, ...r, mensagem: 'Rascunho atualizado.' };
  }

  @Post('assinar')
  @HttpCode(200)
  @Permissao(ESCREVER)
  @AuditadoNoHandler('pep.nota_soap.assinar pelo executor (trilha na mesma transação)')
  async assinar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAssinarNotaSoap, b);
    const r = await this.gravar(req, { nota: e.nota }, ESCREVER, (c) => this.banco().assinarNota(c, e));
    return { ok: true, ...r, mensagem: 'Nota assinada.' };
  }

  @Post('sem-efeito')
  @HttpCode(200)
  @Permissao(SEM_EFEITO)
  @AuditadoNoHandler('pep.nota_soap.sem_efeito pelo executor (trilha na mesma transação)')
  async semEfeito(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSemEfeitoNotaSoap, b);
    const r = await this.gravar(req, { nota: e.nota }, SEM_EFEITO, (c) => this.banco().semEfeitoNota(c, e));
    return { ok: true, ...r, mensagem: 'Nota sem efeito (fica no histórico).' };
  }

  @Get('configuracoes')
  @Permissao('pep.admin.ler')
  configuracoes() {
    return this.banco().configuracoes();
  }

  @Get('configuracoes/opcoes')
  @Permissao('pep.admin.ler')
  opcoesConfiguracao() {
    return this.banco().opcoesConfiguracao();
  }

  @Post('configuracoes')
  @HttpCode(200)
  @Permissao('pep.admin.editar')
  @AuditadoNoHandler('pep.nota_soap.configurar pelo executor (trilha na mesma transação)')
  async configurar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, 'pep.notaSoap', true);
    const r = await this.banco().gravarConfiguracao(
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      b,
    );
    return { ok: true, ...r, mensagem: 'Configuração da nota gravada.' };
  }
}
