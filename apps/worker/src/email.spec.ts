// M06: alerta da quebra de vidro pela fila email: mensagem só com identificadores e cliente SMTP mínimo,
// provado contra um servidor SMTP falso em loopback (nada sai da máquina).
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  destinoAlertaChamado,
  dominioDoCliente,
  enderecosDoValor,
  ErroDestinatarioNaoConfigurado,
  mensagemDoAlerta,
  mensagemDoAlertaLeitura,
  mensagemDoAlertaSuporte,
  resolverDestino,
} from './email.service.js';
import { dadosDoJobOutbox } from './relay-outbox.js';
import { enviarSmtp, montarMensagem } from './smtp.js';

const job = {
  rede: 'rede-teste',
  hospital: 'pc',
  idEmergencia: '42',
  idUsuario: '900001',
  motivo: 'intercorrencia-outro-setor',
  inicio: '2026-10-20T10:00:00.000Z',
  fim: '2026-10-20T11:00:00.000Z',
};

let servidor: Server | null = null;
afterEach(async () => {
  await new Promise<void>((ok) => (servidor ? servidor.close(() => ok()) : ok()));
  servidor = null;
});

function smtpFalso(recebido: string[]): Promise<number> {
  return new Promise((ok) => {
    servidor = createServer((s) => {
      s.setEncoding('utf8');
      let dados = false;
      let buf = '';
      s.write('220 falso\r\n');
      s.on('data', (d: string) => {
        buf += d;
        if (dados) {
          if (buf.includes('\r\n.\r\n')) {
            recebido.push(buf);
            buf = '';
            dados = false;
            s.write('250 aceito\r\n');
          }
          return;
        }
        for (;;) {
          const i = buf.indexOf('\r\n');
          if (i < 0) break;
          const linha = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (linha.startsWith('EHLO')) s.write('250-falso\r\n250 OK\r\n');
          else if (linha.startsWith('DATA')) {
            dados = true;
            s.write('354 envie\r\n');
          } else if (linha.startsWith('QUIT')) s.end('221 tchau\r\n');
          else s.write('250 OK\r\n');
        }
      });
    });
    servidor.listen(0, '127.0.0.1', () => ok((servidor!.address() as { port: number }).port));
  });
}

describe('fila email: alerta de leitura do prontuário (M15, regra 12)', () => {
  it('só códigos; tipo, criticidade e campo fora do formato recusados', () => {
    const j = {
      rede: 'rede-x',
      hospital: 'pc',
      idUsuario: '77',
      tipo: 'fora-do-horario' as const,
      criticidade: 4,
      em: '2026-10-20T02:00:00.000Z',
    };
    const m = mensagemDoAlertaLeitura(j, 'a@x.invalid', 'b@x.invalid');
    expect(m.assunto).toBe('Alerta de leitura do prontuário (pc)');
    expect(m.texto).toContain('fora do horário habitual');
    expect(
      mensagemDoAlertaLeitura({ ...j, tipo: 'muitos-prontuarios', criticidade: 2 }, 'a', 'b').texto,
    ).toContain('muitos prontuários');
    expect(() => mensagemDoAlertaLeitura({ ...j, criticidade: 9 }, 'a', 'b')).toThrow();
    expect(() => mensagemDoAlertaLeitura({ ...j, idUsuario: 'NOME COM ESPAÇO' }, 'a', 'b')).toThrow();
  });
});

