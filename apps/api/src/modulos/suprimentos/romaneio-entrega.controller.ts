// Logística entre unidades (09-AREA linha 77, C1-120), a tela Romaneios de entrega:
//   GET  /api/suprimentos/romaneios                    os romaneios, motoristas, veículos, transportadoras e as
//                                                      transferências ainda sem romaneio
//   GET  /api/suprimentos/romaneios/:id                o romaneio com os itens e a carga (controlado, termolábil)
//   POST /api/suprimentos/romaneios                    monta o romaneio com as transferências
//   POST /api/suprimentos/romaneios/:id/expedicao      libera e registra a saída (transporte e quilometragem)
//   POST /api/suprimentos/romaneios/:id/conferencia    o desfecho de cada item na chegada
//   POST /api/suprimentos/romaneios/:id/cancelamento   cancela antes da saída, com o motivo
//   POST /api/suprimentos/romaneios/motoristas[/:id]   o cadastro do motorista (novo ou a alteração)
//   POST /api/suprimentos/romaneios/veiculos[/:id]     o cadastro do veículo (novo ou a alteração)
//   POST /api/suprimentos/romaneios/envios             o envio entre unidades (destino em outra unidade do cliente)
//   POST /api/suprimentos/romaneios/envios/:id/cancelamento  cancela o envio em aberto fora de romaneio ativo
// Ler pede suprimentos.transferencia.ler; montar, expedir, cancelar e os cadastros, suprimentos.transferencia.enviar;
// a conferência na chegada (pela unidade de destino), suprimentos.transferencia.receber. O envio entre unidades e o
// cancelamento dele, suprimentos.transferencia.enviar. A gravação exige a Idempotency-Key.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { CATEGORIAS_HABILITACAO, DESFECHOS_ITEM_ROMANEIO } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_ROMANEIO_ENTREGA, type PortaRomaneioEntrega } from './romaneio-entrega.js';

const LER = 'suprimentos.transferencia.ler';
const ENVIAR = 'suprimentos.transferencia.enviar';
const RECEBER = 'suprimentos.transferencia.receber';
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const id_ = z.number().int().positive();
const km = z.number().int().min(0).max(9_999_999).nullable().default(null);
const valor = z.number().min(0).max(99_999_999).nullable().default(null);

const transporte = {
  veiculo: id_.nullable().default(null),
  motorista: id_.nullable().default(null),
  transportadora: id_.nullable().default(null),
  valorFrete: valor,
};

export const esquemaMotorista = z
  .object({
    versao: z.number().int().positive().optional(),
    nome: z.string().trim().min(1).max(150),
    cpf: z.string().trim().min(11).max(14),
    tipoVinculo: z.enum(['proprio', 'terceiro']),
    transportadora: id_.nullable().default(null),
    numeroHabilitacao: z.string().trim().min(1).max(15),
    categorias: z.array(z.enum(CATEGORIAS_HABILITACAO)).max(5),
    vencimentoHabilitacao: z.string().regex(DATA),
    transportaControlado: z.boolean().default(false),
    ativo: z.boolean().default(true),
    motivoInativacao: z.string().trim().max(200).nullable().default(null),
  })
  .strict();

export const esquemaVeiculo = z
  .object({
    versao: z.number().int().positive().optional(),
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    placa: z.string().trim().min(1).max(10),
    proprio: z.boolean(),
    transportadora: id_.nullable().default(null),
    refrigerado: z.boolean().default(false),
    capacidadeCargaKg: z.number().max(99_999_999).nullable().default(null),
    ativo: z.boolean().default(true),
    motivoInativacao: z.string().trim().max(200).nullable().default(null),
  })
  .strict();

export const esquemaMontagem = z
  .object({
    documentos: z.array(id_).max(200),
    descricao: z.string().trim().max(150).nullable().default(null),
    saidaPrevista: z.string().regex(INSTANTE).nullable().default(null),
    observacao: z.string().trim().max(2000).nullable().default(null),
    ...transporte,
  })
  .strict();

export const esquemaExpedicao = z
  .object({ versao: z.number().int().positive(), quilometragemSaida: km, ...transporte })
  .strict();

