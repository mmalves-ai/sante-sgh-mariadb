// Logger interno do NestJS ligado ao pino com redação (revisão do M09): sem isto, as mensagens do próprio Nest
// (exceção não tratada, erro de inicialização, mensagem do Firebird com o valor de uma chave) iam pelo
// ConsoleLogger, sem máscara. Forma estrutural do LoggerService do Nest (sem importar o Nest aqui); só os
// níveis error, warn e fatal saem (os mesmos de antes: `logger: ['error', 'warn']`). A redação é a do pino
// da aplicação (formatters.log e hooks.logMethod); aqui o texto e o erro já vão redigidos também.
import { redigir, redigirArgumentoLog } from './redacao.js';

export interface DestinoLogNest {
  error(objeto: object, mensagem: string): void;
  warn(objeto: object, mensagem: string): void;
  fatal(objeto: object, mensagem: string): void;
}

export interface LoggerNest {
  log(mensagem: unknown, ...parametros: unknown[]): void;
  error(mensagem: unknown, ...parametros: unknown[]): void;
  warn(mensagem: unknown, ...parametros: unknown[]): void;
  debug(mensagem: unknown, ...parametros: unknown[]): void;
  verbose(mensagem: unknown, ...parametros: unknown[]): void;
  fatal(mensagem: unknown, ...parametros: unknown[]): void;
}

function montar(mensagem: unknown, parametros: unknown[]): [object, string] {
  // O Nest passa o contexto (nome da classe) como último parâmetro de texto.
  const contexto = typeof parametros.at(-1) === 'string' ? (parametros.at(-1) as string) : undefined;
  const resto = contexto === undefined ? parametros : parametros.slice(0, -1);
  const m = redigirArgumentoLog(mensagem);
  const texto = m instanceof Error ? `${m.name}: ${m.message}` : typeof m === 'string' ? m : 'log do Nest';
  const objeto: Record<string, unknown> = { origem: 'nest' };
  if (contexto) objeto['contexto'] = contexto;
  if (m instanceof Error) objeto['erro'] = { name: m.name, message: m.message, stack: m.stack };
  else if (typeof m !== 'string') objeto['detalhe'] = redigir(m);
  if (resto.length) objeto['parametros'] = redigir(resto.map(redigirArgumentoLog));
  return [objeto, texto];
}

export function loggerNest(destino: DestinoLogNest): LoggerNest {
  return {
    log: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
    error: (m, ...p) => destino.error(...montar(m, p)),
    warn: (m, ...p) => destino.warn(...montar(m, p)),
    fatal: (m, ...p) => destino.fatal(...montar(m, p)),
  };
}