describe('fila email: alerta ao Auditor (regra 8)', () => {
  it('a mensagem só tem identificadores; campo fora do formato é recusado', () => {
    const m = mensagemDoAlerta(job, 'auditoria@rede-teste.invalid', 'nao-responda@rede-teste.invalid');
    expect(m.assunto).toBe('Acesso de emergência nº 42 (pc)');
    expect(m.texto).toContain('Registro: 42');
    expect(() => mensagemDoAlerta({ ...job, motivo: 'texto livre com espaço' }, 'a@b.c', 'd@e.f')).toThrow();
    const bruta = montarMensagem(m, new Date(0));
    expect(bruta).toMatch(/^From: nao-responda@rede-teste\.invalid\r\nTo: auditoria@/);
    expect(bruta).toContain('Subject: =?UTF-8?B?');
    expect(() => montarMensagem({ ...m, para: 'sem arroba' })).toThrow(/inválido/);
  });

  it('aviso do suporte vindo da outbox: estabelecimento da sessão (não o banco da plataforma); carga incompleta recusada', () => {
    const carga = {
      estabelecimento: 'aa',
      idSessao: '4242',
      atorTipo: 'suporte',
      idUsuario: '900123',
      motivo: 'CHAMADO-1',
      inicio: '2026-10-20T10:00:00.000Z',
      fim: '2026-10-20T11:00:00.000Z',
    };
    const ev = {
      id: '1',
      cliente: 'rede_teste',
      hospital: 'aa',
      tipo: 'alerta-suporte',
      chave: 'k',
      carga,
      tentativas: 0,
    };
    const m = mensagemDoAlertaSuporte(dadosDoJobOutbox(ev), 'a@b.invalid', 'c@d.invalid', ev.cliente);
    expect(m.assunto).toBe('Acesso do suporte técnico nº 4242 (aa)');
    expect(m.texto).toContain('Usuário (ID) em nome de quem: 900123');
    expect(dominioDoCliente('rede_teste')).toBe('rede-teste');
    const antiga = Object.fromEntries(
      Object.entries(carga).filter(([k]) => !['idUsuario', 'inicio', 'fim'].includes(k)),
    );
    expect(() =>
      mensagemDoAlertaSuporte(dadosDoJobOutbox({ ...ev, carga: antiga }), 'a@b.invalid', 'c@d.invalid', ev.cliente),
    ).toThrow(/fora do formato/);
  });

  it('entrega por SMTP e só responde depois do 250 da mensagem', async () => {
    const recebido: string[] = [];
    const porta = await smtpFalso(recebido);
    await enviarSmtp(`smtp://127.0.0.1:${porta}`, mensagemDoAlerta(job, 'a@b.invalid', 'c@d.invalid'));
    expect(recebido).toHaveLength(1);
    expect(Buffer.from((recebido[0] ?? '').split('\r\n\r\n')[1] ?? '', 'base64').toString('utf8')).toContain(
      'Registro: 42',
    );
    await expect(enviarSmtp('http://x', mensagemDoAlerta(job, 'a@b.invalid', 'c@d.invalid'))).rejects.toThrow(
      /smtp/,
    );
  });
});

describe('fila email: destinatário por cliente (nunca uma caixa comum a todos)', () => {
  const PROD = { AMBIENTE: 'producao', AUDITORIA_EMAIL: 'caixa-comum@x.invalid', ENCARREGADO_EMAIL: 'dpo-comum@x.invalid' };
  const A = { auditoria: ['auditor@cliente-a.invalid'], encarregado: ['dpo@cliente-a.invalid'] };
  const B = { auditoria: ['auditor@cliente-b.invalid'] };

  it('em produção cada cliente usa a própria configuração; a variável de ambiente é ignorada', () => {
    expect(resolverDestino(A, PROD, 'cliente-a', ['auditoria'])).toEqual(['auditor@cliente-a.invalid']);
    expect(resolverDestino(B, PROD, 'cliente-b', ['auditoria'])).toEqual(['auditor@cliente-b.invalid']);
    expect(destinoAlertaChamado(A, PROD, 'cliente-a', 'dado-pessoal')).toEqual(['dpo@cliente-a.invalid']);
    // Sem encarregado configurado, cai na auditoria do próprio cliente, não na do ambiente.
    expect(destinoAlertaChamado(B, PROD, 'cliente-b', 'dado-pessoal')).toEqual(['auditor@cliente-b.invalid']);
    expect(resolverDestino({ ...A, ti: ['ti@cliente-a.invalid'] }, PROD, 'cliente-a', ['ti', 'responsavelTecnico'])).toEqual([
      'ti@cliente-a.invalid',
      'auditor@cliente-a.invalid',
    ]);
  });

  it('em produção, cliente sem destinatário: recusa visível (nunca um endereço comum)', () => {
    expect(() => resolverDestino({}, PROD, 'cliente-c', ['auditoria'])).toThrow(ErroDestinatarioNaoConfigurado);
  });

  it('fora de produção, a variável desvia para a captura; sem nada, o endereço .invalid do cliente', () => {
    expect(resolverDestino(A, { AMBIENTE: 'dev', AUDITORIA_EMAIL: 'captura@local.invalid' }, 'cliente-a', ['auditoria'])).toEqual([
      'captura@local.invalid',
    ]);
    expect(resolverDestino({}, { AMBIENTE: 'homolog' }, 'cliente-c', ['plantao'])).toEqual(['auditoria@cliente-c.invalid']);
  });

  it('o valor do parâmetro aceita vários endereços e descarta o malformado', () => {
    expect(enderecosDoValor('a@b.invalid; c@d.invalid, sem-arroba ,a@b.invalid')).toEqual(['a@b.invalid', 'c@d.invalid']);
  });
});
