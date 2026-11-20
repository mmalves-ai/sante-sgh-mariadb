// Regra 5 (unidade): o e-mail leva só o link autenticado (nunca o arquivo nem os dados); os destinatários são os
// endereços e os e-mails dos grupos; a falha conta as seguidas e alerta o dono; fora de produção, só o coletor local.
import { describe, expect, it } from 'vitest';
import type { MensagemEmail } from '../smtp.js';
import { type DependenciasEnvio, processarEnvio, smtpPermitido } from './envio-agendado.js';

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
    nomeEstabelecimento: () => 'Estabelecimento Teste',
    enviar: async (m) => {
      enviados.push(m);
    },
    emails: async () => ({
      destinatarios: ['gerente@exemplo.invalid', 'diretoria@exemplo.invalid'],
      dono: 'ti@exemplo.invalid',
    }),
    alertaPadrao: null,
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
    const r = await processarEnvio(JOB, d);
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
    expect(registros).toEqual([{ situacao: 'enviado', falha: null, falhasSeguidas: 0 }]);
  });

  it('a falha soma as seguidas e alerta o dono (toda falha alerta)', async () => {
    const { d, enviados, registros } = deps({
      enviar: async (m) => {
        if (m.para !== 'ti@exemplo.invalid') throw new Error('550 caixa inexistente');
        enviados.push(m);
      },
    });
    const r = await processarEnvio(JOB, d);
    expect(r.situacao).toBe('falhou');
    expect(r.alertouDono).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.assunto).toMatch(/^Falha no envio agendado: Faturamento do mês/);
    expect(enviados[0]!.texto).toContain('3 vezes seguidas');
    expect(registros).toEqual([
      { situacao: 'falhou', falha: 'envio recusado (550 caixa inexistente)', falhasSeguidas: 3 },
    ]);
  });

  it('fora de produção, só o coletor local: SMTP fora do loopback é recusado sem enviar', async () => {
    expect(smtpPermitido('dev', 'smtp://127.0.0.1:1325')).toBe(true);
    expect(smtpPermitido('dev', 'smtp://smtp.exemplo.com:25')).toBe(false);
    expect(smtpPermitido('homolog', 'smtp://smtp.exemplo.com:25')).toBe(false);
    expect(smtpPermitido('producao', 'smtp://smtp.exemplo.com:25')).toBe(true);
    const { d, enviados } = deps({ smtpUrl: 'smtp://smtp.exemplo.com:25' });
    const r = await processarEnvio(JOB, d);
    expect(r.falha).toMatch(/fora do coletor local/);
    expect(enviados).toHaveLength(0);
  });

  it('sem destinatário com e-mail, falha com o motivo; job fora do formato é recusado', async () => {
    const { d } = deps({ emails: async () => ({ destinatarios: [], dono: null }) });
    expect((await processarEnvio({ ...JOB, enderecos: [] }, d)).falha).toBe('nenhum destinatário com e-mail');
    await expect(processarEnvio({ ...JOB, anexo: 'arquivo.xlsx' }, d)).rejects.toThrow();
    await expect(processarEnvio({ ...JOB, link: 'ftp://x' }, d)).rejects.toThrow();
  });

  it('na sessão sintética (registrar falso) não grava resultado', async () => {
    const { d, registros } = deps();
    await processarEnvio({ ...JOB, registrar: false }, d);
    expect(registros).toEqual([]);
  });
});
