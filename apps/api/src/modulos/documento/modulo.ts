// Módulo do documento (M09) na API migrada (F2.2): a emissão de PDF/A imutável com QR de validação pública, a fila
// de etiquetas ZPL e a chave do QZ Tray (DocumentoController), sobre a FONTE_DOCUMENTO. É global: as telas de outros
// módulos (farmácia, especialidades, prontuário) emitem por ela quando o módulo está montado.
// O registro das emissões no banco (registroEmissoesDaRequisicao: um RegistroEmissoesPropria por requisição, com o
// cliente, o estabelecimento e o usuário da sessão; tabela emissao_documento) espera o pedido de DDL do lote 02-06 e
// a opção do registro por requisição em criarFonteDocumento (pedido ao integrador; fonte.ts é de outro lote). Até lá,
// a fonte usa o registro em memória do processo, como antes.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { DocumentoController } from './documento.controller.js';
import { criarFonteDocumento, FONTE_DOCUMENTO, type FonteDocumento } from './fonte.js';
import { armazemArquivosDoAmbiente, estabelecimentoDoCliente } from './infra/arquivos.js';

export interface OpcoesModuloDocumento {
  /** Testes: a fonte já montada. */
  readonly fonte?: FonteDocumento;
}

@Module({})
export class ModuloDocumento {}

export function moduloDocumento(ctx: ContextoModulo, opcoes: OpcoesModuloDocumento = {}): DynamicModule {
  const env = ctx.env as NodeJS.ProcessEnv;
  // ADR 0004: os PDFs vão à porta de arquivos do núcleo (disco local do cliente); sem núcleo, memória só na sessão
  // sintética.
  const armazem = armazemArquivosDoAmbiente({
    nucleo: ctx.nucleo,
    cliente: ctx.configuracao.clientePadrao,
    sintetico: fontesSinteticas(ctx.env, ctx.nucleo !== null),
    env,
  });
  // Com o banco próprio, o arquivo leva o estabelecimento do pedido (mapa código → id do cliente; fora dele, recusa).
  const cliente = ctx.configuracao.clientePadrao;
  const fonte =
    opcoes.fonte ??
    criarFonteDocumento(ctx.configuracao, env, {
      armazem,
      ...(ctx.nucleo && cliente ? { idEstabelecimento: estabelecimentoDoCliente(cliente, ctx.nucleo) } : {}),
    });
  return {
    module: ModuloDocumento,
    global: true,
    controllers: [DocumentoController],
    providers: [{ provide: FONTE_DOCUMENTO, useValue: fonte }],
    exports: [FONTE_DOCUMENTO],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloDocumento(ctx);
}
