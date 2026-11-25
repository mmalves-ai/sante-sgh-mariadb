// Teste de conexão do servidor de e-mail (01-ADM L77): abre a conexão, espera a saudação do servidor (220) e o
// aceite da apresentação (250); com STARTTLS, confere que o servidor o anuncia. Não autentica nem envia mensagem: a
// senha fica no cofre e não passa por aqui.
// Fora de produção (regra de nenhuma mensagem externa), só o servidor local (loopback ou container da própria
// máquina) é contatado; qualquer outro endereço é recusado sem abrir conexão.
import { connect as conectarTcp, type Socket } from 'node:net';
import { connect as conectarTls } from 'node:tls';
import { type Ambiente, containersLocais, ehDestinoLocal, envioExternoPermitido } from '@sgh/nucleo';
import { resumoDoErro } from '@sgh/dominio-acesso';

export interface ServidorParaTeste {
  readonly host: string;
  readonly porta: number;
  readonly seguranca: string;
  readonly tempoLimiteSegundos: number;
}
export type ResultadoTesteConexao =
  | { readonly neutralizado: true }
  | { readonly neutralizado?: false; readonly sucesso: boolean; readonly detalhe: string };
export type TestadorConexao = (s: ServidorParaTeste) => Promise<ResultadoTesteConexao>;

function conversar(socket: Socket, starttls: boolean, tempoMs: number): Promise<string> {
  return new Promise((ok, falha) => {
    socket.setEncoding('utf8');
    socket.setTimeout(tempoMs, () => socket.destroy(new Error('SMTP: tempo esgotado')));
    let buffer = '';
    let etapa: 'saudacao' | 'apresentacao' = 'saudacao';
    let recursos = '';
    socket.once('error', falha);
    socket.once('close', () => falha(new Error('SMTP: conexão fechada')));
    socket.on('data', (d: string) => {
      buffer += d;
      for (;;) {
        const i = buffer.indexOf('\r\n');
        if (i < 0) break;
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (etapa === 'apresentacao') recursos += `${linha.slice(4).toUpperCase()}\n`;
        if (/^\d{3}-/.test(linha)) continue;
        if (etapa === 'saudacao') {
          if (!linha.startsWith('220'))
            return falha(new Error(`SMTP: resposta ${linha.slice(0, 3)} inesperada`));
          etapa = 'apresentacao';
          socket.write('EHLO sgh-api\r\n');
          continue;
        }
        if (!linha.startsWith('250'))
          return falha(new Error(`SMTP: resposta ${linha.slice(0, 3)} inesperada`));
        socket.write('QUIT\r\n');
        if (starttls && !/^STARTTLS\b/m.test(recursos))
          return ok('O servidor respondeu, mas não oferece STARTTLS.');
        return ok('');
      }
    });
  });
}

/** O testador real, preso ao ambiente: fora de produção só fala com o servidor local. */
export function testadorDoAmbiente(env: Ambiente): TestadorConexao {
  return async (s) => {
    if (!envioExternoPermitido(env) && !ehDestinoLocal(s.host, containersLocais(env)))
      return { neutralizado: true };
    const tempoMs = Math.min(Math.max(s.tempoLimiteSegundos, 5), 300) * 1000;
    const socket: Socket =
      s.seguranca === 'ssl_tls'
        ? conectarTls({ host: s.host, port: s.porta, servername: s.host })
        : conectarTcp({ host: s.host, port: s.porta });
    try {
      const aviso = await conversar(socket, s.seguranca === 'starttls', tempoMs);
      return aviso ? { sucesso: false, detalhe: aviso } : { sucesso: true, detalhe: 'Servidor respondeu.' };
    } catch (e) {
      return { sucesso: false, detalhe: resumoDoErro(e) };
    } finally {
      socket.removeAllListeners('close');
      socket.destroy();
    }
  };
}
