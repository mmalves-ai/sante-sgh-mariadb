import { redigir, redigirArgumentoLog } from '@sgh/contratos';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/** Campos sempre ocultos no log (ficha do M05 §10: senha, CPF, token e cookie nunca vão a log). */
export const CAMINHOS_OCULTOS = [
  'senha',
  '*.senha',
  '*.SENHA',
  '*.senhaAtual',
  '*.senhaNova',
  '*.novaSenha',
  '*.segredo',
  '*.csrf',
  '*.cpf',
  '*.CPF',
  // O CPF da ficha do usuário (só para a plataforma) fica em usuario.cpf, dois níveis abaixo.
  '*.*.cpf',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf"]',
  'res.headers["set-cookie"]',
];

/**
 * Opções do pino com redação de dado pessoal: campos de senha, token e cookie por caminho (M05) e, em todo
 * objeto de log, CPF, nome, telefone, e-mail, CNS e texto clínico ocultos (M09, regra 12;
 * packages/contratos/src/redacao.ts), inclusive no texto livre da mensagem.
 */
export function opcoesLogger(app: string, nivel = process.env['LOG_NIVEL'] ?? 'info'): LoggerOptions {
  return {
    level: nivel,
    base: { app },
    redact: { paths: CAMINHOS_OCULTOS, censor: '[oculto]' },
    formatters: { log: (objeto) => redigir(objeto) },
    hooks: {
      logMethod(args, metodo) {
        metodo.apply(this, args.map(redigirArgumentoLog) as Parameters<typeof metodo>);
      },
    },
  };
}

/** Opções do log da API (M05). */
export function opcoesLog(nivel: string = process.env['LOG_NIVEL'] ?? 'info'): LoggerOptions {
  return opcoesLogger('api', nivel);
}

export function criarLogger(destino?: DestinationStream, nivel?: string): Logger {
  return destino ? pino(opcoesLog(nivel), destino) : pino(opcoesLog(nivel));
}

/** Log JSON (pino) com redação de campos sensíveis desde o primeiro dia. */
export const logger = criarLogger();
