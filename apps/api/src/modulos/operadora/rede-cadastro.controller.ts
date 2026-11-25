// Rotas do cadastro complementar do prestador da rede credenciada (08-SGO L101, C2-118; F7). Ler com
// operadora.prestador.ler; gravar com operadora.prestador.editar:
//   GET  operadora/rede-cadastro/apoio                          especialidades e atributos de qualificação vigentes
//   GET  operadora/prestadores/:id/cadastro                     locais, especialidades, qualificações, suspensões e
//                                                               os registros de descredenciamento do prestador
//   POST operadora/prestadores/:id/locais                       inclui um local de atendimento
//   POST operadora/rede-cadastro/locais/:id/desligamento        desliga o local (data e motivo; não apaga)
//   POST operadora/prestadores/:id/especialidades               inclui uma especialidade atendida
//   POST operadora/rede-cadastro/especialidades/:id/encerramento encerra a especialidade (não apaga)
//   POST operadora/prestadores/:id/qualificacoes                registra a qualificação divulgada
//   POST operadora/rede-cadastro/qualificacoes/:id/encerramento encerra a qualificação pela data de fim
//   POST operadora/prestadores/:id/suspensoes                   suspende o prestador ou um local
//   POST operadora/rede-cadastro/suspensoes/:id/reativacao      reativa (a programada é cancelada)
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { MOTIVOS_SUSPENSAO_PRESTADOR } from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { type Gravado, PORTA_REDE_CADASTRO, type PortaRedeCadastroPropria } from './rede-cadastro-propria.js';

const LER = 'operadora.prestador.ler';
const EDITAR = 'operadora.prestador.editar';
const AUD = 'operadora.rede-cadastro.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const versao = z.number().int().positive();
const tn = (max: number) => z.string().max(max).nullable();
const esquemaLocal = z.object({
  nome: tn(150),
  cnes: tn(7),
  cep: z.string().min(1).max(9),
  logradouro: z.string().max(150),
  numero: tn(10),
  complemento: tn(150),
  bairro: tn(100),
  municipioIbge: z.number().int(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  telefone: tn(20),
  email: tn(254),
  acessivelCadeirante: z.boolean(),
  estacionamento: z.boolean(),
  principal: z.boolean(),
  divulga: z.boolean(),
});
const esquemaDesligamento = z.object({ versao, desligadoEm: data, motivo: z.string().max(500) });
const esquemaEspecialidade = z.object({
  especialidade: id,
  local: id.nullable(),
  ambulatorio: z.boolean(),
  internacao: z.boolean(),
  urgencia: z.boolean(),
  hospitalDia: z.boolean(),
  adulto: z.boolean(),
  pediatrico: z.boolean(),
  rqe: tn(30),
  principal: z.boolean(),
  divulga: z.boolean(),
});
const esquemaQualificacao = z.object({
  atributo: id,
  nivel: tn(30),
  titulo: tn(400),
  divulga: z.boolean(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
});
const esquemaEncerrarQualificacao = z.object({ versao, vigenciaFim: data });
const esquemaSuspensao = z.object({
  motivo: z.enum(MOTIVOS_SUSPENSAO_PRESTADOR),
  local: id.nullable(),
  desde: data,
  reativacaoPrevista: data.nullable(),
  observacao: tn(1000),
});
const esquemaReativacao = z.object({ versao, reativadoEm: data });

@Controller()
export class RedeCadastroOperadoraController {
  constructor(@Inject(PORTA_REDE_CADASTRO) private readonly porta: PortaRedeCadastroPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) => linhaTrilha(s, evento, 'operadora.rede', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/rede-cadastro/apoio')
  @Permissao(LER)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.apoio(sessaoDe(req).porta));
  }

  @Get('operadora/prestadores/:id/cadastro')
  @Permissao(LER)
  ficha(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.ficha(sessaoDe(req).porta, idDaRota(p)));
  }

  @Post('operadora/prestadores/:id/locais')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirLocal(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirLocal(
        s.porta,
        idDaRota(p),
        corpo(esquemaLocal, b),
        this.trilha(s, 'operadora.rede.local-incluido', 'local_atendimento_rede'),
      ),
    );
  }

  @Post('operadora/rede-cadastro/locais/:id/desligamento')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  desligarLocal(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDesligamento, b);
    return this.ok(
      this.porta.desligarLocal(
        s.porta,
        idDaRota(k),
        e.versao,
        e,
        this.trilha(s, 'operadora.rede.local-desligado', 'local_atendimento_rede'),
      ),
    );
  }

  @Post('operadora/prestadores/:id/especialidades')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirEspecialidade(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirEspecialidade(
        s.porta,
        idDaRota(p),
        corpo(esquemaEspecialidade, b),
        this.trilha(s, 'operadora.rede.especialidade-incluida', 'especialidade_atendida_rede'),
      ),
    );
  }

  @Post('operadora/rede-cadastro/especialidades/:id/encerramento')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  encerrarEspecialidade(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.encerrarEspecialidade(
        s.porta,
        idDaRota(k),
        corpo(z.object({ versao }), b).versao,
        this.trilha(s, 'operadora.rede.especialidade-encerrada', 'especialidade_atendida_rede'),
      ),
    );
  }

  @Post('operadora/prestadores/:id/qualificacoes')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  incluirQualificacao(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirQualificacao(
        s.porta,
        idDaRota(p),
        corpo(esquemaQualificacao, b),
        this.trilha(s, 'operadora.rede.qualificacao-incluida', 'qualificacao_prestador_rede'),
      ),
    );
  }

  @Post('operadora/rede-cadastro/qualificacoes/:id/encerramento')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  encerrarQualificacao(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarQualificacao, b);
    return this.ok(
      this.porta.encerrarQualificacao(
        s.porta,
        idDaRota(k),
        e.versao,
        e.vigenciaFim,
        this.trilha(s, 'operadora.rede.qualificacao-encerrada', 'qualificacao_prestador_rede'),
      ),
    );
  }

  @Post('operadora/prestadores/:id/suspensoes')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  suspender(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.suspender(
        s.porta,
        idDaRota(p),
        corpo(esquemaSuspensao, b),
        this.trilha(s, 'operadora.rede.prestador-suspenso', 'suspensao_prestador_rede'),
      ),
    );
  }

  @Post('operadora/rede-cadastro/suspensoes/:id/reativacao')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  reativar(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaReativacao, b);
    return this.ok(
      this.porta.reativar(
        s.porta,
        idDaRota(k),
        e.versao,
        e.reativadoEm,
        this.trilha(s, 'operadora.rede.prestador-reativado', 'suspensao_prestador_rede'),
      ),
    );
  }
}
