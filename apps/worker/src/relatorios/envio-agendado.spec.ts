// Regra 5 (unidade): o e-mail leva só o link autenticado (nunca o arquivo nem os dados); os destinatários são os
// endereços e os e-mails dos grupos; a falha conta as seguidas e alerta o dono; fora de produção, só o coletor local.
import { describe, expect, it } from 'vitest';
import type { MensagemEmail } from '../smtp.js';
import { type DependenciasEnvio, processarEnvio, smtpPermitido } from './envio-agendado.js';

const ORIGEM = { tipo: 'vencido' as const, previsto: new Date('2026-11-20T07:30:00Z') };

const JOB = {
  rede: 'rede-teste',
  hospital: 'pc',
  agendamento: '12',
  titulo: 'Faturamento do mês',
  relatorio: 'Faturamento por convênio',
  link: 'http://127.0.0.1:5300/relatorios?relatorio=faturamentoPorConvenio&p.mesFim=mesAnterior',
  enderecos: ['diretoria@exemplo.invalid'],
  grupos: ['DIRETORIA'],
  dono: 'TI.CURADOR',
  registrar: true,
};

function deps(extra: Partial<DependenciasEnvio> = {}) {
  const enviados: MensagemEmail[] = [];
  const registros: unknown[] = [];
  const d: DependenciasEnvio = {
    ambiente: 'dev',
    smtpUrl: 'smtp://127.0.0.1:1325',
    remetente: 'relatorios@sgh.invalid',
    produto: 'Produto Teste',
    nomeEstabelecimento: async () => 'Estabelecimento Teste',
    enviar: async (m) => {
      enviados.push(m);
    },
    emails: async () => ({
      destinatarios: ['gerente@exemplo.invalid', 'diretoria@exemplo.invalid'],
      dono: 'ti@exemplo.invalid',
    }),
    alertaPadrao: null,
    reservar: async () => ({ envio: 7 }),
    registrar: async (_h, _a, r) => {
      registros.push(r);
    },
    falhasAntes: async () => 2,
    ...extra,
  };
  return { d, enviados, registros };
}

