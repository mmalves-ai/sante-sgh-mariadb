// Entrega com registro (01-ADM L77): cada destinatário de um alerta recebe a mensagem com um identificador estável
// entre as tentativas da fila, e toda tentativa (aceita ou não) vai ao registro geral de envio. A falha do envio é
// registrada e relançada (a fila tenta de novo). A falha do próprio registro não derruba a entrega nem causa reenvio:
// é devolvida a quem chamou, que a põe no log.
import { identificadorDaMensagem } from '@sgh/dominio-acesso';
import type { RegistroEnvio } from './registro-envio-proprio.js';
import type { MensagemEmail } from './smtp.js';

export interface EntregaComRegistro {
  /** Chave da entrega na fila (tipo e número do job): a mesma em todas as tentativas. */
  readonly chave: string;
  readonly dominio: string;
  readonly estabelecimento?: string | null;
  readonly destinos: readonly string[];
  readonly montar: (para: string) => MensagemEmail;
  readonly enviar: (m: MensagemEmail) => Promise<void>;
  readonly registro: RegistroEnvio | null;
}

/** Devolve as falhas do registro (nomes dos erros), para o log; a falha do envio é relançada depois de registrada. */
export async function entregarComRegistro(e: EntregaComRegistro): Promise<string[]> {
  const falhasDoRegistro: string[] = [];
  const registrar = async (m: MensagemEmail, aceito: boolean, erro?: unknown) => {
    if (!e.registro) return;
    try {
      await e.registro.registrar({
        estabelecimento: e.estabelecimento ?? null,
        remetente: m.de,
        destinatario: m.para,
        assunto: m.assunto,
        corpo: m.texto,
        identificador: m.idMensagem ?? '',
        aceito,
        ...(aceito ? {} : { erro }),
      });
    } catch (x) {
      falhasDoRegistro.push(x instanceof Error ? x.name : 'erro');
    }
  };
  for (const [i, para] of e.destinos.entries()) {
    const m: MensagemEmail = {
      ...e.montar(para),
      idMensagem: identificadorDaMensagem(e.chave, i + 1, `${e.dominio}.invalid`),
    };
    try {
      await e.enviar(m);
    } catch (erro) {
      await registrar(m, false, erro);
      throw erro;
    }
    await registrar(m, true);
  }
  return falhasDoRegistro;
}