export const esquemaConferencia = z
  .object({
    versao: z.number().int().positive(),
    quilometragemChegada: km,
    desfechos: z
      .array(
        z
          .object({
            item: id_,
            desfecho: z.enum(DESFECHOS_ITEM_ROMANEIO),
            motivo: z.string().trim().max(1000).nullable().default(null),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const esquemaEnvio = z
  .object({
    origem: id_,
    destino: id_,
    itens: z
      .array(z.object({ item: id_, quantidade: z.number().positive().max(9_999_999) }).strict())
      .min(1)
      .max(200),
    observacao: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();

export const esquemaCancelamentoEnvio = z.object({ motivo: z.string().trim().max(500) }).strict();

export const esquemaCancelamento = z
  .object({ versao: z.number().int().positive(), motivo: z.string().trim().max(500) })
  .strict();

function chaveDe(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A Idempotency-Key do pedido falta ou é inválida.',
    );
  return k;
}

function idDe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'O romaneio ou o cadastro não existe.');
  return n;
}

function alvoDe(id: string | undefined, versao: number | undefined): { id: number; versao: number } | null {
  if (id === undefined) return null;
  if (versao === undefined)
    throw new ErroProblema('entrada-invalida', 400, 'Pedido incompleto', 'A alteração pede a versão lida.');
  return { id: idDe(id), versao };
}

@Controller('suprimentos/romaneios')
export class RomaneioEntregaController {
  constructor(@Inject(PORTA_ROMANEIO_ENTREGA) private readonly porta: PortaRomaneioEntrega) {}

  @Get()
  @Permissao(LER)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.porta.painel(sessaoDe(req).porta);
  }

  @Get(':id')
  @Permissao(LER)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.detalhe(sessaoDe(req).porta, idDe(id));
  }

  @Post('motoristas')
  @HttpCode(201)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.gravar-motorista pelo executor (trilha na mesma transação)')
  async novoMotorista(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { versao, ...e } = corpo(esquemaMotorista, b);
    if (versao !== undefined)
      throw new ErroProblema('entrada-invalida', 400, 'Pedido inválido', 'O cadastro novo não leva versão.');
    const r = await this.porta.gravarMotorista(sessaoDe(req).porta, e, null, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Motorista cadastrado.' };
  }

  @Post('motoristas/:id')
  @HttpCode(200)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.gravar-motorista pelo executor (trilha na mesma transação)')
  async alterarMotorista(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { versao, ...e } = corpo(esquemaMotorista, b);
    const r = await this.porta.gravarMotorista(sessaoDe(req).porta, e, alvoDe(id, versao), chaveDe(req));
    return { ok: true, ...r, mensagem: 'Motorista alterado.' };
  }

  @Post('veiculos')
  @HttpCode(201)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.gravar-veiculo pelo executor (trilha na mesma transação)')
  async novoVeiculo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { versao, ...e } = corpo(esquemaVeiculo, b);
    if (versao !== undefined)
      throw new ErroProblema('entrada-invalida', 400, 'Pedido inválido', 'O cadastro novo não leva versão.');
    const r = await this.porta.gravarVeiculo(sessaoDe(req).porta, e, null, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Veículo cadastrado.' };
  }

  @Post('veiculos/:id')
  @HttpCode(200)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.gravar-veiculo pelo executor (trilha na mesma transação)')
  async alterarVeiculo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { versao, ...e } = corpo(esquemaVeiculo, b);
    const r = await this.porta.gravarVeiculo(sessaoDe(req).porta, e, alvoDe(id, versao), chaveDe(req));
    return { ok: true, ...r, mensagem: 'Veículo alterado.' };
  }

  @Post()
  @HttpCode(201)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.montar pelo executor (trilha na mesma transação)')
  async montar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaMontagem, b);
    const r = await this.porta.montar(sessaoDe(req).porta, e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Romaneio ${r.numero} montado.` };
  }

  @Post('envios')
  @HttpCode(201)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.enviar-entre-unidades pelo executor (trilha na mesma transação)')
  async enviar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaEnvio, b);
    const r = await this.porta.enviar(sessaoDe(req).porta, e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Envio ${r.numero} registrado: aguarda o romaneio.` };
  }

  @Post('envios/:id/cancelamento')
  @HttpCode(200)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.cancelar-envio pelo executor (trilha na mesma transação)')
  async cancelarEnvio(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaCancelamentoEnvio, b);
    const r = await this.porta.cancelarEnvio(sessaoDe(req).porta, idDe(id), e.motivo, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Envio cancelado: o histórico continua.' };
  }

  @Post(':id/expedicao')
  @HttpCode(200)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.expedir pelo executor (trilha na mesma transação)')
  async expedir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaExpedicao, b);
    const r = await this.porta.expedir(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Romaneio expedido: em trânsito.' };
  }

  @Post(':id/conferencia')
  @HttpCode(200)
  @Permissao(RECEBER)
  @AuditadoNoHandler('suprimentos.romaneio.conferir pelo executor (trilha na mesma transação)')
  async conferir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaConferencia, b);
    const r = await this.porta.conferir(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Conferência registrada.' };
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  @Permissao(ENVIAR)
  @AuditadoNoHandler('suprimentos.romaneio.cancelar pelo executor (trilha na mesma transação)')
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaCancelamento, b);
    const r = await this.porta.cancelar(sessaoDe(req).porta, idDe(id), e.versao, e.motivo, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Romaneio cancelado: o histórico continua.' };
  }
}