describe('envio agendado (regra 5)', () => {
  it('manda só o link, a cada destinatário uma vez, e registra o envio (as falhas zeram)', async () => {
    const { d, enviados, registros } = deps();
    const r = await processarEnvio(JOB, d, ORIGEM);
    expect(r).toMatchObject({
      destinatarios: 2,
      enviados: 2,
      situacao: 'enviado',
      falha: null,
      alertouDono: false,
    });
    expect(enviados.map((m) => m.para).sort()).toEqual([
      'diretoria@exemplo.invalid',
      'gerente@exemplo.invalid',
    ]);
    for (const m of enviados) {
      expect(m.texto).toContain(JOB.link);
      expect(m.texto).toContain('não leva o arquivo nem os dados');
      expect(m.assunto).toBe('Faturamento do mês (Estabelecimento Teste)');
    }
    expect(registros).toEqual([
      {
        envio: 7,
        situacao: 'enviado',
        falha: null,
        falhasSeguidas: 0,
        destinatarios: 2,
        enderecos: ['diretoria@exemplo.invalid', 'gerente@exemplo.invalid'],
      },
    ]);
  });

  it('a falha soma as seguidas e alerta o dono (toda falha alerta)', async () => {
    const { d, enviados, registros } = deps({
      enviar: async (m) => {
        if (m.para !== 'ti@exemplo.invalid') throw new Error('550 caixa inexistente');
        enviados.push(m);
      },
    });
    const r = await processarEnvio(JOB, d, ORIGEM);
    expect(r.situacao).toBe('falhou');
    expect(r.alertouDono).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.assunto).toMatch(/^Falha no envio agendado: Faturamento do mês/);
    expect(enviados[0]!.texto).toContain('3 vezes seguidas');
    expect(registros).toEqual([
      {
        envio: 7,
        situacao: 'falhou',
        falha: 'envio recusado (550 caixa inexistente)',
        falhasSeguidas: 3,
        destinatarios: 2,
        enderecos: ['diretoria@exemplo.invalid', 'gerente@exemplo.invalid'],
      },
    ]);
  });

  it('fora de produção, só o coletor local: SMTP fora do loopback é recusado sem enviar', async () => {
    expect(smtpPermitido('dev', 'smtp://127.0.0.1:1325')).toBe(true);
    expect(smtpPermitido('dev', 'smtp://smtp.exemplo.com:25')).toBe(false);
    expect(smtpPermitido('homolog', 'smtp://smtp.exemplo.com:25')).toBe(false);
    expect(smtpPermitido('producao', 'smtp://smtp.exemplo.com:25')).toBe(true);
    const { d, enviados } = deps({ smtpUrl: 'smtp://smtp.exemplo.com:25' });
    const r = await processarEnvio(JOB, d, ORIGEM);
    expect(r.falha).toMatch(/fora do coletor local/);
    expect(enviados).toHaveLength(0);
  });

  it('sem destinatário com e-mail, falha com o motivo; job fora do formato é recusado', async () => {
    const { d } = deps({ emails: async () => ({ destinatarios: [], dono: null }) });
    expect((await processarEnvio({ ...JOB, enderecos: [] }, d, ORIGEM)).falha).toBe('nenhum destinatário com e-mail');
    await expect(processarEnvio({ ...JOB, anexo: 'arquivo.xlsx' }, d, ORIGEM)).rejects.toThrow();
    await expect(processarEnvio({ ...JOB, link: 'ftp://x' }, d, ORIGEM)).rejects.toThrow();
  });

  it('na sessão sintética (registrar falso) não grava resultado', async () => {
    const { d, registros } = deps();
    await processarEnvio({ ...JOB, registrar: false }, d);
    expect(registros).toEqual([]);
  });

  it('avisar_falha falso: a falha não alerta o dono', async () => {
    const { d, enviados, registros } = deps({
      emails: async () => ({ destinatarios: ['gerente@exemplo.invalid'], dono: 'ti@exemplo.invalid', avisarFalha: false }),
      enviar: async (m) => {
        if (m.para !== 'ti@exemplo.invalid') throw new Error('550 caixa inexistente');
        enviados.push(m);
      },
    });
    const r = await processarEnvio(JOB, d, ORIGEM);
    expect(r).toMatchObject({ situacao: 'falhou', alertouDono: false });
    expect(enviados).toEqual([]);
    expect(registros).toHaveLength(1);
  });

  it('a reserva vem antes do e-mail: sem a reserva (outro já fez) não envia nem grava', async () => {
    const ordem: string[] = [];
    const { d, enviados, registros } = deps({
      reservar: async () => {
        ordem.push('reservar');
        return null;
      },
    });
    const r = await processarEnvio(JOB, d, ORIGEM);
    expect(r).toMatchObject({ repetido: true, enviados: 0 });
    expect(enviados).toEqual([]);
    expect(registros).toEqual([]);
    expect(ordem).toEqual(['reservar']);
  });

  it('falha ao gravar o resultado: a nova tentativa do job (mesma chave) não manda o e-mail de novo', async () => {
    const reservadas = new Set<string>();
    let falharRegistro = true;
    const { d, enviados } = deps({
      reservar: async (_h, ag, origem) => {
        const k = `${ag}:${origem.tipo === 'fila' ? origem.job : origem.previsto.toISOString()}`;
        if (reservadas.has(k)) return null;
        reservadas.add(k);
        return { envio: 9 };
      },
      registrar: async () => {
        if (falharRegistro) throw new Error('conflito');
      },
    });
    const origem = { tipo: 'fila' as const, job: 'relatorio-x:42' };
    await expect(processarEnvio(JOB, d, origem)).rejects.toThrow('conflito');
    expect(enviados).toHaveLength(2);
    falharRegistro = false;
    expect((await processarEnvio(JOB, d, origem)).repetido).toBe(true);
    expect(enviados).toHaveLength(2);
  });

  it('com registro e sem origem, recusa antes de enviar', async () => {
    const { d, enviados } = deps();
    await expect(processarEnvio(JOB, d)).rejects.toThrow(/origem/);
    expect(enviados).toEqual([]);
  });
});
