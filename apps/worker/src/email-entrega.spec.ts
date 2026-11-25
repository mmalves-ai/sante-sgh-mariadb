import { describe, expect, it } from 'vitest';
import { entregarComRegistro } from './email-entrega.js';
import type { TentativaDeEnvio } from './registro-envio-proprio.js';
import { montarMensagem, type MensagemEmail } from './smtp.js';

const montar = (para: string): MensagemEmail => ({
  de: 'c@d.invalid',
  para,
  assunto: 'Alerta',
  texto: 'Texto',
});
const registroFalso = (falha = false) => {
  const vistos: TentativaDeEnvio[] = [];
  return {
    vistos,
    registrar: async (t: TentativaDeEnvio) => {
      if (falha) throw new TypeError('banco fora');
      vistos.push(t);
      return { envio: vistos.length, situacao: 'capturado', tentativas: 1 };
    },
  };
};

describe('entrega com registro de envio', () => {
  it('cada destinatário recebe com identificador próprio e estável, e o aceite vai ao registro', async () => {
    const enviadas: MensagemEmail[] = [];
    const registro = registroFalso();
    const entrega = {
      chave: 'alerta-leitura.42',
      dominio: 'cliente-x',
      estabelecimento: 'H1',
      destinos: ['a@b.invalid', 'e@f.invalid'],
      montar,
      enviar: async (m: MensagemEmail) => void enviadas.push(m),
      registro,
    };
    expect(await entregarComRegistro(entrega)).toEqual([]);
    expect(enviadas.map((m) => m.idMensagem)).toEqual([
      '<alerta-leitura.42.1@cliente-x.invalid>',
      '<alerta-leitura.42.2@cliente-x.invalid>',
    ]);
    expect(registro.vistos).toEqual([
      {
        estabelecimento: 'H1',
        remetente: 'c@d.invalid',
        destinatario: 'a@b.invalid',
        assunto: 'Alerta',
        corpo: 'Texto',
        identificador: '<alerta-leitura.42.1@cliente-x.invalid>',
        aceito: true,
      },
      expect.objectContaining({ destinatario: 'e@f.invalid', aceito: true }),
    ]);
    // A nova tentativa da fila usa os mesmos identificadores.
    await entregarComRegistro(entrega);
    expect(enviadas[2]?.idMensagem).toBe(enviadas[0]?.idMensagem);
  });

  it('a falha do envio é registrada com o erro e relançada; os destinatários seguintes não são tentados', async () => {
    const registro = registroFalso();
    const erro = new Error('SMTP: resposta 550 inesperada');
    await expect(
      entregarComRegistro({
        chave: 'alerta-chamado.7',
        dominio: 'cliente-x',
        destinos: ['a@b.invalid', 'e@f.invalid'],
        montar,
        enviar: async () => {
          throw erro;
        },
        registro,
      }),
    ).rejects.toBe(erro);
    expect(registro.vistos).toEqual([
      expect.objectContaining({ destinatario: 'a@b.invalid', aceito: false, erro, estabelecimento: null }),
    ]);
  });

  it('a falha do registro não derruba a entrega nem causa reenvio: volta para o log', async () => {
    let enviadas = 0;
    const r = await entregarComRegistro({
      chave: 'alerta-suporte.9',
      dominio: 'cliente-x',
      destinos: ['a@b.invalid'],
      montar,
      enviar: async () => void enviadas++,
      registro: registroFalso(true),
    });
    expect(r).toEqual(['TypeError']);
    expect(enviadas).toBe(1);
  });

  it('sem registro (cliente sem banco no ambiente) a entrega segue', async () => {
    let enviadas = 0;
    expect(
      await entregarComRegistro({
        chave: 'x.1',
        dominio: 'c',
        destinos: ['a@b.invalid'],
        montar,
        enviar: async () => void enviadas++,
        registro: null,
      }),
    ).toEqual([]);
    expect(enviadas).toBe(1);
  });

  it('o identificador vai no cabeçalho da mensagem; identificador fora do formato é recusado', () => {
    const m = montarMensagem({ ...montar('a@b.invalid'), idMensagem: '<alerta.1.1@cliente-x.invalid>' });
    expect(m).toContain('\r\nMessage-ID: <alerta.1.1@cliente-x.invalid>\r\n');
    expect(montarMensagem(montar('a@b.invalid'))).not.toContain('Message-ID');
    expect(() =>
      montarMensagem({ ...montar('a@b.invalid'), idMensagem: '<x@y>\r\nBcc: z@w.invalid' }),
    ).toThrow(/Identificador/);
  });
});
